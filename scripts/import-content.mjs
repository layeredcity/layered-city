#!/usr/bin/env node
// Bulk-create DRAFT (unpublished) song entries in Contentful from a JSON file.
// You then finish each one by hand (add an album cover, location, etc.) and
// publish it. Nothing this script creates is published.
//
// Run:  npm run import:songs           (reads scripts/songs.json)
//   or: node scripts/import-songs.mjs path/to/file.json
//
// Input JSON: an array of songs. All keys optional except title + city.
//   [
//     {
//       "city": "Paris",                 // must match a city name in Contentful
//       "title": "La Vie en Rose",
//       "artist": "Édith Piaf",
//       "year": 1947,
//       "description": "One-line note (max 256 chars).",
//       "spotify": "https://open.spotify.com/track/...",
//       "apple": "https://music.apple.com/...",
//       "minutes": 3,
//       "seconds": 7
//     }
//   ]
//
// Re-running is safe: a song whose title already exists (as music) for that
// city is skipped, so you won't get duplicates.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) fail('No .env file found at project root.')
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}
function fail(msg) { console.error('\n✖ ' + msg + '\n'); process.exit(1) }

const env = loadEnv()
for (const k of ['VITE_CONTENTFUL_SPACE', 'VITE_CONTENTFUL_TOKEN', 'CONTENTFUL_MANAGEMENT_TOKEN']) {
  if (!env[k]) fail(`Missing ${k} in .env`)
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const CDN_TOKEN = env.VITE_CONTENTFUL_TOKEN
const CMA_TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN

// Map our friendly input keys → Contentful story field IDs. This is a superset
// across content types; each entry supplies whichever keys make sense for its
// `type` (music, book, …). `type` itself maps to mediaType (default: music).
const FIELD_MAP = {
  title: 'storyTitle',
  artist: 'creatorName',   // music
  author: 'creatorName',   // book
  creator: 'creatorName',  // generic
  year: 'releaseYear',
  genre: 'genre',
  description: 'storyDescription',
  spotify: 'mediaUrl',     // music
  goodreads: 'mediaUrl',   // book
  justwatch: 'mediaUrl',   // movie/tv (generic "where to watch" link)
  apple: 'secondaryUrl',   // music
  bookshop: 'secondaryUrl',// book
  isbn: 'isbnNumber',      // book
  imdb: 'imdbId',          // movie/tv (drives poster + rating via OMDb)
  bookCoverUrl: 'bookCoverUrl', // book (resolved at import)
  poster: 'coverImageUrl',      // any type: manual image override (wins over OMDb/auto cover)
  coverImageUrl: 'coverImageUrl',
  minutes: 'numberOfMinutes',
  seconds: 'numberOfSeconds',
}

// Resolve a working Open Library cover URL for a book. The by-ISBN endpoint has
// gaps, so we fall back to a search that returns a cover id. All server-side,
// so no CORS/quota limits (the browser can only load cover images, not search).
// Returns 'ok' | 'missing' | 'unreachable'. The distinction matters: a 404 (via
// ?default=false) means Open Library really has no cover, but a timeout or 5xx
// means it isn't answering. Collapsing both into "no cover" made an Open
// Library outage look like a batch of genuinely coverless books, which then
// never got retried. Retries transient failures before giving up.
async function coverExists(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'layered-city/1.0' } })
      if (r.ok && (r.headers.get('content-type') || '').startsWith('image')) return 'ok'
      if (r.status === 404) return 'missing'
    } catch { /* timeout or network error — retry */ }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
  }
  return 'unreachable'
}
async function searchCoverId({ isbn, title, author }) {
  const pick = async (params) => {
    try {
      const r = await fetch('https://openlibrary.org/search.json?' + params, { headers: { 'User-Agent': 'layered-city/1.0' } })
      const j = await r.json()
      return j.docs?.[0]?.cover_i || null
    } catch { return null }
  }
  if (isbn) { const c = await pick(new URLSearchParams({ isbn, fields: 'cover_i', limit: '1' })); if (c) return c }
  if (title) { const p = new URLSearchParams({ title, fields: 'cover_i', limit: '1' }); if (author) p.set('author', author); const c = await pick(p); if (c) return c }
  if (title && title.includes(':')) { const p = new URLSearchParams({ title: title.split(':')[0].trim(), fields: 'cover_i', limit: '1' }); if (author) p.set('author', author); const c = await pick(p); if (c) return c }
  return null
}
// Returns the cover URL, or null when there is none. Sets `outage.hit` if Open
// Library failed to answer at any point, so the caller can say "retry later"
// rather than "this book has no cover".
async function resolveBookCover(isbn, title, author, outage = {}) {
  const clean = isbn ? String(isbn).replace(/[^0-9Xx]/g, '') : ''
  if (clean) {
    const byIsbn = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`
    const state = await coverExists(byIsbn + '?default=false')
    if (state === 'ok') return byIsbn
    if (state === 'unreachable') outage.hit = true
  }
  const coverId = await searchCoverId({ isbn: clean, title, author })
  if (coverId) {
    const byId = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    const state = await coverExists(byId + '?default=false')
    if (state === 'ok') return byId
    if (state === 'unreachable') outage.hit = true
  }
  return null
}

// For books with no ISBN supplied, look one up from Open Library by title +
// author (no API key / no quota; used only for a cover, so edition differences
// don't matter). Prefers a 13-digit ISBN.
async function resolveIsbn(title, author) {
  const tryOne = async (t) => {
    const params = new URLSearchParams({ title: t, limit: '5', fields: 'isbn' })
    if (author) params.set('author', author)
    const res = await fetch('https://openlibrary.org/search.json?' + params, { headers: { 'User-Agent': 'layered-city/1.0' } })
    const data = await res.json()
    for (const doc of (data.docs || [])) {
      const isbns = doc.isbn || []
      const pick = isbns.find(x => x.length === 13) || isbns[0]
      if (pick) return pick
    }
    return null
  }
  try {
    let r = await tryOne(title)
    if (!r && title.includes(':')) r = await tryOne(title.split(':')[0].trim()) // drop subtitle
    return r
  } catch {}
  return null
}

// Convert straight quotes/apostrophes to typographic (curly) ones.
export function curlyQuotes(s) {
  if (s == null) return s
  return String(s)
    .replace(/(^|[\s([{—–\-/])"/g, '$1“') // opening “
    .replace(/"/g, '”')                              // closing ”
    .replace(/'(?=\d)/g, '’')                        // elision: '90s → ’90s
    .replace(/(^|[\s([{—–\-/])'/g, '$1‘')  // opening ‘
    .replace(/'/g, '’')                              // apostrophe / closing ’
}
// Normalize curly quotes back to straight — used for quote-insensitive dedup keys.
function plainQuotes(s) {
  return String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
}
const CURLY_FIELDS = new Set(['storyTitle', 'storyDescription', 'creatorName'])

async function cdn(path) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://cdn.contentful.com/spaces/${SPACE}/environments/master${path}${sep}access_token=${CDN_TOKEN}`)
  if (!res.ok) fail(`Contentful CDN ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}
async function cma(path, opts = {}) {
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + CMA_TOKEN,
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      ...(opts.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`CMA ${opts.method || 'GET'} ${path} → ${res.status}: ${body?.message || JSON.stringify(body)}`)
  return body
}

function coerce(type, value) {
  if (type === 'Integer' || type === 'Number') return Number(value)
  if (type === 'Boolean') return Boolean(value)
  return String(value)
}

// Tidy up URL fields: add a scheme if missing and percent-encode spaces /
// accents (so the search-style links pasted from chat become valid URLs).
function normalizeUrl(u) {
  u = String(u).trim()
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  if (u.includes(' ') || /[^\x00-\x7F]/.test(u)) { try { u = encodeURI(u) } catch {} }
  return u
}

async function main() {
  const pathArg = process.argv.slice(2).find(a => !a.startsWith('--'))
  const inputPath = resolve(pathArg || join(ROOT, 'scripts', 'songs.json'))
  if (!existsSync(inputPath)) fail(`Input file not found: ${inputPath}\nCreate it (see scripts/songs.example.json) or pass a path.`)
  let songs
  try { songs = JSON.parse(readFileSync(inputPath, 'utf8')) }
  catch (e) { fail(`Could not parse ${inputPath} as JSON: ${e.message}`) }
  if (!Array.isArray(songs)) fail('Input JSON must be an array of song objects.')

  // Books: resolve an ISBN (if missing) and a working cover URL before importing.
  let coverOutages = 0
  for (const s of songs) {
    if ((s.type || '').toLowerCase() !== 'book') continue
    const who = s.author || s.creator || s.artist
    if (!s.isbn) {
      const found = await resolveIsbn(s.title, who)
      if (found) { s.isbn = found; console.log(`  ↩ resolved ISBN for "${s.title}": ${found}`) }
      else console.log(`  ! no ISBN found for "${s.title}"`)
    }
    if (!s.bookCoverUrl) {
      const outage = {}
      const cover = await resolveBookCover(s.isbn, s.title, who, outage)
      if (cover) { s.bookCoverUrl = cover; console.log(`  🖼 cover for "${s.title}": ${cover.split('/').pop()}`) }
      else if (outage.hit) { coverOutages++; console.log(`  ? Open Library unreachable for "${s.title}" — retry later with: npm run fix:covers`) }
      else console.log(`  ! no cover found for "${s.title}"`)
    }
    await new Promise(r => setTimeout(r, 250)) // be gentle with Open Library
  }

  // Field types (to coerce values correctly) + default locale
  const ct = await cma('/content_types/story')
  const fieldType = Object.fromEntries(ct.fields.map(f => [f.id, f.type]))
  const locales = await cma('/locales')
  const L = (locales.items.find(l => l.default) || locales.items[0]).code

  // City name → id
  const citiesRes = await cdn('/entries?content_type=city&limit=500')
  const cityIdByName = {}
  for (const c of citiesRes.items) if (c.fields.cityName) cityIdByName[c.fields.cityName.trim().toLowerCase()] = c.sys.id

  // With --update, existing songs get empty fields filled in (e.g. backfill
  // genre) instead of being skipped; published entries are re-published.
  const UPDATE = process.argv.includes('--update')

  // Existing story entries per city (any type, drafts + published): key -> entry
  const existing = new Map()
  let skip = 0
  while (true) {
    const page = await cma(`/entries?content_type=story&limit=1000&skip=${skip}`)
    for (const e of page.items) {
      const cid = e.fields.relatedCity?.[L]?.sys?.id
      const title = plainQuotes((e.fields.storyTitle?.[L] || '').trim()).toLowerCase()
      const artist = plainQuotes((e.fields.creatorName?.[L] || '').trim()).toLowerCase()
      if (cid && title) existing.set(cid + '::' + title + '::' + artist, e)
    }
    skip += page.items.length
    if (skip >= page.total || page.items.length === 0) break
  }

  // Build the Contentful field values a song maps to.
  const buildFields = (song, cityId) => {
    const fields = {
      storyTitle: { [L]: curlyQuotes((song.title || '').trim()) },
      mediaType: { [L]: (song.type || 'music').toLowerCase() },
      relatedCity: { [L]: { sys: { type: 'Link', linkType: 'Entry', id: cityId } } },
    }
    if (song.lat != null && song.lon != null && song.lat !== '' && song.lon !== '') {
      fields.storyLocation = { [L]: { lat: Number(song.lat), lon: Number(song.lon) } }
    }
    for (const [key, fieldId] of Object.entries(FIELD_MAP)) {
      if (key === 'title' || song[key] == null || song[key] === '') continue
      let val = song[key]
      if (CURLY_FIELDS.has(fieldId)) val = curlyQuotes(val)
      if (fieldId === 'storyDescription' && String(val).length > 256) {
        console.log(`  ! "${song.title}": description over 256 chars — truncated (Contentful field limit).`)
        val = String(val).slice(0, 256)
      }
      if (fieldId === 'mediaUrl' || fieldId === 'secondaryUrl') val = normalizeUrl(val)
      fields[fieldId] = { [L]: coerce(fieldType[fieldId], val) }
    }
    return fields
  }
  const isEmpty = v => v == null || v === ''

  let created = 0, updated = 0, skipped = 0, failed = 0
  for (const song of songs) {
    const title = (song.title || '').trim()
    const cityKey = (song.city || '').trim().toLowerCase()
    if (!title || !cityKey) { console.log(`– skipped (missing title or city): ${JSON.stringify(song).slice(0, 80)}`); skipped++; continue }
    const cityId = cityIdByName[cityKey]
    if (!cityId) { console.log(`– skipped "${title}": no city named "${song.city}" in Contentful`); skipped++; continue }
    const creator = song.artist || song.author || song.creator || ''
    const dedupeKey = cityId + '::' + plainQuotes(title).toLowerCase() + '::' + plainQuotes(creator.trim()).toLowerCase()

    if (existing.has(dedupeKey)) {
      if (!UPDATE) { console.log(`– skipped "${title}" — ${song.artist || ''} (${song.city}): already exists`); skipped++; continue }
      // Fill-blanks update: only set fields that are currently empty.
      const entry = existing.get(dedupeKey)
      const candidate = buildFields(song, cityId)
      const filled = []
      for (const [fid, val] of Object.entries(candidate)) {
        if (fid === 'storyTitle' || fid === 'mediaType' || fid === 'relatedCity') continue
        if (isEmpty(entry.fields[fid]?.[L])) { entry.fields[fid] = val; filled.push(fid) }
      }
      if (!filled.length) { console.log(`= "${title}" (${song.city}): nothing to fill`); skipped++; continue }
      try {
        const wasPublished = !!entry.sys.publishedVersion
        const put = await cma('/entries/' + entry.sys.id, {
          method: 'PUT',
          headers: { 'X-Contentful-Version': String(entry.sys.version), 'X-Contentful-Content-Type': 'story' },
          body: JSON.stringify({ fields: entry.fields }),
        })
        if (wasPublished) {
          await cma('/entries/' + entry.sys.id + '/published', { method: 'PUT', headers: { 'X-Contentful-Version': String(put.sys.version) } })
        }
        console.log(`↻ updated ${wasPublished ? '(published)' : '(draft)'}: ${title} — filled ${filled.join(', ')}`)
        updated++
      } catch (e) {
        console.log(`✗ update failed "${title}": ${e.message}`)
        failed++
      }
      continue
    }

    if (UPDATE) { console.log(`? no match to update: "${title}" — ${song.artist || ''} (${song.city})`); skipped++; continue }
    try {
      await cma('/entries', {
        method: 'POST',
        headers: { 'X-Contentful-Content-Type': 'story' },
        body: JSON.stringify({ fields: buildFields(song, cityId) }),
      })
      console.log(`✓ created draft: ${title} — ${song.artist || ''} (${song.city})`)
      created++
    } catch (e) {
      console.log(`✗ failed "${title}": ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed.`)
  if (created) console.log('New entries are DRAFTS — finish them in Contentful (album cover, etc.) and publish.')
  if (coverOutages) {
    console.log(`\n⚠ ${coverOutages} book(s) have no cover because Open Library was unreachable, not because`)
    console.log(`  no cover exists. Re-run once it recovers:  npm run fix:covers`)
  }
  console.log('')
}

main().catch(e => fail(e.message))
