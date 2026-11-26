// Frees Contentful records now that the repo holds the same content (Nov 2026):
//   1. every `word` entry (Words live in src/data/words/ now), and
//   2. every asset in data/migrate/asset-usage.json `deletableIds`: images the
//      repo already has a copy of (dish images, covers, channel icons) and
//      assets nothing uses.
// For each asset it first clears the field that points to it, so no entry is
// left with a broken link. An entry with no unpublished changes is republished
// after the edit; one with draft changes is only saved, so drafts aren't
// published by accident (listed in the log).
//
// Runs from .github/workflows/contentful-cleanup.yml with
// CONTENTFUL_MANAGEMENT_TOKEN. MODE=dry-run (default) only reports; MODE=delete
// makes the changes. Writes data/migrate/cleanup-log.json either way.
import fs from 'node:fs/promises'

const TOKEN = process.env.CONTENTFUL_MANAGEMENT_TOKEN
const MODE = process.env.MODE === 'delete' ? 'delete' : 'dry-run'
const base = 'https://api.contentful.com/spaces/yl6xhrcd616q/environments/master'
if (!TOKEN) throw new Error('CONTENTFUL_MANAGEMENT_TOKEN is not set')
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function cma(path, opts = {}) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...(opts.headers || {}) } })
    if (r.status === 429) { await sleep(1000 * (i + 1)); continue }
    const body = r.status === 204 ? null : await r.json().catch(() => null)
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${r.status} ${JSON.stringify(body)?.slice(0, 300)}`)
    await sleep(120) // stay under the management API's rate limit
    return body
  }
  throw new Error('rate limited: ' + path)
}
const v = e => ({ 'X-Contentful-Version': String(e.sys.version) })
const isPublished = e => !!e.sys.publishedVersion
const hasDraftChanges = e => isPublished(e) && e.sys.version > e.sys.publishedVersion + 1

async function removeEntry(e) {
  if (isPublished(e)) e = await cma(`/entries/${e.sys.id}/published`, { method: 'DELETE', headers: v(e) })
  await cma(`/entries/${e.sys.id}`, { method: 'DELETE', headers: v(e) })
}
async function removeAsset(a) {
  if (isPublished(a)) a = await cma(`/assets/${a.sys.id}/published`, { method: 'DELETE', headers: v(a) })
  await cma(`/assets/${a.sys.id}`, { method: 'DELETE', headers: v(a) })
}

const log = { mode: MODE, started: new Date().toISOString(), words: 0, assets: 0, entriesEdited: 0, draftsLeftUnpublished: [], keptForDrafts: [], errors: [] }

// Inventory first: the management API also sees unpublished and archived
// assets, which the delivery API (and so the usage report) can't.
const inventory = { published: 0, draft: 0, archived: 0 }
for (let skip = 0; ; ) {
  const d = await cma(`/assets?limit=1000&skip=${skip}`)
  for (const a of d.items) inventory[a.sys.archivedVersion ? 'archived' : a.sys.publishedVersion ? 'published' : 'draft']++
  skip += d.items.length
  if (skip >= d.total || !d.items.length) break
}
log.assetInventory = inventory

// 1. Word entries (drafts included: the management API sees everything).
const words = []
for (let skip = 0; ; ) {
  const d = await cma(`/entries?content_type=word&limit=500&skip=${skip}`)
  words.push(...d.items); skip += d.items.length
  if (skip >= d.total || !d.items.length) break
}
for (const w of words) {
  try { if (MODE === 'delete') await removeEntry(w); log.words++ }
  catch (e) { log.errors.push(`word ${w.sys.id}: ${e.message}`) }
}

// 2. Assets the repo has replaced.
const { deletableIds } = JSON.parse(await fs.readFile('data/migrate/asset-usage.json', 'utf8'))
const wordIds = new Set(words.map(w => w.sys.id))
for (const id of deletableIds) {
  try {
    // Entries still linking to this asset (other than words, which are gone).
    const linking = (await cma(`/entries?links_to_asset=${id}&limit=100`)).items.filter(e => !wordIds.has(e.sys.id))
    // The report only saw published entries. If a draft-only entry uses this
    // asset, that's work in progress: keep the asset.
    const draftOnly = linking.filter(e => !isPublished(e))
    if (draftOnly.length) { log.keptForDrafts.push({ id, drafts: draftOnly.map(e => e.sys.id) }); continue }
    for (let e of linking) {
      const drafty = hasDraftChanges(e), published = isPublished(e)
      for (const [field, locales] of Object.entries(e.fields)) {
        for (const [loc, val] of Object.entries(locales)) {
          if (val?.sys?.id === id) delete e.fields[field][loc]
          else if (Array.isArray(val)) e.fields[field][loc] = val.filter(x => x?.sys?.id !== id)
        }
      }
      if (MODE === 'delete') {
        e = await cma(`/entries/${e.sys.id}`, { method: 'PUT', headers: v(e), body: JSON.stringify({ fields: e.fields }) })
        if (published && !drafty) await cma(`/entries/${e.sys.id}/published`, { method: 'PUT', headers: v(e) })
      }
      if (drafty) log.draftsLeftUnpublished.push(e.sys.id)
      log.entriesEdited++
    }
    if (MODE === 'delete') await removeAsset(await cma(`/assets/${id}`))
    log.assets++
  } catch (e) { log.errors.push(`asset ${id}: ${e.message}`) }
}

log.finished = new Date().toISOString()
await fs.writeFile('data/migrate/cleanup-log.json', JSON.stringify(log, null, 1) + '\n')
console.log(`::notice::${MODE}: ${log.words} words, ${log.assets} assets, ${log.entriesEdited} entries edited, ${log.errors.length} errors`)
