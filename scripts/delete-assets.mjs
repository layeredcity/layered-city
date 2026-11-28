// Deletes the Contentful assets listed in data/migrate/run-delete-assets
// (first line: mode "dry-run" or "delete"; then one asset id per line).
// Refuses to delete an asset that any entry still links to.
// Runs from .github/workflows/delete-assets.yml. Writes data/migrate/delete-assets-log.json.
import fs from 'node:fs/promises'
const TOKEN = process.env.CONTENTFUL_MANAGEMENT_TOKEN
const base = 'https://api.contentful.com/spaces/yl6xhrcd616q/environments/master'
const cma = async (path, opts = {}) => {
  const r = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/vnd.contentful.management.v1+json', ...(opts.headers || {}) } })
  const body = r.status === 204 ? null : await r.json().catch(() => null)
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path}: ${r.status} ${JSON.stringify(body)?.slice(0, 300)}`)
  return body
}
const lines = (await fs.readFile('data/migrate/run-delete-assets', 'utf8')).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
const mode = lines.shift() === 'delete' ? 'delete' : 'dry-run'
const log = { mode, at: new Date().toISOString(), results: [] }
for (const id of lines) {
  try {
    let a = await cma(`/assets/${id}`)
    const links = (await cma(`/entries?links_to_asset=${id}&limit=100`)).items.map(e => e.sys.id)
    const title = a.fields.title?.['en-US']
    if (links.length) { log.results.push({ id, title, status: 'kept: still linked', links }); continue }
    if (mode === 'delete') {
      if (a.sys.publishedVersion) a = await cma(`/assets/${id}/published`, { method: 'DELETE', headers: { 'X-Contentful-Version': String(a.sys.version) } })
      await cma(`/assets/${id}`, { method: 'DELETE', headers: { 'X-Contentful-Version': String(a.sys.version) } })
    }
    log.results.push({ id, title, status: mode === 'delete' ? 'deleted' : 'would delete' })
  } catch (e) { log.results.push({ id, status: 'error', error: e.message }) }
}
await fs.writeFile('data/migrate/delete-assets-log.json', JSON.stringify(log, null, 1))
console.log(JSON.stringify(log))
