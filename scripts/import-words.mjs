#!/usr/bin/env node
// Import Words-tier content (see words-contentful-spec.md) from a batch file.
// Creates DRAFT `word` entries and sets each city's wordsPreamble + wordsVariant
// (leaves wordsPublished untouched — flip that per city once it validates).
//
//   node scripts/import-words.mjs path/to/words-content-batch-1.json [more.json ...]
//   flags: --only=Lisbon,Madrid   --publish (publish the words it creates)
//
// Idempotent: skips words that already exist for a city (by slot + deepCutOrder
// + local), so re-running is safe.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function fail(m){ console.error('\n✖ '+m+'\n'); process.exit(1) }
function loadEnv(){
  const p = join(ROOT, '.env'); if (!existsSync(p)) fail('No .env')
  const env = {}
  for (const line of readFileSync(p,'utf8').split('\n')){
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'')
  }
  return env
}
const env = loadEnv()
const SPACE = env.VITE_CONTENTFUL_SPACE
const CMA = env.CONTENTFUL_MANAGEMENT_TOKEN
async function cma(path, opts={}, attempt=0){
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: { 'Authorization':'Bearer '+CMA, 'Content-Type':'application/vnd.contentful.management.v1+json', ...(opts.headers||{}) },
  })
  // Back off and retry on rate-limit / transient errors — a 1,150-entry run
  // will otherwise trip Contentful's per-second cap.
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const wait = Number(res.headers.get('X-Contentful-RateLimit-Reset')) * 1000 || (500 * 2 ** attempt)
    await new Promise(r=>setTimeout(r, Math.max(wait, 500)))
    return cma(path, opts, attempt+1)
  }
  const body = res.status === 204 ? null : await res.json().catch(()=>null)
  if (!res.ok) throw new Error(`CMA ${opts.method||'GET'} ${path} → ${res.status}: ${body?.message||JSON.stringify(body)}`)
  return body
}
const sleep = ms => new Promise(r=>setTimeout(r,ms))
// Diacritic-insensitive city match: "Krakow" ⇄ "Kraków", "Reykjavik" ⇄ "Reykjavík".
const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toLowerCase()

const args = process.argv.slice(2)
const files = args.filter(a=>!a.startsWith('--'))
if (!files.length) fail('Pass one or more batch JSON files.')
const only = (args.find(a=>a.startsWith('--only='))||'').replace('--only=','').split(',').filter(Boolean)
const doPublish = args.includes('--publish')

const L = 'en-US'
const ct = await cma('/content_types/word')
const fieldType = Object.fromEntries(ct.fields.map(f=>[f.id,f.type]))
const coerce = (id,v)=> fieldType[id]==='Integer' ? Number(v) : fieldType[id]==='Boolean' ? Boolean(v) : v

// City entries (management), keyed by normalized name.
let cities = [], skip = 0
while (true) { const pg = await cma('/entries?content_type=city&limit=100&skip='+skip); cities = cities.concat(pg.items); skip += 100; if (skip>=pg.total) break }
const cityByName = new Map(cities.map(c=>[norm(c.fields.cityName?.[L]), c]))

// Field keys copied straight through from the batch word object.
const WORD_KEYS = ['slot','local','phonetic','meaning','context','groupNote','phoneticApproximate','deepCutOrder']

let created=0, skipped=0, failed=0, published=0, citiesTouched=0
for (const file of files) {
  const data = JSON.parse(readFileSync(resolve(file),'utf8'))
  for (const cityBlock of data.cities) {
    if (only.length && !only.map(norm).includes(norm(cityBlock.city))) continue
    const cityEntry = cityByName.get(norm(cityBlock.city))
    if (!cityEntry) { console.log(`– skipped city "${cityBlock.city}": no matching city entry`); continue }
    const cityId = cityEntry.sys.id
    const cityName = cityEntry.fields.cityName[L]
    citiesTouched++
    console.log(`\n== ${cityName} (${cityBlock.wordsVariant||'standard'}) ==`)

    // 1. Set the city's preamble + variant, re-publishing if it was published.
    try {
      const fresh = await cma('/entries/'+cityId)
      fresh.fields.wordsPreamble = { [L]: cityBlock.wordsPreamble }
      fresh.fields.wordsVariant = { [L]: cityBlock.wordsVariant || 'standard' }
      const wasPub = !!fresh.sys.publishedVersion
      const put = await cma('/entries/'+cityId, { method:'PUT', headers:{ 'X-Contentful-Version': String(fresh.sys.version), 'X-Contentful-Content-Type':'city' }, body: JSON.stringify({ fields: fresh.fields }) })
      if (wasPub) await cma('/entries/'+cityId+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(put.sys.version) } })
      console.log(`  ✎ preamble + variant set${wasPub?' (re-published)':''}`)
    } catch(e){ console.log(`  ! city update failed: ${e.message}`) }

    // 2. Existing words for this city → dedup keys.
    let existing = [], es = 0
    while (true) { const pg = await cma(`/entries?content_type=word&fields.city.sys.id=${cityId}&limit=100&skip=${es}`); existing = existing.concat(pg.items); es += 100; if (es>=pg.total) break }
    const key = w => `${w.slot}#${w.deepCutOrder??''}#${w.local}`
    const seen = new Set(existing.map(e=>key({ slot:e.fields.slot?.[L], deepCutOrder:e.fields.deepCutOrder?.[L], local:e.fields.local?.[L] })))

    // 3. Create each word.
    for (const w of cityBlock.words) {
      if (seen.has(key(w))) { skipped++; continue }
      const fields = {
        title: { [L]: `${cityName} · ${w.local}` },
        city: { [L]: { sys: { type:'Link', linkType:'Entry', id: cityId } } },
      }
      for (const k of WORD_KEYS) if (w[k] != null && w[k] !== '') fields[k] = { [L]: coerce(k, w[k]) }
      try {
        const entry = await cma('/entries', { method:'POST', headers:{ 'X-Contentful-Content-Type':'word' }, body: JSON.stringify({ fields }) })
        if (doPublish) { await cma('/entries/'+entry.sys.id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(entry.sys.version) } }); published++ }
        created++
        seen.add(key(w))
      } catch(e){ console.log(`  ✗ "${w.local}" (${w.slot}): ${e.message}`); failed++ }
      await sleep(120) // stay under CMA rate limits
    }
    console.log(`  ✓ ${cityName}: created ${created}, skipped ${skipped} so far`)
  }
}
console.log(`\nDone. ${citiesTouched} cities · ${created} words created${doPublish?` (${published} published)`:' as DRAFTS'} · ${skipped} skipped · ${failed} failed.`)
if (!doPublish && created) console.log('Words are DRAFTS. Publish them and flip each city\'s wordsPublished once it validates.')
