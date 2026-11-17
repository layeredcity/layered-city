// Narrates threads with ElevenLabs. For each slug in data/thread-audio.json,
// writes public/audio/<slug>/<n>.mp3 (one per segment: the intro, then each
// chapter) and public/audio/<slug>/index.json with the start time of every
// sentence, so the page can highlight and scroll along with the voice.
// Segments whose text hasn't changed are skipped. Runs in
// .github/workflows/thread-audio.yml with the ELEVENLABS_API_KEY secret.
//
// Two voices: `titleVoice` reads the thread title and each chapter's heading
// and place, and `voice` reads everything else. Each is recorded separately
// and joined with ffmpeg into one file per segment, with a short pause
// between. Without `titleVoice`, `voice` reads it all.
//
// A voice is either an ID already in the account, or { voice_id, owner, name }
// for a voice-library voice, which is added to the account for the run and
// removed afterwards (Starter plans hold 10 voices).
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { threadScript } from '../src/utils/sentences.js'

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) { console.log('::warning::ELEVENLABS_API_KEY secret is not set yet; nothing narrated'); process.exit(0) }
const fail = e => { console.log(`::error::${String(e?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1) }
process.on('unhandledRejection', fail); process.on('uncaughtException', fail)

const cfg = JSON.parse(await fs.readFile('data/thread-audio.json', 'utf8'))
const threads = JSON.parse(await fs.readFile('src/data/threads.json', 'utf8'))
const model = cfg.model || 'eleven_multilingual_v2'
const GAP = 0.6 // seconds of silence between the title voice and the body voice
const FADE = 0.06 // seconds faded out at the end of each clip before the next voice
// The title voice sometimes clipped its last syllable just before the body
// voice came in. Its text is recorded with a trailing pause (an ellipsis,
// which v3 reads as a breath), and each clip fades out before the gap. The
// pause isn't part of the hash, so existing recordings aren't redone.
const TAIL = ' …'
const idOf = v => (typeof v === 'string' ? v : v?.voice_id)
// Each job narrates one thread into public/audio/<dir>/. The threads list uses
// the main voices; `trials` record a thread with other voices into a separate
// folder (<slug>--trial), for listening at ?voices=trial without touching the
// live recordings.
const jobs = [
  ...cfg.threads.map(slug => ({ slug, dir: slug, body: cfg.voice, title: cfg.titleVoice || cfg.voice })),
  ...(cfg.trials || []).map(t => ({ slug: t.slug, dir: `${t.slug}--trial`, body: t.voice, title: t.titleVoice || t.voice, rev: t.rev })),
]

const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, cmd === 'ffmpeg' ? ['-nostdin', '-loglevel', 'error', ...args] : args, { timeout: 120000 }, (e, so, se) => e ? rej(new Error(`${cmd}: ${se || e.message}`)) : res(so)))
const duration = async f => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f])).trim())
const el = (p, init = {}) => fetch('https://api.elevenlabs.io' + p, { ...init, headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' } })

// Library voices are added on first use; `live` maps the configured ID to the
// ID the account uses for it.
const mine = new Set(((await (await el('/v1/voices')).json()).voices || []).map(v => v.voice_id))
const live = {}, added = []
async function useVoice(v) {
  const id = idOf(v)
  if (live[id]) return live[id]
  if (mine.has(id) || typeof v === 'string') return (live[id] = id)
  const r = await el(`/v1/voices/add/${v.owner}/${id}`, { method: 'POST', body: JSON.stringify({ new_name: `LC threads – ${v.name || id}`.slice(0, 100) }) })
  if (!r.ok) throw new Error(`Could not add voice ${v.name || id}: ${r.status} ${(await r.text()).slice(0, 300)}`)
  live[id] = (await r.json()).voice_id || id
  added.push(live[id])
  return live[id]
}

async function speak(voice, text) {
  const voice_settings = model === 'eleven_v3' ? { stability: 0.5 } : { stability: 0.5, similarity_boost: 0.75, style: 0.15 }
  const res = await el(`/v1/text-to-speech/${await useVoice(voice)}/with-timestamps?output_format=mp3_44100_128`, { method: 'POST', body: JSON.stringify({ text, model_id: model, voice_settings }) })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const d = await res.json()
  return { audio: Buffer.from(d.audio_base64, 'base64'), starts: d.alignment.character_start_times_seconds, ends: d.alignment.character_end_times_seconds, end: d.alignment.character_end_times_seconds.at(-1) || 0 }
}

// v3 often adds a breath after the last word, and some voices render the
// title voice's trailing pause as faint crackle. Every clip is cut where its
// last word ends and faded out there. The word's end comes from the character
// timings: the start of whatever follows the last letter (closing
// punctuation, or the title voice's trailing pause), since the end time of
// the last letter tends to run long. Then the cut is pulled back to the last
// moment that is louder than a faint noise floor, which drops the crackle.
const pcm = f => new Promise((res, rej) => execFile('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', f, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], { encoding: 'buffer', maxBuffer: 1 << 28, timeout: 120000 }, (e, so) => e ? rej(e) : res(new Int16Array(so.buffer, so.byteOffset, so.length >> 1))))
async function trimClip(f, d, text) {
  let k = text.length - 1
  while (k > 0 && !/[\p{L}\p{N}]/u.test(text[k])) k--
  const wordEnd = d.starts?.[k + 1] ?? d.ends?.[k]
  if (!wordEnd) return { file: f, info: 'no timings' }
  const s = await pcm(f), FR = 160 // 10 ms frames at 16 kHz
  const loud = i => { let sum = 0; for (let j = i * FR; j < (i + 1) * FR; j++) sum += (s[j] / 32768) ** 2; return 10 * Math.log10(sum / FR + 1e-12) > -40 }
  let i = Math.min(Math.floor((wordEnd + 0.12) * 100), Math.floor(s.length / FR) - 1)
  while (i > 0 && !loud(i)) i--
  const lastLoud = (i + 1) / 100
  const end = lastLoud > wordEnd - 0.4 ? Math.min(lastLoud, wordEnd + 0.12) + 0.04 : wordEnd + 0.1
  const cut = f.replace(/\.mp3$/, '-cut.mp3')
  await run('ffmpeg', ['-y', '-i', f, '-af', `atrim=end=${end.toFixed(3)},afade=t=out:st=${Math.max(0, end - 0.07).toFixed(3)}:d=0.07`, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', cut])
  return { file: cut, info: `word ends ${wordEnd.toFixed(2)}s, last sound ${lastLoud.toFixed(2)}s, cut ${end.toFixed(2)}s of ${(s.length / 16000).toFixed(2)}s` }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'thread-audio-'))
try {
  for (const job of jobs) {
    const slug = job.slug
    const VOICES = { body: job.body, title: job.title }
    const two = idOf(VOICES.title) !== idOf(VOICES.body)
    const roleOf = key => (two && (key === 'title' || key.endsWith('-h')) ? 'title' : 'body')
    const thread = threads.find(t => t.slug === slug)
    if (!thread) { console.log(`::warning::${slug}: no such thread`); continue }
    const dir = `public/audio/${job.dir}`
    await fs.mkdir(dir, { recursive: true })
    const old = JSON.parse(await fs.readFile(`${dir}/index.json`, 'utf8').catch(() => '{"segments":[]}'))
    const segments = []
    for (const [n, parts] of threadScript(thread).entries()) {
      // Consecutive parts read by the same voice are recorded together.
      const groups = []
      for (const p of parts) {
        const role = roleOf(p.key)
        if (groups.at(-1)?.role === role) groups.at(-1).parts.push(p); else groups.push({ role, parts: [p] })
      }
      for (const g of groups) g.text = g.parts.map(p => p.say).join(' ')
      const hash = crypto.createHash('sha1').update((job.rev ? `${job.rev}|` : '') + (two
        // 0.45 was the original gap. It stays in the hash so changing GAP doesn't re-record everything.
        ? `2|${model}|0.45|` + groups.map(g => `${idOf(VOICES[g.role])}|${g.text}`).join('|')
        : `${idOf(VOICES.body)}|${model}|${groups[0].text}`)).digest('hex').slice(0, 12)
      const prev = old.segments[n]
      if (prev && prev.hash === hash) { segments.push(prev); continue }
      // Threads listed in `keep` hold on to their existing recordings even when
      // the text changes slightly (a spelling pass), as long as the chapter's
      // sentences still line up with the recorded timings.
      if (prev && job.dir === slug && (cfg.keep || []).includes(slug) && prev.marks?.length === parts.length && prev.marks.every((m, i) => m.key === parts[i].key)) { segments.push(prev); continue }
      const file = `${n}-${hash}.mp3`
      const marks = []
      let dur
      if (groups.length === 1) {
        const d = await speak(VOICES[groups[0].role], groups[0].text)
        const raw = path.join(tmp, `${slug}-${n}-only.mp3`)
        await fs.writeFile(raw, d.audio)
        const t = await trimClip(raw, d, groups[0].text)
        console.log(`${job.dir} #${n}: ${t.info}`)
        await fs.copyFile(t.file, `${dir}/${file}`)
        let at = 0
        for (const p of groups[0].parts) { marks.push({ key: p.key, t: d.starts[at] ?? 0 }); at += p.say.length + 1 }
        dur = await duration(`${dir}/${file}`)
      } else {
        // Record each group, then join them with a pause after each but the last.
        const clips = []
        let offset = 0
        const durs = []
        for (const [gi, g] of groups.entries()) {
          const d = await speak(VOICES[g.role], g.role === 'title' ? g.text + TAIL : g.text)
          let f = path.join(tmp, `${slug}-${n}-${gi}.mp3`)
          await fs.writeFile(f, d.audio)
          const t = await trimClip(f, d, g.text)
          console.log(`${job.dir} #${n}.${gi} ${g.role}: ${t.info}`)
          f = t.file
          let at = 0
          for (const p of g.parts) { marks.push({ key: p.key, t: offset + (d.starts[at] ?? 0) }); at += p.say.length + 1 }
          clips.push(f)
          durs.push(await duration(f))
          offset += durs.at(-1) + (gi < groups.length - 1 ? GAP : 0)
        }
        const filter = clips.map((_, i) => i < clips.length - 1 ? `[${i}:a]afade=t=out:st=${Math.max(0, durs[i] - FADE).toFixed(3)}:d=${FADE},apad=pad_dur=${GAP}[a${i}]` : `[${i}:a]afade=t=in:st=0:d=0.02[a${i}]`).join(';')
          + ';' + clips.map((_, i) => `[a${i}]`).join('') + `concat=n=${clips.length}:v=0:a=1[out]`
        await run('ffmpeg', ['-y', ...clips.flatMap(f => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', `${dir}/${file}`])
        dur = await duration(`${dir}/${file}`)
      }
      if (prev?.file && prev.file !== file) await fs.rm(`${dir}/${prev.file}`, { force: true })
      segments.push({ file, hash, dur: Math.round(dur * 100) / 100, marks: marks.map(m => ({ key: m.key, t: Math.round(m.t * 100) / 100 })) })
      console.log(`::notice::${job.dir} #${n}: ${groups.reduce((c, g) => c + g.text.length, 0)} chars, ${dur.toFixed(1)}s`)
    }
    // Drop files for segments that no longer exist.
    for (const s of old.segments.slice(segments.length)) if (s?.file) await fs.rm(`${dir}/${s.file}`, { force: true })
    await fs.writeFile(`${dir}/index.json`, JSON.stringify({ voice: idOf(VOICES.body), titleVoice: two ? idOf(VOICES.title) : undefined, model, segments }, null, 1))
  }
} finally {
  for (const id of added) await el(`/v1/voices/${id}`, { method: 'DELETE' }).catch(() => {})
  await fs.rm(tmp, { recursive: true, force: true })
}
