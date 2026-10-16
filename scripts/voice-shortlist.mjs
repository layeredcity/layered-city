// Shortlist ElevenLabs voice-library voices for each city's Words audio.
//
// For every city, searches the shared voice library for native speakers of the
// city's language, ranks voices whose accent/description mentions the city or
// its region first, then the right national locale (pt-PT for Lisbon, not
// Brazilian), then by how widely the voice is used. Voices that charge extra
// credits (legacy custom rates) are skipped.
//
// Writes voices/shortlist.json: up to 6 candidates per city with preview URLs,
// for Ryan to choose one per city by ear. Choices go in voices/chosen.json.
//
// Run: ELEVENLABS_API_KEY=... node scripts/voice-shortlist.mjs
// Runs on GitHub via .github/workflows/voice-shortlist.yml (key is a repo secret).

import fs from 'node:fs/promises'
import path from 'node:path'

const KEY = process.env.ELEVENLABS_API_KEY
if (!KEY) { console.error('Set ELEVENLABS_API_KEY'); process.exit(1) }

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// ROUND=2 CITIES=London,Dublin re-shortlists only those cities, skips the
// voice already chosen, shows more options, and writes shortlist-round2.json.
const ROUND = Number(process.env.ROUND || 1)
const ONLY = (process.env.CITIES || '').split(',').map(s => s.trim()).filter(Boolean)
const COUNT = Number(process.env.COUNT || (ROUND > 1 ? 10 : 6))
const OUT = path.join(ROOT, 'voices', ROUND > 1 ? `shortlist-round${ROUND}.json` : 'shortlist.json')
const PREVIOUS = ROUND > 1 ? JSON.parse(await fs.readFile(path.join(ROOT, 'voices', 'chosen.json'), 'utf8')) : {}

