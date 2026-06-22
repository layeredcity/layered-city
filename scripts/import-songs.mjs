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

// Map our friendly input keys → Contentful story field IDs.
const FIELD_MAP = {
  title: 'storyTitle',
  artist: 'creatorName',
  year: 'releaseYear',
  description: 'storyDescription',
  spotify: 'mediaUrl',
  apple: 'secondaryUrl',
  minutes: 'numberOfMinutes',
  seconds: 'numberOfSeconds',
}

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

async function main() {
  const inputPath = resolve(process.argv[2] || join(ROOT, 'scripts', 'songs.json'))
  if (!existsSync(inputPath)) fail(`Input file not found: ${inputPath}\nCreate it (see scripts/songs.example.json) or pass a path.`)
  let songs
  try { songs = JSON.parse(readFileSync(inputPath, 'utf8')) }
  catch (e) { fail(`Could not parse ${inputPath} as JSON: ${e.message}`) }
  if (!Array.isArray(songs)) fail('Input JSON must be an array of song objects.')

  // Field types (to coerce values correctly) + default locale
  const ct = await cma('/content_types/story')
  const fieldType = Object.fromEntries(ct.fields.map(f => [f.id, f.type]))
  const locales = await cma('/locales')
  const L = (locales.items.find(l => l.default) || locales.items[0]).code

  // City name → id
  const citiesRes = await cdn('/entries?content_type=city&limit=500')
  const cityIdByName = {}
  for (const c of citiesRes.items) if (c.fields.cityName) cityIdByName[c.fields.cityName.trim().toLowerCase()] = c.sys.id

  // Existing music titles per city (drafts + published), to skip duplicates
  const existing = new Set()
  let skip = 0
  while (true) {
    const page = await cma(`/entries?content_type=story&limit=1000&skip=${skip}`)
    for (const e of page.items) {
      if ((e.fields.mediaType?.[L] || '').toLowerCase() !== 'music') continue
      const cid = e.fields.relatedCity?.[L]?.sys?.id
      const title = (e.fields.storyTitle?.[L] || '').trim().toLowerCase()
      if (cid && title) existing.add(cid + '::' + title)
    }
    skip += page.items.length
    if (skip >= page.total || page.items.length === 0) break
  }

  let created = 0, skipped = 0, failed = 0
  for (const song of songs) {
    const title = (song.title || '').trim()
    const cityKey = (song.city || '').trim().toLowerCase()
    if (!title || !cityKey) { console.log(`– skipped (missing title or city): ${JSON.stringify(song).slice(0, 80)}`); skipped++; continue }
    const cityId = cityIdByName[cityKey]
    if (!cityId) { console.log(`– skipped "${title}": no city named "${song.city}" in Contentful`); skipped++; continue }
    if (existing.has(cityId + '::' + title.toLowerCase())) { console.log(`– skipped "${title}" (${song.city}): already exists`); skipped++; continue }

    // Build fields
    const fields = {}
    fields.storyTitle = { [L]: title }
    fields.mediaType = { [L]: 'music' }
    fields.relatedCity = { [L]: { sys: { type: 'Link', linkType: 'Entry', id: cityId } } }
    for (const [key, fieldId] of Object.entries(FIELD_MAP)) {
      if (key === 'title' || song[key] == null || song[key] === '') continue
      let val = song[key]
      if (fieldId === 'storyDescription' && String(val).length > 256) {
        console.log(`  ! "${title}": description over 256 chars — truncated (Contentful field limit).`)
        val = String(val).slice(0, 256)
      }
      fields[fieldId] = { [L]: coerce(fieldType[fieldId], val) }
    }

    try {
      await cma('/entries', {
        method: 'POST',
        headers: { 'X-Contentful-Content-Type': 'story' },
        body: JSON.stringify({ fields }),
      })
      console.log(`✓ created draft: ${title} — ${song.artist || ''} (${song.city})`)
      existing.add(cityId + '::' + title.toLowerCase())
      created++
    } catch (e) {
      console.log(`✗ failed "${title}": ${e.message}`)
      failed++
    }
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped, ${failed} failed.`)
  console.log('All new entries are DRAFTS — finish them in Contentful (album cover, location, etc.) and publish.\n')
}

main().catch(e => fail(e.message))
