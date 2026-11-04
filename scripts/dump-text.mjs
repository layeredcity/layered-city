// Read-only dump of the editorial text in Words, Food and the Words preambles,
// for copy-editing passes. Writes data/text/{words,food,cities}.json.
import fs from 'node:fs/promises'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
async function all(type) {
  const items = []
  for (let skip = 0; ; ) {
    const d = await (await fetch(`https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master/entries?content_type=${type}&limit=1000&skip=${skip}`, { headers: { Authorization: 'Bearer ' + T } })).json()
    items.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return items
}
await fs.mkdir('data/text', { recursive: true })
const cities = await all('city')
const cn = Object.fromEntries(cities.map(c => [c.sys.id, c.fields.cityName]))
const strip = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null && typeof o[k] !== 'object').map(k => [k, o[k]]))
const words = (await all('word')).map(i => ({ id: i.sys.id, city: cn[i.fields.city?.sys?.id], ...strip(i.fields, ['slot', 'local', 'phonetic', 'meaning', 'context', 'groupNote']) }))
const food = (await all('food')).map(i => ({ id: i.sys.id, city: cn[i.fields.relatedCity?.sys?.id], ...strip(i.fields, Object.keys(i.fields)) }))
await fs.writeFile('data/text/words.json', JSON.stringify(words, null, 1))
await fs.writeFile('data/text/food.json', JSON.stringify(food, null, 1))
await fs.writeFile('data/text/cities.json', JSON.stringify(cities.map(c => ({ id: c.sys.id, city: c.fields.cityName, wordsPreamble: c.fields.wordsPreamble })), null, 1))
// Stories, compact, for finding material for cross-city threads.
const stories = (await all('story')).map(i => ({ id: i.sys.id, city: cn[i.fields.relatedCity?.sys?.id], type: (i.fields.mediaType || '').toLowerCase(), title: i.fields.storyTitle, place: i.fields.locationName || undefined, creator: i.fields.creatorName || undefined, desc: i.fields.storyDescription }))
await fs.writeFile('data/text/stories.json', JSON.stringify(stories))
