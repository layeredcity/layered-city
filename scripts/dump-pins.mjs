// Exports every city's story pins (place name + coordinates + media type) to
// data/pins/<city>.json, for building Landmarks. Read-only (Delivery API).
import fs from 'node:fs'
const SPACE = 'yl6xhrcd616q'
const TOKEN = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = `https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?access_token=${TOKEN}`
const get = q => fetch(base + q).then(r => r.json())
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const cities = (await get('&content_type=city&limit=200')).items
fs.mkdirSync('data/pins', { recursive: true })
for (const c of cities) {
  const res = await get(`&content_type=story&fields.relatedCity.sys.id=${c.sys.id}&limit=1000&include=1`)
  const ch = Object.fromEntries((res.includes?.Entry || []).map(e => [e.sys.id, e.fields]))
  const pins = res.items.filter(i => i.fields.storyLocation).map(i => ({
    id: i.sys.id,
    title: i.fields.storyTitle,
    type: i.fields.mediaType || ch[i.fields.channel?.sys?.id]?.mediaType || null,
    place: i.fields.locationName || '',
    lat: +i.fields.storyLocation.lat.toFixed(5),
    lon: +i.fields.storyLocation.lon.toFixed(5),
  }))
  fs.writeFileSync(`data/pins/${slug(c.fields.cityName)}.json`, JSON.stringify({ city: c.fields.cityName, pins }, null, 1))
  console.log(`::notice::${c.fields.cityName}: ${pins.length} pins`)
}
