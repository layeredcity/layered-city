// Counts the published records in Contentful (entries by content type, plus
// assets) and writes data/contentful-usage.json. Uses the delivery API, so it
// sees published records only; drafts aren't included. Runs from
// .github/workflows/count-records.yml.
import fs from 'node:fs/promises'
const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const base = 'https://cdn.contentful.com/spaces/yl6xhrcd616q/environments/master'
const get = async p => (await fetch(base + p, { headers: { Authorization: 'Bearer ' + T } })).json()
const types = (await get('/content_types?limit=1000')).items.map(t => t.sys.id)
const entries = {}
for (const t of types) entries[t] = (await get(`/entries?content_type=${t}&limit=0`)).total
const assets = (await get('/assets?limit=0')).total
const totalEntries = Object.values(entries).reduce((a, b) => a + b, 0)
const out = { counted: new Date().toISOString().slice(0, 10), records: totalEntries + assets, entries: totalEntries, assets, byType: Object.fromEntries(Object.entries(entries).sort((a, b) => b[1] - a[1])) }
await fs.writeFile('data/contentful-usage.json', JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${out.records} published records: ${totalEntries} entries, ${assets} assets`)
