#!/usr/bin/env node
// Generate one public Spotify playlist per city from the song URLs stored in
// Contentful, then write the playlist URL back onto each city entry.
//
// Run:  npm run playlists
//
// One-time setup (see scripts/README.md for details):
//   .env must contain:
//     VITE_CONTENTFUL_SPACE         (already present)
//     VITE_CONTENTFUL_TOKEN         (already present — read-only CDN token)
//     CONTENTFUL_MANAGEMENT_TOKEN   (new — Contentful CMA personal access token)
//     SPOTIFY_CLIENT_ID             (new — from your Spotify developer app)
//     SPOTIFY_CLIENT_SECRET         (new — from your Spotify developer app)
//
// The script is idempotent: re-running updates the same playlists (it reuses the
// playlist already linked on each city entry and replaces its tracks).

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN_CACHE = join(ROOT, '.spotify-token.json')
const REDIRECT_URI = 'http://127.0.0.1:8888/callback'
const SCOPES = 'playlist-modify-public playlist-modify-private'

// ---------- tiny .env loader ----------
function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) fail('No .env file found at project root.')
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

function fail(msg) {
  console.error('\n✖ ' + msg + '\n')
  process.exit(1)
}

const env = loadEnv()
for (const k of ['VITE_CONTENTFUL_SPACE', 'VITE_CONTENTFUL_TOKEN', 'CONTENTFUL_MANAGEMENT_TOKEN', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET']) {
  if (!env[k]) fail(`Missing ${k} in .env — see scripts/README.md for setup.`)
}

const SPACE = env.VITE_CONTENTFUL_SPACE
const CDN_TOKEN = env.VITE_CONTENTFUL_TOKEN
const CMA_TOKEN = env.CONTENTFUL_MANAGEMENT_TOKEN
const SPOTIFY_ID = env.SPOTIFY_CLIENT_ID
const SPOTIFY_SECRET = env.SPOTIFY_CLIENT_SECRET
const PLAYLIST_FIELD = 'musicPlaylistSpotify'

// ============================================================
// Spotify auth (Authorization Code flow, cached refresh token)
// ============================================================
async function spotifyToken() {
  if (existsSync(TOKEN_CACHE)) {
    const cached = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'))
    if (cached.refresh_token) {
      const tok = await refreshSpotify(cached.refresh_token)
      if (tok) return tok
      console.log('Cached Spotify token could not be refreshed — re-authorizing.')
    }
  }
  return authorizeSpotify()
}

async function refreshSpotify(refreshToken) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) return null
  const data = await res.json()
  // Spotify may or may not return a new refresh token; keep the old one if not.
  const refresh = data.refresh_token || refreshToken
  writeFileSync(TOKEN_CACHE, JSON.stringify({ refresh_token: refresh }, null, 2))
  return data.access_token
}

function authorizeSpotify() {
  return new Promise((resolve) => {
    const state = Math.random().toString(36).slice(2)
    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      response_type: 'code',
      client_id: SPOTIFY_ID,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
      state,
    })

    const server = createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI)
      if (!url.pathname.startsWith('/callback')) { res.writeHead(404); res.end(); return }
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body style="font-family:sans-serif;padding:40px"><h2>Layered City</h2><p>Spotify connected. You can close this tab and return to the terminal.</p></body></html>')
      server.close()
      if (err || !code) fail('Spotify authorization was denied or failed: ' + (err || 'no code'))

      const tokRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_ID}:${SPOTIFY_SECRET}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
      })
      if (!tokRes.ok) fail('Spotify token exchange failed: ' + (await tokRes.text()))
      const data = await tokRes.json()
      writeFileSync(TOKEN_CACHE, JSON.stringify({ refresh_token: data.refresh_token }, null, 2))
      resolve(data.access_token)
    })

    server.listen(8888, '127.0.0.1', () => {
      console.log('\nOpening your browser to authorize Spotify…')
      console.log('If it does not open, visit this URL manually:\n' + authUrl + '\n')
      // macOS 'open'; harmless if it fails — the URL is printed above.
      spawn('open', [authUrl], { stdio: 'ignore' }).on('error', () => {})
    })
  })
}

let ACCESS_TOKEN = null
async function spotify(path, opts = {}) {
  const res = await fetch('https://api.spotify.com/v1' + path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + ACCESS_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = body?.error?.message || JSON.stringify(body)
    throw new Error(`Spotify ${opts.method || 'GET'} ${path} → ${res.status}: ${msg}`)
  }
  return body
}

