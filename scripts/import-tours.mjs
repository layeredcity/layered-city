// Import VoiceMap self-guided walking tours as `story` entries of
// mediaType "audiotour". Reads scripts/tours.json (see tours.example.json).
//
//   npm run import:tours -- --publish     # create + publish
//   npm run import:tours -- --dry-run      # report only, write nothing
//
// A tour with "draft": true is created but left UNPUBLISHED even with --publish
// (used for tours whose coordinates still need a human check).
//
// Dedup guard: a story title already present for a city is skipped, so re-runs
// are safe.
import fs from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const has = f => args.includes(f)
const at = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null }
const DRY_RUN = has('--dry-run')
const PUBLISH = has('--publish')
const FILE = at('--file') || join(ROOT, 'scripts', 'tours.json')

const env = {}
for (const line of fs.readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('='); if (i < 0) continue
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN
if (!SPACE || !TOKEN) { console.error('Missing VITE_CONTENTFUL_SPACE / CONTENTFUL_MANAGEMENT_TOKEN in .env'); process.exit(1) }

const base = `https://api.contentful.com/spaces/${SPACE}/environments/master`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => (s || '').replace(/[‘’']/g, "'").toLowerCase().trim()
const link = (id, linkType = 'Entry') => ({ sys: { type: 'Link', linkType, id } })
async function cma(path, opts = {}) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...(opts.headers || {}) } })
    if (res.status === 429) { await sleep(2000); continue }
    return res
  }
}
async function allEntries(query) {
  const out = []; let skip = 0
  while (true) {
    const res = await cma(`/entries?${query}&limit=100&skip=${skip}`)
    if (!res.ok) { console.error('Contentful', res.status, (await res.text()).slice(0, 200)); process.exit(1) }
    const d = await res.json(); out.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return out
}
async function publishEntry(id, version) {
  const p = await cma(`/entries/${id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(version) } })
  if (!p.ok) throw new Error(`publish ${p.status}: ${(await p.text()).slice(0, 150)}`)
}

const tours = JSON.parse(fs.readFileSync(FILE, 'utf8'))

// pre-flight: description length
const tooLong = tours.filter(t => (t.description || '').length > 256)
if (tooLong.length) {
  console.error('✖ Descriptions over 256 chars:')
  tooLong.forEach(t => console.error(`   ${t.description.length}  ${t.title}`))
  process.exit(1)
}

// resolve cities
const cities = await allEntries('content_type=city')
const cityByName = {}
for (const c of cities) cityByName[norm(c.fields.cityName?.['en-US'])] = c.sys.id

// dedup guard
const existingTitles = {}
for (const cityId of [...new Set(tours.map(t => cityByName[norm(t.city)]).filter(Boolean))]) {
  const stories = await allEntries(`content_type=story&fields.relatedCity.sys.id=${cityId}`)
  existingTitles[cityId] = new Set(stories.map(s => norm(s.fields.storyTitle?.['en-US'])))
}

console.log(`${tours.length} tour(s)${DRY_RUN ? ' [dry run]' : ''}${PUBLISH ? ' [will publish]' : ' [drafts]'}\n`)
let created = 0, failed = 0, published = 0, skipped = 0
const flags = []

for (const t of tours) {
  const cityId = cityByName[norm(t.city)]
  if (!cityId) { console.error(`✖ ${t.title}: city "${t.city}" not found`); failed++; continue }
  if (existingTitles[cityId]?.has(norm(t.title))) { console.log(`· skipped: ${t.title} (already in ${t.city})`); skipped++; continue }
  if (DRY_RUN) { console.log(`[dry] would create ${t.draft ? 'DRAFT ' : ''}"${t.title}" in ${t.city}`); continue }

  const fields = {
    storyTitle: { 'en-US': t.title },
    storyDescription: { 'en-US': t.description },
    storyLocation: { 'en-US': { lat: t.lat, lon: t.lon } },
    relatedCity: { 'en-US': link(cityId) },
    mediaUrl: { 'en-US': t.url },
    mediaType: { 'en-US': 'audiotour' },
  }
  if (t.creator) fields.creatorName = { 'en-US': t.creator }
  if (t.minutes != null) fields.numberOfMinutes = { 'en-US': t.minutes }
  if (t.distanceKm != null) fields.distanceKm = { 'en-US': t.distanceKm }
  if (t.priceUsd != null) fields.priceUsd = { 'en-US': t.priceUsd }
  if (t.rating != null) fields.rating = { 'en-US': t.rating }
  if (t.numberOfRatings != null) fields.numberOfRatings = { 'en-US': t.numberOfRatings }
  if (t.image) fields.coverImageUrl = { 'en-US': t.image }

  const r = await cma('/entries', { method: 'POST', headers: { 'X-Contentful-Content-Type': 'story' }, body: JSON.stringify({ fields }) })
  if (!r.ok) { console.error(`✖ ${t.title}: ${r.status} ${(await r.text()).slice(0, 200)}`); failed++; continue }
  const e = await r.json()
  created++
  existingTitles[cityId].add(norm(t.title))

  if (PUBLISH && !t.draft) { await publishEntry(e.sys.id, e.sys.version); published++; console.log(`✓ ${t.title}`) }
  else if (t.draft) { console.log(`◐ ${t.title} [left as DRAFT]`); flags.push(`${t.title}: kept as draft (${t.draftReason || 'needs review'})`) }
  else console.log(`✓ ${t.title} [draft]`)
}

console.log(`\n${created} created, ${failed} failed, ${published} published${skipped ? `, ${skipped} skipped` : ''}.`)
if (flags.length) { console.log('\nTo finish / verify:'); flags.forEach(f => console.log('  · ' + f)) }
