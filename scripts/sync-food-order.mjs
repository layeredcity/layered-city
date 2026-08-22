// Push the listOrder values in scripts/food.json to entries that already exist
// in Contentful, republishing the ones that were published.
//
//   node scripts/sync-food-order.mjs --dry-run   # report what would change
//   node scripts/sync-food-order.mjs             # apply
//
// Matches on dish name within a city, so it only ever touches order — never
// names, descriptions or images. Dishes that are already in the right place are
// left alone, so this is safe to re-run.
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
const wanted = new Map(dishes.filter(d => d.listOrder != null).map(d => [norm(d.name), d.listOrder]))
const entries = await allEntries('content_type=food')

const changes = []
for (const e of entries) {
  const name = e.fields.foodName?.[LOCALE]
  const target = wanted.get(norm(name))
  if (target == null) continue
  const current = e.fields.listOrder?.[LOCALE] ?? null
  if (current !== target) changes.push({ entry: e, name, current, target })
}

if (!changes.length) { console.log('✓ Order already matches — nothing to do.'); process.exit(0) }

console.log(`${changes.length} dish${changes.length === 1 ? '' : 'es'} to reorder:`)
for (const c of changes) console.log(`   ${c.name}: ${c.current ?? '—'} → ${c.target}`)
if (DRY_RUN) { console.log('\n(dry run — nothing was written)'); process.exit(0) }
console.log('')

for (const c of changes) {
  const wasPublished = !!c.entry.sys.publishedVersion
  const fields = { ...c.entry.fields, listOrder: { ...(c.entry.fields.listOrder || {}), [LOCALE]: c.target } }
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
  console.log(`  ✓ ${c.name} → ${c.target}${wasPublished ? '' : ' (left as draft)'}`)
  await sleep(120)
}
