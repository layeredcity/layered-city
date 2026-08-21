// Creates the `food` content type in Contentful (master environment).
//
//   node scripts/create-food-type.mjs            # create + activate
//   node scripts/create-food-type.mjs --dry-run  # print the model, write nothing
//
// Additive and one-shot: it refuses to run if a `food` type already exists, so
// it can never overwrite a model you have since edited by hand.
//
// Food deliberately has NO location field. Dishes outlive the restaurants that
// serve them, so a Food entry belongs to a city, not to a pin on the map.
import fs from 'fs'

const DRY_RUN = process.argv.includes('--dry-run')

const env = {}
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const i = l.indexOf('=')
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
}
for (const k of ['VITE_CONTENTFUL_SPACE', 'CONTENTFUL_MANAGEMENT_TOKEN']) {
  if (!env[k]) { console.error(`\n✖ Missing ${k} in .env\n`); process.exit(1) }
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

const model = {
  name: 'Food',
  description: 'A dish worth eating in a city. Deliberately has no location — dishes outlive the restaurants that serve them.',
  displayField: 'foodName',
  fields: [
    {
      id: 'foodName', name: 'Dish name', type: 'Symbol',
      required: true, localized: false,
    },
    {
      id: 'foodDescription', name: 'Description', type: 'Symbol',
      required: true, localized: false,
      validations: [{ size: { max: 256 }, message: 'Keep it to 256 characters or fewer.' }],
    },
    {
      id: 'foodImage', name: 'Illustration', type: 'Link', linkType: 'Asset',
      required: false, localized: false,
      validations: [{ linkMimetypeGroup: ['image'] }],
    },
    {
      id: 'relatedCity', name: 'City', type: 'Link', linkType: 'Entry',
      required: true, localized: false,
      validations: [{ linkContentType: ['city'] }],
    },
    {
      id: 'listOrder', name: 'List order', type: 'Integer',
      required: false, localized: false,
    },
  ],
}

if (DRY_RUN) {
  console.log(JSON.stringify(model, null, 2))
  console.log('\n(dry run — nothing was written)')
  process.exit(0)
}

const existing = await cma('/content_types/food')
if (existing.status === 200) {
  console.error('\n✖ A `food` content type already exists. Stopping rather than overwriting it.\n')
  process.exit(1)
}

const res = await cma('/content_types/food', { method: 'PUT', body: JSON.stringify(model) })
if (!res.ok) {
  console.error('\n✖ create failed', res.status, (await res.text()).slice(0, 400), '\n')
  process.exit(1)
}
const created = await res.json()
console.log('✓ created  (version ' + created.sys.version + ')')

const pub = await cma('/content_types/food/published', {
  method: 'PUT',
  headers: { 'X-Contentful-Version': String(created.sys.version) },
})
if (!pub.ok) {
  console.error('\n✖ activate failed', pub.status, (await pub.text()).slice(0, 400), '\n')
  process.exit(1)
}
console.log('✓ activated — Food can now hold entries')
