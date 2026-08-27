#!/usr/bin/env node
// One-off content pass: convert straight quotes/apostrophes to curly ones in
// every city's wordsPreamble. Dry-run by default; pass --apply to write +
// republish. Idempotent (already-curly text is left untouched).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')
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
const CDN = env.VITE_CONTENTFUL_TOKEN
const CMA = env.CONTENTFUL_MANAGEMENT_TOKEN
const L = 'en-US'

async function cdn(path){
  const r = await fetch(`https://cdn.contentful.com/spaces/${SPACE}/environments/master${path}`, { headers:{ Authorization:'Bearer '+CDN } })
  if (!r.ok) throw new Error(`CDN ${path} → ${r.status}`)
  return r.json()
}
async function cma(path, opts={}){
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: { 'Authorization':'Bearer '+CMA, 'Content-Type':'application/vnd.contentful.management.v1+json', ...(opts.headers||{}) },
  })
  const body = res.status === 204 ? null : await res.json().catch(()=>null)
  if (!res.ok) throw new Error(`CMA ${opts.method||'GET'} ${path} → ${res.status}: ${body?.message||JSON.stringify(body)}`)
  return body
}

// Curly-quote conversion. Order matters: doubles first, then singles.
function smarten(s){
  return s
    // opening double: start / whitespace / open-bracket before "
    .replace(/(^|[\s([{<])"/g, '$1“')
    // any remaining " is a closing double
    .replace(/"/g, '”')
    // apostrophe / closing single: preceded by a letter or digit
    .replace(/([A-Za-z0-9])'/g, '$1’')
    // opening single: start / whitespace / open-bracket before '
    .replace(/(^|[\s([{<])'/g, '$1‘')
    // any leftover ' (e.g. '90s) is an apostrophe
    .replace(/'/g, '’')
}

let all=[],skip=0
while(true){const pg=await cdn(`/entries?content_type=city&limit=100&skip=${skip}&select=fields.cityName,sys.id`); all=all.concat(pg.items); skip+=100; if(skip>=pg.total)break}

let changed=0
for (const c of all){
  const id = c.sys.id, name = c.fields.cityName
  const fresh = await cma('/entries/'+id)
  const cur = fresh.fields.wordsPreamble?.[L]
  if (!cur) continue
  const next = smarten(cur)
  if (next === cur) continue
  changed++
  console.log(`\n=== ${name} ===`)
  for (const line of next.split('\n')) if (/[‘’“”]/.test(line)) console.log('  '+line)
  if (APPLY){
    fresh.fields.wordsPreamble = { [L]: next }
    const put = await cma('/entries/'+id, { method:'PUT', headers:{ 'X-Contentful-Version': String(fresh.sys.version), 'X-Contentful-Content-Type':'city' }, body: JSON.stringify({ fields: fresh.fields }) })
    await cma('/entries/'+id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(put.sys.version) } })
    await new Promise(r=>setTimeout(r,90))
  }
}
console.log(`\n${APPLY ? 'Applied' : 'Dry run'} — ${changed} preambles ${APPLY ? 'updated + republished' : 'would change'}.`)
