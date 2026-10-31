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
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Wikimedia rate-limits bursts; pace requests and back off when told to.
async function api(host, params) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(700)
    const r = await fetch(`https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params }), { headers: UA })
    const text = await r.text()
    try { const j = JSON.parse(text); if (!j.error) return j } catch {}
    await sleep(5000 * (attempt + 1))
  }
  throw new Error('Wikimedia API kept refusing')
}

const landmarks = JSON.parse(await fs.readFile('src/data/landmarks.json', 'utf8'))
const mapPath = 'src/data/landmark-photos.json'
const photos = JSON.parse(await fs.readFile(mapPath, 'utf8').catch(() => '{}'))

for (const city of CITIES) {
  for (const lm of landmarks[city] || []) {
    const key = `${slug(city)}/${lm.id}`
    if (lm.noPhoto || (photos[key] && !process.env.REFRESH && !(process.env.ONLY || '').split(',').includes(lm.id))) continue
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(lm.id)) continue
    const wiki = (lm.wikipediaLang || 'en') + '.wikipedia.org'
    try {
      // No article given: search Wikipedia for "name city" and take the top hit.
      if (!lm.wikipedia) {
        const hit = (await api(wiki, { action: 'query', list: 'search', srsearch: `${lm.name} ${city}`, srlimit: '1' })).query?.search?.[0]
        if (!hit) { console.log(`::warning::${key}: no article found`); continue }
        lm.wikipedia = hit.title
      }
      const page = (await api(wiki, { action: 'query', prop: 'pageimages', piprop: 'name', titles: lm.wikipedia, redirects: '1' })).query?.pages?.[0]
      let file = lm.photoFile || page?.pageimage
      // No lead image, or it's a logo/map/drawing: fall back to the article's
      // first photograph.
      if (!file || !/\.(jpe?g|png|webp|tiff?)$/i.test(file) || /logo|map|plan|icon|flag|coat|seal|signature/i.test(file)) {
        const imgs = (await api(wiki, { action: 'query', prop: 'images', titles: lm.wikipedia, redirects: '1', imlimit: '50' })).query?.pages?.[0]?.images || []
        if (process.env.ONLY) console.log(`::notice::${key} images: ` + imgs.map(i => i.title.replace(/^(File|Datei):/, '')).filter(f => /\.jpe?g$/i.test(f)).join(' | ').slice(0, 3500))
        file = imgs.map(i => i.title.replace(/^(File|Datei):/, '')).find(f => /\.(jpe?g)$/i.test(f) && !/logo|map|plan|icon|flag|coat|seal|signature|portrait|commons-logo| - |GG \d|Testament/i.test(f))
      }
      if (!file) { console.log(`::warning::${key}: no photo on "${lm.wikipedia}"`); continue }
      const info = (await api('commons.wikimedia.org', { action: 'query', prop: 'imageinfo', titles: 'File:' + file, iiprop: 'url|extmetadata', iiurlwidth: '1200' })).query?.pages?.[0]?.imageinfo?.[0]
      if (!info?.thumburl) { console.log(`::warning::${key}: ${file} not on Commons`); continue }
      const meta = info.extmetadata || {}
      await sleep(700)
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
        article: lm.wikipedia,
        file,
      }
      console.log(`::notice::${key}: ${file} (${photos[key].license}, ${photos[key].author})`)
    } catch (e) {
      console.log(`::error::${key}: ${e.message}`)
    }
  }
}
await fs.writeFile(mapPath, JSON.stringify(photos, null, 1) + '\n')
