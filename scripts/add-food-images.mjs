// Add dish images to the repo (instead of Contentful, where each image would
// cost one of the free plan's 10,000 records).
//
//   node scripts/add-food-images.mjs <City> <folder-of-images>
//   e.g. node scripts/add-food-images.mjs Belgrade ~/Downloads/belgrade-dishes
//
// Name each file after the dish's local name, slugged: lowercase, accents
// dropped, spaces to hyphens (Ćevapi → cevapi.png, Smørrebrød → smorrebrod.png,
// Karađorđeva šnicla → karadjordjeva-snicla.png). The app matches images to
// dishes the same way (src/utils/covers.js), so no Contentful IDs are needed.
// Re-running with a new image for the same dish replaces the old one.
//
// Writes public/food/<city>/<dish>-<hash>.webp and src/data/food-images.json.
// Needs sharp: npm i --no-save sharp

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { slugify } from '../src/utils/slugify.js'

const [city, dir] = process.argv.slice(2)
if (!city || !dir) { console.error('usage: node scripts/add-food-images.mjs <City> <folder>'); process.exit(1) }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const MAP = path.join(ROOT, 'src', 'data', 'food-images.json')
const citySlug = slugify(city)
const outDir = path.join(ROOT, 'public', 'food', citySlug)

const map = JSON.parse(await fs.readFile(MAP, 'utf8').catch(() => '{}'))
map[citySlug] ||= {}
await fs.mkdir(outDir, { recursive: true })

for (const name of (await fs.readdir(dir)).sort()) {
  if (!/\.(png|jpe?g|webp)$/i.test(name)) continue
  const dish = slugify(name.replace(/\.[^.]+$/, ''))
  // Shown at 116px; 320px covers high-density screens. Keeps transparency.
  const out = await sharp(path.join(dir, name)).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer()
  const hash = crypto.createHash('sha1').update(out).digest('hex').slice(0, 8)
  const old = map[citySlug][dish]
  if (old && old !== hash) await fs.rm(path.join(outDir, `${dish}-${old}.webp`), { force: true })
  await fs.writeFile(path.join(outDir, `${dish}-${hash}.webp`), out)
  map[citySlug][dish] = hash
  console.log(`${old ? (old === hash ? '=' : '↻') : '+'} ${citySlug}/${dish}  ${(out.length / 1024).toFixed(0)} KB`)
}

const sorted = Object.fromEntries(Object.keys(map).sort().map(c => [c, Object.fromEntries(Object.keys(map[c]).sort().map(d => [d, map[c][d]]))]))
await fs.writeFile(MAP, JSON.stringify(sorted, null, 1) + '\n')
