// Keep a copy of every cover, album artwork and channel icon in this repo.
//
// Why: each image stored in Contentful costs one of the free plan's 10,000
// records, and about 1,600 of them are copies of images that live elsewhere
// (Open Library, OMDb, podcast artwork). Keeping those copies in the repo
// instead frees the records, keeps everything portable in one place, and
// still protects the site from a source going offline.
//
// What it does: reads every published story and channel from the Contentful
// Delivery API, works out which image each one should show, downloads any
// that are new or whose source changed, resizes them to WebP, and writes
//   public/covers/<kind>/<entryId>-<hash>.webp   (the images)
//   src/data/covers.json             (slim map the app imports: id → hash)
//   src/data/covers-manifest.json    (full record: source, size; for this script)
// The app reads covers.json at build time and prefers the repo copy, falling
// back to Contentful or the original URL for anything not synced yet.
//
// Safe by design: a file is only removed when its entry is gone from
// Contentful. If an image can't be fetched, the copy we already have is kept.
//
// Run: node scripts/sync-covers.mjs   (needs `npm i --no-save sharp`)
// Runs nightly in .github/workflows/sync-covers.yml, which commits the result.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

// The Delivery token is read-only and already ships in the site's JS bundle.
const SPACE = process.env.CONTENTFUL_SPACE || process.env.VITE_CONTENTFUL_SPACE || 'yl6xhrcd616q'
const TOKEN = process.env.CONTENTFUL_DELIVERY_TOKEN || process.env.VITE_CONTENTFUL_TOKEN
if (!TOKEN) { console.error('Set CONTENTFUL_DELIVERY_TOKEN'); process.exit(1) }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const IMG_DIR = path.join(ROOT, 'public', 'covers')
const MANIFEST = path.join(ROOT, 'src', 'data', 'covers-manifest.json')
const APP_MAP = path.join(ROOT, 'src', 'data', 'covers.json')

// Largest size each kind is ever shown at, doubled for high-density screens.
const SIZES = {
  story: { width: 640, fit: 'inside' },    // book/film/tour covers, panel up to 320px
  artwork: { width: 400, fit: 'inside' },  // album art
  channel: { width: 160, height: 160, fit: 'cover' }, // round icons, 56px max
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8)

async function getAll(query) {
  const items = [], assets = {}
  for (let skip = 0; ; ) {
    const url = `https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?${query}&limit=1000&skip=${skip}&include=1`
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + TOKEN } })
    if (res.status === 429) { await sleep(1500); continue }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
    const data = await res.json()
    items.push(...data.items)
    for (const a of data.includes?.Asset || []) assets[a.sys.id] = a
    skip += data.items.length
    if (skip >= data.total || !data.items.length) break
  }
  return { items, assets }
}

const assetUrl = (assets, link) => {
  const u = link?.sys?.id && assets[link.sys.id]?.fields?.file?.url
  return u ? 'https:' + u : null
}

// A hand-picked override wins; bookCoverUrl
// only applies to books.
const storySource = f => f.coverImageUrl || (f.mediaType === 'book' ? f.bookCoverUrl : null) || null

async function download(urls) {
  let lastErr
  for (const url of urls.filter(Boolean)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'LayeredCityCoverSync/1.0 (https://layeredcity.com)' } })
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue }
        if (!res.ok) { lastErr = `${res.status} from ${url}`; break }
        const buf = Buffer.from(await res.arrayBuffer())
        const meta = await sharp(buf).metadata().catch(() => null) // rejects HTML error pages
        if (!meta?.width) { lastErr = `not an image: ${url}`; break }
        return { buf, meta }
      } catch (e) { lastErr = `${e.message} (${url})`; await sleep(1000) }
    }
  }
  throw new Error(lastErr || 'no source')
}

