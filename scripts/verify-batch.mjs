// Verifies a new-city batch from GitHub's runner (open internet). Reads
// data/batch/<city>/*.json, writes data/batch/check.json with what each
// source says: YouTube (oEmbed + watch page: title, channel, length, upload
// date, channel avatar), podcasts (Apple lookup/search: link, runtime, date,
// show artwork), books (Open Library cover by ISBN), films (Wikidata by IMDb
// id: label, year), VoiceMap tours (page metadata). Read-only.
import fs from 'node:fs'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const get = (u, o = {}) => fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en', ...(o.headers || {}) }, redirect: 'follow' })
const TOURS_ONLY = process.env.TOURS_ONLY === '1'
const out = TOURS_ONLY ? JSON.parse(fs.readFileSync('data/batch/check.json', 'utf8')) : { videos: {}, channels: {}, podcasts: {}, shows: {}, books: {}, films: {}, tours: {} }
if (TOURS_ONLY) out.tours = {}
const cities = fs.readdirSync('data/batch').filter(d => fs.statSync(`data/batch/${d}`).isDirectory())
const read = (c, f) => { try { return JSON.parse(fs.readFileSync(`data/batch/${c}/${f}.json`, 'utf8')) } catch { return [] } }
const all = f => cities.flatMap(c => [...read(c, f), ...read(c, f + '-add')])

for (const v of TOURS_ONLY ? [] : all('videos')) {
  if (!v.youtube || out.videos[v.youtube]) continue
  const r = { }
  try {
    const o = await get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${v.youtube}&format=json`)
    r.oembed = o.status
    if (o.ok) { const j = await o.json(); r.title = j.title; r.channel = j.author_name; r.channelUrl = j.author_url }
    const h = await get(`https://www.youtube.com/watch?v=${v.youtube}`).then(x => x.text())
    r.seconds = +(h.match(/"lengthSeconds":"(\d+)"/)?.[1] || 0) || null
    r.uploadDate = h.match(/"uploadDate":"([^"]+)"/)?.[1]?.slice(0, 10) || null
    r.lang = h.match(/"defaultAudioLanguage":"([^"]+)"/)?.[1] || null
  } catch (e) { r.error = String(e) }
  out.videos[v.youtube] = r
  if (r.channelUrl && !out.channels[r.channel]) {
    try { const h = await get(r.channelUrl).then(x => x.text()); out.channels[r.channel] = { url: r.channelUrl, avatar: h.match(/property="og:image" content="([^"]+)"/)?.[1] || null } } catch {}
  }
  await sleep(400)
}

for (const p of TOURS_ONLY ? [] : all('podcasts')) {
  const key = `${p.show}|${p.episode}`
  if (out.podcasts[key]) continue
  const r = {}
  try {
    let ep = null
    const id = (p.apple || '').match(/[?&]i=(\d+)/)?.[1]
    if (id) ep = (await get(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode`).then(x => x.json())).results.find(x => x.wrapperType === 'podcastEpisode')
    if (!ep) {
      const s = await get(`https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=25&term=${encodeURIComponent(`${p.show} ${p.episode}`)}`).then(x => x.json())
      const norm = t => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      ep = s.results.find(x => norm(x.trackName) === norm(p.episode) && norm(x.collectionName).includes(norm(p.show).slice(0, 12))) ||
           s.results.find(x => norm(x.trackName).includes(norm(p.episode)) && norm(x.collectionName).includes(norm(p.show).slice(0, 12)))
    }
    if (ep) {
      Object.assign(r, { apple: ep.trackViewUrl.replace(/&uo=4$/, ''), title: ep.trackName, show: ep.collectionName, seconds: ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : null, date: (ep.releaseDate || '').slice(0, 10), collectionId: ep.collectionId })
      if (!out.shows[ep.collectionName]) {
        const c = (await get(`https://itunes.apple.com/lookup?id=${ep.collectionId}`).then(x => x.json())).results[0]
        out.shows[ep.collectionName] = { artwork: c?.artworkUrl600 || null, artist: c?.artistName || null }
      }
    } else r.notFound = true
  } catch (e) { r.error = String(e) }
  out.podcasts[key] = r
  await sleep(3200)
}