// lang: ISO 639-1 for the library filter. locales: preferred locale(s), best
// first. local: words that mark a voice as being from this city or region.
export const CITY_VOICES = {
  Lisbon:     { lang: 'pt', locales: ['pt-PT'], local: ['lisbon', 'lisboa', 'european portuguese', 'portugal'] },
  Madrid:     { lang: 'es', locales: ['es-ES'], local: ['madrid', 'castilian', 'castellano', 'spain'] },
  Seville:    { lang: 'es', locales: ['es-ES'], local: ['seville', 'sevilla', 'andalusian', 'andaluz', 'andalucía', 'andalucia'] },
  Barcelona:  { lang: 'ca', locales: ['ca-ES'], local: ['barcelona', 'catalan', 'català', 'catalunya'] },
  Paris:      { lang: 'fr', locales: ['fr-FR'], local: ['paris', 'parisian', 'parisien', 'france'] },
  Marseille:  { lang: 'fr', locales: ['fr-FR'], local: ['marseille', 'provence', 'provençal', 'southern', 'sud', 'midi'] },
  Brussels:   { lang: 'fr', locales: ['fr-BE'], local: ['brussels', 'bruxelles', 'belgian', 'belge', 'belgium', 'belgique'] },
  Rome:       { lang: 'it', locales: ['it-IT'], local: ['rome', 'roma', 'roman', 'romano', 'romanesco', 'lazio'] },
  Florence:   { lang: 'it', locales: ['it-IT'], local: ['florence', 'firenze', 'florentine', 'tuscan', 'toscano', 'toscana'] },
  Naples:     { lang: 'it', locales: ['it-IT'], local: ['naples', 'napoli', 'neapolitan', 'napoletano', 'campania'] },
  Venice:     { lang: 'it', locales: ['it-IT'], local: ['venice', 'venezia', 'venetian', 'veneziano', 'veneto'] },
  Berlin:     { lang: 'de', locales: ['de-DE'], local: ['berlin', 'berliner'] },
  Munich:     { lang: 'de', locales: ['de-DE'], local: ['munich', 'münchen', 'bavarian', 'bayerisch', 'bayern', 'bavaria'] },
  Vienna:     { lang: 'de', locales: ['de-AT'], local: ['vienna', 'wien', 'viennese', 'wienerisch', 'austrian', 'österreich', 'austria'] },
  Zurich:     { lang: 'de', locales: ['de-CH'], local: ['zurich', 'zürich', 'swiss', 'schweiz', 'schweizer'] },
  Amsterdam:  { lang: 'nl', locales: ['nl-NL'], local: ['amsterdam', 'netherlands', 'nederland', 'holland'] },
  Copenhagen: { lang: 'da', locales: ['da-DK'], local: ['copenhagen', 'københavn', 'danish', 'denmark'] },
  Stockholm:  { lang: 'sv', locales: ['sv-SE'], local: ['stockholm', 'sweden', 'sverige'] },
  Oslo:       { lang: 'no', locales: ['nb-NO', 'no-NO'], local: ['oslo', 'østlandet', 'eastern norwegian', 'bokmål'] },
  Helsinki:   { lang: 'fi', locales: ['fi-FI'], local: ['helsinki', 'finland', 'suomi'] },
  Reykjavík:  { lang: 'is', locales: ['is-IS'], local: ['reykjavík', 'reykjavik', 'iceland', 'ísland'] },
  Athens:     { lang: 'el', locales: ['el-GR'], local: ['athens', 'athína', 'athenian', 'greece'] },
  Belgrade:   { lang: 'sr', locales: ['sr-RS'], local: ['belgrade', 'beograd', 'serbia', 'srbija'] },
  Prague:     { lang: 'cs', locales: ['cs-CZ'], local: ['prague', 'praha', 'czech', 'bohemian'] },
  Kraków:     { lang: 'pl', locales: ['pl-PL'], local: ['kraków', 'krakow', 'cracow', 'lesser poland', 'małopolska'] },
  Bucharest:  { lang: 'ro', locales: ['ro-RO'], local: ['bucharest', 'bucurești', 'bucuresti', 'romania'] },
  Budapest:   { lang: 'hu', locales: ['hu-HU'], local: ['budapest', 'hungary', 'magyar'] },
  Istanbul:   { lang: 'tr', locales: ['tr-TR'], local: ['istanbul', 'İstanbul', 'turkey', 'türkiye'] },
  London:     { lang: 'en', locales: ['en-GB'], local: ['london', 'londoner', 'south east', 'southern english', 'estuary'], avoid: ['cockney', 'posh', 'aristocrat', 'royal', 'rp ', 'received pronunciation'] },
  Manchester: { lang: 'en', locales: ['en-GB'], local: ['manchester', 'mancunian', 'northern', 'lancashire', 'yorkshire', 'north west', 'north of england'] },
  Edinburgh:  { lang: 'en', locales: ['en-GB'], local: ['edinburgh', 'scottish', 'scotland', 'scots'] },
  Dublin:     { lang: 'en', locales: ['en-IE'], local: ['dublin', 'dub', 'irish', 'ireland'] },
}

