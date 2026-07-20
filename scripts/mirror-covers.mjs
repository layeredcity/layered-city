#!/usr/bin/env node
// Mirror cover images into Contentful so the site stops depending on other
// people's servers staying up.
//
// Normally you don't need this: the Netlify webhook mirrors a cover within
// seconds of you publishing an entry, and the nightly sweep catches anything it
// missed. This is the manual version of the same logic, for backfills and for
// looking at what's outstanding.
//
// Run:  npm run mirror:covers                  (everything outstanding)
//   or: npm run mirror:covers -- --city Marseille
//   or: npm run mirror:covers -- --dry-run
//   or: npm run mirror:covers -- --limit 20
//
// Mirrors two things:
//   · books     — bookCoverUrl, usually auto-resolved from Open Library
//   · any story — coverImageUrl, a hand-picked image (the only way to give a
//                 film a poster when OMDb has none). These are often the most
//                 fragile URLs we hold: Google Images thumbnails expire.
//
// Nothing is destroyed: the source URL fields are left as they are and remain
// the fallback in the app, so unlinking coverAsset reverts to the old
// behaviour. Safe to re-run — anything already mirrored from the same source is
// skipped, and a changed source URL is re-mirrored automatically.
//
// The actual work lives in shared/mirror-core.mjs, which the Netlify functions
// use too, so the command line and the automation can't drift apart.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { makeClient, mirrorStory, sourceUrlFor, sourceOfMirror } from '../shared/mirror-core.mjs'

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
for (const k of ['VITE_CONTENTFUL_SPACE', 'CONTENTFUL_MANAGEMENT_TOKEN']) {
  if (!env[k]) fail(`Missing ${k} in .env`)
}

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const at = flag => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1] }
const CITY_NAME = at('--city')
const LIMIT = at('--limit') ? parseInt(at('--limit')) : null

const client = makeClient({
  space: env.VITE_CONTENTFUL_SPACE,
  token: env.CONTENTFUL_MANAGEMENT_TOKEN,
})

let cityId = null
if (CITY_NAME) {
  const cities = await client.allEntries(`content_type=city&fields.cityName=${encodeURIComponent(CITY_NAME)}`)
  if (!cities.length) fail(`No city named "${CITY_NAME}" in Contentful.`)
  cityId = cities[0].sys.id
}

const stories = await client.allEntries(
  'content_type=story' + (cityId ? `&fields.relatedCity.sys.id=${cityId}` : '')
)

// Which URL each existing mirror was made from, so we can spot a cover whose
// source URL has been edited since we copied it.
const mirrorSources = {}
{
  let skip = 0
  while (true) {
    const data = await (await client.cma(`/assets?limit=100&skip=${skip}`)).json()
    for (const a of data.items) {
      const src = sourceOfMirror(a)
      if (src) mirrorSources[a.sys.id] = src
    }
    skip += data.items.length
    if (skip >= data.total || !data.items.length) break
  }
}

const archived = stories.filter(e => e.sys.archivedVersion !== undefined).length
const candidates = stories.filter(e => e.sys.archivedVersion === undefined && sourceUrlFor(e.fields))
const todo = candidates.filter(e => {
  const existing = e.fields?.coverAsset?.['en-US']?.sys?.id
  return !existing || mirrorSources[existing] !== sourceUrlFor(e.fields)
})
const refreshing = todo.filter(e => e.fields?.coverAsset?.['en-US']?.sys?.id).length

console.log(`${candidates.length} mirrorable image(s)${CITY_NAME ? ` in ${CITY_NAME}` : ''}: ${candidates.length - todo.length} already current, ${todo.length} to mirror${refreshing ? ` (${refreshing} because the source URL changed)` : ''}${archived ? `, ${archived} archived and skipped` : ''}.\n`)

const queue = LIMIT ? todo.slice(0, LIMIT) : todo
if (LIMIT && todo.length > LIMIT) console.log(`(--limit ${LIMIT}: doing ${queue.length} of ${todo.length})\n`)
if (!queue.length) { console.log('Nothing to do.'); process.exit(0) }

let done = 0, failed = 0
const lowRes = []
for (const entry of queue) {
  const title = entry.fields?.storyTitle?.['en-US'] || '(untitled)'
  if (DRY_RUN) { console.log(`→ would mirror: ${title}`); done++; continue }
  try {
    const r = await mirrorStory(client, entry.sys.id)
    if (r.status !== 'mirrored') { console.log(`· skipped ${title} (${r.reason})`); continue }
    const low = r.width && r.width < 200 ? `  ⚠ low-res ${r.width}px wide` : ''
    if (low) lowRes.push(title)
    console.log(`✓ ${title} (${Math.round(r.bytes / 1024)} KB)${low}`)
    done++
  } catch (e) {
    console.log(`✗ ${title}: ${e.message}`)
    failed++
  }
}

console.log(`\n${DRY_RUN ? '[dry run] ' : ''}${done} mirrored, ${failed} failed.`)
if (lowRes.length) {
  console.log(`\n${lowRes.length} source image(s) were low resolution — fine, but soft on a retina screen:`)
  lowRes.forEach(t => console.log(`  · ${t}`))
}
if (failed) {
  console.log('\nRe-run to retry — anything already mirrored is skipped, and failed attempts clean up after themselves.')
  process.exit(1)
}
