// Lists every episode of a BBC programme brand from its public episode guide
// (title, programme link, synopsis). Brands come from data/run-dump-bbc lines
// "slug|pid". Output: data/feeds/bbc-<slug>.json. Read-only.
import fs from 'node:fs'
const lines = fs.readFileSync('data/run-dump-bbc', 'utf8').split('\n').filter(l => l.includes('|'))
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
for (const l of lines) {
  const [slug, pid] = l.split('|').map(x => x.trim())
  const out = [], seen = new Set()
  for (let page = 1; page <= 400; page++) {
    let html
    try { html = await fetch(`https://www.bbc.co.uk/programmes/${pid}/episodes/guide?page=${page}`, { headers: { 'User-Agent': UA } }).then(r => r.ok ? r.text() : '') } catch { html = '' }
    if (!html) break
    const blocks = html.split('programme--episode').slice(1)
    let added = 0
    for (const b of blocks) {
      const id = b.match(/data-pid="(\w+)"/)?.[1] || b.match(/\/programmes\/(\w{8,})/)?.[1]
      if (!id || seen.has(id)) continue
      seen.add(id); added++
      const title = clean(b.match(/class="programme__title[^"]*"[^>]*>([\s\S]*?)<\/(?:span|h\d|a)>/)?.[1] || '')
      const synopsis = clean(b.match(/class="programme__synopsis[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] || '').slice(0, 300)
      const date = b.match(/datetime="(\d{4}-\d{2}-\d{2})/)?.[1] || null
      out.push({ title, link: `https://www.bbc.co.uk/programmes/${id}`, about: synopsis, date })
    }
    if (!added) break
    await sleep(400)
  }
  fs.writeFileSync(`data/feeds/bbc-${slug}.json`, JSON.stringify({ show: slug, episodes: out }, null, 1))
  console.log(`::notice::${slug}: ${out.length} episodes`)
}
