// Which Contentful assets the repo has made unnecessary. For every published
// asset, lists the entries and fields that point to it, and whether each of
// those already has a copy in this repo (covers, artwork, channel icons, dish
// images, word audio). Writes data/migrate/asset-usage.json. Read-only.
import fs from 'node:fs/promises'
import { slugify } from '../src/utils/slugify.js'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = 'https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master'
async function all(path, q = '') {
  const items = []
  for (let skip = 0; ; ) {
    const d = await (await fetch(`${base}/${path}?${q}&limit=1000&skip=${skip}`, { headers: { Authorization: 'Bearer ' + T } })).json()
    items.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return items
}
const covers = JSON.parse(await fs.readFile('src/data/covers.json', 'utf8'))
const foodImages = JSON.parse(await fs.readFile('src/data/food-images.json', 'utf8'))
const wordAudio = JSON.parse(await fs.readFile('src/data/word-audio.json', 'utf8'))
const assets = await all('assets')
const entries = await all('entries')
const cities = Object.fromEntries(entries.filter(e => e.sys.contentType.sys.id === 'city').map(c => [c.sys.id, c.fields.cityName]))
const refs = {} // assetId -> [{ type, field, entry, inRepo }]
const inRepo = (type, field, e) => {
  const f = e.fields
  if (type === 'story' && field === 'coverAsset') return !!covers.story?.[e.sys.id]
  if (type === 'story' && field === 'artworkImage') return !!covers.artwork?.[e.sys.id]
  if (type === 'channel' && field === 'channelIcon') return !!covers.channel?.[e.sys.id]
  if (type === 'food' && field === 'foodImage') return !!foodImages[slugify(cities[f.relatedCity?.sys?.id])]?.[slugify(f.foodName)]
  if (type === 'word') return true // words move to the repo; their entries go away
  return false
}
for (const e of entries) {
  const type = e.sys.contentType.sys.id
  for (const [field, v] of Object.entries(e.fields)) {
    for (const link of [v].flat()) {
      if (link?.sys?.linkType === 'Asset') (refs[link.sys.id] ||= []).push({ type, field, entry: e.sys.id, inRepo: inRepo(type, field, e) })
    }
  }
}
const rows = assets.map(a => {
  const r = refs[a.sys.id] || []
  return { id: a.sys.id, title: a.fields?.title, file: a.fields?.file?.fileName, refs: r, deletable: r.every(x => x.inRepo) }
})
const groups = {}
for (const r of rows) {
  const key = r.refs.length ? [...new Set(r.refs.map(x => `${x.type}.${x.field}`))].join('+') : 'unused'
  const g = (groups[key] ||= { total: 0, deletable: 0 }); g.total++; if (r.deletable) g.deletable++
}
const out = { checked: new Date().toISOString().slice(0, 10), assets: rows.length, deletable: rows.filter(r => r.deletable).length, groups, keep: rows.filter(r => !r.deletable).map(r => ({ id: r.id, file: r.file, refs: r.refs })), deletableIds: rows.filter(r => r.deletable).map(r => r.id) }
await fs.mkdir('data/migrate', { recursive: true })
await fs.writeFile('data/migrate/asset-usage.json', JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${out.assets} assets, ${out.deletable} deletable`, JSON.stringify(groups))