async function main() {
  const old = JSON.parse(await fs.readFile(MANIFEST, 'utf8').catch(() => '{}'))
  const next = { story: {}, artwork: {}, channel: {} }

  // Build the list of wanted images: { kind, id, key, urls }.
  // `key` names the image logically — when it changes we re-download. `urls`
  // are where to fetch it from, most reliable first.
  const wanted = []
  const stories = await getAll('content_type=story&select=sys.id,fields.coverAsset,fields.coverImageUrl,fields.bookCoverUrl,fields.mediaType,fields.artworkImage')
  for (const e of stories.items) {
    const f = e.fields
    const src = storySource(f)
    const mirror = assetUrl(stories.assets, f.coverAsset)
    if (src) wanted.push({ kind: 'story', id: e.sys.id, key: src, urls: [mirror, src] })
    const art = assetUrl(stories.assets, f.artworkImage)
    if (art) wanted.push({ kind: 'artwork', id: e.sys.id, key: 'asset:' + f.artworkImage.sys.id, urls: [art] })
  }
  // No `select` here: it rejects fields the content type doesn't have yet, and
  // channelIconUrl is optional future-proofing. Channels are small anyway.
  const channels = await getAll('content_type=channel')
  for (const e of channels.items) {
    const f = e.fields
    const asset = assetUrl(channels.assets, f.channelIcon)
    const key = f.channelIconUrl || (asset ? 'asset:' + f.channelIcon.sys.id : null)
    if (key) wanted.push({ kind: 'channel', id: e.sys.id, key, urls: [asset, f.channelIconUrl] })
  }
  const liveIds = new Set([...stories.items, ...channels.items].map(e => e.sys.id))

  let fetched = 0, kept = 0, failed = 0
  for (const w of wanted) {
    const prev = old[w.kind]?.[w.id]
    // Unchanged: keep what we have. (Once a Contentful copy is deleted the
    // story's key — its original URL — stays the same, so nothing refetches.)
    if (prev && prev.key === w.key) {
      next[w.kind][w.id] = prev; kept++; continue
    }
    try {
      const { buf } = await download(w.urls)
      const size = SIZES[w.kind]
      const out = await sharp(buf).rotate()
        .resize({ width: size.width, height: size.height, fit: size.fit, withoutEnlargement: true })
        .webp({ quality: 80 }).toBuffer({ resolveWithObject: true })
      const file = `${w.kind}/${w.id}-${hash(w.key)}.webp`
      await fs.mkdir(path.join(IMG_DIR, w.kind), { recursive: true })
      await fs.writeFile(path.join(IMG_DIR, file), out.data)
      next[w.kind][w.id] = { file, key: w.key, w: out.info.width, h: out.info.height }
      fetched++
    } catch (e) {
      failed++
      console.warn(`✗ ${w.kind} ${w.id}: ${e.message}`)
      if (prev) next[w.kind][w.id] = prev // a stale copy beats none
    }
  }

  // An album cover or channel icon whose Contentful asset has been deleted
  // (on purpose, once the repo holds it) no longer shows up above. Keep its
  // copy as long as the entry exists; entries deleted from Contentful lose it.
  for (const kind of Object.keys(next)) {
    for (const [id, prev] of Object.entries(old[kind] || {})) {
      if (!next[kind][id] && liveIds.has(id) && kind !== 'story') next[kind][id] = prev
    }
  }

  // Delete image files the manifest no longer points at.
  const keep = new Set(Object.values(next).flatMap(m => Object.values(m).map(v => v.file)))
  let removed = 0
  for (const kind of Object.keys(next)) {
    const dir = path.join(IMG_DIR, kind)
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (!keep.has(`${kind}/${name}`)) { await fs.unlink(path.join(dir, name)); removed++ }
    }
  }

  // Sorted keys so the committed diff only shows real changes.
  const sorted = Object.fromEntries(Object.entries(next).map(([k, m]) =>
    [k, Object.fromEntries(Object.keys(m).sort().map(id => [id, m[id]]))]))
  await fs.mkdir(path.dirname(MANIFEST), { recursive: true })
  await fs.writeFile(MANIFEST, JSON.stringify(sorted, null, 1) + '\n')
  // The app only needs to know which entries have a copy, and its hash.
  const slim = Object.fromEntries(Object.entries(sorted).map(([k, m]) =>
    [k, Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v.file.slice(k.length + id.length + 2, -5)]))]))
  await fs.writeFile(APP_MAP, JSON.stringify(slim) + '\n')

  console.log(`covers: ${fetched} fetched, ${kept} unchanged, ${removed} removed, ${failed} failed`)
  if (process.env.GITHUB_ACTIONS) console.log(`::notice::covers: ${fetched} fetched, ${kept} unchanged, ${removed} removed, ${failed} failed`)
  console.log(`totals: ${Object.entries(sorted).map(([k, m]) => `${Object.keys(m).length} ${k}`).join(', ')}`)
}

main().catch(e => {
  console.error(e)
  // Surfaces the reason as a check annotation on GitHub, not only in the log.
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${String(e.message).replace(/\n/g, ' ').slice(0, 900)}`)
  process.exit(1)
})
