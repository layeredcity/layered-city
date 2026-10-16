// Generate Words audio with ElevenLabs, one chosen voice per city
// (voices/chosen.json, picked with the voice picker), and store the MP3s in
// this repo so visitors never trigger an ElevenLabs call.
//
//   CITIES="Paris" node scripts/generate-word-audio.mjs     # one or more cities
//   CITIES=all node scripts/generate-word-audio.mjs          # everything
//
// Each clip is one take, trimmed of surrounding silence and played at SPEED
// (default 0.9: a little slower than normal; pitch is preserved). The voice
// model ignores its own speed setting, so the slowing is done
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
const KINDS = (process.env.KINDS || 'words').split(',').map(s => s.trim())
const ONLY = (process.env.CITIES || '').split(',').map(s => s.trim()).filter(Boolean)
if (!KEY || !CDA_TOKEN || !ONLY.length) { console.error('Need ELEVENLABS_API_KEY, CONTENTFUL_DELIVERY_TOKEN and CITIES'); process.exit(1) }

const fail = e => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log(`::error::${String(e?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1) }
process.on('unhandledRejection', fail); process.on('uncaughtException', fail)

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// Two kinds of clip share the voices and the processing: Words phrases and
// the local names of dishes (Food). Each keeps its own folder and map.
const KIND = {
  words: { dir: 'words-audio', map: path.join(ROOT, 'src', 'data', 'word-audio.json') },
  food: { dir: 'food-audio', map: path.join(ROOT, 'src', 'data', 'food-audio.json') },
}
const chosen = JSON.parse(await fs.readFile(path.join(ROOT, 'voices', 'chosen.json'), 'utf8'))
const LANG = {
  Lisbon: 'pt', Madrid: 'es', Seville: 'es', Barcelona: 'ca', Paris: 'fr', Marseille: 'fr', Brussels: 'fr',
  Rome: 'it', Florence: 'it', Naples: 'it', Venice: 'it', Berlin: 'de', Munich: 'de', Vienna: 'de', Zurich: 'de',
  Amsterdam: 'nl', Copenhagen: 'da', Stockholm: 'sv', Oslo: 'no', Helsinki: 'fi', 'Reykjavík': 'is',
  Athens: 'el', Belgrade: 'sr', Prague: 'cs', 'Kraków': 'pl', Bucharest: 'ro', Budapest: 'hu', Istanbul: 'tr',
  London: 'en', Manchester: 'en', Edinburgh: 'en', Dublin: 'en',
}

const SPEED = Number(process.env.SPEED || 0.9)
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'wordaudio-'))

async function tts(voiceId, text, lang, speed, seed = 7) {
  let lastErr = ''
  for (const m of MODELS) {
    // Very short inputs ("Oui", "Non") come back truncated without an ending;
    // a full stop gives the model a complete utterance. Only sent, never shown.
    const spoken = /[.!?…;:]$/.test(text) ? text : text + '.'
    const body = { text: spoken, model_id: m, language_code: lang, seed }
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
// Trim the silence each take comes with.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0.1,areverse'
async function trimmed(buf, extra = '') {
  const a = await tmp(buf), out = path.join(TMP, `${n++}.wav`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', a, '-af', `aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono,${TRIM}${extra}`, out])
  return out
}
// A take sometimes ends with a breath or click after a long gap, which the
// silence trim can't reach. Cut a short sound (< 0.3s) that follows a gap of
// at least 0.35s at the end of the clip.
async function dropTailBlip(f) {
  const log = await new Promise(res => execFile('ffmpeg', ['-nostdin', '-i', f, '-af', 'silencedetect=n=-40dB:d=0.35', '-f', 'null', '-'], (e, so, se) => res(se || '')))
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1])
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1])
  if (!starts.length || !ends.length) return f
  const total = await dur(f), lastStart = starts.at(-1), lastEnd = ends.at(-1)
  if (lastEnd < total && total - lastEnd < 0.3 && lastStart > 0.2) {
    const out = path.join(TMP, `${n++}.wav`)
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-af', `atrim=0:${(lastStart + 0.1).toFixed(3)}`, out])
    return out
  }
  return f
}
// Loudness of the last 80 ms of speech (before our fade). A word that ends
// naturally has trailed off by then; one the model cut short is still loud.
async function endLevel(f) {
  const d = await dur(f)
  const log = await new Promise(res => execFile('ffmpeg', ['-nostdin', '-ss', Math.max(0, d - 0.08).toFixed(3), '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], (e, so, se) => res(se || '')))
  const m = log.match(/mean_volume: (-?[\d.]+) dB/)
  return m ? Number(m[1]) : -99
}
// Even out loudness between voices (one speaker came out ~10 dB quieter):
// bring the speech to TARGET_DB mean, never letting peaks pass -1 dB.
const TARGET_DB = Number(process.env.TARGET_DB || -17)
async function levelGain(f) {
  const log = await new Promise(res => execFile('ffmpeg', ['-nostdin', '-i', f, '-af', 'volumedetect', '-f', 'null', '-'], (e, so, se) => res(se || '')))
  const mean = Number(log.match(/mean_volume: (-?[\d.]+) dB/)?.[1]), max = Number(log.match(/max_volume: (-?[\d.]+) dB/)?.[1])
  if (!Number.isFinite(mean) || !Number.isFinite(max)) return 0
  return Math.min(TARGET_DB - mean, -1 - max)
}
async function slowedClip(buf) {
  const t = await trimmed(buf, SPEED === 1 ? '' : `,atempo=${SPEED}`)
  const len = await dur(t).catch(() => NaN)
  if (!(len > 0.08)) return { audio: null, endDb: Infinity } // the take was silent: no usable audio
  const f = await dropTailBlip(t)
  const endDb = await endLevel(f)
  const gain = await levelGain(f)
  // Short lead-in and a fade into a little silence, so playback never starts
  // or stops mid-sound (browsers can swallow the first few milliseconds).
  const d = await dur(f), out = path.join(TMP, `${n++}.mp3`)
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-af',
    `volume=${gain.toFixed(2)}dB,afade=t=out:st=${Math.max(0, d - 0.04).toFixed(3)}:d=0.04,adelay=60,apad=pad_dur=0.25`, '-ac', '1', '-b:a', '64k', out])
  return { audio: await fs.readFile(out), endDb }
}

// Clips whose ending is still louder than this after retries are listed in
// voices/audio-check.json for a listen.
const END_OK = Number(process.env.END_OK_DB || -26)
const SEEDS = [7, 101, 2027]
async function bestTake(voiceId, text, lang, round = 0) {
  let best = null, tries = 0
  for (const base of SEEDS) {
    const seed = base + round * 1000 // a redo round asks for genuinely different takes
    tries++
    let take
    try { take = await slowedClip(await tts(voiceId, text, lang, 1.0, seed)) }
    catch (e) { console.warn(`take failed for "${text}": ${e.message.slice(0, 200)}`); take = { audio: null, endDb: Infinity } }
    if (!best || take.endDb < best.endDb) best = take
    if (take.endDb <= END_OK) break
  }
  return { ...best, tries }
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
  .map(w => ({ kind: 'words', id: w.sys.id, text: (w.fields.local || '').trim(), city: cities[w.fields.city?.sys?.id] }))
  .filter(w => w.text && w.city)
const foods = (await cda('content_type=food&select=sys.id,fields.foodName,fields.relatedCity')).items
  .map(f => ({ kind: 'food', id: f.sys.id, text: (f.fields.foodName || '').trim(), city: cities[f.fields.relatedCity?.sys?.id] }))
  .filter(f => f.text && f.city)
const items = [...(KINDS.includes('words') ? words : []), ...(KINDS.includes('food') ? foods : [])]
// voices/redo.json: clips Ryan heard as off, [{ city, kind, text, round }].
// Each listed clip is regenerated with a new set of takes (bump `round` to try again).
const redo = JSON.parse(await fs.readFile(path.join(ROOT, 'voices', 'redo.json'), 'utf8').catch(() => '[]'))
const redoRound = (w) => redo.find(r => r.city === w.city && (r.kind || 'words') === w.kind && r.text === w.text)?.round || 0
const targets = ONLY[0] === 'all' ? Object.keys(chosen) : ONLY
const maps = {}
for (const k of Object.keys(KIND)) maps[k] = JSON.parse(await fs.readFile(KIND[k].map, 'utf8').catch(() => '{}'))
const myVoices = new Set((await (await el('/v1/voices')).json()).voices?.map(v => v.voice_id) || [])

let made = 0, kept = 0, chars = 0, retries = 0, adopted = 0
const flagged = []
const CHECK = path.join(ROOT, 'voices', 'audio-check.json')
async function saveProgress() {
  for (const k of KINDS) await fs.writeFile(KIND[k].map, JSON.stringify(Object.fromEntries(Object.keys(maps[k]).sort().map(id => [id, maps[k][id]]))) + '\n')
  await fs.writeFile(CHECK, JSON.stringify(check, null, 1) + '\n')
}
const check = JSON.parse(await fs.readFile(CHECK, 'utf8').catch(() => '{}'))
for (const city of targets) {
  const pick = chosen[city]; if (!pick) { console.warn('No voice chosen for ' + city); continue }
  const list = items.filter(w => w.city === city)
  const cs = slugify(city)

  // Make the library voice usable from this account for the duration of the city.
  let voiceId = pick.voice_id, added = false
  if (!myVoices.has(voiceId)) {
    const r = await el(`/v1/voices/add/${pick.owner}/${pick.voice_id}`, { method: 'POST', body: JSON.stringify({ new_name: `LC ${city} – ${pick.name}`.slice(0, 100) }) })
    if (!r.ok) throw new Error(`Could not add ${pick.name} for ${city}: ${r.status} ${(await r.text()).slice(0, 300)}`)
    voiceId = (await r.json()).voice_id || voiceId; added = true
  }
  const generatedNow = new Set()
  try {
    for (const w of list) {
      const map = maps[w.kind]
      const dir = path.join(ROOT, 'public', KIND[w.kind].dir, cs)
      await fs.mkdir(dir, { recursive: true })
      const model = MODELS[0]
      const hash = crypto.createHash('sha1').update([voiceId, model, w.text, 'single:v7', SPEED, ...(redoRound(w) ? ['redo' + redoRound(w)] : [])].join('|')).digest('hex').slice(0, 8)
      if (map[w.id] === `${cs}/${hash}`) { kept++; continue }
      // A file with this exact hash is already on disk (an earlier run that
      // stopped before saving its map): adopt it rather than pay for it again.
      const existing = path.join(dir, `${w.id}-${hash}.mp3`)
      if (await fs.access(existing).then(() => true, () => false)) { map[w.id] = `${cs}/${hash}`; adopted++; continue }
      const { audio, endDb, tries } = await bestTake(voiceId, w.text, LANG[city], redoRound(w))
      retries += tries - 1
      if (!audio) { flagged.push({ city, kind: w.kind, id: w.id, text: w.text, endDb: null, problem: 'no usable audio after 3 tries' }); continue }
      if (endDb > END_OK) flagged.push({ city, kind: w.kind, id: w.id, text: w.text, endDb: Math.round(endDb * 10) / 10 })
      if (map[w.id]) await fs.rm(path.join(ROOT, 'public', KIND[w.kind].dir, `${map[w.id].split('/')[0]}`, `${w.id}-${map[w.id].split('/')[1]}.mp3`), { force: true })
      await fs.writeFile(path.join(dir, `${w.id}-${hash}.mp3`), audio)
      map[w.id] = `${cs}/${hash}`; generatedNow.add(w.id); made++; chars += w.text.length
    }
  } finally {
    if (added) await el(`/v1/voices/${voiceId}`, { method: 'DELETE' }).catch(() => {})
  }
  // This city's listen-to list: earlier flags for phrases not regenerated
  // now, plus this run's flags.
  check[city] = [...(check[city] || []).filter(x => !generatedNow.has(x.id)),
    ...flagged.filter(f => f.city === city).map(({ city: _c, ...rest }) => rest)]
  if (!check[city].length) delete check[city]
  await saveProgress() // so a later failure never loses finished cities
  console.log(`${city}: ${list.length} phrases`)
}

await saveProgress()
const msg = `word audio: ${made} generated (~${chars} characters, ${retries} retakes), ${adopted} reused from an earlier run, ${kept} unchanged; ${flagged.length} may sound cut off: ${flagged.map(f => `${f.city} "${f.text}"`).join(', ').slice(0, 600)}`
console.log(msg); if (process.env.GITHUB_ACTIONS) console.log('::notice::' + msg)
