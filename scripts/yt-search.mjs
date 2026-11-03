// YouTube search via yt-dlp, one query per line of data/run-yt-search
// ("slug|query"). Output: data/ytsearch/<slug>.json (id, title, channel,
// duration, views, url) — merged per slug across queries. Read-only.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
const lines = fs.readFileSync('data/run-yt-search', 'utf8').split('\n').filter(l => l.includes('|'))
fs.mkdirSync('data/ytsearch', { recursive: true })
const bySlug = {}
for (const l of lines) {
  const [slug, q] = l.split('|').map(s => s.trim())
  let d = { entries: [] }
  try { d = JSON.parse(execFileSync('yt-dlp', ['--flat-playlist', '-J', `ytsearch30:${q}`], { maxBuffer: 64e6 }).toString()) } catch (e) { console.log(`::warning::${q}: ${String(e).slice(0, 120)}`) }
  const list = (bySlug[slug] ||= {})
  for (const e of d.entries || []) {
    if (!e?.id || list[e.id]) continue
    list[e.id] = { id: e.id, title: e.title, channel: e.channel || e.uploader, duration: e.duration, views: e.view_count, q }
  }
}
for (const [slug, m] of Object.entries(bySlug)) {
  fs.writeFileSync(`data/ytsearch/${slug}.json`, JSON.stringify(Object.values(m), null, 1))
  console.log(`::notice::${slug}: ${Object.keys(m).length} videos`)
}
