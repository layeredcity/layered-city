// Imports a new city's batch (data/batch/<slug>/*.json) into Contentful:
// the city (with its hero photo as an asset), every story (podcasts, videos,
// films, books, music, tours), and its dishes. Words live in the repo
// (src/data/words/<slug>.json), so they aren't imported.
//
// Uses data/batch/check.json (from the "Verify batch" workflow) for Apple
// episode links and runtimes, show artwork, and YouTube channel icons. Run the
// verification first.
//
// Shows and channels are matched by name to existing `channel` entries; a new
// one is created with its artwork as the (required) channel icon.
// Stories already in the city with the same title are skipped, so re-running
// is safe. Entries are published, except tours marked "draft": true.
//
// Runs from .github/workflows/import-batch.yml with CONTENTFUL_MANAGEMENT_TOKEN.
// The run file data/batch/run-import holds "<mode> <slug>", where mode is
// "dry-run" (report only) or "import". Writes data/batch/<slug>/import-log.json.
import fs from 'node:fs/promises'

const TOKEN = process.env.CONTENTFUL_MANAGEMENT_TOKEN
const [MODE, SLUG] = (process.env.RUN || '').trim().split(/\s+/)
if (!TOKEN) throw new Error('CONTENTFUL_MANAGEMENT_TOKEN is not set')
if (!['dry-run', 'import', 'tour-images'].includes(MODE) || !SLUG) throw new Error('RUN must be "dry-run <slug>", "import <slug>", or "tour-images <slug>"')
const DRY = MODE === 'dry-run'
const base = 'https://api.contentful.com/spaces/yl6xhrcd616q/environments/master'
const L = 'en-US'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const norm = s => (s || '').replace(/[‘’']/g, "'").toLowerCase().trim()
const link = (id, linkType = 'Entry') => ({ sys: { type: 'Link', linkType, id } })
const loc = v => ({ [L]: v })

async function cma(path, opts = {}) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...(opts.headers || {}) } })
    if (r.status === 429) { await sleep(1000 * (i + 1)); continue }
    const body = r.status === 204 ? null : await r.json().catch(() => null)
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${r.status} ${JSON.stringify(body)?.slice(0, 400)}`)
    await sleep(120)
    return body
  }
  throw new Error('rate limited: ' + path)
}
async function all(path) {
  const out = []
  for (let skip = 0; ; ) {
    const d = await cma(`${path}${path.includes('?') ? '&' : '?'}limit=1000&skip=${skip}`)
    out.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return out
}
const publish = e => cma(`/entries/${e.sys.id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(e.sys.version) } })
async function createEntry(type, fields, { draft = false } = {}) {
  if (DRY) return { sys: { id: `dry-${type}` } }
  const e = await cma('/entries', { method: 'POST', headers: { 'X-Contentful-Content-Type': type }, body: JSON.stringify({ fields }) })
  if (!draft) await publish(e)
  return e
}
async function createAsset(url, title) {
  if (DRY) return 'dry-asset'
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || 'jpg').toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
  let a = await cma('/assets', { method: 'POST', body: JSON.stringify({ fields: { title: loc(title.slice(0, 250)), file: loc({ contentType, fileName: `${title.replace(/[^\w-]+/g, '-').slice(0, 60)}.${ext}`, upload: url }) } }) })
  await cma(`/assets/${a.sys.id}/files/${L}/process`, { method: 'PUT', headers: { 'X-Contentful-Version': String(a.sys.version) } })
  for (let i = 0; i < 30; i++) {
    await sleep(1500)
    a = await cma(`/assets/${a.sys.id}`)
    if (a.fields.file?.[L]?.url) break
  }
  if (!a.fields.file?.[L]?.url) throw new Error(`asset never finished processing: ${url}`)
  await cma(`/assets/${a.sys.id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(a.sys.version) } })
  return a.sys.id
}

// "tour-images <slug>": fill in coverImageUrl on that city's existing tour
// stories from the VoiceMap images in check.json. Published entries without
// pending edits are republished; drafts are only saved.
if (MODE === 'tour-images') {
  const check = JSON.parse(await fs.readFile('data/batch/check.json', 'utf8'))
  for (const slug of SLUG.split(',')) {
  const tours = JSON.parse(await fs.readFile(`data/batch/${slug}/tours.json`, 'utf8'))
  const out = { mode: MODE, updated: [], skipped: [], errors: [] }
  for (const t of tours) {
    try {
      const img = check.tours[t.url]?.image
      const found = (await cma(`/entries?content_type=story&fields.mediaUrl=${encodeURIComponent(t.url)}&limit=10`)).items
      if (!img || !found.length) { out.skipped.push(`${t.title}: ${!img ? 'no image' : 'no entry'}`); continue }
      for (let e of found) {
        if (e.fields.coverImageUrl?.[L]) { out.skipped.push(`${t.title}: already has an image`); continue }
        const clean = e.sys.publishedVersion && e.sys.version === e.sys.publishedVersion + 1
        e.fields.coverImageUrl = loc(img)
        e = await cma(`/entries/${e.sys.id}`, { method: 'PUT', headers: { 'X-Contentful-Version': String(e.sys.version) }, body: JSON.stringify({ fields: e.fields }) })
        if (clean) await publish(e)
        out.updated.push(`${t.title}${clean ? '' : ' (saved, not published)'}`)
      }
    } catch (err) { out.errors.push(`${t.title}: ${err.message}`) }
  }
  await fs.writeFile(`data/batch/${slug}/tour-images-log.json`, JSON.stringify(out, null, 1) + '\n')
  console.log(`::notice::tour images ${slug}: ${out.updated.length} updated, ${out.errors.length} errors`)
  }
  process.exit(0)
}

const read = async f => JSON.parse(await fs.readFile(`data/batch/${SLUG}/${f}.json`, 'utf8').catch(() => '[]'))
const city = await read('city')
const check = JSON.parse(await fs.readFile('data/batch/check.json', 'utf8'))
const log = { mode: MODE, city: city.cityName, started: new Date().toISOString(), created: [], skipped: [], channels: [], drafts: [], warnings: [], errors: [] }

// ---------------------------------------------------------------- the city
const cities = await all('/entries?content_type=city')
let cityEntry = cities.find(c => norm(c.fields.cityName?.[L]) === norm(city.cityName))
let cityId = cityEntry?.sys.id
const median = field => {
  const xs = cities.filter(c => c.sys.publishedVersion).map(c => c.fields[field]?.[L]).filter(x => typeof x === 'number').sort((a, b) => a - b)
  return xs[Math.floor(xs.length / 2)]
}
try {
  if (!cityEntry || !cityEntry.sys.publishedVersion) {
    // New city, or a draft left by an earlier run that failed to publish:
    // fill every field the city needs, then publish.
    const delta = median('latitudeLongitudeDelta') ?? 1
    const mapHeight = median('cityMapHeight') ?? 400
    const heroId = cityEntry?.fields.cityHeroImage?.[L]?.sys?.id || await createAsset(city.hero, city.heroTitle || `${city.cityName} hero`)
    const fields = {
      ...(cityEntry?.fields || {}),
      cityName: loc(city.cityName), countryName: loc(city.countryName), continent: loc(city.continent || 'Europe'),
      cityCoordinates: loc({ lat: city.lat, lon: city.lon }), cityHeroImage: loc(link(heroId, 'Asset')),
      isFeatured: loc(false), cityQuote: loc(city.cityQuote), cityQuoteAttribution: loc(city.cityQuoteAttribution),
      latitudeLongitudeDelta: loc(delta), cityMapHeight: loc(mapHeight), wordsVariant: loc('standard'), wordsPublished: loc(true),
    }
    if (city.wordsPreamble) fields.wordsPreamble = loc(city.wordsPreamble)
    if (!cityEntry) cityEntry = await createEntry('city', fields)
    else if (!DRY) {
      cityEntry = await cma(`/entries/${cityEntry.sys.id}`, { method: 'PUT', headers: { 'X-Contentful-Version': String(cityEntry.sys.version) }, body: JSON.stringify({ fields }) })
      await publish(cityEntry)
    }
    cityId = cityEntry.sys.id
    log.created.push(`city: ${city.cityName} (map zoom delta ${delta}, map height ${mapHeight})`)
  } else log.skipped.push(`city: ${city.cityName} already exists`)
} catch (e) {
  log.errors.push(`city: ${e.message}`)
  await fs.writeFile(`data/batch/${SLUG}/import-log.json`, JSON.stringify(log, null, 1) + '\n')
  throw e
}

// ---------------------------------------------------------------- channels
const channels = await all('/entries?content_type=channel')
const channelByName = Object.fromEntries(channels.map(c => [norm(c.fields.channelName?.[L]), c.sys.id]))
async function channelFor(name, mediaType, iconUrl, publisherName) {
  const key = norm(name)
  if (channelByName[key]) return channelByName[key]
  if (!iconUrl) throw new Error(`new ${mediaType} channel "${name}" has no artwork to use as its icon`)
  const iconId = await createAsset(iconUrl, `${name} (${mediaType} icon)`)
  const fields = { channelName: loc(name), mediaType: loc(mediaType), channelIcon: loc(link(iconId, 'Asset')) }
  if (publisherName) fields.publisherName = loc(publisherName.slice(0, 120))
  const e = await createEntry('channel', fields)
  channelByName[key] = e.sys.id
  log.channels.push(`${mediaType}: ${name}`)
  return e.sys.id
}

// ---------------------------------------------------------------- stories
const existing = cityId && !cityId.startsWith('dry') ? await all(`/entries?content_type=story&fields.relatedCity.sys.id=${cityId}`) : []
const have = new Set(existing.map(s => norm(s.fields.storyTitle?.[L])))
const spotifySearch = q => 'https://open.spotify.com/search/' + encodeURIComponent(q)
const appleSearch = q => 'https://podcasts.apple.com/us/search?term=' + encodeURIComponent(q)
async function openLibrary(title, author) {
  try {
    const d = await (await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&fields=isbn,cover_i&limit=3`)).json()
    const doc = d.docs?.find(x => x.cover_i) || d.docs?.[0]
    const isbn = doc?.isbn?.find(i => i.length === 13 && /^97[89]/.test(i)) || doc?.isbn?.[0] || null
    return { isbn, cover: doc?.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null }
  } catch { return {} }
}
async function addStory(item, type, extra) {
  const title = item.title
  if (have.has(norm(title))) { log.skipped.push(`${type}: ${title} (already in ${city.cityName})`); return }
  const fields = {
    storyTitle: loc(title), storyDescription: loc(item.description), relatedCity: loc(link(cityId)),
    storyLocation: loc({ lat: item.lat, lon: item.lon }), mediaType: loc(type),
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, loc(v)])),
  }
  if (item.place) fields.locationName = loc(String(item.place).slice(0, 80))
  if (!fields.mediaUrl) throw new Error(`${type} "${title}" has no link (mediaUrl)`)
  const draft = !!item.draft
  await createEntry('story', fields, { draft })
  have.add(norm(title))
  log.created.push(`${type}: ${title}`)
  if (draft) log.drafts.push(`${title}: ${item.draftReason || 'marked draft'}`)
}
const tryAdd = async (item, type, build) => {
  try { await addStory(item, type, await build()) } catch (e) { log.errors.push(`${type} "${item.title}": ${e.message}`) }
}