for (const b of TOURS_ONLY ? [] : all('books')) {
  if (!b.isbn || out.books[b.isbn]) continue
  const r = {}
  try {
    const j = await get(`https://openlibrary.org/isbn/${b.isbn}.json`)
    r.ol = j.status
    if (j.ok) { const d = await j.json(); r.title = d.title }
    const c = await get(`https://covers.openlibrary.org/b/isbn/${b.isbn}-L.jpg?default=false`)
    r.cover = c.ok ? `https://covers.openlibrary.org/b/isbn/${b.isbn}-L.jpg` : null
  } catch (e) { r.error = String(e) }
  out.books[b.isbn] = r
  await sleep(300)
}

const films = TOURS_ONLY ? [] : all('films').filter(f => f.imdb)
if (films.length) {
  const ids = films.map(f => `"${f.imdb}"`).join(' ')
  const q = `SELECT ?id ?itemLabel ?date WHERE { VALUES ?id { ${ids} } ?item wdt:P345 ?id . OPTIONAL { ?item wdt:P577 ?date } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`
  try {
    const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } }).then(x => x.json())
    for (const b of j.results.bindings) { const id = b.id.value; out.films[id] ||= { label: b.itemLabel.value, year: b.date ? +b.date.value.slice(0, 4) : null } }
  } catch (e) { out.films._error = String(e) }
}

for (const t of all('tours')) {
  if (!t.url || out.tours[t.url]) continue
  const r = {}
  try {
    const res = await get(t.url); r.status = res.status; const h = await res.text()
    r.title = h.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
    r.image = h.match(/property="og:image" content="([^"]+)"/)?.[1] || null
    const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')
    r.rating = +(ld.match(/"ratingValue":\s*"?([\d.]+)/)?.[1] || 0) || null
    r.ratings = +(ld.match(/"(?:ratingCount|reviewCount)":\s*"?(\d+)/)?.[1] || 0) || null
    r.price = +(ld.match(/"price":\s*"?([\d.]+)/)?.[1] || 0) || null
    r.currency = ld.match(/"priceCurrency":\s*"([A-Z]+)"/)?.[1] || null
    r.minutes = +(h.match(/(\d+)\s*min(?:ute)?s?\b/)?.[1] || 0) || null
    r.km = +(h.match(/([\d.]+)\s*km\b/)?.[1] || 0) || null
    r.creator = ld.match(/"author":\s*\{[^}]*"name":\s*"([^"]+)"/)?.[1] || null
    r.about = (h.match(/name="description" content="([^"]*)"/)?.[1] || '').slice(0, 400)
    r.km = +(h.match(/([\d.]+)\s*km\b/)?.[1] || 0) || null
    const ll = h.match(/"lat(?:itude)?"\s*:\s*"?(-?\d{1,2}\.\d{3,})"?\s*,\s*"(?:lng|lon|longitude)"\s*:\s*"?(-?\d{1,3}\.\d{3,})/)
    r.lat = ll ? +ll[1] : null; r.lon = ll ? +ll[2] : null
    r.start = (h.match(/[Ss]tart(?:ing)? (?:point|location)[^<]{0,20}<[^>]*>\s*([^<]{3,120})/)?.[1] || '').trim()
  } catch (e) { r.error = String(e) }
  out.tours[t.url] = r
  await sleep(600)
}
fs.writeFileSync('data/batch/check.json', JSON.stringify(out, null, 1))
console.log(`::notice::videos ${Object.keys(out.videos).length}, podcasts ${Object.keys(out.podcasts).length}, books ${Object.keys(out.books).length}, films ${Object.keys(out.films).length}, tours ${Object.keys(out.tours).length}`)
