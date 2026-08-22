// Adds an optional `foodNeighborhood` field to the `food` content type.
//
//   node scripts/add-food-neighborhood.mjs --dry-run
//   node scripts/add-food-neighborhood.mjs
//
// Optional on purpose. Plenty of dishes — bifana, bitoque, caracóis — are eaten
// everywhere in a city, and a neighborhood value for those would be noise
// dressed up as information. Blank is a real answer, and the app shows the line
// only when a dish has one.
//
// Additive: existing entries are untouched and stay valid.
import fs from 'fs'

const DRY_RUN = process.argv.includes('--dry-run')

const env = {}
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const i = l.indexOf('=')
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
}
const base = `https://api.contentful.com/spaces/${env.VITE_CONTENTFUL_SPACE}/environments/master`
const cma = (p, o = {}) => fetch(base + p, {
  ...o,
  headers: {
    Authorization: 'Bearer ' + env.CONTENTFUL_MANAGEMENT_TOKEN,
    'Content-Type': 'application/vnd.contentful.management.v1+json',
    ...(o.headers || {}),
  },
})

const res = await cma('/content_types/food')
if (!res.ok) { console.error('✖ could not read the food type:', res.status); process.exit(1) }
const ct = await res.json()

if (ct.fields.some(f => f.id === 'foodNeighborhood')) {
  console.log('✓ foodNeighborhood already exists — nothing to do.')
  process.exit(0)
}

const field = {
  id: 'foodNeighborhood',
  name: 'Best neighborhood',
  type: 'Symbol',
  required: false,
  localized: false,
  validations: [{ size: { max: 60 }, message: 'A neighborhood name, not a sentence.' }],
}

// Sits after the description, before the image — so the editor reads
// name, description, neighborhood, picture.
const fields = [...ct.fields]
const at = fields.findIndex(f => f.id === 'foodImage')
fields.splice(at < 0 ? fields.length : at, 0, field)

if (DRY_RUN) {
  console.log('would add:', JSON.stringify(field, null, 2))
  console.log('\nresulting field order:', fields.map(f => f.id).join(', '))
  console.log('\n(dry run — nothing was written)')
  process.exit(0)
}

const put = await cma('/content_types/food', {
  method: 'PUT',
  headers: { 'X-Contentful-Version': String(ct.sys.version) },
  body: JSON.stringify({ name: ct.name, description: ct.description, displayField: ct.displayField, fields }),
})
if (!put.ok) { console.error('✖ update failed', put.status, (await put.text()).slice(0, 300)); process.exit(1) }
const updated = await put.json()

const pub = await cma('/content_types/food/published', {
  method: 'PUT', headers: { 'X-Contentful-Version': String(updated.sys.version) },
})
if (!pub.ok) { console.error('✖ activate failed', pub.status, (await pub.text()).slice(0, 300)); process.exit(1) }
console.log('✓ added and activated — foodNeighborhood is live and optional')
