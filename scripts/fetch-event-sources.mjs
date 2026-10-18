// Fetches the pages listed in events/sources/<city>.json and saves, for each,
// a plain-text copy with links kept inline ("text <url>") plus any schema.org
// Event objects found in JSON-LD. The weekly Events refresh reads these files,
// so it never has to open pages itself. Run: CITY=vienna node scripts/fetch-event-sources.mjs
import fs from 'node:fs'
import path from 'node:path'

const CITY = (process.env.CITY || 'vienna').toLowerCase()
const cfg = JSON.parse(fs.readFileSync(`events/sources/${CITY}.json`, 'utf8'))
const OUT = `events/raw/${CITY}`
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const decode = s => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))

function toText(html, base) {
  let h = html
    .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  h = h.replace(/<a\b[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
    let url = href
    try { url = new URL(decode(href), base).href } catch {}
    const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return t ? ` ${t} <${url}> ` : ''
  })
  h = h.replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section|\/article|time)[^>]*>/gi, '\n')
  h = h.replace(/<time[^>]*datetime="([^"]+)"[^>]*>/gi, ' [$1] ')
  h = decode(h.replace(/<[^>]+>/g, ' '))
  return h.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean)
    .filter((l, i, a) => l !== a[i - 1]).join('\n')
}

function events(html) {
  const out = []
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = o => {
        if (!o || typeof o !== 'object') return
        if (Array.isArray(o)) return o.forEach(walk)
        const t = [].concat(o['@type'] || [])
        if (t.some(x => /Event|Exhibition/i.test(x))) out.push(o)
        Object.values(o).forEach(walk)
      }
      walk(JSON.parse(m[1]))
    } catch {}
  }
  return out
}

const status = {}
for (const [name, url] of Object.entries(cfg.urls)) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
        'accept-language': 'en,de;q=0.8',
      },
    })
    const html = await res.text()
    const text = toText(html, res.url).slice(0, 200000)
    const ev = events(html)
    fs.writeFileSync(path.join(OUT, `${name}.txt`), `SOURCE ${res.url}\nFETCHED ${new Date().toISOString()}\nHTTP ${res.status}\n\n${text}\n`)
    if (ev.length) fs.writeFileSync(path.join(OUT, `${name}.events.json`), JSON.stringify(ev, null, 1).slice(0, 400000))
    status[name] = { url, final: res.url, http: res.status, chars: text.length, jsonLdEvents: ev.length }
    console.log(`::notice::${name} ${res.status} ${text.length} chars, ${ev.length} events`)
  } catch (e) {
    status[name] = { url, error: String(e.message || e) }
    console.log(`::error::${name} ${e.message || e}`)
  }
}
fs.writeFileSync(path.join(OUT, '_status.json'), JSON.stringify({ fetched: new Date().toISOString(), status }, null, 1))