for (const p of [...await read('podcasts'), ...await read('podcasts-add')]) {
  await tryAdd(p, 'podcast', async () => {
    const c = check.podcasts[`${p.show}|${p.episode}`] || {}
    if (!c.apple) log.warnings.push(`podcast "${p.title}": no Apple match, using a search link`)
    const show = c.show || p.show
    const chId = await channelFor(show, 'podcast', check.shows[show]?.artwork, p.publisher || check.shows[show]?.artist)
    const secs = c.seconds || (p.minutes ? p.minutes * 60 : null)
    return { channel: link(chId), mediaUrl: spotifySearch(`${p.show} ${p.episode}`), secondaryUrl: c.apple || appleSearch(`${p.show} ${p.episode}`),
      numberOfMinutes: secs ? Math.floor(secs / 60) : null, numberOfSeconds: secs ? secs % 60 : null,
      originalPublishDate: (c.date || p.date || '').slice(0, 10) || null, creatorName: p.creator || null }
  })
}
for (const v of [...await read('videos'), ...await read('videos-add')]) {
  await tryAdd(v, 'video', async () => {
    const c = check.videos[v.youtube] || {}
    if (c.oembed && c.oembed !== 200) throw new Error(`YouTube says ${c.oembed} (removed or private?)`)
    const name = c.channel || v.show
    const chId = await channelFor(name, 'video', check.channels[name]?.avatar, null)
    const secs = c.seconds || (v.minutes != null ? v.minutes * 60 + (v.seconds || 0) : null)
    return { channel: link(chId), mediaUrl: `https://www.youtube.com/watch?v=${v.youtube}`,
      numberOfMinutes: secs ? Math.floor(secs / 60) : null, numberOfSeconds: secs ? secs % 60 : null,
      originalPublishDate: c.uploadDate || null }
  })
}
for (const f of [...await read('films'), ...await read('films-add')]) {
  await tryAdd(f, 'movie', async () => ({ creatorName: f.creator, releaseYear: f.year, genre: f.genre, imdbId: f.imdb, numberOfMinutes: f.minutes, mediaUrl: f.justwatch }))
}
for (const b of await read('books')) {
  await tryAdd(b, 'book', async () => {
    const ol = b.isbn ? { isbn: b.isbn } : await openLibrary(b.title, b.author)
    if (!ol.isbn) log.warnings.push(`book "${b.title}": no ISBN found`)
    return { creatorName: b.author, releaseYear: b.year, genre: b.genre, isbnNumber: ol.isbn || null, bookCoverUrl: ol.cover || null, mediaUrl: b.goodreads, secondaryUrl: b.bookshop }
  })
}
for (const m of await read('music')) {
  await tryAdd(m, 'music', async () => ({ creatorName: m.artist, releaseYear: m.year, genre: m.genre, numberOfMinutes: m.minutes, numberOfSeconds: m.seconds, mediaUrl: m.spotify, secondaryUrl: m.apple }))
}
for (const t of await read('tours')) {
  await tryAdd(t, 'audiotour', async () => ({ creatorName: t.creator, numberOfMinutes: t.minutes, distanceKm: t.distanceKm, priceUsd: t.priceUsd, rating: t.rating, numberOfRatings: t.numberOfRatings, coverImageUrl: t.image || null, mediaUrl: t.url }))
}

// ---------------------------------------------------------------- food
const foods = cityId && !cityId.startsWith('dry') ? await all(`/entries?content_type=food&fields.relatedCity.sys.id=${cityId}`) : []
const haveFood = new Set(foods.map(f => norm(f.fields.foodName?.[L])))
for (const d of await read('food')) {
  if (haveFood.has(norm(d.foodName))) { log.skipped.push(`food: ${d.foodName}`); continue }
  try {
    const fields = { foodName: loc(d.foodName), foodDescription: loc(d.foodDescription), relatedCity: loc(link(cityId)), listOrder: loc(d.listOrder) }
    if (d.foodEnglishName) fields.foodEnglishName = loc(d.foodEnglishName)
    await createEntry('food', fields)
    log.created.push(`food: ${d.foodName}`)
  } catch (e) { log.errors.push(`food "${d.foodName}": ${e.message}`) }
}

log.finished = new Date().toISOString()
await fs.writeFile(`data/batch/${SLUG}/import-log.json`, JSON.stringify(log, null, 1) + '\n')
console.log(`::notice::${MODE} ${city.cityName}: ${log.created.length} created, ${log.skipped.length} skipped, ${log.channels.length} new channels, ${log.errors.length} errors`)
