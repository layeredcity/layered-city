#!/usr/bin/env node
// One-off content pass: shorten `how-much` to the bare "how much?" a traveler
// would actually say, meaning "how much?", context cleared. All 26 standard
// cities (english cities have no such slot). Republishes each entry.
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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
async function cma(path, opts={}){
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: { 'Authorization':'Bearer '+CMA, 'Content-Type':'application/vnd.contentful.management.v1+json', ...(opts.headers||{}) },
  })
  const body = res.status === 204 ? null : await res.json().catch(()=>null)
  if (!res.ok) throw new Error(`CMA ${opts.method||'GET'} ${path} → ${res.status}: ${body?.message||JSON.stringify(body)}`)
  return body
}
const L = 'en-US'
const norm = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()

// city → [ local, phonetic ]. The bare "how much?".
const DATA = {
  Lisbon:     ['Quanto?','KWAN-too'],
  Madrid:     ['¿Cuánto?','KWAN-toh'],
  Budapest:   ['Mennyi?','MEN-nyee'],
  Amsterdam:  ['Hoeveel?','HOO-fayl'],
  Zurich:     ['Wie viel?','vee FEEL'],
  Paris:      ['Combien?','kom-BYAN'],
  Rome:       ['Quanto?','KWAN-toh'],
  Berlin:     ['Wie viel?','vee FEEL'],
  Vienna:     ['Wie viel?','vee FEEL'],
  Copenhagen: ['Hvor meget?','vor MY-el'],
  Stockholm:  ['Hur mycket?','hoor MEW-keh'],
  Oslo:       ['Hvor mye?','vor MEW-eh'],
  Helsinki:   ['Paljonko?','PAHL-yon-koh'],
  Reykjavík:  ['Hvað kostar?','kvath KOS-tar'],
  Athens:     ['Πόσο;','POH-soh'],
  Belgrade:   ['Koliko?','KOH-lee-koh'],
  Prague:     ['Kolik?','KOH-leek'],
  Kraków:     ['Ile?','EE-leh'],
  Bucharest:  ['Cât?','kut'],
  Barcelona:  ['Quant?','kwahn'],
  Seville:    ['¿Cuánto?','KWAN-toh'],
  Florence:   ['Quanto?','KWAN-toh'],
  Naples:     ['Quanto?','KWAN-toh'],
  Marseille:  ['Combien?','kom-BYAN'],
  Brussels:   ['Combien?','kom-BYAN'],
  Istanbul:   ['Ne kadar?','neh kah-DAR'],
}

let cities = [], skip = 0
while (true) { const pg = await cma('/entries?content_type=city&limit=100&skip='+skip); cities = cities.concat(pg.items); skip += 100; if (skip>=pg.total) break }
const cityByName = new Map(cities.map(c=>[norm(c.fields.cityName?.[L]), c]))

let updated=0
for (const [cityName, [local, phonetic]] of Object.entries(DATA)) {
  const cityEntry = cityByName.get(norm(cityName)); if (!cityEntry) { console.log(`! no city "${cityName}"`); continue }
  const displayName = cityEntry.fields.cityName[L]
  const found = await cma(`/entries?content_type=word&fields.city.sys.id=${cityEntry.sys.id}&fields.slot=how-much&limit=1`)
  const entry = found.items[0]
  if (!entry) { console.log(`  ! ${displayName}: no how-much entry`); continue }
  const fresh = await cma('/entries/'+entry.sys.id)
  fresh.fields.title = { [L]: `${displayName} · ${local}` }
  fresh.fields.local = { [L]: local }
  fresh.fields.phonetic = { [L]: phonetic }
  fresh.fields.meaning = { [L]: 'how much?' }
  delete fresh.fields.context
  const put = await cma('/entries/'+entry.sys.id, { method:'PUT', headers:{ 'X-Contentful-Version': String(fresh.sys.version), 'X-Contentful-Content-Type':'word' }, body: JSON.stringify({ fields: fresh.fields }) })
  await cma('/entries/'+entry.sys.id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(put.sys.version) } })
  updated++
  console.log(`  ✓ ${displayName}: ${local}`)
  await new Promise(r=>setTimeout(r,90))
}
console.log(`\nDone. ${updated} how-much entries updated + republished.`)
