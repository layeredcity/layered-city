#!/usr/bin/env node
// One-off content pass: shorten the `delicious` word to the single-word
// exclamation a traveler would actually say to compliment their hosts, and
// clear its context (the word stands alone). All 26 standard cities; the 4
// english-language cities have no `delicious` slot. Republishes each entry.
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

// city → [ local, phonetic ]. The most idiomatic single-word food compliment.
const DATA = {
  Lisbon:     ['Delicioso!','duh-lee-see-OH-zoo'],
  Madrid:     ['¡Buenísimo!','bweh-NEE-see-moh'],
  Budapest:   ['Finom!','FEE-nom'],
  Amsterdam:  ['Heerlijk!','HAYR-luk'],
  Zurich:     ['Fein!','fine'],
  Paris:      ['Délicieux!','day-lee-SYUH'],
  Rome:       ['Buonissimo!','bwoh-NEES-see-moh'],
  Berlin:     ['Lecker!','LECK-er'],
  Vienna:     ['Ausgezeichnet!','OWS-guh-tsykh-net'],
  Copenhagen: ['Lækkert!','LEH-kert'],
  Stockholm:  ['Jättegott!','YET-teh-got'],
  Oslo:       ['Nydelig!','NEW-deh-li'],
  Helsinki:   ['Herkullista!','HER-kool-lis-tah'],
  Reykjavík:  ['Ljúffengt!','LYOO-fengt'],
  Athens:     ['Πεντανόστιμο!','pen-dah-NO-stee-moh'],
  Belgrade:   ['Odlično!','OD-leech-no'],
  Prague:     ['Výborné!','VEE-bor-neh'],
  Kraków:     ['Pyszne!','PISH-neh'],
  Bucharest:  ['Delicios!','deh-lee-CHOS'],
  Barcelona:  ['Boníssim!','boo-NEE-seem'],
  Seville:    ['¡Buenísimo!','bweh-NEE-see-moh'],
  Florence:   ['Buonissimo!','bwoh-NEES-see-moh'],
  Naples:     ['Buonissimo!','bwoh-NEES-see-moh'],
  Marseille:  ['Délicieux!','day-lee-SYUH'],
  Brussels:   ['Délicieux!','day-lee-SYUH'],
  Istanbul:   ['Nefis!','neh-FEES'],
}

let cities = [], skip = 0
while (true) { const pg = await cma('/entries?content_type=city&limit=100&skip='+skip); cities = cities.concat(pg.items); skip += 100; if (skip>=pg.total) break }
const cityByName = new Map(cities.map(c=>[norm(c.fields.cityName?.[L]), c]))

let updated=0
for (const [cityName, [local, phonetic]] of Object.entries(DATA)) {
  const cityEntry = cityByName.get(norm(cityName)); if (!cityEntry) { console.log(`! no city "${cityName}"`); continue }
  const cityId = cityEntry.sys.id
  const displayName = cityEntry.fields.cityName[L]
  const found = await cma(`/entries?content_type=word&fields.city.sys.id=${cityId}&fields.slot=delicious&limit=1`)
  const entry = found.items[0]
  if (!entry) { console.log(`  ! ${displayName}: no delicious entry`); continue }
  const fresh = await cma('/entries/'+entry.sys.id)
  fresh.fields.title = { [L]: `${displayName} · ${local}` }
  fresh.fields.local = { [L]: local }
  fresh.fields.phonetic = { [L]: phonetic }
  fresh.fields.meaning = { [L]: 'delicious!' }
  delete fresh.fields.context   // no context — the word stands alone
  const put = await cma('/entries/'+entry.sys.id, { method:'PUT', headers:{ 'X-Contentful-Version': String(fresh.sys.version), 'X-Contentful-Content-Type':'word' }, body: JSON.stringify({ fields: fresh.fields }) })
  await cma('/entries/'+entry.sys.id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(put.sys.version) } })
  updated++
  console.log(`  ✓ ${displayName}: ${local}`)
  await new Promise(r=>setTimeout(r,90))
}
console.log(`\nDone. ${updated} delicious entries updated + republished.`)
