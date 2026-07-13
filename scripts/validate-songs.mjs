#!/usr/bin/env node
// Validate scripts/songs.json before importing. Checks the Contentful field
// constraints and reports what each song is still missing (so you know what to
// finish by hand). Exits non-zero on HARD errors (unparseable JSON, missing
// title/city, description over 256 chars, unknown city, bad coordinates).
//
// Run:  npm run validate:songs   (or: node scripts/validate-songs.mjs path.json)

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

const env = loadEnv()
const inputPath = resolve(process.argv[2] || join(ROOT, 'scripts', 'songs.json'))
if (!existsSync(inputPath)) { console.error('✖ Not found: ' + inputPath); process.exit(1) }

let songs
try { songs = JSON.parse(readFileSync(inputPath, 'utf8')) }
catch (e) { console.error('✖ JSON parse error: ' + e.message); process.exit(1) }
if (!Array.isArray(songs)) { console.error('✖ Top level must be an array.'); process.exit(1) }

const errors = []   // hard: block import
const warnings = [] // soft: fine to import, but flag to the user
const toFinish = [] // per-song gaps to complete before publishing

for (const [i, s] of songs.entries()) {
  const who = s.title ? `"${s.title}"` : `#${i + 1}`
  if (!s.title) errors.push(`${who}: missing title`)
  if (!s.city) errors.push(`${who}: missing city`)
  if (s.description == null || s.description === '') errors.push(`${who}: missing description`)
  else if (String(s.description).length > 256) errors.push(`${who}: description ${String(s.description).length} chars (max 256)`)
  if (s.year != null && !/^\d{4}$/.test(String(s.year))) errors.push(`${who}: year "${s.year}" must be a 4-digit number`)
  if ((s.lat == null) !== (s.lon == null)) errors.push(`${who}: needs both lat and lon, or neither`)
  if (s.lat != null && (Math.abs(Number(s.lat)) > 90 || Math.abs(Number(s.lon)) > 180)) errors.push(`${who}: coordinates out of range`)

  const type = (s.type || 'music').toLowerCase()
  const creator = s.artist || s.author || s.creator
  const gaps = []
  if (s.lat == null) gaps.push('location')
  if (type === 'music' && s.minutes == null) gaps.push('duration') // books/etc. have no duration
  if (s.year == null) gaps.push('year')
  if (!creator) gaps.push(type === 'book' ? 'author' : 'creator')
  if (gaps.length) toFinish.push(`${who}: ${gaps.join(', ')}`)
}

// Duplicate detection within the file (city + title + creator)
const seen = new Map()
for (const s of songs) {
  const creator = (s.artist || s.author || s.creator || '').toLowerCase()
  const key = `${(s.city || '').toLowerCase()}::${(s.title || '').toLowerCase()}::${creator}`
  if (seen.has(key)) warnings.push(`duplicate in file: "${s.title}" — ${creator} (${s.city})`)
  seen.set(key, true)
}

// City existence check (needs Contentful CDN creds)
async function checkCities() {
  if (!env.VITE_CONTENTFUL_SPACE || !env.VITE_CONTENTFUL_TOKEN) {
    warnings.push('skipped city-exists check (no Contentful CDN credentials in .env)')
    return
  }
  const res = await fetch(`https://cdn.contentful.com/spaces/${env.VITE_CONTENTFUL_SPACE}/environments/master/entries?content_type=city&limit=500&access_token=${env.VITE_CONTENTFUL_TOKEN}`)
  const data = await res.json()
  const names = new Set((data.items || []).map(c => (c.fields.cityName || '').toLowerCase()))
  const cities = [...new Set(songs.map(s => (s.city || '').toLowerCase()).filter(Boolean))]
  for (const c of cities) if (!names.has(c)) errors.push(`city "${c}" not found in Contentful`)
}

await checkCities()

console.log(`\nValidated ${songs.length} song(s) in ${inputPath.replace(ROOT + '/', '')}\n`)
if (toFinish.length) {
  console.log('To finish before publishing (imported anyway as drafts):')
  toFinish.forEach(t => console.log('  · ' + t))
  console.log('')
}
if (warnings.length) { console.log('Warnings:'); warnings.forEach(w => console.log('  ! ' + w)); console.log('') }
if (errors.length) {
  console.log('ERRORS (fix before importing):')
  errors.forEach(e => console.log('  ✖ ' + e))
  console.log('')
  process.exit(1)
}
console.log('✓ No blocking errors — safe to run: npm run import:songs\n')