// ============================================================
// Contentful
// ============================================================
async function cdn(path) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`https://cdn.contentful.com/spaces/${SPACE}/environments/master${path}${sep}access_token=${CDN_TOKEN}`)
  if (!res.ok) fail(`Contentful CDN ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function cma(path, opts = {}) {
  const res = await fetch(`https://api.contentful.com/spaces/${SPACE}/environments/master${path}`, {
    ...opts,
    headers: {
      'Authorization': 'Bearer ' + CMA_TOKEN,
      'Content-Type': 'application/vnd.contentful.management.v1+json',
      ...(opts.headers || {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Contentful CMA ${opts.method || 'GET'} ${path} → ${res.status}: ${body?.message || JSON.stringify(body)}`)
  return body
}

// Default locale (usually en-US)
async function defaultLocale() {
  const data = await cma('/locales')
  const def = data.items.find(l => l.default) || data.items[0]
  return def.code
}

// Ensure the city content type has the playlist field; add it if missing.
async function ensurePlaylistField() {
  const ct = await cma('/content_types/city')
  if (ct.fields.some(f => f.id === PLAYLIST_FIELD)) return
  console.log(`Adding "${PLAYLIST_FIELD}" field to the city content type…`)
  ct.fields.push({
    id: PLAYLIST_FIELD,
    name: 'Music Playlist (Spotify)',
    type: 'Symbol',
    required: false,
    localized: false,
    validations: [],
    disabled: false,
    omitted: false,
  })
  const updated = await cma('/content_types/city', {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(ct.sys.version) },
    body: JSON.stringify({ name: ct.name, displayField: ct.displayField, fields: ct.fields }),
  })
  await cma('/content_types/city/published', {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(updated.sys.version) },
  })
  console.log('Field added and content type published.')
}

async function setCityPlaylist(cityId, locale, url) {
  const entry = await cma('/entries/' + cityId)
  entry.fields[PLAYLIST_FIELD] = { ...(entry.fields[PLAYLIST_FIELD] || {}), [locale]: url }
  const updated = await cma('/entries/' + cityId, {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(entry.sys.version), 'X-Contentful-Content-Type': 'city' },
    body: JSON.stringify({ fields: entry.fields }),
  })
  await cma('/entries/' + cityId + '/published', {
    method: 'PUT',
    headers: { 'X-Contentful-Version': String(updated.sys.version) },
  })
}

async function getCityPlaylistUrl(cityId, locale) {
  try {
    const entry = await cma('/entries/' + cityId)
    return entry.fields?.[PLAYLIST_FIELD]?.[locale] || null
  } catch {
    return null
  }
}

// ============================================================
// Helpers
// ============================================================
function spotifyTrackId(url) {
  if (!url) return null
  const m = String(url).match(/track[/:]([A-Za-z0-9]{20,24})/)
  return m ? m[1] : null
}

function playlistIdFromUrl(url) {
  if (!url) return null
  const m = String(url).match(/playlist[/:]([A-Za-z0-9]{20,24})/)
  return m ? m[1] : null
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('Authenticating with Spotify…')
  ACCESS_TOKEN = await spotifyToken()
  const me = await spotify('/me')
  console.log(`Connected as Spotify user: ${me.display_name || me.id}`)

  const locale = await defaultLocale()
  await ensurePlaylistField()

  // Fetch cities and all stories (resolving channel mediaType).
  console.log('Loading cities and songs from Contentful…')
  const citiesRes = await cdn('/entries?content_type=city&limit=500&order=fields.cityName')
  const cities = citiesRes.items

  const storiesRes = await cdn('/entries?content_type=story&include=2&limit=1000')
  const includedEntries = {}
  for (const e of (storiesRes.includes?.Entry || [])) includedEntries[e.sys.id] = e

  // Group music stories by related-city id
  const musicByCity = {}
  for (const item of storiesRes.items) {
    let type = (item.fields.mediaType || '').toLowerCase()
    if (!type && item.fields.channel) {
      const ch = includedEntries[item.fields.channel.sys.id]
      type = (ch?.fields?.mediaType || '').toLowerCase()
    }
    if (type !== 'music') continue
    const cityId = item.fields.relatedCity?.sys?.id
    if (!cityId) continue
    ;(musicByCity[cityId] ||= []).push(item)
  }

  const summary = []
  for (const city of cities) {
    const songs = musicByCity[city.sys.id] || []
    if (!songs.length) continue
    const name = city.fields.cityName

    // Chronological order (oldest first) to match the app's Music section.
    songs.sort((a, b) => (parseInt(a.fields.releaseYear) || 0) - (parseInt(b.fields.releaseYear) || 0))

    const ids = []
    const missing = []
    for (const s of songs) {
      const id = spotifyTrackId(s.fields.mediaUrl) || spotifyTrackId(s.fields.secondaryUrl)
      if (id) ids.push(id)
      else missing.push(s.fields.storyTitle)
    }
    if (!ids.length) {
      summary.push({ name, tracks: 0, note: 'no Spotify URLs found' })
      continue
    }
    const uris = ids.map(id => 'spotify:track:' + id)

    // Reuse existing playlist if one is linked and still owned by us.
    const existingUrl = await getCityPlaylistUrl(city.sys.id, locale)
    let playlistId = playlistIdFromUrl(existingUrl)
    if (playlistId) {
      try {
        const pl = await spotify('/playlists/' + playlistId + '?fields=owner(id)')
        if (pl.owner?.id !== me.id) playlistId = null
      } catch {
        playlistId = null // 404 / deleted
      }
    }

    const playlistName = `Layered City: ${name}`
    const description = `A musical portrait of ${name}. Curated by Layered City.`

    if (!playlistId) {
      const created = await spotify(`/users/${me.id}/playlists`, {
        method: 'POST',
        body: JSON.stringify({ name: playlistName, public: true, description }),
      })
      playlistId = created.id
    } else {
      await spotify('/playlists/' + playlistId, {
        method: 'PUT',
        body: JSON.stringify({ name: playlistName, description }),
      })
    }

    // Replace all tracks (idempotent).
    await spotify('/playlists/' + playlistId + '/tracks', {
      method: 'PUT',
      body: JSON.stringify({ uris }),
    })

    const url = 'https://open.spotify.com/playlist/' + playlistId
    await setCityPlaylist(city.sys.id, locale, url)
    summary.push({ name, tracks: ids.length, note: missing.length ? `missing: ${missing.join(', ')}` : url })
  }

  console.log('\nDone.\n')
  for (const r of summary) {
    console.log(`  ${r.name.padEnd(16)} ${String(r.tracks).padStart(2)} track(s)  ${r.note}`)
  }
  if (!summary.length) console.log('  (no cities with music songs found)')
  console.log('')
}

main().catch(e => fail(e.message))
