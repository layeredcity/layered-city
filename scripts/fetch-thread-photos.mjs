// Copies the Wikimedia Commons images named in src/data/threads.json
// (thread.image and chapter.image, as Commons file names) into
// public/threads/, with author and licence for the credit line, and writes
// src/data/thread-photos.json (file name → { src, author, license, page }).
// Images already copied are skipped. Runs in .github/workflows/thread-photos.yml.
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'

const UA = { 'User-Agent': 'LayeredCityBot/1.0 (https://layeredcity.com)' }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => (s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const threads = JSON.parse(await fs.readFile('src/data/threads.json', 'utf8'))
const mapPath = 'src/data/thread-photos.json'
const photos = JSON.parse(await fs.readFile(mapPath, 'utf8').catch(() => '{}'))
const files = new Set()
for (const t of threads) { if (t.image) files.add(t.image); for (const c of t.chapters) if (c.image) files.add(c.image) }
await fs.mkdir('public/threads', { recursive: true })
for (const file of files) {
  if (photos[file]) continue
  try {
    const u = new URL('https://commons.wikimedia.org/w/api.php')
    Object.entries({ action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo', titles: 'File:' + file, iiprop: 'url|extmetadata', iiurlwidth: '1600' }).forEach(([k, v]) => u.searchParams.set(k, v))
    const info = (await (await fetch(u, { headers: UA })).json()).query?.pages?.[0]?.imageinfo?.[0]
    if (!info?.thumburl) { console.log(`::warning::${file}: not found`); continue }
    await sleep(700)
    const buf = Buffer.from(await (await fetch(info.thumburl, { headers: UA })).arrayBuffer())
    const out = await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    const hash = crypto.createHash('sha1').update(out).digest('hex').slice(0, 10)
    await fs.writeFile(`public/threads/${hash}.webp`, out)
    const meta = info.extmetadata || {}
    photos[file] = { src: `/threads/${hash}.webp`, author: strip(meta.Artist?.value) || 'Unknown', license: strip(meta.LicenseShortName?.value) || '', page: info.descriptionurl }
    console.log(`::notice::${file}: ${photos[file].license}, ${photos[file].author}`)
  } catch (e) { console.log(`::warning::${file}: ${e.message}`) }
  await sleep(700)
}
await fs.writeFile(mapPath, JSON.stringify(photos, null, 1))
