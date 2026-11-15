// Narrates threads with ElevenLabs. For each slug in data/thread-audio.json,
// writes public/audio/<slug>/<n>.mp3 (one per segment: the intro, then each
// chapter) and public/audio/<slug>/index.json with the start time of every
// sentence, so the page can highlight and scroll along with the voice.
// Segments whose text hasn't changed are skipped. Runs in
// .github/workflows/thread-audio.yml with the ELEVENLABS_API_KEY secret.
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { threadScript } from '../src/utils/sentences.js'

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) { console.log('::warning::ELEVENLABS_API_KEY secret is not set yet; nothing narrated'); process.exit(0) }
const cfg = JSON.parse(await fs.readFile('data/thread-audio.json', 'utf8'))
const threads = JSON.parse(await fs.readFile('src/data/threads.json', 'utf8'))
const voice = cfg.voice
const model = cfg.model || 'eleven_multilingual_v2'

for (const slug of cfg.threads) {
  const thread = threads.find(t => t.slug === slug)
  if (!thread) { console.log(`::warning::${slug}: no such thread`); continue }
  const dir = `public/audio/${slug}`
  await fs.mkdir(dir, { recursive: true })
  const old = JSON.parse(await fs.readFile(`${dir}/index.json`, 'utf8').catch(() => '{"segments":[]}'))
  const segments = []
  for (const [n, parts] of threadScript(thread).entries()) {
    const text = parts.map(p => p.say).join(' ')
    const hash = crypto.createHash('sha1').update(`${voice}|${model}|${text}`).digest('hex').slice(0, 12)
    const prev = old.segments[n]
    if (prev && prev.hash === hash) { segments.push(prev); continue }
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.15 } }),
    })
    if (!res.ok) { console.log(`::error::${slug} #${n}: ${res.status} ${await res.text()}`); process.exit(1) }
    const d = await res.json()
    const file = `${n}-${hash}.mp3`
    await fs.writeFile(`${dir}/${file}`, Buffer.from(d.audio_base64, 'base64'))
    if (prev?.file && prev.file !== file) await fs.rm(`${dir}/${prev.file}`, { force: true })
    // Start time of each part = start time of its first character.
    const starts = d.alignment.character_start_times_seconds
    let at = 0
    const marks = parts.map(p => { const t = starts[at] ?? 0; at += p.say.length + 1; return { key: p.key, t: Math.round(t * 100) / 100 } })
    const dur = d.alignment.character_end_times_seconds.at(-1) || 0
    segments.push({ file, hash, dur: Math.round(dur * 100) / 100, marks })
    console.log(`::notice::${slug} #${n}: ${text.length} chars, ${dur.toFixed(1)}s`)
  }
  await fs.writeFile(`${dir}/index.json`, JSON.stringify({ voice, model, segments }, null, 1))
}
