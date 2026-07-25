#!/usr/bin/env node
// Import podcast episodes into Contentful for the Layered City app.
//
// Podcasts are modelled differently from songs/books/films: an episode is a
// `story` that LINKS to a `channel` (the show) and inherits its media type from
// it — the episode itself stores no mediaType. Creating a *new* channel is
// non-trivial: the `channel` type requires a `publisher` link and a
// `channelIcon` asset, both mandatory. This script handles all of that:
//
//   • links episodes to an existing channel when the show already exists;
//   • otherwise creates the channel — finding/creating its publisher and
//     pulling the show's official artwork from Apple's iTunes API;
//   • optionally enriches missing durations/dates from the iTunes episode API;
//   • creates the episode entries (drafts by default; --publish to publish).
//
// Run:  npm run import:podcasts                 (reads scripts/podcasts.json)
//   or: npm run import:podcasts -- --publish    (also publish the episodes)
//   or: npm run import:podcasts -- --enrich     (fill missing duration/date from Apple)
//   or: npm run import:podcasts -- --dry-run    (report only, write nothing)
//
// New channels (and their publishers + artwork assets) are always created AND
// published, because an episode can only resolve its show on the live site if
// the channel is published. Episodes default to drafts so you can eyeball them
// first, then publish in Contentful (or pass --publish).
//
// Input JSON: an array of episodes. Required per episode: city, title, show,
// description. Everything else optional. See scripts/podcasts.example.json.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fail = msg => { console.error('\n✖ ' + msg + '\n'); process.exit(1) }

// ---------------------------------------------------------------- env + args
function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) fail('No .env at project root.')
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}
const env = loadEnv()
for (const k of ['VITE_CONTENTFUL_SPACE', 'CONTENTFUL_MANAGEMENT_TOKEN']) {
  if (!env[k]) fail(`Missing ${k} in .env`)
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const PUBLISH = args.includes('--publish')
const ENRICH = args.includes('--enrich')
const at = flag => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1] }
const FILE = at('--file') || join(ROOT, 'scripts', 'podcasts.json')

