// Looks up poster images on IMDb's public suggestion endpoint for a list of
// films (by IMDb id, or by title search when there is no id). Read-only:
// writes data/posters/out.json for review. Input: data/posters/in.json
// [{ key, imdb?, q }].
import fs from 'node:fs/promises'
const list = JSON.parse(await fs.readFile('data/posters/in.json', 'utf8'))
const out = []
for (const f of list) {
  const q = f.imdb || f.q
  try {
    const r = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(q.toLowerCase())}.json`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const d = await r.json()
    out.push({ ...f, status: r.status, hits: (d.d || []).slice(0, 5).map(h => ({ id: h.id, l: h.l, y: h.y, q: h.q, s: h.s, img: h.i?.imageUrl || null })) })
  } catch (e) { out.push({ ...f, err: String(e) }) }
  // also check the OMDb-style image still loads, for comparison
  await new Promise(r => setTimeout(r, 500))
}
for (const o of out) for (const h of o.hits || []) if (h.img) { try { const r = await fetch(h.img, { method: 'HEAD' }); h.ok = r.status } catch { h.ok = 0 } }
await fs.writeFile('data/posters/out.json', JSON.stringify(out, null, 1))
