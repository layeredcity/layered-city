// Checks each candidate's URL from GitHub's runner (open internet): HTTP
// status, final URL, page title, and a runtime where the page exposes one
// (YouTube lengthSeconds, schema/OG duration, BBC programme duration).
// Input: data/single-work-candidates.json. Output: data/single-work-check.json.
import fs from 'node:fs'
const items = JSON.parse(fs.readFileSync('data/single-work-candidates.json', 'utf8')).filter(i => i.channel === 'Moving Pictures')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = ms => new Promise(r => setTimeout(r, ms))
function dur(html) {
  let m = html.match(/"lengthSeconds":"(\d+)"/); if (m) return +m[1]
  m = html.match(/"duration"\s*:\s*"P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/) || html.match(/content="P?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"\s*itemprop="duration"/)
  if (m && (m[1] || m[2] || m[3])) return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0))
  m = html.match(/"duration"\s*:\s*(\d{2,6})\b/); if (m) return +m[1]
  m = html.match(/(\d+)\s*mins?\b/); if (m) return +m[1] * 60
  return null
}
const out = []
for (const it of items) {
  const r = { title: it.title, channel: it.channel, url: it.url }
  try {
    const res = await fetch(it.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en' }, redirect: 'follow' })
    const html = await res.text()
    r.status = res.status; r.finalUrl = res.url
    r.pageTitle = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim().slice(0, 160)
    r.ogTitle = (html.match(/property="og:title"\s+content="([^"]*)"/i)?.[1] || '').slice(0, 160)
    r.ogImage = html.match(/property="og:image"\s+content="([^"]*)"/i)?.[1] || ''
    if (/bbc\.co\.uk/.test(it.url)) r.ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => m[1].slice(0, 3000))
    r.seconds = dur(html)
    const y = html.match(/"(?:uploadDate|datePublished|publishDate)"\s*:\s*"(\d{4})/); if (y) r.year = +y[1]
  } catch (e) { r.error = String(e) }
  out.push(r); console.log(r.status, r.seconds, r.pageTitle?.slice(0, 70))
  await sleep(700)
}
fs.writeFileSync('data/single-work-check.json', JSON.stringify(out, null, 1))
