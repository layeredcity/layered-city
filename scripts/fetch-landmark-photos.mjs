// Landmark photos from Wikipedia/Wikimedia Commons (freely licensed). For each
// landmark with a `wikipedia` article title in src/data/landmarks.json (in the
// cities listed in CITIES), takes the article's lead image, downloads a 1200px
// version, saves it as WebP under public/landmarks/<city>/, and records the
// photographer and licence in src/data/landmark-photos.json for the credit
// line. Existing photos are kept unless REFRESH=1. Needs: npm i --no-save sharp
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import sharp from 'sharp'

const CITIES = (process.env.CITIES || 'Vienna').split(',').map(s => s.trim())
const UA = { 'user-agent': 'LayeredCityBot/1.0 (https://layeredcity.com; landmark photos)' }
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const strip = h => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const api = (host, params) => fetch(`https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', ...params }), { headers: UA }).then(r => r.json())

const landmarks = JSON.parse(await fs.readFile('src/data/landmarks.json', 'utf8'))
const mapPath = 'src/data/landmark-photos.json'
const photos = JSON.parse(await fs.readFile(mapPath, 'utf8').catch(() => '{}'))

for (const city of CITIES) {
  for (const lm of landmarks[city] || []) {
    const key = `${slug(city)}/${lm.id}`
    if (!lm.wikipedia || (photos[key] && !process.env.REFRESH)) continue
    try {
      const page = (await api('en.wikipedia.org', { action: 'query', prop: 'pageimages', piprop: 'name', titles: lm.wikipedia, redirects: '1' })).query?.pages?.[0]
      let file = lm.photoFile || page?.pageimage
      // No lead image, or it's a logo/map/drawing: fall back to the article's
      // first photograph.
      if (!file || !/\.(jpe?g|png|webp|tiff?)$/i.test(file) || /logo|map|plan|icon|flag|coat|seal|signature/i.test(file)) {
        const imgs = (await api('en.wikipedia.org', { action: 'query', prop: 'images', titles: lm.wikipedia, redirects: '1', imlimit: '50' })).query?.pages?.[0]?.images || []
        file = imgs.map(i => i.title.replace(/^File:/, '')).find(f => /\.(jpe?g)$/i.test(f) && !/logo|map|plan|icon|flag|coat|seal|signature|portrait|commons-logo/i.test(f))
      }
      if (!file) { console.log(`::warning::${key}: no photo on "${lm.wikipedia}"`); continue }
      const info = (await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', titles: 'File:' + file, iiprop: 'url|extmetadata', iiurlwidth: '1200' })).query?.pages?.[0]?.imageinfo?.[0]
      if (!info?.thumburl) { console.log(`::warning::${key}: ${file} not on Commons`); continue }
      const meta = info.extmetadata || {}
      const buf = Buffer.from(await (await fetch(info.thumburl, { headers: UA })).arrayBuffer())
      const out = await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
      const hash = crypto.createHash('sha1').update(out).digest('hex').slice(0, 8)
      await fs.mkdir(`public/landmarks/${slug(city)}`, { recursive: true })
      await fs.writeFile(`public/landmarks/${slug(city)}/${lm.id}-${hash}.webp`, out)
      photos[key] = {
        src: `/landmarks/${slug(city)}/${lm.id}-${hash}.webp`,
        author: strip(meta.Artist?.value) || 'Unknown',
        license: strip(meta.LicenseShortName?.value) || '',
        page: info.descriptionurl,
      }
      console.log(`::notice::${key}: ${file} (${photos[key].license}, ${photos[key].author})`)
    } catch (e) {
      console.log(`::error::${key}: ${e.message}`)
    }
  }
}
await fs.writeFile(mapPath, JSON.stringify(photos, null, 1) + '\n')
