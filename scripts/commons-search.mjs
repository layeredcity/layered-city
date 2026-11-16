// Research helper: for each key in data/commons/queries.json, searches
// Wikimedia Commons for landscape photos and writes data/commons/results.json
// plus a numbered contact sheet per key (data/commons/sheets/<key>.jpg), so
// candidates can be looked at without browsing Commons. Run by
// .github/workflows/commons-search.yml when the queries change.
import fs from 'node:fs/promises'
import sharp from 'sharp'

const UA = { 'User-Agent': 'LayeredCityBot/1.0 (https://layeredcity.com)' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const Q = JSON.parse(await fs.readFile('data/commons/queries.json', 'utf8'))
await fs.rm('data/commons/sheets', { recursive: true, force: true })
await fs.mkdir('data/commons/sheets', { recursive: true })
const results = {}
const W = 300, H = 170, COLS = 4, LABEL = 34
for (const [key, queries] of Object.entries(Q)) {
  const found = []
  for (const q of queries) {
    const u = new URL('https://commons.wikimedia.org/w/api.php')
    Object.entries({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '20', gsrsearch: q, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: String(W * 2) }).forEach(([k, v]) => u.searchParams.set(k, v))
    const d = await (await fetch(u, { headers: UA })).json()
    const pages = Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index)
    for (const p of pages) {
      const ii = p.imageinfo?.[0]
      if (!ii || ii.width < 1000 || ii.width < ii.height * 1.15 || found.some(f => f.title === p.title)) continue
      found.push({ title: p.title.replace(/^File:/, ''), w: ii.width, h: ii.height, thumb: ii.thumburl })
      if (found.length >= 8 * queries.length && found.length >= 8) break
    }
    await sleep(500)
  }
  results[key] = found.slice(0, 12).map(({ thumb, ...r }) => r)
  const tiles = []
  for (const [i, f] of found.slice(0, 12).entries()) {
    try {
      const buf = Buffer.from(await (await fetch(f.thumb, { headers: UA })).arrayBuffer())
      const img = await sharp(buf).resize(W, H, { fit: 'cover' }).toBuffer()
      const label = Buffer.from(`<svg width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="white"/><text x="4" y="14" font-family="sans-serif" font-size="12" font-weight="bold">${i}</text><text x="22" y="14" font-family="sans-serif" font-size="11">${f.title.slice(0, 44).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text><text x="22" y="28" font-family="sans-serif" font-size="11">${f.title.slice(44, 88).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`)
      tiles.push({ img, label, i })
    } catch { /* skip */ }
    await sleep(300)
  }
  if (!tiles.length) continue
  const rows = Math.ceil(tiles.length / COLS)
  const comp = []
  tiles.forEach((t, n) => {
    const x = (n % COLS) * W, y = Math.floor(n / COLS) * (H + LABEL)
    comp.push({ input: t.img, left: x, top: y }, { input: t.label, left: x, top: y + H })
  })
  await sharp({ create: { width: COLS * W, height: rows * (H + LABEL), channels: 3, background: '#fff' } }).composite(comp).jpeg({ quality: 70 }).toFile(`data/commons/sheets/${key}.jpg`)
}
await fs.writeFile('data/commons/results.json', JSON.stringify(results, null, 1))
