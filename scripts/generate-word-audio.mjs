// Generate Words audio with ElevenLabs, one chosen voice per city
// (voices/chosen.json, picked with the voice picker), and store the MP3s in
// this repo so visitors never trigger an ElevenLabs call.
//
//   CITIES="Paris" node scripts/generate-word-audio.mjs     # one or more cities
//   CITIES=all node scripts/generate-word-audio.mjs          # everything
//
// Each clip is the phrase at normal speed, a one-second pause, then the same
// phrase read slowly (a second, slower generation, not a time-stretch), joined
// with ffmpeg.
//
// Writes public/words-audio/<city>/<wordId>-<hash>.mp3 and
// src/data/word-audio.json ({ wordId: 'city/hash' }). The hash covers voice, model and
// text, so re-running only generates phrases that are new or changed.
//
// Starter plans hold 10 voices at a time, so each library voice is added for
// its city and removed afterwards — but only if this script added it. Voices
// already in the account are left alone.
//
// Runs on GitHub via .github/workflows/word-audio.yml (needs ELEVENLABS_API_KEY).

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { slugify } from '../src/utils/slugify.js'
import { execFile } from 'node:child_process'
import os from 'node:os'
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, cmd === 'ffmpeg' ? ['-nostdin', ...args] : args, { timeout: 60000 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)))

const KEY = process.env.ELEVENLABS_API_KEY
const CDA_TOKEN = process.env.CONTENTFUL_DELIVERY_TOKEN
const SPACE = process.env.CONTENTFUL_SPACE || 'yl6xhrcd616q'
const MODELS = (process.env.MODELS || 'eleven_v3').split(',')
const ONLY = (process.env.CITIES || '').split(',').map(s => s.trim()).filter(Boolean)
if (!KEY || !CDA_TOKEN || !ONLY.length) { console.error('Need ELEVENLABS_API_KEY, CONTENTFUL_DELIVERY_TOKEN and CITIES'); process.exit(1) }

const fail = e => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log(`::error::${String(e?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1) }
process.on('unhandledRejection', fail); process.on('uncaughtException', fail)

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const MAP = path.join(ROOT, 'src', 'data', 'word-audio.json')
const chosen = JSON.parse(await fs.readFile(path.join(ROOT, 'voices', 'chosen.json'), 'utf8'))
const LANG = {
  Lisbon: 'pt', Madrid: 'es', Seville: 'es', Barcelona: 'ca', Paris: 'fr', Marseille: 'fr', Brussels: 'fr',
  Rome: 'it', Florence: 'it', Naples: 'it', Venice: 'it', Berlin: 'de', Munich: 'de', Vienna: 'de', Zurich: 'de',
  Amsterdam: 'nl', Copenhagen: 'da', Stockholm: 'sv', Oslo: 'no', Helsinki: 'fi', 'Reykjavík': 'is',
  Athens: 'el', Belgrade: 'sr', Prague: 'cs', 'Kraków': 'pl', Bucharest: 'ro', Budapest: 'hu', Istanbul: 'tr',
  London: 'en', Manchester: 'en', Edinburgh: 'en', Dublin: 'en',
}

const SLOW = Number(process.env.SLOW_SPEED || 0.75)
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'wordaudio-'))

async function tts(voiceId, text, lang, speed) {
  let lastErr = ''
  for (const m of MODELS) {
    const body = { text, model_id: m, language_code: lang, seed: 7 }
    if (speed !== 1) body.voice_settings = { speed }
    const r = await el(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, { method: 'POST', body: JSON.stringify(body) })
    if (r.ok) return Buffer.from(await r.arrayBuffer())
    lastErr = `${r.status} ${(await r.text()).slice(0, 200)}`
  }
  throw new Error(`"${text}" at speed ${speed}: ${lastErr}`)
}
let n = 0
const tmp = (buf, ext = 'mp3') => { const f = path.join(TMP, `${n++}.${ext}`); return fs.writeFile(f, buf).then(() => f) }
async function stretch(buf, speed) {
  const a = await tmp(buf), out = path.join(TMP, `${n++}.mp3`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-filter:a', `atempo=${speed}`, '-b:a', '64k', out])
  return fs.readFile(out)
}
const dur = async f => Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))
// Trim the silence each take comes with, so the pause between them is exactly PAUSE seconds.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse'
async function trimmed(buf, extra = '') {
  const a = await tmp(buf), out = path.join(TMP, `${n++}.wav`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-af', `aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,${TRIM}${extra}`, out])
  return out
}
const PAUSE = Number(process.env.PAUSE_SECONDS || 1)
async function joinWithPause(a, b) {
  const fa = await trimmed(a)
  let fb = await trimmed(b)
  // The model may not honour the speed setting. If the slow take isn't clearly
  // slower, stretch it (pitch preserved) to SLOW of the normal pace.
  const want = (await dur(fa)) / SLOW, got = await dur(fb)
  if (got < want * 0.92) {
    const tempo = Math.min(2, Math.max(0.5, got / want))
    const out = path.join(TMP, `${n++}.wav`)
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', fb, '-af', `atempo=${tempo.toFixed(3)}`, out])
    fb = out
  }
  const out = path.join(TMP, `${n++}.mp3`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', fa, '-f', 'lavfi', '-t', String(PAUSE), '-i', 'anullsrc=r=44100:cl=mono', '-i', fb,
    '-filter_complex', '[0:a][1:a][2:a]concat=n=3:v=0:a=1', '-ac', '1', '-b:a', '64k', out])
  return fs.readFile(out)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function el(p, opts = {}) {
  for (let i = 0; i < 5; i++) {
    let res
    try { res = await fetch('https://api.elevenlabs.io' + p, { ...opts, signal: AbortSignal.timeout(90000), headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } }) }
    catch (e) { if (i === 4) throw e; await sleep(3000); continue } // stalled or dropped request
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (i + 1)); continue }
    return res
  }
  throw new Error('ElevenLabs kept failing: ' + p)
}
async function cda(q) {
  const out = []; const includes = []
  for (let skip = 0; ; ) {
    const r = await fetch(`https://cdn.contentful.com/spaces/${SPACE}/environments/master/entries?${q}&limit=1000&skip=${skip}`, { headers: { Authorization: 'Bearer ' + CDA_TOKEN } })
    if (!r.ok) throw new Error('Contentful ' + r.status)
    const d = await r.json(); out.push(...d.items); includes.push(...(d.includes?.Entry || []))
    skip += d.items.length; if (skip >= d.total || !d.items.length) break
  }
  return { items: out, includes }
}