// ------------------------------------------------------------------- helpers
const base = `https://api.contentful.com/spaces/${SPACE}/environments/master`
async function cma(path, opts = {}) {
  for (let i = 0; i < 4; i++) {
    try {
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
    } catch (e) { if (i === 3) throw e; await sleep(1500 * (i + 1)) }
  }
}
async function allEntries(query) {
  const out = []; let skip = 0
  while (true) {
    const res = await cma(`/entries?${query}&limit=100&skip=${skip}`)
    if (!res.ok) fail(`Contentful ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const d = await res.json(); out.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return out
}
const norm = s => (s || '').replace(/[‘’']/g, "'").toLowerCase().trim()
const link = (id, linkType = 'Entry') => ({ sys: { type: 'Link', linkType, id } })

// Contentful Date fields accept a full date, a bare year, or a full datetime —
// but NOT year-month ("2025-03"). Normalize to something it accepts, keeping as
// much precision as we can (year-month becomes the 1st of that month).
const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 }
function normalizeDate(input) {
  if (input == null || input === '') return null
  const s = String(input).trim()
  if (/^\d{4}$/.test(s)) return s                                   // year
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)           // full date
  if (/^\d{4}-\d{2}$/.test(s)) return s + '-01'                     // year-month -> 1st
  const m = s.match(/^([A-Za-z]+)\s+(\d{4})$/)                      // "March 2025"
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-01`
  return null // unrecognized -> omit rather than send garbage
}

function buildUrl(val, kind) {
  if (!val) return null
  if (/^https?:\/\//i.test(val)) return val
  // treat as a search term
  return kind === 'spotify'
    ? 'https://open.spotify.com/search/' + val
    : 'https://podcasts.apple.com/us/search?term=' + val
}

// ------------------------------------------------------------- iTunes lookups
async function itunes(term, entity, limit = 8) {
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=podcast&entity=${entity}&limit=${limit}`)
    return (await r.json()).results || []
  } catch { return [] }
}
async function showArtwork(showName) {
  const res = await itunes(showName, 'podcast', 5)
  const hit = res.find(r => norm(r.collectionName) === norm(showName)) || res[0]
  return hit ? (hit.artworkUrl600 || hit.artworkUrl100) : null
}
// Best-effort episode match within a show, for enriching duration/date.
async function episodeInfo(showName, episodeTitle) {
  const res = await itunes(`${showName} ${episodeTitle}`, 'podcastEpisode', 12)
  const inShow = res.filter(r => r.wrapperType === 'podcastEpisode' && norm(r.collectionName).includes(norm(showName)))
  // prefer an exact-ish title match
  const hit = inShow.find(r => norm(r.trackName).includes(norm(episodeTitle))) || inShow[0]
  if (!hit) return null
  const info = {}
  if (hit.trackTimeMillis) { const s = Math.round(hit.trackTimeMillis / 1000); info.minutes = Math.floor(s / 60); info.seconds = s % 60 }
  if (hit.releaseDate) info.date = hit.releaseDate.slice(0, 10)
  info.matchedTitle = hit.trackName
  return info
}

// ------------------------------------------------------- asset / entry create
async function createIconAsset(url, title) {
  const c = await cma('/assets', { method: 'POST', body: JSON.stringify({ fields: {
    title: { 'en-US': title.slice(0, 250) },
    file: { 'en-US': { contentType: 'image/jpeg', fileName: `channel-${title.replace(/[^0-9A-Za-z]/g, '')}.jpg`, upload: url } },
  } }) })
  if (!c.ok) throw new Error(`asset ${c.status}: ${(await c.text()).slice(0, 150)}`)
  const a = await c.json()
  const pr = await cma(`/assets/${a.sys.id}/files/en-US/process`, { method: 'PUT', headers: { 'X-Contentful-Version': String(a.sys.version) } })
  if (!pr.ok) throw new Error(`process ${pr.status}`)
  let proc = null
  for (let i = 0; i < 40; i++) { await sleep(1000); const cur = await (await cma(`/assets/${a.sys.id}`)).json(); if (cur.fields?.file?.['en-US']?.url) { proc = cur; break } }
  if (!proc) throw new Error('asset processing timed out')
  const pub = await cma(`/assets/${proc.sys.id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(proc.sys.version) } })
  if (!pub.ok) throw new Error(`asset publish ${pub.status}`)
  return proc.sys.id
}
async function publishEntry(id, version) {
  const p = await cma(`/entries/${id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(version) } })
  if (!p.ok) throw new Error(`publish ${p.status}: ${(await p.text()).slice(0, 150)}`)
}

// -------------------------------------------------------------------- main
if (!existsSync(FILE)) fail(`Input file not found: ${FILE}`)
let episodes
try { episodes = JSON.parse(readFileSync(FILE, 'utf8')) } catch (e) { fail(`Invalid JSON in ${FILE}: ${e.message}`) }
if (!Array.isArray(episodes) || !episodes.length) fail('Input must be a non-empty array of episodes.')

// Validate up front.
const errors = []
episodes.forEach((e, i) => {
  const who = e.title || `#${i + 1}`
  if (!e.city) errors.push(`${who}: missing "city"`)
  if (!e.title) errors.push(`#${i + 1}: missing "title"`)
  if (!e.show) errors.push(`${who}: missing "show"`)
  if (!e.description) errors.push(`${who}: missing "description"`)
  else if (e.description.length > 256) errors.push(`${who}: description ${e.description.length} chars (max 256)`)
  if ((e.lat == null) !== (e.lon == null)) errors.push(`${who}: lat and lon must both be present or both absent`)
})
if (errors.length) fail('Validation errors:\n  ' + errors.join('\n  '))

// Preload cities and channels.
const cities = await allEntries('content_type=city')
const cityByName = Object.fromEntries(cities.map(c => [norm(c.fields.cityName?.['en-US']), c.sys.id]))
let channels = await allEntries('content_type=channel')
const publishers = await allEntries('content_type=publisher')
const channelByName = {}
for (const c of channels) channelByName[norm(c.fields.channelName?.['en-US'])] = c.sys.id

// Dedup guard: a story title already present for a city is treated as
// "already imported" and skipped, so re-running a batch (e.g. after a partial
// failure — the create step is not otherwise idempotent) never double-creates.
// Keyed by cityId -> Set of normalized existing titles; new creates are added
// to it so duplicates *within* one batch are caught too.
const existingTitles = {}
for (const cityId of [...new Set(episodes.map(e => cityByName[norm(e.city)]).filter(Boolean))]) {
  const stories = await allEntries(`content_type=story&fields.relatedCity.sys.id=${cityId}`)
  existingTitles[cityId] = new Set(stories.map(s => norm(s.fields.storyTitle?.['en-US'])))
}
const publisherByName = {}
for (const p of publishers) publisherByName[norm(p.fields.publisherName?.['en-US'])] = p.sys.id

async function findOrCreatePublisher(name) {
  const key = norm(name)
  if (publisherByName[key]) return publisherByName[key]
  if (DRY_RUN) { console.log(`   [dry] would create publisher "${name}"`); return 'DRY_PUB' }
  const r = await cma('/entries', { method: 'POST', headers: { 'X-Contentful-Content-Type': 'publisher' }, body: JSON.stringify({ fields: { publisherName: { 'en-US': name } } }) })
  if (!r.ok) throw new Error(`publisher ${r.status}: ${(await r.text()).slice(0, 150)}`)
  const e = await r.json(); await publishEntry(e.sys.id, e.sys.version)
  publisherByName[key] = e.sys.id
  console.log(`   ✚ publisher "${name}"`)
  return e.sys.id
}
async function resolveChannel(ep) {
  const key = norm(ep.show)
  if (channelByName[key]) return channelByName[key]
  // needs creating
  const publisherName = ep.publisher || ep.show // fall back to show name as publisher
  console.log(`   new show "${ep.show}" — creating channel (publisher: ${publisherName})`)
  const art = await showArtwork(ep.show)
  if (!art && !DRY_RUN) throw new Error(`no Apple artwork found for show "${ep.show}"; add it to Contentful by hand or set a real show name`)
  if (DRY_RUN) { console.log(`   [dry] would create channel "${ep.show}" with artwork ${art ? 'from Apple' : 'MISSING'}`); channelByName[key] = 'DRY_CH'; return 'DRY_CH' }
  const pubId = await findOrCreatePublisher(publisherName)
  const iconId = await createIconAsset(art, ep.show + ' (podcast artwork)')
  const r = await cma('/entries', { method: 'POST', headers: { 'X-Contentful-Content-Type': 'channel' }, body: JSON.stringify({ fields: {
    channelName: { 'en-US': ep.show }, mediaType: { 'en-US': 'podcast' },
    publisher: { 'en-US': link(pubId) }, channelIcon: { 'en-US': link(iconId, 'Asset') },
  } }) })
  if (!r.ok) throw new Error(`channel ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const e = await r.json(); await publishEntry(e.sys.id, e.sys.version)
  channelByName[key] = e.sys.id
  console.log(`   ✚ channel "${ep.show}" (artwork + publisher)`)
  return e.sys.id
}

console.log(`${episodes.length} episode(s)${DRY_RUN ? ' [dry run]' : ''}${PUBLISH ? ' [will publish]' : ' [drafts]'}\n`)
let created = 0, failed = 0, published = 0, skipped = 0
const flags = []
for (const ep of episodes) {
  const cityId = cityByName[norm(ep.city)]
  if (!cityId) { console.log(`✗ ${ep.title}: city "${ep.city}" not found in Contentful`); failed++; continue }
  if (existingTitles[cityId]?.has(norm(ep.title))) {
    console.log(`· skipped: ${ep.title} (already in ${ep.city})`); skipped++; continue
  }
  try {
    const channelId = await resolveChannel(ep)

    // Enrichment: fill missing duration/date from Apple when asked (or always
    // when the field is absent and --enrich is set).
    let { minutes, seconds, date } = ep
    if (ENRICH && (minutes == null || date == null)) {
      const info = await episodeInfo(ep.show, ep.title)
      if (info) {
        if (minutes == null && info.minutes != null) { minutes = info.minutes; seconds = info.seconds }
        if (date == null && info.date) date = info.date
        flags.push(`${ep.title}: enriched from Apple ("${info.matchedTitle}") — verify it's the right episode`)
      }
    }

    const fields = {
      storyTitle: { 'en-US': ep.title },
      storyDescription: { 'en-US': ep.description },
      channel: { 'en-US': link(channelId) },
      relatedCity: { 'en-US': link(cityId) },
    }
    if (ep.lat != null) fields.storyLocation = { 'en-US': { lat: ep.lat, lon: ep.lon } }
    const sp = buildUrl(ep.spotify, 'spotify'); if (sp) fields.mediaUrl = { 'en-US': sp }
    const ap = buildUrl(ep.apple, 'apple'); if (ap) fields.secondaryUrl = { 'en-US': ap }
    if (minutes != null) { fields.numberOfMinutes = { 'en-US': minutes }; fields.numberOfSeconds = { 'en-US': seconds || 0 } }
    const nd = normalizeDate(date); if (nd) fields.originalPublishDate = { 'en-US': nd }

    if (!fields.storyLocation) flags.push(`${ep.title}: no location (can't be published until pinned)`)
    if (minutes == null) flags.push(`${ep.title}: no duration`)
    if (!nd) flags.push(`${ep.title}: no date`)

    if (DRY_RUN) { console.log(`→ would create: ${ep.title} [${ep.show}]`); created++; existingTitles[cityId].add(norm(ep.title)); continue }
    const r = await cma('/entries', { method: 'POST', headers: { 'X-Contentful-Content-Type': 'story' }, body: JSON.stringify({ fields }) })
    if (!r.ok) { console.log(`✗ ${ep.title}: ${r.status} ${(await r.text()).slice(0, 160)}`); failed++; continue }
    const e = await r.json(); created++; existingTitles[cityId].add(norm(ep.title))
    if (PUBLISH) { await publishEntry(e.sys.id, e.sys.version); published++ }
    console.log(`✓ ${ep.title} [${ep.show}]${PUBLISH ? '' : ' (draft)'}`)
  } catch (err) { console.log(`✗ ${ep.title}: ${err.message}`); failed++ }
}

console.log(`\n${DRY_RUN ? '[dry run] ' : ''}${created} created, ${failed} failed${skipped ? `, ${skipped} skipped (already existed)` : ''}${PUBLISH ? `, ${published} published` : ''}.`)
if (flags.length) { console.log('\nTo finish / verify:'); flags.forEach(f => console.log('  · ' + f)) }
if (!PUBLISH && !DRY_RUN && created) console.log('\nEpisodes were created as DRAFTS. Review, then publish in Contentful or re-run with --publish.')
if (failed) process.exit(1)
