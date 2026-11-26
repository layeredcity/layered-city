// Monthly link check of every published story. Runs on GitHub's runner (open
// internet) from .github/workflows/monthly-link-check.yml.
//
// For each story it checks the main link (mediaUrl) and the second link
// (secondaryUrl). YouTube videos are checked through oEmbed, which fails for
// videos that were removed or made private. Everything else gets a GET that
// follows redirects. Results go to data/fact-check/links.json:
//   broken: 404/410, DNS or connection failures, removed YouTube videos
//   check:  other errors (403, 429, 5xx, timeouts), which are often a site
//           blocking robots rather than a dead link, so a person should look
// The monthly fact-check session reads this file. Read-only: it never edits
// Contentful.
import fs from 'node:fs/promises'

const T = process.env.CONTENTFUL_DELIVERY_TOKEN
const SPACE = 'yl6xhrcd616q'
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; LayeredCityLinkCheck/1.0; +https://layeredcity.com)' }
const CONCURRENCY = 8
const TIMEOUT = 20000

async function all(type) {
  const items = []
  for (let skip = 0; ; ) {
    const d = await (await fetch(`https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?content_type=${type}&limit=1000&skip=${skip}`, { headers: { Authorization: 'Bearer ' + T } })).json()
    items.push(...d.items); skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return items
}

const withScheme = u => (/^https?:\/\//i.test(u) ? u : 'https://' + u)
const BLOCKS_ROBOTS = /(^|\.)(spotify\.com|bookshop\.org|justwatch\.com)$/
const ytId = u => (u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/) || [])[1]

async function get(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: ctl.signal })
    r.body?.cancel().catch(() => {})
    return { status: r.status, final: r.url }
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.cause?.code || e.message) }
  } finally { clearTimeout(t) }
}

async function check(url) {
  const id = ytId(url)
  if (id) {
    const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`)
    if (r.status === 200) return { ok: true }
    if ([400, 401, 403, 404].includes(r.status)) return { verdict: 'broken', status: r.status, note: 'YouTube video removed or private' }
    return { verdict: 'check', status: r.status, note: r.error }
  }
  const r = await get(url)
  if (r.status >= 200 && r.status < 400) return { ok: true }
  // These sites turn away robots (403) or rate-limit them (429), so those
  // answers say nothing about the link. The first run flagged 1,300 of them.
  if ([403, 429].includes(r.status) && BLOCKS_ROBOTS.test(new URL(url).hostname)) return { ok: true }
  const dead = r.status === 404 || r.status === 410 || ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN'].includes(r.error)
  return { verdict: dead ? 'broken' : 'check', status: r.status, note: r.error, final: r.final }
}

const cities = Object.fromEntries((await all('city')).map(c => [c.sys.id, c.fields.cityName]))
// The delivery API only returns published entries.
const stories = await all('story')
const jobs = []
for (const s of stories) {
  for (const field of ['mediaUrl', 'secondaryUrl']) {
    const u = s.fields[field]
    if (typeof u === 'string' && u.trim()) jobs.push({ id: s.sys.id, city: cities[s.fields.relatedCity?.sys?.id], title: s.fields.storyTitle, field, url: withScheme(u.trim()) })
  }
}

const results = []
let next = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++]
    const r = await check(j.url)
    if (!r.ok) results.push({ ...j, ...r })
    await new Promise(res => setTimeout(res, 150))
  }
}))

const order = { broken: 0, check: 1 }
results.sort((a, b) => order[a.verdict] - order[b.verdict] || (a.city || '').localeCompare(b.city || ''))
const out = {
  checked: new Date().toISOString().slice(0, 10),
  stories: stories.length,
  links: jobs.length,
  broken: results.filter(r => r.verdict === 'broken').length,
  check: results.filter(r => r.verdict === 'check').length,
  problems: results,
}
await fs.mkdir('data/fact-check', { recursive: true })
await fs.writeFile('data/fact-check/links.json', JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${out.links} links in ${out.stories} stories: ${out.broken} broken, ${out.check} to check`)
