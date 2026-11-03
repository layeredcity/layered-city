// Podcast episode search via the iTunes Search API, one query per line of
// data/run-itunes-search ("slug|query"). Output: data/podsearch/<slug>.json
// (episode title, show, Apple link, runtime, date, start of description,
// the query that found it), merged per slug. Read-only.
import fs from 'node:fs'
const lines = fs.readFileSync('data/run-itunes-search', 'utf8').split('\n').filter(l => l.includes('|'))
fs.mkdirSync('data/podsearch', { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const bySlug = {}
for (const l of lines) {
  const [slug, q] = l.split('|').map(s => s.trim())
  const m = (bySlug[slug] ||= {})
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=100&term=' + encodeURIComponent(q))
      if (r.status === 403 || r.status === 429) { await sleep(20000); continue }
      const j = await r.json()
      for (const x of j.results || []) {
        if (m[x.trackId]) continue
        m[x.trackId] = { title: x.trackName, show: x.collectionName, url: (x.trackViewUrl || '').replace(/&uo=4$/, ''), seconds: x.trackTimeMillis ? Math.round(x.trackTimeMillis / 1000) : null, date: (x.releaseDate || '').slice(0, 10), about: (x.description || '').replace(/\s+/g, ' ').slice(0, 300), q }
      }
      break
    } catch { await sleep(5000) }
  }
  await sleep(3500)
}
for (const [slug, m] of Object.entries(bySlug)) {
  fs.writeFileSync(`data/podsearch/${slug}.json`, JSON.stringify(Object.values(m), null, 1))
  console.log(`::notice::${slug}: ${Object.keys(m).length} episodes`)
}
