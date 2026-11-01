// Lists every episode of a few podcasts (title, Apple Podcasts link, show
// link, runtime, date) from the iTunes lookup API and the show's RSS feed.
// Output: data/feeds/<slug>.json. Read-only.
import fs from 'node:fs'
const SHOWS = { 'painting-of-the-week': 1580296218, 'lonely-palette': 1110780638, 'inside-the-masterpiece': 1844970987 }
const extra = fs.existsSync('data/run-dump-feeds') ? fs.readFileSync('data/run-dump-feeds', 'utf8').split('\n').slice(1).filter(l => /^\S+ \d+$/.test(l)) : []
for (const l of extra) { const [k, v] = l.split(' '); SHOWS[k] = +v }
fs.mkdirSync('data/feeds', { recursive: true })
const tag = (x, t) => (x.match(new RegExp(`<${t}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1]?.trim()
for (const [slug, id] of Object.entries(SHOWS)) {
  try {
    const lk = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcastEpisode&limit=300`).then(r => r.json())
    const show = lk.results.find(r => r.wrapperType === 'track' && r.kind === 'podcast')
    const apple = Object.fromEntries(lk.results.filter(r => r.wrapperType === 'podcastEpisode').map(r => [r.trackName.trim(), { apple: r.trackViewUrl, ms: r.trackTimeMillis, date: r.releaseDate }]))
    let items = []
    if (show?.feedUrl) {
      const xml = await fetch(show.feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text())
      items = xml.split('<item>').slice(1).map(x => ({ title: tag(x, 'title'), link: tag(x, 'link'), duration: tag(x, 'itunes:duration'), date: tag(x, 'pubDate') }))
    }
    const rows = items.length ? items.map(i => ({ ...i, ...(apple[i.title] || {}) })) : Object.entries(apple).map(([title, a]) => ({ title, ...a }))
    fs.writeFileSync(`data/feeds/${slug}.json`, JSON.stringify({ show: show?.collectionName, feed: show?.feedUrl, episodes: rows }, null, 1))
    console.log(`::notice::${slug}: ${rows.length} episodes`)
  } catch (e) { console.log(`::warning::${slug}: ${e}`) }
}
