// Second round of thread narrator auditions: American voices only, six women
// and six men, all on ElevenLabs v3. The two current voices (the narrator and
// the title voice) are read too, for comparison. Writes the clips to
// voices/narrator-auditions-us/ with a list in voices/narrator-auditions-us.json.
// Library voices are added to the account for the reading and removed again.
// Runs in .github/workflows/narrator-auditions-us.yml.
import fs from 'node:fs/promises'

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) { console.log('::warning::ELEVENLABS_API_KEY secret is not set; nothing made'); process.exit(0) }
const fail = e => { console.log(`::error::${String(e?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1) }
process.on('unhandledRejection', fail); process.on('uncaughtException', fail)

const TEXT = 'He dreamed of a “studio of the south” where artists would live and work together, and he talked Gauguin into joining him. The two men painted side by side for nine weeks, but they argued constantly. On the night of December 23, 1888, after a bad quarrel, Van Gogh cut off part of his left ear with a razor.'
const CFG = JSON.parse(await fs.readFile('data/thread-audio.json', 'utf8'))
const CURRENT = CFG.voice, TITLE = CFG.titleVoice?.voice_id, TITLE_OWNER = CFG.titleVoice?.owner
const FLAT = { stability: 0.5, similarity_boost: 0.75, style: 0.15 }       // what the threads use now
const EXPRESSIVE = { stability: 0.35, similarity_boost: 0.75, style: 0.4 }
const MODELS = ['eleven_multilingual_v2', 'eleven_v3']
const DIR = 'voices/narrator-auditions-us'

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function el(p, init = {}) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch('https://api.elevenlabs.io' + p, { ...init, headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } })
    if (res.status === 429) { await sleep(3000 * (i + 1)); continue }
    return res
  }
  throw new Error('rate limited: ' + p)
}
async function library(params) {
  const out = []
  for (let page = 0; page < 3; page++) {
    const q = new URLSearchParams({ page_size: '100', page: String(page), sort: 'usage_character_count_1y', language: 'en', ...params })
    const r = await el('/v1/shared-voices?' + q)
    if (!r.ok) { console.log(`::warning::library search ${JSON.stringify(params)}: ${r.status}`); break }
    const d = await r.json(); out.push(...d.voices); if (!d.has_more) break
  }
  return out
}

// Candidates: widely used narration voices, no extra-credit rates, adults.
const seen = new Map()
for (const params of [{ locale: 'en-US' }, { locale: 'en-US', search: 'narrator' }, { locale: 'en-US', search: 'storyteller' }, { search: 'narrator' }, { search: 'documentary' }, { search: 'storyteller' }, { search: 'audiobook' }]) {
  for (const v of await library(params)) if (!seen.has(v.voice_id)) seen.set(v.voice_id, v)
}
const blob = v => [v.name, v.description, v.descriptive, v.use_case, v.category].filter(Boolean).join(' ').toLowerCase()
const accentOf = v => {
  const t = [v.accent, ...(v.verified_languages || []).filter(l => l.language === 'en').flatMap(l => [l.accent, l.locale])].filter(Boolean).join(' ').toLowerCase()
  return /british|en-gb|english|scottish|irish|welsh/.test(t) && !/american|en-us/.test(t) ? 'British' : /american|en-us/.test(t) ? 'American' : null
}
const pool = [...seen.values()]
  .filter(v => v.voice_id !== CURRENT && v.voice_id !== TITLE && !((v.rate || 1) > 1) && !v.fiat_rate)
  .filter(v => /narrat|documentar|storytell|audiobook|informative|educational/.test(blob(v)))
  .filter(v => !/child|kid|cartoon|villain|whisper|asmr|meditat|horror|creepy|santa|pirate|robot|tiktok|social media|celebrity|hype|energetic|announcer|trailer/.test(blob(v)))
  .map(v => ({ v, accent: accentOf(v) })).filter(x => x.accent && /^(male|female)$/.test(x.v.gender || ''))
  .sort((a, b) => (b.v.usage_character_count_1y || 0) - (a.v.usage_character_count_1y || 0))
const take = (accent, gender, n) => pool.filter(x => x.accent === accent && x.v.gender === gender).slice(0, n)
const picks = [...take('American', 'female', 6), ...take('American', 'male', 6)]
console.log(`::notice::${pool.length} narration voices found; auditioning ${picks.length}`)

const mine = (await (await el('/v1/voices')).json()).voices || []
const mineIds = new Set(mine.map(v => v.voice_id))


await fs.rm(DIR, { recursive: true, force: true }); await fs.mkdir(DIR, { recursive: true })
const out = { generated: new Date().toISOString(), text: TEXT, current: CURRENT, voices: [] }

async function read(voiceId, model, settings) {
  const body = { text: TEXT.replace(/(\d)\s*–\s*(\d)/g, '$1 to $2'), model_id: model }
  if (model !== 'eleven_v3') body.voice_settings = settings
  else body.voice_settings = { stability: 0.5 }
  const r = await el(`/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_64`, { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 200)}` }
  const d = await r.json()
  return { audio: Buffer.from(d.audio_base64, 'base64'), timed: Array.isArray(d.alignment?.character_start_times_seconds) }
}
async function audition(entry, voiceId, variants) {
  entry.clips = []
  for (const [label, model, settings] of variants) {
    const res = await read(voiceId, model, settings)
    if (res.error) { console.log(`::notice::${entry.name} / ${label}: skipped (${res.error})`); continue }
    const file = `${entry.voice_id}-${label}.mp3`
    await fs.writeFile(`${DIR}/${file}`, res.audio)
    entry.clips.push({ label, model, settings: model === 'eleven_v3' ? null : settings, timed: res.timed, file })
  }
  if (entry.clips.length) out.voices.push(entry)
}

