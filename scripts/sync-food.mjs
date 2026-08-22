// Push description and listOrder from scripts/food.json to entries that already
// exist in Contentful, republishing the ones that were published.
//
//   node scripts/sync-food.mjs --dry-run   # report what would change
//   node scripts/sync-food.mjs             # apply
//
// Matches on dish name, and only ever writes description, English name,
// neighborhood and order — never the local name itself and never the image, so
// illustrations added in Contentful are safe.
// Entries already matching are skipped, so this is safe to re-run.
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : join(ROOT, 'scripts', 'food.json')

const env = {}
for (const line of fs.readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN
if (!SPACE || !TOKEN) { console.error('Missing VITE_CONTENTFUL_SPACE / CONTENTFUL_MANAGEMENT_TOKEN in .env'); process.exit(1) }

const LOCALE = 'en-US'
const base = `https://api.contentful.com/spaces/${SPACE}/environments/master`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => (s || '').replace(/[‘’']/g, "'").normalize('NFC').toLowerCase().trim()

async function cma(path, opts = {}) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(base + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/vnd.contentful.management.v1+json',
        ...(opts.headers || {}),
      },
    })
    if (res.status === 429) { await sleep(2000); continue }
    return res
  }
}
async function allEntries(query) {
  const out = []
  let skip = 0
  while (true) {
    const res = await cma(`/entries?${query}&limit=100&skip=${skip}`)
    if (!res.ok) { console.error('Contentful', res.status, (await res.text()).slice(0, 200)); process.exit(1) }
    const d = await res.json()
    out.push(...d.items)
    skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return out
}

const dishes = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const cities = await allEntries('content_type=city')
const cityNameById = Object.fromEntries(cities.map(c => [c.sys.id, c.fields.cityName?.[LOCALE]]))
// Keyed by city + dish: Vienna and Budapest can both list a goulash, and
// matching on the dish name alone would have one overwrite the other.
const key = (city, name) => `${norm(city)}::${norm(name)}`
const wanted = new Map(dishes.map(d => [key(d.city, d.name), d]))
const entries = await allEntries('content_type=food')

const changes = []
for (const e of entries) {
  const name = e.fields.foodName?.[LOCALE]
  const city = cityNameById[e.fields.relatedCity?.[LOCALE]?.sys?.id]
  const want = wanted.get(key(city, name))
  if (!want) continue
  const curOrder = e.fields.listOrder?.[LOCALE] ?? null
  const curDesc = e.fields.foodDescription?.[LOCALE] ?? ''
  const orderChanged = want.listOrder != null && curOrder !== want.listOrder
  const descChanged = want.description && curDesc !== want.description
  const curHood = e.fields.foodNeighborhood?.[LOCALE] ?? ''
  const hoodChanged = (want.neighborhood || '') !== curHood
  const curEng = e.fields.foodEnglishName?.[LOCALE] ?? ''
  const engChanged = (want.englishName || '') !== curEng
  if (orderChanged || descChanged || hoodChanged || engChanged) changes.push({ entry: e, name, want, orderChanged, descChanged, hoodChanged, engChanged, curOrder, curHood, curEng })
}

if (!changes.length) { console.log('✓ Contentful already matches food.json — nothing to do.'); process.exit(0) }

console.log(`${changes.length} dish${changes.length === 1 ? '' : 'es'} to update:`)
for (const c of changes) {
  const bits = []
  if (c.orderChanged) bits.push(`order ${c.curOrder ?? '—'} → ${c.want.listOrder}`)
  if (c.descChanged) bits.push('description rewritten')
  if (c.hoodChanged) bits.push(`neighborhood ${c.curHood || '—'} → ${c.want.neighborhood || '—'}`)
  if (c.engChanged) bits.push(`english name ${c.curEng || '—'} → ${c.want.englishName || '—'}`)
  console.log(`   ${c.name}: ${bits.join(', ')}`)
}
if (DRY_RUN) { console.log('\n(dry run — nothing was written)'); process.exit(0) }
console.log('')

for (const c of changes) {
  const wasPublished = !!c.entry.sys.publishedVersion
  const fields = { ...c.entry.fields }
  if (c.orderChanged) fields.listOrder = { ...(fields.listOrder || {}), [LOCALE]: c.want.listOrder }
  if (c.descChanged) fields.foodDescription = { ...(fields.foodDescription || {}), [LOCALE]: c.want.description }
  if (c.hoodChanged) {
    if (c.want.neighborhood) fields.foodNeighborhood = { ...(fields.foodNeighborhood || {}), [LOCALE]: c.want.neighborhood }
    else delete fields.foodNeighborhood
  }
  if (c.engChanged) {
    if (c.want.englishName) fields.foodEnglishName = { ...(fields.foodEnglishName || {}), [LOCALE]: c.want.englishName }
    else delete fields.foodEnglishName
  }
  const res = await cma(`/entries/${c.entry.sys.id}`, {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(c.entry.sys.version) },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) { console.error(`  ✖ ${c.name}: ${res.status} ${(await res.text()).slice(0, 160)}`); continue }
  const updated = await res.json()

  if (wasPublished) {
    const pub = await cma(`/entries/${updated.sys.id}/published`, {
      method: 'PUT', headers: { 'X-Contentful-Version': String(updated.sys.version) },
    })
    if (!pub.ok) { console.error(`  ! ${c.name}: updated but not republished (${pub.status})`); continue }
  }
  console.log(`  ✓ ${c.name}${wasPublished ? '' : ' (left as draft)'}`)
  await sleep(120)
}
