// Read-only: every movie/TV story whose links don't include JustWatch.
// Output: data/movie-links.json
import fs from 'node:fs'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = `https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master/entries?access_token=${T}`
const out = []
let total = 0
for (const t of ['movie', 'tv']) {
  let skip = 0
  for (;;) {
    const r = await fetch(base + `&content_type=story&fields.mediaType=${t}&limit=1000&skip=${skip}&include=1&select=sys.id,fields.storyTitle,fields.mediaUrl,fields.secondaryUrl,fields.relatedCity`).then(r => r.json())
    const cities = Object.fromEntries((r.includes?.Entry || []).map(e => [e.sys.id, e.fields.cityName]))
    for (const i of r.items) {
      total++
      const urls = [i.fields.mediaUrl, i.fields.secondaryUrl].filter(Boolean)
      if (!urls.some(u => u.includes('justwatch'))) out.push({ id: i.sys.id, type: t, city: cities[i.fields.relatedCity?.sys?.id] || '', title: i.fields.storyTitle, urls })
    }
    skip += r.items.length
    if (!r.items.length || skip >= r.total) break
  }
}
fs.writeFileSync('data/movie-links.json', JSON.stringify({ total, withoutJustWatch: out }, null, 1))
console.log(`::notice::${total} movies/TV, ${out.length} without JustWatch`)
