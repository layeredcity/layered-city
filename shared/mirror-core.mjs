// Core cover-mirroring logic, shared by the Netlify functions (webhook +
// nightly sweep). Kept free of filesystem and CLI concerns so it runs the same
// way in a serverless function as it would anywhere else.
//
// The job: whatever URL a story points at for its cover, keep a copy of that
// image in Contentful and link it, so the site serves its own images instead of
// depending on Open Library, Google's image cache, or a publisher's website
// staying up.

const sleep = ms => new Promise(r => setTimeout(r, ms))

export function makeClient({ space, token, environment = 'master' }) {
  const base = `https://api.contentful.com/spaces/${space}/environments/${environment}`

  async function cma(path, opts = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(base + path, {
          ...opts,
          headers: {
            Authorization: 'Bearer ' + token,
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
      if (!res.ok) throw new Error(`entries ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = await res.json()
      out.push(...data.items)
      skip += data.items.length
      if (skip >= data.total || !data.items.length) break
    }
    return out
  }

  return { cma, allEntries }
}

// Which image a story should be mirroring. A hand-picked override wins on any
// media type — it's the only way to give a film a poster when OMDb has none.
// bookCoverUrl applies to books only; a film without an override still gets its
// poster from OMDb at runtime.
export function sourceUrlFor(fields) {
  const at = f => fields?.[f]?.['en-US']
  return at('coverImageUrl') || (at('mediaType') === 'book' ? at('bookCoverUrl') : null) || null
}

// We record the source URL in the mirrored asset's description. That's what
// lets us tell "already mirrored" from "mirrored, but the editor has since
// pasted a different URL" — without it, an edit would be served stale forever.
const SOURCE_RE = /\(source: (.+)\)$/
export const describeMirror = (title, sourceUrl) => `Mirrored cover for "${title}" (source: ${sourceUrl})`
export const sourceOfMirror = asset => (asset?.fields?.description?.['en-US'] || '').match(SOURCE_RE)?.[1] || null

const isPublished = e => e.sys.publishedVersion === e.sys.version - 1

// Remove an asset we created but couldn't finish using. Without this, every
// failure leaves a stray asset behind — it costs a record, clutters the Media
// library, and looks like a real cover that just isn't attached to anything.
async function discardAsset(client, id) {
  try {
    const asset = await (await client.cma(`/assets/${id}`)).json()
    if (asset.sys?.publishedVersion) {
      await client.cma(`/assets/${id}/published`, {
        method: 'DELETE',
        headers: { 'X-Contentful-Version': String(asset.sys.version) },
      })
    }
    await client.cma(`/assets/${id}`, { method: 'DELETE' })
  } catch { /* best effort — the caller is already reporting a failure */ }
}

// Remove the mirror we just replaced. When a cover URL changes we make a fresh
// asset and relink to it, which leaves the previous one referenced by nobody —
// one wasted record per edit. Guarded two ways: only ever deletes an asset our
// own tooling created (the description marker), and it's best-effort — the new
// cover is already linked and live, so a prune hiccup is cosmetic, never fatal.
async function pruneSupersededMirror(client, id) {
  try {
    const asset = await (await client.cma(`/assets/${id}`)).json()
    if (!(asset.fields?.description?.['en-US'] || '').startsWith('Mirrored cover for')) return false
    if (asset.sys?.publishedVersion) {
      await client.cma(`/assets/${id}/published`, {
        method: 'DELETE',
        headers: { 'X-Contentful-Version': String(asset.sys.version) },
      })
    }
    return (await client.cma(`/assets/${id}`, { method: 'DELETE' })).ok
  } catch { return false }
}

async function createAsset(client, { sourceUrl, title, fileName }) {
  const create = await client.cma('/assets', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        title: { 'en-US': title.slice(0, 250) },
        description: { 'en-US': describeMirror(title, sourceUrl) },
        file: { 'en-US': { contentType: 'image/jpeg', fileName, upload: sourceUrl } },
      },
    }),
  })
  if (!create.ok) throw new Error(`create ${create.status}: ${(await create.text()).slice(0, 200)}`)
  const asset = await create.json()

  // Contentful downloads the file asynchronously; poll until file.url appears.
  const proc = await client.cma(`/assets/${asset.sys.id}/files/en-US/process`, {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(asset.sys.version) },
  })
  if (!proc.ok) throw new Error(`process ${proc.status}: ${(await proc.text()).slice(0, 200)}`)

  let processed = null
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(1000)
    const current = await (await client.cma(`/assets/${asset.sys.id}`)).json()
    if (current.fields?.file?.['en-US']?.url) { processed = current; break }
  }
  if (!processed) {
    await discardAsset(client, asset.sys.id)
    throw new Error('asset processing timed out (source too slow or unreachable)')
  }

  const pub = await client.cma(`/assets/${processed.sys.id}/published`, {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(processed.sys.version) },
  })
  if (!pub.ok) throw new Error(`publish ${pub.status}: ${(await pub.text()).slice(0, 200)}`)
  return await pub.json()
}

// Mirror one story if it needs it. Returns a result describing what happened —
// 'skipped' covers both "nothing to mirror" and "already current", which is
// what stops the webhook from looping: our own write triggers another webhook,
// that run finds the mirror already matches the source, and it stops there.
export async function mirrorStory(client, entryId) {
  const entry = await (await client.cma(`/entries/${entryId}`)).json()
  if (entry.sys?.type !== 'Entry') return { status: 'skipped', reason: 'not an entry' }
  if (entry.sys.contentType?.sys?.id !== 'story') return { status: 'skipped', reason: 'not a story' }
  // Archived entries aren't on the site and can't be edited at all — Contentful
  // rejects the write with "Cannot edit archived". Skip before doing any work,
  // or we'd upload an asset and then fail to attach it.
  if (entry.sys.archivedVersion !== undefined) return { status: 'skipped', reason: 'archived' }

  const title = entry.fields?.storyTitle?.['en-US'] || '(untitled)'
  const source = sourceUrlFor(entry.fields)
  if (!source) return { status: 'skipped', reason: 'no cover url to mirror', title }

  const existingId = entry.fields?.coverAsset?.['en-US']?.sys?.id
  if (existingId) {
    const existing = await (await client.cma(`/assets/${existingId}`)).json()
    if (sourceOfMirror(existing) === source) {
      return { status: 'skipped', reason: 'already mirrored from this url', title }
    }
  }

  const key = entry.fields?.isbnNumber?.['en-US'] || entry.fields?.imdbId?.['en-US'] || entry.sys.id
  const asset = await createAsset(client, {
    sourceUrl: source,
    title,
    fileName: `cover-${String(key).replace(/[^0-9A-Za-z]/g, '')}.jpg`,
  })

  // From here on the asset exists, so any failure has to clean it up — an
  // asset we can't attach is pure litter in the Media library.
  try {
    // Re-read immediately before writing so we hold the current version.
    const fresh = await (await client.cma(`/entries/${entry.sys.id}`)).json()
    var wasPublished = isPublished(fresh)
    fresh.fields.coverAsset = { 'en-US': { sys: { type: 'Link', linkType: 'Asset', id: asset.sys.id } } }

    const put = await client.cma(`/entries/${entry.sys.id}`, {
      method: 'PUT',
      headers: { 'X-Contentful-Version': String(fresh.sys.version) },
      body: JSON.stringify({ fields: fresh.fields }),
    })
    if (!put.ok) throw new Error(`link ${put.status}: ${(await put.text()).slice(0, 200)}`)

    // A published story must be republished or the link never reaches the site.
    if (wasPublished) {
      const updated = await put.json()
      const pub = await client.cma(`/entries/${entry.sys.id}/published`, {
        method: 'PUT',
        headers: { 'X-Contentful-Version': String(updated.sys.version) },
      })
      if (!pub.ok) throw new Error(`republish ${pub.status}: ${(await pub.text()).slice(0, 200)}`)
    }
  } catch (e) {
    await discardAsset(client, asset.sys.id)
    throw e
  }

  // The new cover is linked and live; the old mirror is now an orphan. Delete
  // it so repeated edits don't pile up unused assets. Only runs once we're past
  // the point of no failure, and never touches the asset we just created.
  let pruned = false
  if (existingId && existingId !== asset.sys.id) {
    pruned = await pruneSupersededMirror(client, existingId)
  }

  const details = asset.fields.file['en-US'].details
  return {
    status: 'mirrored',
    title,
    replaced: existingId || null,
    pruned,
    bytes: details?.size || 0,
    width: details?.image?.width || null,
  }
}

// Find stories whose mirror is missing or out of date. Used by the nightly
// sweep; `limit` keeps a single run inside the function's time budget.
export async function findStale(client, { limit = 25 } = {}) {
  const stories = await client.allEntries('content_type=story')

  const mirrorSources = {}
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

  const stale = []
  for (const e of stories) {
    if (e.sys.archivedVersion !== undefined) continue // can't be edited, isn't on the site
    const source = sourceUrlFor(e.fields)
    if (!source) continue
    const existing = e.fields?.coverAsset?.['en-US']?.sys?.id
    if (!existing || mirrorSources[existing] !== source) stale.push(e.sys.id)
  }
  return { total: stale.length, batch: stale.slice(0, limit) }
}
