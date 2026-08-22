// Import dishes as `food` entries. Reads scripts/food.json.
//
//   npm run import:food -- --dry-run    # report only, write nothing
//   npm run import:food                 # create as DRAFTS
//   npm run import:food -- --publish    # create and publish
//
// Input JSON: an array of dishes.
//   [{ "city": "Lisbon", "name": "Pastel de nata",
//      "description": "Max 256 characters.", "listOrder": 1 }]
//
// Food entries carry no location on purpose — a dish belongs to a city, not to
// a restaurant that may not outlive it.
//
// Dedup guard: a dish whose name already exists for that city is skipped, so
// re-runs are safe.
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = f => args.includes(f)
const at = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const DRY_RUN = has('--dry-run')
const PUBLISH = has('--publish')
const FILE = at('--file') || join(ROOT, 'scripts', 'food.json')

const env = {}
for (const line of fs.readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=')
  if (i < 0) continue
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN
if (!SPACE || !TOKEN) {
  console.error('Missing VITE_CONTENTFUL_SPACE / CONTENTFUL_MANAGEMENT_TOKEN in .env')
  process.exit(1)
}

const LOCALE = 'en-US'
const base = `https://api.contentful.com/spaces/${SPACE}/environments/master`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => (s || '').replace(/[‘’']/g, "'").normalize('NFC').toLowerCase().trim()
const link = (id, linkType = 'Entry') => ({ sys: { type: 'Link', linkType, id } })

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
    if (!res.ok) {
      console.error('Contentful', res.status, (await res.text()).slice(0, 200))
      process.exit(1)
    }
    const d = await res.json()
    out.push(...d.items)
    skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return out
}

// --- read and validate the input -------------------------------------------
const dishes = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const problems = []
dishes.forEach((d, i) => {
  if (!d.name) problems.push(`#${i + 1}: missing name`)
  if (!d.city) problems.push(`#${i + 1} (${d.name}): missing city`)
  if (!d.description) problems.push(`#${i + 1} (${d.name}): missing description`)
  else if ([...d.description].length > 256) problems.push(`#${i + 1} (${d.name}): description is ${[...d.description].length} chars, max 256`)
})
if (problems.length) {
  console.error('\n✖ Input problems:\n   ' + problems.join('\n   ') + '\n')
  process.exit(1)
}

// --- resolve the cities these dishes belong to ------------------------------
const cityNames = [...new Set(dishes.map(d => d.city))]
const cities = await allEntries('content_type=city')
const cityId = {}
for (const name of cityNames) {
  const match = cities.find(c => norm(c.fields.cityName?.[LOCALE]) === norm(name))
  if (!match) { console.error(`\n✖ No city entry named "${name}" in Contentful.\n`); process.exit(1) }
  cityId[name] = match.sys.id
}

// --- skip anything already there --------------------------------------------
const existing = await allEntries('content_type=food')
const seen = new Set(existing.map(e => {
  const c = e.fields.relatedCity?.[LOCALE]?.sys?.id
  return `${c}::${norm(e.fields.foodName?.[LOCALE])}`
}))

console.log(`${dishes.length} dishes in ${FILE.replace(ROOT + '/', '')}`)
console.log(`${existing.length} food entries already in Contentful`)
console.log(DRY_RUN ? '\nDRY RUN — nothing will be written\n' : PUBLISH ? '\ncreating and publishing\n' : '\ncreating as drafts\n')

let created = 0, skipped = 0, failed = 0
for (const d of dishes) {
  const key = `${cityId[d.city]}::${norm(d.name)}`
  if (seen.has(key)) { console.log(`  – skip     ${d.name} (already exists)`); skipped++; continue }
  if (DRY_RUN) { console.log(`  + would create ${String(d.listOrder ?? '').padStart(2)} ${d.name}`); created++; continue }

  const fields = {
    foodName: { [LOCALE]: d.name },
    foodDescription: { [LOCALE]: d.description },
    relatedCity: { [LOCALE]: link(cityId[d.city]) },
  }
  if (d.listOrder != null) fields.listOrder = { [LOCALE]: d.listOrder }
  if (d.englishName) fields.foodEnglishName = { [LOCALE]: d.englishName }

  const res = await cma('/entries', {
    method: 'POST',
    headers: { 'X-Contentful-Content-Type': 'food' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    console.error(`  ✖ fail     ${d.name}: ${res.status} ${(await res.text()).slice(0, 160)}`)
    failed++
    continue
  }
  const entry = await res.json()
  seen.add(key)

  if (PUBLISH) {
    const pub = await cma(`/entries/${entry.sys.id}/published`, {
      method: 'PUT', headers: { 'X-Contentful-Version': String(entry.sys.version) },
    })
    if (!pub.ok) {
      console.error(`  ! created but not published: ${d.name} (${pub.status})`)
      created++
      continue
    }
  }
  console.log(`  + ${PUBLISH ? 'published' : 'draft    '} ${String(d.listOrder ?? '').padStart(2)} ${d.name}`)
  created++
  await sleep(120)   // stay under the CMA rate limit
}

console.log(`\n${created} created, ${skipped} skipped, ${failed} failed`)
if (!DRY_RUN && !PUBLISH && created) console.log('They are drafts — add illustrations, then publish.')
