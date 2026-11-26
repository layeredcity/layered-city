// One-time move of the Words phrasebook out of Contentful (Nov 2026, to free
// about 1,300 of the free plan's 10,000 records). Writes one file per city,
// src/data/words/<city-slug>.json, keeping each word's Contentful ID so the
// generated audio (src/data/word-audio.json, keyed by ID) still matches.
// From now on the JSON files are the source; edit them in the repo.
import fs from 'node:fs/promises'
import { slugify } from '../src/utils/slugify.js'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = 'https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master'
async function all(q) {
  const items = []
  for (let skip = 0; ; ) {
    const d = await (await fetch(`${base}/entries?${q}&limit=1000&skip=${skip}`, { headers: { Authorization: 'Bearer ' + T } })).json()
    items.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return items
}
const cities = Object.fromEntries((await all('content_type=city')).map(c => [c.sys.id, c.fields.cityName]))
const byCity = {}
for (const w of await all('content_type=word&order=sys.createdAt')) {
  const f = w.fields, city = cities[f.city?.sys?.id]
  if (!city) continue
  const word = { id: w.sys.id, slot: f.slot, local: f.local }
  for (const k of ['phonetic', 'meaning', 'context', 'groupNote']) if (f[k]) word[k] = f[k]
  if (f.phoneticApproximate) word.phoneticApproximate = true
  if (f.deepCutOrder != null) word.deepCutOrder = f.deepCutOrder
  ;(byCity[city] ||= []).push(word)
}
await fs.mkdir('src/data/words', { recursive: true })
let n = 0
for (const [city, words] of Object.entries(byCity)) {
  await fs.writeFile(`src/data/words/${slugify(city)}.json`, JSON.stringify({ city, words }, null, 1) + '\n')
  n += words.length
}
console.log(`::notice::${n} words in ${Object.keys(byCity).length} cities`)
