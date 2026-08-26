#!/usr/bin/env node
// One-off content pass: shorten the `menu` and `check` words to the bare form a
// brief visitor would actually use, with the full polite phrase moved into the
// context line. Skips the French-politeness cities and the already-minimal
// single-word checks. Updates + republishes the affected `word` entries.
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
const cv = full => `If you're warm and kind, this is enough to get by. More polite version: ${full}${/[?.!]$/.test(full) ? '' : '.'}`

// city → { menu, check }. Each: [ local, phonetic, fullPolite, contextOverride? ]
const MADRID_MENU_CTX = 'Order la carta — el menú is the set lunch. More polite version: La carta, por favor.'
const DATA = {
  Lisbon:     { menu: ['A ementa?','uh ee-MEN-tuh','A ementa, se faz favor'], check: ['A conta?','uh KON-tuh','A conta, se faz favor'] },
  Madrid:     { menu: ['La carta?','lah KAR-tah','La carta, por favor', MADRID_MENU_CTX], check: ['La cuenta?','lah KWEHN-tah','La cuenta, por favor'] },
  Budapest:   { menu: ['Az étlapot?','ahz AYT-lah-pot','Az étlapot, legyen szíves'] },
  Amsterdam:  { menu: ['De menukaart?','duh muh-NEW-kart','De menukaart, alstublieft'], check: ['De rekening?','duh RAY-kuh-ning','De rekening, alstublieft'] },
  Zurich:     { menu: ['D Charte?','dee KHAR-tuh','D Charte, bitte'], check: ['Zahle?','TSAH-luh','Zahle bitte'] },
  Rome:       { menu: ['Il menù?','eel meh-NOO','Il menù, per favore'], check: ['Il conto?','eel KON-toh','Il conto, per favore'] },
  Berlin:     { menu: ['Die Karte?','dee KAR-tuh','Die Karte, bitte'], check: ['Zahlen?','TSAH-len','Zahlen, bitte'] },
  Vienna:     { menu: ['Die Speisekarte?','dee SHPY-zuh-kar-tuh','Die Speisekarte, bitte'], check: ['Zahlen?','TSAH-len','Zahlen, bitte'] },
  Copenhagen: { menu: ['Menukortet?','meh-NEW-kor-tet','Menukortet, tak'], check: ['Regningen?','RY-ning-en','Må jeg bede om regningen?'] },
  Stockholm:  { menu: ['Menyn?','meh-NEWN','Menyn, tack'], check: ['Notan?','NOO-tan','Notan, tack'] },
  Oslo:       { menu: ['Menyen?','meh-NEW-en','Menyen, takk'], check: ['Regningen?','RY-ning-en','Kan jeg få regningen?'] },
  Helsinki:   { menu: ['Ruokalista?','ROO-oh-kah-lis-tah','Ruokalista, kiitos'], check: ['Lasku?','LAHS-koo','Saisinko laskun'] },
  Reykjavík:  { menu: ['Matseðilinn?','MAHT-seth-il-in','Matseðilinn, takk'], check: ['Reikninginn?','RAYK-ning-in','Get ég fengið reikninginn?'] },
  Athens:     { menu: ['Τον κατάλογο;','ton kah-TAH-loh-goh','Τον κατάλογο, παρακαλώ'], check: ['Τον λογαριασμό;','ton loh-gah-ryahz-MOH','Τον λογαριασμό, παρακαλώ'] },
  Belgrade:   { menu: ['Jelovnik?','YEH-lov-neek','Jelovnik, molim'], check: ['Račun?','RAH-choon','Račun, molim'] },
  Prague:     { menu: ['Jídelní lístek?','YEE-del-nee LEE-stek','Jídelní lístek, prosím'] },
  Kraków:     { menu: ['Menu?','MEH-noo','Poproszę menu'], check: ['Rachunek?','rah-KHOO-nek','Poproszę rachunek'] },
  Bucharest:  { menu: ['Meniul?','MEH-nyool','Meniul, vă rog'], check: ['Nota?','NOH-tah','Nota, vă rog'] },
  Barcelona:  { menu: ['La carta?','lah KAR-tah','La carta, si us plau'], check: ['El compte?','el KOMP-tuh','El compte, si us plau'] },
  Seville:    { menu: ['La carta?','lah KAR-tah','La carta, por favor', MADRID_MENU_CTX], check: ['La cuenta?','lah KWEN-tah','La cuenta, por favor'] },
  Florence:   { menu: ['Il menù?','eel meh-NOO','Il menù, per favore'], check: ['Il conto?','eel KON-toh','Il conto, per favore'] },
  Naples:     { menu: ['Il menù?','eel meh-NOO','Il menù, per favore'], check: ['Il conto?','eel KON-toh','Il conto, per favore'] },
  Istanbul:   { menu: ['Menü?','meh-NEW','Menü, lütfen'], check: ['Hesap?','heh-SAHP','Hesap, lütfen'] },
}
const MEANING = { menu: 'menu?', check: 'the check?' }

// City entries by normalized name.
let cities = [], skip = 0
while (true) { const pg = await cma('/entries?content_type=city&limit=100&skip='+skip); cities = cities.concat(pg.items); skip += 100; if (skip>=pg.total) break }
const cityByName = new Map(cities.map(c=>[norm(c.fields.cityName?.[L]), c]))

let updated=0, overLimit=0
for (const [cityName, slots] of Object.entries(DATA)) {
  const cityEntry = cityByName.get(norm(cityName)); if (!cityEntry) { console.log(`! no city "${cityName}"`); continue }
  const cityId = cityEntry.sys.id
  const displayName = cityEntry.fields.cityName[L]
  // fetch this city's words
  let ws = [], es = 0
  while (true) { const pg = await cma(`/entries?content_type=word&fields.city.sys.id=${cityId}&limit=100&skip=${es}`); ws = ws.concat(pg.items); es += 100; if (es>=pg.total) break }
  for (const slot of ['menu','check']) {
    const spec = slots[slot]; if (!spec) continue
    const [local, phonetic, full, ctxOverride] = spec
    const ctx = ctxOverride || cv(full)
    if (ctx.length > 140) { console.log(`  ⚠ ${displayName} ${slot} context ${ctx.length} chars`); overLimit++ }
    const entry = ws.find(e => e.fields.slot?.[L] === slot)
    if (!entry) { console.log(`  ! ${displayName}: no ${slot} entry`); continue }
    const fresh = await cma('/entries/'+entry.sys.id)
    fresh.fields.title = { [L]: `${displayName} · ${local}` }
    fresh.fields.local = { [L]: local }
    fresh.fields.phonetic = { [L]: phonetic }
    fresh.fields.meaning = { [L]: MEANING[slot] }
    fresh.fields.context = { [L]: ctx }
    const put = await cma('/entries/'+entry.sys.id, { method:'PUT', headers:{ 'X-Contentful-Version': String(fresh.sys.version), 'X-Contentful-Content-Type':'word' }, body: JSON.stringify({ fields: fresh.fields }) })
    await cma('/entries/'+entry.sys.id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(put.sys.version) } })
    updated++
    console.log(`  ✓ ${displayName} ${slot}: ${local}`)
    await new Promise(r=>setTimeout(r,90))
  }
}
console.log(`\nDone. ${updated} entries updated + republished. ${overLimit} over the 140-char context cap.`)
