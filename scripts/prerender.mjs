// Writes a static HTML page for the home page, every city, every city section
// and every thread into dist/, so link previews (iMessage, Slack, social) and
// search engines see a real title, description, image and text instead of an
// empty app shell. The app itself is unchanged: it loads on top of the page
// and takes over as usual.
//
// Also writes sitemap.xml, robots.txt and 1200×630 preview images for threads
// and the home page.
//
// Runs after `vite build` (see vite.config.js). It must never break a deploy:
// if Contentful can't be reached, it logs a warning and leaves the plain app.
import fs from 'node:fs/promises'
import path from 'node:path'

const SITE = 'https://layeredcity.com'
const DIST = 'dist'
const SPACE = process.env.VITE_CONTENTFUL_SPACE || 'yl6xhrcd616q'
const TOKEN = process.env.VITE_CONTENTFUL_TOKEN
const TAGLINE = 'The guidebook companion for curious travelers in Europe'

const SPELLED = { đ: 'dj', æ: 'ae', ø: 'o', ß: 'ss', œ: 'oe', ł: 'l', ı: 'i', þ: 'th', ð: 'd' }
const slugify = s => String(s || '').toLowerCase().replace(/[đæøßœłıþð]/g, c => SPELLED[c])
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' }

// The media sections, as in the app's FILTERS (TV is hidden in the app).
const SECTIONS = [
  { label: 'Books', type: 'book', unit: ['book', 'books'], blurb: 'Novels and nonfiction about {city}' },
  { label: 'Movies', type: 'movie', unit: ['movie', 'movies'], blurb: 'Films set in {city}' },
  { label: 'Music', type: 'music', unit: ['song', 'songs'], blurb: 'A portrait of {city} in songs' },
  { label: 'Podcasts', type: 'podcast', unit: ['episode', 'episodes'], blurb: 'Podcast episodes about {city}' },
  { label: 'Videos', type: 'video', unit: ['video', 'videos'], blurb: 'Short videos about {city}' },
  { label: 'Tours', type: 'audiotour', unit: ['tour', 'tours'], blurb: 'Self-guided audio tours of {city}' },
]

async function cda(query) {
  const items = [], includes = { Entry: [], Asset: [] }
  for (let skip = 0; ; ) {
    const u = `https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?${query}&limit=1000&skip=${skip}`
    const res = await fetch(u, { headers: { Authorization: 'Bearer ' + TOKEN } })
    if (!res.ok) throw new Error(`Contentful ${res.status}`)
    const d = await res.json()
    items.push(...d.items)
    if (d.includes) { includes.Entry.push(...(d.includes.Entry || [])); includes.Asset.push(...(d.includes.Asset || [])) }
    skip += d.items.length
    if (skip >= d.total || !d.items.length) break
  }
  return { items, includes }
}

// The built index.html with this page's head tags and a text snapshot inside
// #root (visually hidden; the app replaces it when it starts).
function page(shell, { title, description, url, image, body }) {
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="Layered City">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    image && `<meta property="og:image" content="${esc(image)}">`,
    image && `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    image && `<meta name="twitter:image" content="${esc(image)}">`,
  ].filter(Boolean).join('\n    ')
  return shell
    .replace(/<title>[\s\S]*?<\/title>/, head)
    .replace('<div id="root"></div>', `<div id="root"><div class="prerender" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">${body}</div></div>`)
}

async function write(rel, html) {
  const file = path.join(DIST, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, html)
}

async function loadSharp() {
  try { return (await import('sharp')).default } catch { return null }
}

