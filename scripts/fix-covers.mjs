#!/usr/bin/env node
// Repair book entries that are missing a cover image.
//
// The importer resolves covers from Open Library at import time. When Open
// Library is slow or down, that lookup fails and the book is created with no
// cover — it then shows the grey "BOOK" placeholder forever, because nothing
// ever retries. This script is that retry.
//
// Run:  npm run fix:covers                  (every city)
//   or: npm run fix:covers -- --city Marseille
//   or: npm run fix:covers -- --dry-run     (report only, change nothing)
//
// The important bit: it distinguishes "Open Library says this book has no
// cover" (a real 404 — nothing to do, needs a manual coverImageUrl) from
// "Open Library didn't answer" (an outage — worth running again later). The
// importer's own check collapses both into "no cover found", which is what
// made an outage look like nine coverless books.
//
// Safe to re-run: books that already have a cover are skipped, and an entry
// that was published stays published.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
const sleep = ms => new Promise(r => setTimeout(r, ms))

const env = loadEnv()
for (const k of ['VITE_CONTENTFUL_SPACE', 'CONTENTFUL_MANAGEMENT_TOKEN']) {
  if (!env[k]) fail(`Missing ${k} in .env`)
}
const SPACE = env.VITE_CONTENTFUL_SPACE
const CMA_TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const cityArg = args.indexOf('--city')
const CITY_NAME = cityArg !== -1 ? args[cityArg + 1] : null

// ---------------------------------------------------------------- Contentful

async function cma(path, opts = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
        ...opts,
        headers: {
          Authorization: 'Bearer ' + CMA_TOKEN,
          'Content-Type': 'application/vnd.contentful.management.v1+json',
          ...(opts.headers || {}),
        },
      })
      if (res.status === 429) { await sleep(2000); continue } // rate limited
      return res
    } catch (e) {
      if (attempt === 3) throw e
      await sleep(1500 * (attempt + 1))
    }
  }
}