for (const [id, role] of [[CURRENT, 'Current narrator'], [TITLE, 'Current title voice']]) {
  let c = mine.find(v => v.voice_id === id), useId = id, added = false
  if (!c && id === TITLE && TITLE_OWNER) {
    const r = await el(`/v1/voices/add/${TITLE_OWNER}/${id}`, { method: 'POST', body: JSON.stringify({ new_name: 'LC audition – ' + (CFG.titleVoice.name || 'title voice') }) })
    if (r.ok) { useId = (await r.json()).voice_id || id; added = true; c = { name: CFG.titleVoice.name, labels: { gender: 'male', accent: 'american' } } }
  }
  if (!c) { console.log(`::notice::${role}: not found in the account; skipped`); continue }
  try {
    await audition({ voice_id: id, name: c.name.replace(/^LC.*?– /, ''), current: role, gender: c.labels?.gender, accent: c.labels?.accent, description: c.labels?.description || c.description || '' }, useId, [['v3', MODELS[1], null]])
  } finally { if (added) await el(`/v1/voices/${useId}`, { method: 'DELETE' }).catch(() => {}) }
}

for (const { v, accent } of picks) {
  let id = v.voice_id, added = false
  if (!mineIds.has(id)) {
    const r = await el(`/v1/voices/add/${v.public_owner_id}/${v.voice_id}`, { method: 'POST', body: JSON.stringify({ new_name: `LC audition – ${v.name}`.slice(0, 100) }) })
    if (!r.ok) { console.log(`::notice::${v.name}: could not add (${r.status} ${(await r.text()).slice(0, 150)})`); continue }
    id = (await r.json()).voice_id || id; added = true
  }
  try {
    await audition({ voice_id: v.voice_id, owner: v.public_owner_id, name: v.name, gender: v.gender, age: v.age, accent, description: (v.description || '').slice(0, 240), uses_1y: v.usage_character_count_1y || 0 },
      id, [['v3', MODELS[1], null]])
  } finally {
    if (added) await el(`/v1/voices/${id}`, { method: 'DELETE' }).catch(() => {})
  }
}
await fs.writeFile('voices/narrator-auditions-us.json', JSON.stringify(out, null, 1) + '\n')
console.log(`::notice::${out.voices.length} voices, ${out.voices.reduce((n, v) => n + v.clips.length, 0)} clips`)
