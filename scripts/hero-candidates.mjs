// Finds city hero photo candidates on Wikimedia Commons (quality images first).
// data/run-hero lines "slug|search terms". Saves 480px previews to
// data/heroes/<slug>-<n>.jpg and metadata to data/heroes/<slug>.json. Read-only.
import fs from 'node:fs'
const UA = 'LayeredCity/1.0 (https://layeredcity.com)'
const api = q => fetch('https://commons.wikimedia.org/w/api.php?format=json&' + q, { headers: { 'User-Agent': UA } }).then(r => r.json())
const sleep = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync('data/heroes', { recursive: true })
for (const l of fs.readFileSync('data/run-hero', 'utf8').split('\n').filter(x => x.includes('|'))) {
  const [slug, terms] = l.split('|').map(s => s.trim())
  const seen = new Set(), meta = []
  for (const t of terms.split(';')) {
    for (const extra of [' incategory:"Quality_images"', '']) {
      const j = await api('action=query&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=' + encodeURIComponent(`${t.trim()} filetype:bitmap${extra}`) + '&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=480')
      for (const p of Object.values(j.query?.pages || {})) {
        const ii = p.imageinfo?.[0]; if (!ii || seen.has(p.title)) continue
        if (ii.width < 1600 || ii.width < ii.height) continue
        seen.add(p.title)
        const m = ii.extmetadata || {}
        meta.push({ file: p.title, url: ii.url, width: ii.width, height: ii.height, thumb: ii.thumburl, license: m.LicenseShortName?.value, author: (m.Artist?.value || '').replace(/<[^>]+>/g, '').trim(), q: t.trim() + extra })
      }
      await sleep(500)
      if (meta.length >= 10) break
    }
    if (meta.length >= 10) break
  }
  const keep = meta.slice(0, 10)
  for (let i = 0; i < keep.length; i++) {
    const b = Buffer.from(await fetch(keep[i].thumb, { headers: { 'User-Agent': UA } }).then(r => r.arrayBuffer()))
    fs.writeFileSync(`data/heroes/${slug}-${i}.jpg`, b); keep[i].preview = `${slug}-${i}.jpg`
    await sleep(300)
  }
  fs.writeFileSync(`data/heroes/${slug}.json`, JSON.stringify(keep, null, 1))
  console.log(`::notice::${slug}: ${keep.length}`)
}