const cities = Object.fromEntries((await cda('content_type=city&select=sys.id,fields.cityName')).items.map(c => [c.sys.id, c.fields.cityName]))
const words = (await cda('content_type=word&select=sys.id,fields.local,fields.slot,fields.city')).items
  .map(w => ({ id: w.sys.id, text: (w.fields.local || '').trim(), city: cities[w.fields.city?.sys?.id] }))
  .filter(w => w.text && w.city)
const targets = ONLY[0] === 'all' ? Object.keys(chosen) : ONLY
const map = JSON.parse(await fs.readFile(MAP, 'utf8').catch(() => '{}'))
const myVoices = new Set((await (await el('/v1/voices')).json()).voices?.map(v => v.voice_id) || [])

let made = 0, kept = 0, chars = 0
for (const city of targets) {
  const pick = chosen[city]; if (!pick) { console.warn('No voice chosen for ' + city); continue }
  const list = words.filter(w => w.city === city)
  const cs = slugify(city)
  const dir = path.join(ROOT, 'public', 'words-audio', cs)
  await fs.mkdir(dir, { recursive: true })

  // Make the library voice usable from this account for the duration of the city.
  let voiceId = pick.voice_id, added = false
  if (!myVoices.has(voiceId)) {
    const r = await el(`/v1/voices/add/${pick.owner}/${pick.voice_id}`, { method: 'POST', body: JSON.stringify({ new_name: `LC ${city} – ${pick.name}`.slice(0, 100) }) })
    if (!r.ok) throw new Error(`Could not add ${pick.name} for ${city}: ${r.status} ${(await r.text()).slice(0, 300)}`)
    voiceId = (await r.json()).voice_id || voiceId; added = true
  }
  try {
    for (const w of list) {
      const model = MODELS[0]
      const hash = crypto.createHash('sha1').update([voiceId, model, w.text, 'normal+pause+slow:v2', SLOW, process.env.PAUSE_SECONDS || 1].join('|')).digest('hex').slice(0, 8)
      if (map[w.id] === `${cs}/${hash}`) { kept++; continue }
      const normal = await tts(voiceId, w.text, LANG[city], 1.0)
      let slow
      try { slow = await tts(voiceId, w.text, LANG[city], SLOW) }
      catch { slow = await stretch(normal, SLOW) } // model without a speed setting: slow the normal take instead
      const audio = await joinWithPause(normal, slow)
      if (map[w.id]) await fs.rm(path.join(ROOT, 'public', 'words-audio', `${map[w.id].split('/')[0]}`, `${w.id}-${map[w.id].split('/')[1]}.mp3`), { force: true })
      await fs.writeFile(path.join(dir, `${w.id}-${hash}.mp3`), audio)
      map[w.id] = `${cs}/${hash}`; made++; chars += 2 * w.text.length
    }
  } finally {
    if (added) await el(`/v1/voices/${voiceId}`, { method: 'DELETE' }).catch(() => {})
  }
  console.log(`${city}: ${list.length} phrases`)
}

const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]))
await fs.writeFile(MAP, JSON.stringify(sorted) + '\n')
const msg = `word audio: ${made} generated (~${chars} characters), ${kept} unchanged`
console.log(msg); if (process.env.GITHUB_ACTIONS) console.log('::notice::' + msg)