// Surface failures as GitHub check annotations (readable without log access).
const fail = e => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log(`::error::${String(e?.message || e).replace(/\n/g, ' ').slice(0, 900)}`); process.exit(1) }
process.on('unhandledRejection', fail); process.on('uncaughtException', fail)

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function api(p) {
  for (let i = 0; i < 4; i++) {
    const res = await fetch('https://api.elevenlabs.io' + p, { headers: { 'xi-api-key': KEY } })
    if (res.status === 429) { await sleep(2000 * (i + 1)); continue }
    if (!res.ok) throw new Error(`${res.status} ${p}: ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
  throw new Error('rate limited: ' + p)
}

// Pull up to `pages` pages of library voices for a language (and optional extra filters).
async function search(params, pages = 3) {
  const out = []
  for (let page = 0; page < pages; page++) {
    const q = new URLSearchParams({ page_size: '100', page: String(page), sort: 'usage_character_count_1y', ...params })
    const d = await api('/v1/shared-voices?' + q)
    out.push(...d.voices)
    if (!d.has_more) break
  }
  return out
}

const text = v => [v.name, v.accent, v.description, v.descriptive, ...(v.verified_languages || []).flatMap(l => [l.accent, l.locale])]
  .filter(Boolean).join(' ').toLowerCase()

const cfgCity = cfg => Object.keys(CITY_VOICES).find(k => CITY_VOICES[k] === cfg)
function score(v, cfg) {
  const t = text(v)
  const langs = v.verified_languages || []
  const native = langs.some(l => l.language === cfg.lang) || v.language === cfg.lang
  if (!native) return -1
  if ((v.rate || 1) > 1 || v.fiat_rate) return -1 // rate is a credit multiplier (1 = normal); legacy custom rates cost extra
  let s = 0
  // Accents that read as American, or styles the city doesn't want, sink.
  if (/american|\bus\b|en-us|transatlantic|mid-atlantic/.test(t)) s -= 80
  if ((cfg.avoid || []).some(k => t.includes(k))) s -= 60
  if (PREVIOUS[cfgCity(cfg)]?.voice_id === v.voice_id) return -1
  const hits = cfg.local.filter(k => t.includes(k.toLowerCase()))
  s += hits.length ? 100 + 10 * hits.length : 0
  // City name itself is the strongest signal.
  if (t.includes(cfg.local[0].toLowerCase())) s += 50
  const loc = langs.find(l => l.language === cfg.lang)?.locale || v.locale
  const li = cfg.locales.indexOf(loc)
  if (li >= 0) s += 40 - li * 5
  // Wrong national variant (e.g. Brazilian for Lisbon, Latin American for Madrid) is a real problem.
  if (loc && !cfg.locales.includes(loc) && cfg.locales[0].split('-')[0] === loc.split('-')[0]) s -= 60
  s += Math.min(30, Math.log10(1 + (v.usage_character_count_1y || 0)) * 4)
  if (v.use_case && /conversational|informative|educational|narrat/i.test(v.use_case)) s += 5
  return s
}

const result = { generated: new Date().toISOString(), cities: {} }
for (const [city, cfg] of Object.entries(CITY_VOICES).filter(([c]) => !ONLY.length || ONLY.includes(c))) {
  const seen = new Map()
  const add = vs => vs.forEach(v => { if (!seen.has(v.voice_id)) seen.set(v.voice_id, v) })
  add(await search({ language: cfg.lang }))
  // The API only accepts locales it knows (no ca-ES, for instance); skip ones it rejects.
  for (const loc of cfg.locales) {
    try { add(await search({ language: cfg.lang, locale: loc }, 1)) } catch (e) { if (!String(e.message).startsWith('400')) throw e }
  }
  for (const term of cfg.local.slice(0, ROUND > 1 ? 3 : 1)) add(await search({ search: term }, 1))
  const ranked = [...seen.values()]
    .map(v => ({ v, s: score(v, cfg) })).filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s).slice(0, COUNT)
    .map(({ v, s }) => {
      const vl = (v.verified_languages || []).find(l => l.language === cfg.lang) || {}
      return {
        voice_id: v.voice_id, public_owner_id: v.public_owner_id, name: v.name,
        gender: v.gender, age: v.age, accent: vl.accent || v.accent, locale: vl.locale || null,
        description: (v.description || '').slice(0, 300), use_case: v.use_case,
        preview_url: vl.preview_url || v.preview_url, uses_1y: v.usage_character_count_1y || 0,
        score: Math.round(s), local_match: score(v, cfg) >= 100,
      }
    })
  result.cities[city] = { lang: cfg.lang, candidates: ranked }
  console.log(`${city}: ${ranked.length} candidates, ${ranked.filter(r => r.local_match).length} with a local accent match`)
  await sleep(300)
}

// Keep a copy of each preview clip so the picker page can play them (the
// ElevenLabs storage host isn't reachable from every page that needs them).
for (const [city, c] of Object.entries(result.cities)) {
  for (const v of c.candidates) {
    if (!v.preview_url) continue
    const rel = `previews/${c.lang}-${v.voice_id}.mp3`
    const dest = path.join(ROOT, 'voices', rel)
    try { await fs.access(dest) } catch {
      const r = await fetch(v.preview_url)
      if (!r.ok) { console.warn(`preview ${r.status} for ${city} ${v.name}`); continue }
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()))
    }
    v.preview_file = rel
  }
}

await fs.mkdir(path.dirname(OUT), { recursive: true })
await fs.writeFile(OUT, JSON.stringify(result, null, 1) + '\n')
const weak = Object.entries(result.cities).filter(([, c]) => !c.candidates.some(x => x.local_match)).map(([k]) => k)
console.log(`\nNo local-accent match (falls back to native speakers of the language): ${weak.join(', ') || 'none'}`)
if (process.env.GITHUB_ACTIONS) console.log(`::notice::shortlist written; no local-accent match for: ${weak.join(', ') || 'none'}`)