export default async function prerender() {
  if (!TOKEN) { console.warn('[prerender] no Contentful token; skipping'); return }
  const shell = await fs.readFile(path.join(DIST, 'index.html'), 'utf8')
  const threads = JSON.parse(await fs.readFile('src/data/threads.json', 'utf8'))
  const photos = JSON.parse(await fs.readFile('src/data/thread-photos.json', 'utf8'))
  const sharp = await loadSharp()

  const { items: cityItems, includes: cityInc } = await cda('content_type=city&order=fields.cityName')
  const assets = Object.fromEntries(cityInc.Asset.map(a => [a.sys.id, a.fields?.file?.url]))
  const cities = cityItems.map(c => ({
    id: c.sys.id, name: c.fields.cityName, country: c.fields.countryName, slug: slugify(c.fields.cityName),
    hero: assets[c.fields.cityHeroImage?.sys?.id] ? 'https:' + assets[c.fields.cityHeroImage.sys.id] : null,
    quote: c.fields.cityQuote, quoteBy: c.fields.cityQuoteAttribution,
  }))
  const { items: storyItems, includes: storyInc } = await cda('content_type=story&include=1&select=sys.id,fields.storyTitle,fields.storyDescription,fields.mediaType,fields.relatedCity,fields.locationName,fields.creatorName,fields.channel')
  const channels = Object.fromEntries(storyInc.Entry.map(e => [e.sys.id, e.fields]))
  const byCity = {}
  for (const s of storyItems) {
    const f = s.fields, ch = channels[f.channel?.sys?.id]
    const type = String(f.mediaType || ch?.mediaType || '').toLowerCase()
    const cid = f.relatedCity?.sys?.id
    if (!cid || type === 'tv') continue
    ;(byCity[cid] ||= []).push({ title: f.storyTitle, desc: f.storyDescription, type, place: f.locationName, by: f.creatorName || ch?.channelName })
  }

  const cityImage = c => c.hero ? `${c.hero}?w=1200&h=630&fit=fill&fm=jpg&q=80` : null
  const storyList = list => '<ul>' + list.map(s => `<li><h3>${esc(s.title)}</h3>${s.by ? `<p>${esc(s.by)}</p>` : ''}${s.place ? `<p>${esc(s.place)}</p>` : ''}${s.desc ? `<p>${esc(s.desc)}</p>` : ''}</li>`).join('') + '</ul>'
  const urls = [SITE + '/']

  // Cities and their sections.
  for (const c of cities) {
    const stories = byCity[c.id] || []
    const present = SECTIONS.filter(sec => stories.some(s => s.type === sec.type))
    const counts = present.map(sec => { const n = stories.filter(s => s.type === sec.type).length; return `${n} ${sec.unit[n === 1 ? 0 : 1]}` })
    const description = clip(`Podcasts, films, books, music, and walking tours pinned to the places in ${c.name} they’re about: ${counts.join(', ')}.`)
    const body = `<h1>${esc(c.name)}</h1><p>${esc(c.country)}</p>${c.quote ? `<blockquote>${esc(c.quote)}${c.quoteBy ? ` — ${esc(c.quoteBy)}` : ''}</blockquote>` : ''}` +
      present.map(sec => `<h2><a href="/${c.slug}/${slugify(sec.label)}">${sec.label}</a></h2>` + storyList(stories.filter(s => s.type === sec.type))).join('')
    await write(`${c.slug}.html`, page(shell, { title: `${c.name} | Layered City`, description, url: `${SITE}/${c.slug}`, image: cityImage(c), body }))
    urls.push(`${SITE}/${c.slug}`)
    for (const sec of present) {
      const list = stories.filter(s => s.type === sec.type)
      const title = `${sec.blurb.replace('{city}', c.name)} | Layered City`
      const desc = clip(`${list.length} ${sec.unit[list.length === 1 ? 0 : 1]}, each pinned to the place in ${c.name} it’s about. ${list.slice(0, 3).map(s => s.title).join(', ')}.`)
      const body = `<h1>${esc(sec.blurb.replace('{city}', c.name))}</h1><p><a href="/${c.slug}">${esc(c.name)}</a></p>` + storyList(list)
      await write(`${c.slug}/${slugify(sec.label)}.html`, page(shell, { title, description: desc, url: `${SITE}/${c.slug}/${slugify(sec.label)}`, image: cityImage(c), body }))
      urls.push(`${SITE}/${c.slug}/${slugify(sec.label)}`)
    }
  }

  // Threads, with a 1200×630 JPEG preview made from the lead photo.
  await fs.mkdir(path.join(DIST, 'og'), { recursive: true })
  for (const t of threads) {
    let image = null
    const p = photos[t.image]
    if (p && sharp) {
      try {
        await sharp(path.join('public', p.src)).resize(1200, 630, { fit: 'cover', position: 'attention' }).jpeg({ quality: 80 }).toFile(path.join(DIST, 'og', `thread-${t.slug}.jpg`))
        image = `${SITE}/og/thread-${t.slug}.jpg`
      } catch (e) { console.warn('[prerender] thread image', t.slug, e.message) }
    }
    const cityCount = new Set(t.chapters.map(c => c.city)).size
    const description = clip(t.intro[0], 200)
    const body = `<h1>${esc(t.title)}</h1><p>${esc(t.kind)} · ${esc(t.dates)} · ${cityCount} cities</p>` + t.intro.map(p => `<p>${esc(p)}</p>`).join('') +
      t.chapters.map(c => `<h2>${esc(c.heading)}</h2><p>${esc(c.when)} · ${esc(c.place)}</p><p>${esc(c.text)}</p>`).join('')
    await write(`threads/${t.slug}.html`, page(shell, { title: `${t.title} | Layered City`, description, url: `${SITE}/threads/${t.slug}`, image, body }))
    urls.push(`${SITE}/threads/${t.slug}`)
  }

  // Home page: a collage of city photos with the logo in the middle.
  let homeImage = null
  if (sharp) {
    try {
      const picks = cities.filter(c => c.hero).slice(0, 8)
      const tiles = await Promise.all(picks.map(async c => {
        const buf = Buffer.from(await (await fetch(`${c.hero}?w=300&h=315&fit=fill&fm=jpg`)).arrayBuffer())
        return sharp(buf).resize(300, 315).toBuffer()
      }))
      const logo = await sharp('public/logo.png').resize(260, 260).toBuffer()
      const ring = Buffer.from('<svg width="284" height="284"><circle cx="142" cy="142" r="140" fill="#F7F4EF"/></svg>')
      await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#F7F4EF' } })
        .composite([...tiles.map((b, i) => ({ input: b, left: (i % 4) * 300, top: Math.floor(i / 4) * 315 })), { input: ring, left: 458, top: 173 }, { input: logo, left: 470, top: 185 }])
        .jpeg({ quality: 82 }).toFile(path.join(DIST, 'og', 'home.jpg'))
      homeImage = `${SITE}/og/home.jpg`
    } catch (e) { console.warn('[prerender] home image', e.message) }
  }
  const homeBody = `<h1>Layered City</h1><p>${TAGLINE}</p><h2>Cities</h2><ul>` + cities.map(c => `<li><a href="/${c.slug}">${esc(c.name)}</a>, ${esc(c.country)}</li>`).join('') +
    '</ul><h2>Threads</h2><ul>' + threads.map(t => `<li><a href="/threads/${t.slug}">${esc(t.title)}</a>: ${esc(clip(t.intro[0], 140))}</li>`).join('') + '</ul>'
  await fs.writeFile(path.join(DIST, 'index.html'), page(shell, {
    title: `Layered City | ${TAGLINE}`,
    description: `Podcasts, films, books, music, and walking tours pinned to the places they’re about, in ${cities.length} European cities.`,
    url: SITE + '/', image: homeImage, body: homeBody,
  }))

  // Threads list (/threads).
  const kinds = [...new Set(threads.map(t => t.kind))]
  const threadsBody = '<h1>Threads</h1><p>Stories that run across several cities.</p>' + kinds.map(k => `<h2>${esc(k)}</h2><ul>` +
    threads.filter(t => t.kind === k).map(t => `<li><a href="/threads/${t.slug}">${esc(t.title)}</a>: ${esc(clip(t.intro[0], 140))}</li>`).join('') + '</ul>').join('')
  await write('threads.html', page(shell, { title: 'Threads | Layered City', description: `${threads.length} stories that follow people, movements, and events across European cities.`, url: SITE + '/threads', image: homeImage, body: threadsBody }))
  urls.push(SITE + '/threads')

  // About page.
  try {
    const about = (await import(path.resolve('src/data/about.js'))).default
    const body = '<h1>About Layered City</h1>' + about.map(sec => (sec.heading ? `<h2>${esc(sec.heading)}</h2>` : '') + sec.paragraphs.map(p => `<p>${esc(p.replace('{cities}', cities.length))}</p>`).join('')).join('')
    await write('about.html', page(shell, { title: 'About | Layered City', description: clip(about[0].paragraphs[0]), url: SITE + '/about', image: homeImage, body }))
    urls.push(SITE + '/about')
  } catch (e) { console.warn('[prerender] about', e.message) }

  await fs.writeFile(path.join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`)
  await fs.writeFile(path.join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`)
  console.log(`[prerender] ${urls.length} pages`)
}
