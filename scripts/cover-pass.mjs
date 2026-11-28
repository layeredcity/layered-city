// Finds books and songs with no cover in the given cities, and looks for one.
// data/cover-pass/run: first line "audit" or "apply"; then one city name per line.
//   audit: writes data/cover-pass/audit.json (gaps + candidates) and candidate
//          thumbnails to data/cover-pass/thumbs/ for review.
//   apply: sets coverImageUrl from data/cover-pass/picks.json ({entryId: url}),
//          republishing entries that were published (drafts stay drafts).
// A book counts as covered if coverImageUrl or a working bookCoverUrl is set;
// a song if artworkImage or coverImageUrl is set.
// Runs from .github/workflows/cover-pass.yml with CONTENTFUL_MANAGEMENT_TOKEN.
import fs from 'node:fs/promises'
const TOKEN = process.env.CONTENTFUL_MANAGEMENT_TOKEN
const base = 'https://api.contentful.com/spaces/yl6xhrcd616q/environments/master'
const L = 'en-US'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function cma(path, opts = {}) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...(opts.headers || {}) } })
    if (r.status === 429) { await sleep(1000 * (i + 1)); continue }
    const body = r.status === 204 ? null : await r.json().catch(() => null)
    if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${r.status} ${JSON.stringify(body)?.slice(0, 300)}`)
    await sleep(120); return body
  }
  throw new Error('rate limited')
}
async function all(path) { const out = []; for (let skip = 0; ; skip += 100) { const d = await cma(`${path}&limit=100&skip=${skip}`); out.push(...d.items); if (skip + 100 >= d.total) break } return out }
const UA = { 'User-Agent': 'LayeredCityCoverPass/1.0 (https://layeredcity.com)' }
async function imageOk(url) {
  try { const r = await fetch(url, { headers: UA, redirect: 'follow' }); if (!r.ok) return 0; const b = Buffer.from(await r.arrayBuffer()); return b.length > 1500 ? b : 0 } catch { return 0 }
}
const getJson = async url => { try { const r = await fetch(url, { headers: UA }); return r.ok ? await r.json() : null } catch { return null } }

const lines = (await fs.readFile('data/cover-pass/run', 'utf8')).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
const mode = lines.shift()
const cityNames = lines

if (mode === 'apply') {
  const picks = JSON.parse(await fs.readFile('data/cover-pass/picks.json', 'utf8'))
  const log = []
  for (const [id, url] of Object.entries(picks)) {
    try {
      let e = await cma(`/entries/${id}`)
      const wasPublished = !!e.sys.publishedVersion && e.sys.version === e.sys.publishedVersion + 1
      e.fields.coverImageUrl = { [L]: url }
      e = await cma(`/entries/${id}`, { method: 'PUT', headers: { 'X-Contentful-Version': String(e.sys.version) }, body: JSON.stringify({ fields: e.fields }) })
      if (wasPublished) await cma(`/entries/${id}/published`, { method: 'PUT', headers: { 'X-Contentful-Version': String(e.sys.version) } })
      log.push({ id, title: e.fields.storyTitle?.[L], status: wasPublished ? 'set and republished' : 'set (left as draft)' })
    } catch (err) { log.push({ id, status: 'error', error: err.message }) }
  }
  await fs.writeFile('data/cover-pass/apply-log.json', JSON.stringify(log, null, 1))
  console.log(JSON.stringify(log)); process.exit(0)
}

const cities = await all('/entries?content_type=city')
const out = []
await fs.mkdir('data/cover-pass/thumbs', { recursive: true })
for (const name of cityNames) {
  const c = cities.find(x => x.fields.cityName?.[L] === name)
  if (!c) { out.push({ city: name, error: 'city not found' }); continue }
  const stories = await all(`/entries?content_type=story&fields.relatedCity.sys.id=${c.sys.id}`)
  for (const s of stories) {
    const f = Object.fromEntries(Object.entries(s.fields).map(([k, v]) => [k, v?.[L]]))
    const type = (f.mediaType || '').toLowerCase()
    if (type !== 'book' && type !== 'music') continue
    const row = { city: name, id: s.sys.id, type, title: f.storyTitle, creator: f.creatorName, year: f.releaseYear, isbn: f.isbnNumber || null, published: !!s.sys.publishedVersion }
    if (f.coverImageUrl) continue
    if (type === 'music' && f.artworkImage) continue
    if (type === 'book' && f.bookCoverUrl) {
      if (await imageOk(f.bookCoverUrl.includes('?') ? f.bookCoverUrl : f.bookCoverUrl + '?default=false')) continue
      row.brokenCover = f.bookCoverUrl
    }
    const cands = []
    if (type === 'music') {
      for (const term of [`${f.creatorName || ''} ${f.storyTitle}`, f.storyTitle]) {
        const d = await getJson(`https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(term)}`)
        for (const r of d?.results || []) if (r.artworkUrl100 && !cands.some(x => x.url === r.artworkUrl100.replace('100x100bb', '600x600bb')))
          cands.push({ src: 'itunes', label: `${r.artistName} — ${r.trackName} (${r.collectionName}, ${r.releaseDate?.slice(0, 4)})`, url: r.artworkUrl100.replace('100x100bb', '600x600bb') })
        if (cands.length >= 4) break
        await sleep(400)
      }
    } else {
      if (f.isbnNumber) {
        const u = `https://covers.openlibrary.org/b/isbn/${f.isbnNumber}-L.jpg?default=false`
        if (await imageOk(u)) cands.push({ src: 'ol-isbn', label: f.isbnNumber, url: u })
      }
      const ol = await getJson(`https://openlibrary.org/search.json?q=${encodeURIComponent(`${f.storyTitle} ${f.creatorName || ''}`)}&fields=title,author_name,cover_i,first_publish_year,language&limit=6`)
      for (const d of ol?.docs || []) if (d.cover_i) cands.push({ src: 'openlibrary', label: `${d.title} — ${(d.author_name || []).join(', ')} (${d.first_publish_year}; ${(d.language || []).slice(0, 4).join(',')})`, url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` })
      const gb = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${f.storyTitle}${f.creatorName ? ' inauthor:' + f.creatorName.split(/[ &,]/).filter(Boolean).pop() : ''}`)}&maxResults=6&printType=books`)
      for (const v of gb?.items || []) { const il = v.volumeInfo?.imageLinks; if (il?.thumbnail) cands.push({ src: 'googlebooks', label: `${v.volumeInfo.title} — ${(v.volumeInfo.authors || []).join(', ')} (${v.volumeInfo.publishedDate}; ${v.volumeInfo.language})`, url: il.thumbnail.replace('http://', 'https://').replace('&edge=curl', '') }) }
    }
    row.candidates = []
    for (const [i, cnd] of cands.slice(0, 6).entries()) {
      const b = await imageOk(cnd.url)
      if (!b) continue
      const file = `data/cover-pass/thumbs/${s.sys.id}-${i}.jpg`
      await fs.writeFile(file, b)
      row.candidates.push({ ...cnd, file, bytes: b.length })
    }
    out.push(row)
  }
}
await fs.writeFile('data/cover-pass/audit.json', JSON.stringify(out, null, 1))
console.log(`::notice::${out.length} gaps, ${out.filter(r => r.candidates?.length).length} with candidates`)
