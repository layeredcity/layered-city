// Adds an optional `foodEnglishName` field to the `food` content type.
//
//   node scripts/add-food-english-name.mjs --dry-run
//   node scripts/add-food-english-name.mjs
//
// Optional on purpose, and left blank for most dishes. Bitterballen, pastel de
// nata and stroopwafel are what English speakers actually say, so an English
// label on those would be inventing a name nobody uses. It gets filled only
// where a traveler is likely to meet the dish in English.
//
// `foodName` stays the local name: it is what the app searches Google Maps for,
// and menus are not written in English.
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

if (ct.fields.some(f => f.id === 'foodEnglishName')) {
  console.log('✓ foodEnglishName already exists — nothing to do.')
  process.exit(0)
}

const field = {
  id: 'foodEnglishName',
  name: 'English name',
  type: 'Symbol',
  required: false,
  localized: false,
  validations: [{ size: { max: 80 }, message: 'A short English name, not a description.' }],
}

// Directly after the dish name, since the two are read together.
const fields = [...ct.fields]
const at = fields.findIndex(f => f.id === 'foodName')
fields.splice(at < 0 ? 0 : at + 1, 0, field)

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
console.log('✓ added and activated — foodEnglishName is live and optional')