async function allEntries(query) {
  const out = []
  let skip = 0
  while (true) {
    const res = await cma(`/entries?${query}&limit=100&skip=${skip}`)
    if (!res.ok) fail(`Contentful returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = await res.json()
    out.push(...data.items)
    skip += data.items.length
    if (skip >= data.total || !data.items.length) break
  }
  return out
}

// An entry is live if its published version is the one immediately before the
// current draft version — Contentful bumps version by one on publish.
const isPublished = e => e.sys.publishedVersion === e.sys.version - 1

// --------------------------------------------------------------- OpenLibrary

// Probe a cover URL. Returns 'ok' | 'missing' | 'unreachable'.
// `?default=false` makes Open Library 404 rather than serving a blank image,
// so a 404 is a trustworthy "this book has no cover". Anything else — a 5xx, a
// timeout, a dropped connection — is the service failing, not an answer, and
// gets retried with backoff before we give up and call it unreachable.
async function probeCover(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'layered-city/1.0' },
      })
      if (res.ok && (res.headers.get('content-type') || '').startsWith('image')) return 'ok'
      if (res.status === 404) return 'missing'
    } catch { /* timeout or network error — fall through to retry */ }
    if (attempt < 3) await sleep(2000 * (attempt + 1))
  }
  return 'unreachable'
}

// Open Library's by-ISBN cover endpoint has gaps, so fall back to a search that
// returns an internal cover id. Mirrors the importer's strategy.
async function searchCoverId({ isbn, title, author }) {
  const pick = async (params) => {
    try {
      const res = await fetch('https://openlibrary.org/search.json?' + params, {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'layered-city/1.0' },
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.docs?.[0]?.cover_i || null
    } catch { return null }
  }
  if (isbn) {
    const c = await pick(new URLSearchParams({ isbn, fields: 'cover_i', limit: '1' }))
    if (c) return c
  }
  if (title) {
    const p = new URLSearchParams({ title, fields: 'cover_i', limit: '1' })
    if (author) p.set('author', author)
    const c = await pick(p)
    if (c) return c
    // Subtitles after a colon often prevent a match; try the main title alone.
    if (title.includes(':')) {
      const p2 = new URLSearchParams({ title: title.split(':')[0].trim(), fields: 'cover_i', limit: '1' })
      if (author) p2.set('author', author)
      const c2 = await pick(p2)
      if (c2) return c2
    }
  }
  return null
}

// Returns { url } on success, { missing: true } if Open Library genuinely has
// no cover, or { unreachable: true } if we never got a straight answer.
async function resolveCover({ isbn, title, author }) {
  const clean = isbn ? String(isbn).replace(/[^0-9Xx]/g, '') : ''
  let sawOutage = false

  if (clean) {
    const byIsbn = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`
    const state = await probeCover(byIsbn + '?default=false')
    if (state === 'ok') return { url: byIsbn }
    if (state === 'unreachable') sawOutage = true
  }

  const coverId = await searchCoverId({ isbn: clean, title, author })
  if (coverId) {
    const byId = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
    const state = await probeCover(byId + '?default=false')
    if (state === 'ok') return { url: byId }
    if (state === 'unreachable') sawOutage = true
  }

  // No cover found — but only call that authoritative if Open Library was
  // actually answering us throughout. Otherwise it's an outage to retry.
  return sawOutage ? { unreachable: true } : { missing: true }
}

// --------------------------------------------------------------------- main

let cityId = null
if (CITY_NAME) {
  const cities = await allEntries(`content_type=city&fields.cityName=${encodeURIComponent(CITY_NAME)}`)
  if (!cities.length) fail(`No city named "${CITY_NAME}" in Contentful.`)
  cityId = cities[0].sys.id
}

const query = 'content_type=story&fields.mediaType=book'
  + (cityId ? `&fields.relatedCity.sys.id=${cityId}` : '')
const books = await allEntries(query)

// A manual coverImageUrl override counts as having a cover — it's the field we
// use precisely when Open Library can't help.
const needy = books.filter(b => !b.fields.bookCoverUrl?.['en-US'] && !b.fields.coverImageUrl?.['en-US'])

console.log(`${books.length} book(s)${CITY_NAME ? ` in ${CITY_NAME}` : ''}; ${needy.length} missing a cover.\n`)
if (!needy.length) { console.log('Nothing to do.'); process.exit(0) }

const fixed = [], missing = [], unreachable = [], failed = []

for (const entry of needy) {
  const title = entry.fields.storyTitle?.['en-US'] || '(untitled)'
  const author = entry.fields.creatorName?.['en-US'] || ''
  const isbn = entry.fields.isbnNumber?.['en-US'] || ''

  const result = await resolveCover({ isbn, title, author })

  if (result.unreachable) { console.log(`?  Open Library unreachable: ${title}`); unreachable.push(title); continue }
  if (result.missing)     { console.log(`✗  no cover exists: ${title}`);         missing.push(title);     continue }

  if (DRY_RUN) { console.log(`🖼 would set: ${title} → ${result.url.split('/').pop()}`); fixed.push(title); continue }

  // Re-read immediately before writing so we send the current version.
  const fresh = await (await cma(`/entries/${entry.sys.id}`)).json()
  const wasPublished = isPublished(fresh)
  fresh.fields.bookCoverUrl = { 'en-US': result.url }

  const put = await cma(`/entries/${entry.sys.id}`, {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(fresh.sys.version) },
    body: JSON.stringify({ fields: fresh.fields }),
  })
  if (!put.ok) { console.log(`!  update failed (${put.status}): ${title}`); failed.push(title); continue }

  // Editing a published entry leaves unpublished changes behind, so a book that
  // was live must be republished or the cover never reaches the site.
  if (wasPublished) {
    const updated = await put.json()
    const pub = await cma(`/entries/${entry.sys.id}/published`, {
      method: 'PUT',
      headers: { 'X-Contentful-Version': String(updated.sys.version) },
    })
    if (!pub.ok) { console.log(`!  cover set but republish failed (${pub.status}): ${title}`); failed.push(title); continue }
  }

  console.log(`🖼 ${wasPublished ? 'set + republished' : 'set (draft)'}: ${title}`)
  fixed.push(title)
}

console.log(`\n${DRY_RUN ? '[dry run] ' : ''}${fixed.length} fixed, ${missing.length} genuinely coverless, ${unreachable.length} unreachable, ${failed.length} failed.`)

if (missing.length) {
  console.log(`\nNo cover exists on Open Library — set coverImageUrl by hand in Contentful:`)
  missing.forEach(t => console.log(`  · ${t}`))
}
if (unreachable.length) {
  console.log(`\nOpen Library never answered for these — run this script again later:`)
  unreachable.forEach(t => console.log(`  · ${t}`))
}
// Signal an incomplete run so a future scheduled job can tell it should retry.
if (unreachable.length || failed.length) process.exit(1)
