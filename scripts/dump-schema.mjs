// Writes data/contentful-schema.json: every content type with its fields
// (id, type, required, link type, validations). Read-only. Needs
// CONTENTFUL_MANAGEMENT_TOKEN (runs from .github/workflows/dump-schema.yml).
import fs from 'node:fs/promises'
const r = await fetch('https://api.contentful.com/spaces/yl6xhrcd616q/environments/master/content_types?limit=1000', { headers: { Authorization: 'Bearer ' + process.env.CONTENTFUL_MANAGEMENT_TOKEN } })
const d = await r.json()
const out = Object.fromEntries(d.items.map(ct => [ct.sys.id, { name: ct.name, displayField: ct.displayField, fields: ct.fields.map(f => ({ id: f.id, type: f.type, linkType: f.linkType || f.items?.linkType, required: !!f.required, disabled: !!f.disabled, omitted: !!f.omitted, validations: f.validations?.length ? f.validations : undefined, items: f.items?.validations?.length ? f.items.validations : undefined })) }]))
await fs.writeFile('data/contentful-schema.json', JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${Object.keys(out).length} content types`)
