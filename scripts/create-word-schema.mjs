#!/usr/bin/env node
// One-time schema migration for the Words tier (see words-contentful-spec.md):
//   1. Create the `word` content type.
//   2. Add wordsPreamble / wordsVariant / wordsPublished to `city`.
// Idempotent: safe to re-run (updates in place by version).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function fail(m){ console.error('\n✖ '+m+'\n'); process.exit(1) }
function loadEnv(){
  const p = join(ROOT, '.env'); if (!existsSync(p)) fail('No .env')
  const env = {}
  for (const line of readFileSync(p,'utf8').split('\n')){
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'')
  }
  return env
}
const env = loadEnv()
const SPACE = env.VITE_CONTENTFUL_SPACE
const CMA = env.CONTENTFUL_MANAGEMENT_TOKEN
async function cma(path, opts={}){
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: { 'Authorization':'Bearer '+CMA, 'Content-Type':'application/vnd.contentful.management.v1+json', ...(opts.headers||{}) },
  })
  const body = res.status === 204 ? null : await res.json().catch(()=>null)
  if (!res.ok) throw new Error(`CMA ${opts.method||'GET'} ${path} → ${res.status}: ${body?.message||JSON.stringify(body)}`)
  return { body, res }
}

const SLOTS = [
  'greeting-morning','greeting-afternoon','greeting-evening','greeting-casual','leaving',
  'please','thanks','yes','no','speak-english','dont-speak','dont-understand',
  'sorry','excuse-attention','excuse-passing','number-one','number-two','number-three','number-four',
  'table-for','menu','id-like-this','enjoy-meal','cheers','delicious','check','money-surprise',
  'where-is','ticket','bathroom','door-men','door-women','atm','how-much','card','cash','bag','deep-cut',
]

// ---- 1. word content type ----
const wordFields = [
  { id:'title', name:'Title', type:'Symbol', required:true },
  { id:'city', name:'City', type:'Link', linkType:'Entry', required:true, validations:[{ linkContentType:['city'] }] },
  { id:'slot', name:'Slot', type:'Symbol', required:true, validations:[{ in: SLOTS }] },
  { id:'local', name:'Local word', type:'Symbol', required:true },
  // phonetic optional: english-language cities carry none (spec validator only requires it for non-english)
  { id:'phonetic', name:'Phonetic', type:'Symbol', required:false },
  { id:'meaning', name:'English meaning', type:'Symbol', required:false },
  { id:'context', name:'Context line', type:'Text', required:false, validations:[{ size:{ max:140 } }] },
  { id:'groupNote', name:'Group note', type:'Text', required:false, validations:[{ size:{ max:140 } }] },
  { id:'phoneticApproximate', name:'Phonetic is approximate', type:'Boolean', required:false, defaultValue:{ 'en-US': false } },
  // range 1–8: english variant runs deep cuts to 8 (spec §3)
  { id:'deepCutOrder', name:'Deep cut order', type:'Integer', required:false, validations:[{ range:{ min:1, max:8 } }] },
  { id:'audio', name:'Audio', type:'Link', linkType:'Asset', required:false, validations:[{ linkMimetypeGroup:['audio'] }] },
]

async function upsertContentType(id, name, displayField, fields){
  let version = null
  try { const { body } = await cma('/content_types/'+id); version = body.sys.version; console.log(`  (updating existing ${id}, v${version})`) }
  catch { console.log(`  (creating ${id})`) }
  const { body } = await cma('/content_types/'+id, {
    method:'PUT',
    headers: version != null ? { 'X-Contentful-Version': String(version) } : {},
    body: JSON.stringify({ name, displayField, fields }),
  })
  await cma('/content_types/'+id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(body.sys.version) } })
  console.log(`  ✓ ${id} content type saved + published`)
}

// ---- 2. city fields ----
async function addCityFields(){
  const { body: city } = await cma('/content_types/city')
  const ids = new Set(city.fields.map(f=>f.id))
  const additions = [
    { id:'wordsPreamble', name:'Words preamble', type:'Text', required:false, validations:[{ size:{ max:900 } }] },
    { id:'wordsVariant', name:'Words variant', type:'Symbol', required:false, validations:[{ in:['standard','english-language'] }], defaultValue:{ 'en-US':'standard' } },
    { id:'wordsPublished', name:'Words published', type:'Boolean', required:false, defaultValue:{ 'en-US': false } },
  ]
  let added = 0
  for (const f of additions) if (!ids.has(f.id)) { city.fields.push(f); added++ }
  if (!added) { console.log('  city already has the words fields — nothing to add'); return }
  const { body: updated } = await cma('/content_types/city', {
    method:'PUT',
    headers:{ 'X-Contentful-Version': String(city.sys.version) },
    body: JSON.stringify({ name: city.name, displayField: city.displayField, fields: city.fields }),
  })
  await cma('/content_types/city/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(updated.sys.version) } })
  console.log(`  ✓ added ${added} field(s) to city + published`)
}

console.log('Creating `word` content type…')
await upsertContentType('word', 'Word', 'title', wordFields)
console.log('Adding words fields to `city`…')
await addCityFields()
console.log('\nDone.')
