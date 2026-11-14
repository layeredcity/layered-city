// Fetches the photos for the About tab from ryannee.com and saves them as
// 900px-wide WebP files in public/about/. Run by .github/workflows/about-photos.yml.
import fs from 'node:fs/promises'
import sharp from 'sharp'

const PHOTOS = {
  'ali-ryan-wedding.webp': 'https://www.ryannee.com/images/ali-ryan-wedding.jpeg',
  'ryan-owl.webp': 'https://www.ryannee.com/images/ryan-owl-web.jpg',
  'ali-ryan-italy.webp': 'https://www.ryannee.com/images/ali-ryan-italy.jpeg',
}

await fs.mkdir('public/about', { recursive: true })
for (const [name, url] of Object.entries(PHOTOS)) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await sharp(buf).rotate().resize({ width: 900, withoutEnlargement: true }).webp({ quality: 78 }).toFile('public/about/' + name)
  console.log('saved', name)
}
