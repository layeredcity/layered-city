// Saves OMDb data (rating, poster, runtime…) for every story with an IMDb id
// into src/data/omdb.json, so visitors never call OMDb themselves. A free OMDb
// key allows 1,000 requests a day for everyone combined; calling it from the
// browser on every city open would run out at modest traffic.
// Run weekly by .github/workflows/snapshot-omdb.yml. A failed lookup keeps the
// previous entry.
import fs from 'node:fs'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const KEY = process.env.OMDB_KEY
if (!KEY) { console.log('::error::Add a repository secret named OMDB_KEY (the OMDb API key).'); process.exit(1) }
const OUT = 'src/data/omdb.json'
const base = `https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master/entries?access_token=${T}`

const ids = new Set()
for (let skip = 0; ;) {
  const r = await fetch(base + `&content_type=story&fields.imdbId[exists]=true&select=fields.imdbId&limit=1000&skip=${skip}`).then(r => r.json())
  for (const i of r.items) { const id = (i.fields.imdbId || '').trim(); if (/^tt\d+$/.test(id)) ids.add(id) }
  skip += r.items.length
  if (!r.items.length || skip >= r.total) break
}

const old = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
const out = {}
let fetched = 0, kept = 0, missing = 0
for (const id of [...ids].sort()) {
  try {
    const d = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=${KEY}`).then(r => r.json())
    if (d.Response === 'True') {
      const v = x => (x && x !== 'N/A' ? x : null)
      out[id] = {
        rating: v(d.imdbRating),
        poster: v(d.Poster)?.replace(/^http:/, 'https:') || null,
        title: v(d.Title),
        year: v(d.Year),
        runtime: v(d.Runtime),
        genre: v(d.Genre),
      }
      fetched++
    } else if (/limit/i.test(d.Error || '')) {
      throw new Error(d.Error)
    } else if (old[id]) { out[id] = old[id]; kept++ } else missing++
  } catch (e) {
    if (old[id]) { out[id] = old[id]; kept++ } else missing++
    if (/limit/i.test(e.message)) console.log(`::warning::OMDb limit reached at ${id}`)
  }
  await new Promise(r => setTimeout(r, 150))
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${ids.size} IMDb ids: ${fetched} fetched, ${kept} kept from last run, ${missing} not found`)
