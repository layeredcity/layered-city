// Read-only (Delivery API). Writes data/channels/_all.json (every channel with
// its story count and media type) and data/channels/<slug>.json for each
// channel named on the first line of data/run-dump-channel (comma-separated):
// every story with id, city, title, place, description and link.
import fs from 'node:fs'
const SPACE = 'yl6xhrcd616q'
const TOKEN = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = `https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?access_token=${TOKEN}`
const get = q => fetch(base + q).then(r => r.json())
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
async function all(q) { let out = [], skip = 0; for (;;) { const r = await get(q + `&limit=1000&skip=${skip}`); out.push(...r.items); skip += r.items.length; if (!r.items.length || skip >= r.total) return out } }

const want = fs.readFileSync('data/run-dump-channel', 'utf8').split('\n')[0].split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const cities = Object.fromEntries((await all('&content_type=city&select=sys.id,fields.cityName')).map(c => [c.sys.id, c.fields.cityName]))
const channels = await all('&content_type=channel&select=sys.id,fields.channelName,fields.mediaType')
const stories = await all('&content_type=story&select=sys.id,fields.storyTitle,fields.channel,fields.relatedCity,fields.locationName,fields.storyDescription,fields.mediaUrl,fields.mediaType')
const byCh = {}
for (const s of stories) { const id = s.fields.channel?.sys?.id; if (id) (byCh[id] ||= []).push(s) }
fs.mkdirSync('data/channels', { recursive: true })
fs.writeFileSync('data/channels/_all.json', JSON.stringify(channels.map(c => ({ id: c.sys.id, name: c.fields.channelName, type: c.fields.mediaType, stories: (byCh[c.sys.id] || []).length })).sort((a, b) => b.stories - a.stories), null, 1))
for (const c of channels) {
  if (!want.includes((c.fields.channelName || '').toLowerCase())) continue
  const rows = (byCh[c.sys.id] || []).map(s => ({ id: s.sys.id, city: cities[s.fields.relatedCity?.sys?.id] || '', title: s.fields.storyTitle, place: s.fields.locationName || '', description: s.fields.storyDescription || '', url: s.fields.mediaUrl || '' })).sort((a, b) => a.city.localeCompare(b.city))
  fs.writeFileSync(`data/channels/${slug(c.fields.channelName)}.json`, JSON.stringify(rows, null, 1))
  console.log(`::notice::${c.fields.channelName}: ${rows.length} stories`)
}
