---
name: upload-content-to-contentful
description: Import curated per-city content (books, movies/TV, music, podcasts, videos, etc.) into the Layered City app's Contentful CMS. Use whenever the user pastes a batch of items for a city — books, films, songs, podcast episodes — to be added to that city's list. Formats the paste into scripts/songs.json, validates it, runs the importer to create draft `story` entries, resolves artwork/metadata, and publishes. Supersedes upload-music-to-contentful for everything except pure music batches.
---

# Upload content to Contentful (all media types)

Layered City presents each city through media "layers" (Books, Movies, Music,
Podcasts, Videos, Tours, Words). This skill turns a pasted batch of items into
**draft** `story` entries via `scripts/import-content.mjs`, resolves artwork and
metadata, and publishes them.

The importer is **one unified pipeline** keyed off each entry's `type`. Every
media type flows through the same `scripts/songs.json` → validate → import →
publish sequence. (The file is still named `songs.json` for historical reasons;
it holds items of any type.)

## Prerequisites

- Run all `npm` commands from the **repo root** (`/Users/rnee/layered-city`), not
  a worktree. (Edits/commits also target the main repo.)
- `.env` at repo root must contain `VITE_CONTENTFUL_SPACE`, `VITE_CONTENTFUL_TOKEN`
  (CDN), `CONTENTFUL_MANAGEMENT_TOKEN` (the writable one), and for movies
  `VITE_OMDB_KEY`.
- The city must already exist as a `city` entry in Contentful (validator checks).
- `scripts/songs.json` is gitignored (transient working data).

## Workflow (every batch)

1. **Write the batch to `scripts/songs.json`** — a JSON array, one object per
   item, using the per-type fields below. All keys optional except `type`,
   `city`, `title`, `description`.
2. **Validate:** `npm run validate:songs`. Fix any `ERROR` lines before importing.
   The "To finish" list is soft — gaps (missing year/creator/location, movie
   missing imdb/watch link) that import fine as drafts.
3. **Import:** `npm run import`. Creates **unpublished drafts**. Idempotent:
   skips items whose `city + title + creator` already exist (safe to re-run).
   For books it also resolves ISBN + cover art here (see below).
4. **Verify** artwork/metadata resolved (books: covers; movies: OMDb posters).
   Patch any gaps.
5. **Publish** (importer never publishes — see Publishing below).
6. **Report** what was created, any covers/ids that need manual attention, and
   confirm ratings/artwork status.

## Per-type input fields

Common to all: `type`, `city`, `title`, `description` (≤256 chars, hard limit),
`lat` + `lon` (both or neither), `year` (1–4 digits — classical texts like `121`
are fine), `creator` (maps to `creatorName`), `genre`.

### `book`
```json
{ "type": "book", "city": "Dublin", "title": "Ulysses", "author": "James Joyce",
  "year": 1922, "genre": "modernist novel", "lat": 53.2887, "lon": -6.1136,
  "description": "One ordinary Dublin day… (≤256).",
  "goodreads": "goodreads.com/search?q=James Joyce Ulysses",
  "bookshop": "bookshop.org/search?keywords=James Joyce Ulysses" }
```
- `author` → creatorName. `goodreads` → mediaUrl, `bookshop` → secondaryUrl
  (the app also builds precise Goodreads/Bookshop links from the ISBN at display
  time, affiliate id `126157`).
- `isbn` optional — **auto-resolved** from title+author via Open Library at
  import if omitted. Cover art auto-resolved into `bookCoverUrl`.
- Display: chronological by year, "View on Goodreads" + "Buy on Bookshop.org"
  buttons, book-cover hover animation (opens like a book).

### `movie` / `tv`
```json
{ "type": "movie", "city": "Amsterdam", "title": "Loving Vincent",
  "creator": "Dorota Kobiela & Hugh Welchman", "year": 2017,
  "genre": "animated documentary-drama", "lat": 52.3581, "lon": 4.8812,
  "minutes": 94, "imdb": "tt3262342",
  "justwatch": "justwatch.com/us/search?q=Loving Vincent",
  "description": "Every frame is an oil painting… (≤256)." }
```
- `imdb` (the `tt…` id) → `imdbId`. **This drives the poster + star rating** via
  OMDb at display time — no artwork stored. `creator` = director ("Directed by").
- `justwatch` → mediaUrl → the **"Find where to watch"** button. A **"View on
  IMDb"** button is auto-built from the `tt` id, so no IMDb URL needed.
- `minutes` → runtime. `mediaUrl` (JustWatch) is **required to publish**.
- **Don't** ask for `imdb.com/find` search links — the `tt` id covers poster,
  rating, and the IMDb link.
- Display: sorted by OMDb rating tier; DVD-case hover animation (disc slides out).

### `music`
```json
{ "type": "music", "city": "Lisbon", "title": "La Vie en Rose",
  "artist": "Édith Piaf", "year": 1947, "genre": "chanson",
  "lat": 38.7156, "lon": -9.1245, "minutes": 3, "seconds": 7,
  "description": "…",
  "spotify": "open.spotify.com/search/Édith Piaf La Vie en Rose",
  "apple": "music.apple.com/us/search?term=Édith Piaf La Vie en Rose" }
```
- `artist` → creatorName. `spotify` → mediaUrl, `apple` → secondaryUrl.
  `minutes`/`seconds` → duration. Sorted chronologically; record-sleeve hover.

### `podcast` / `video` / `audiotour` / `speak`
Same shape; `creator` → creatorName, a URL → `mediaUrl`. Podcasts/videos usually
carry a `channelIcon`/`artworkImage` set in Contentful. These weren't bulk-imported
via this pipeline yet — confirm field needs with the user first.

## Field-mapping reference (input key → Contentful field)

`title`→storyTitle · `artist`/`author`/`creator`→creatorName · `year`→releaseYear ·
`genre`→genre · `description`→storyDescription · `lat`+`lon`→storyLocation ·
`type`→mediaType · `spotify`/`goodreads`/`justwatch`→mediaUrl ·
`apple`/`bookshop`→secondaryUrl · `isbn`→isbnNumber · `imdb`→imdbId ·
`bookCoverUrl`→bookCoverUrl · `minutes`→numberOfMinutes · `seconds`→numberOfSeconds.

Contentful `story` required fields: storyTitle, storyDescription, storyLocation,
relatedCity, **mediaUrl**. So an item with no `mediaUrl`-mapped link imports as a
draft but can't be published until it has one.

## Behavior & gotchas

- **Drafts only.** `npm run import` never publishes. Publish separately.
- **256-char descriptions.** Over-length descriptions are truncated with a warning
  — better to tighten them in the JSON first.
- **Curly quotes** are applied automatically to title/description/creator; dedup is
  quote-insensitive, so this never causes duplicates.
- **Dedup key = city + title + creator**, per city. The same title in two cities is
  two separate entries — this is how intentional cross-city duplicates work (e.g.
  *Fear and Loathing in La Liga* in both Barcelona and Madrid, *Down and Out* in
  London and Paris). Just include it under each city; no special handling.
- **`--update` mode** (`npm run import -- --update`) fills only *empty* fields on
  matched entries and re-publishes ones that were already published — used to
  backfill a newly added field without clobbering manual edits.
- **Watch the city field.** Content whose landmarks/coordinates belong to one city
  but is labeled another is almost always a paste error — confirm before importing
  (this happened: a "Barcelona" batch was actually Madrid).

## Books: cover resolution

At import, for each book the importer resolves an ISBN (if missing) and a working
Open Library cover URL into `bookCoverUrl`. Two things to check after import:

- **Foreign-language editions.** Open Library sometimes returns a non-English
  edition's cover (Spanish, German, French…). Spot-check and swap to an English
  edition by patching `bookCoverUrl`.
- **Missing covers.** Some titles have no Open Library cover at all. They show the
  "BOOK" placeholder; the user can upload art to the `artworkImage` field in
  Contentful. **Always verify a candidate cover is the right book** — Open Library
  occasionally serves mismatched images (verify title via its books API).

To find/verify a better cover, query
`https://openlibrary.org/search.json?q=<title author>&fields=title,cover_i,language`
and test `https://covers.openlibrary.org/b/id/<cover_i>-L.jpg?default=false` (or
`/b/isbn/<isbn>-L.jpg`). A working cover returns a real image (>~1.5 KB, 200).

## Movies: verify OMDb before publishing

The poster + rating come from OMDb via the `tt` id at display time. Before
publishing a batch, confirm every id resolves (poster + rating present):

```js
// node -e with .env VITE_OMDB_KEY; iterate scripts/songs.json imdb ids:
const d = await (await fetch(`https://www.omdbapi.com/?i=${id}&apikey=${key}`)).json()
// expect d.Response === 'True', d.Poster !== 'N/A', d.imdbRating
```

## Publishing (drafts → live)

The importer only creates drafts. Publish via a **one-off CMA script** (write it,
run it, delete it — this is the established pattern). Template, scoped by the
titles in the current `songs.json` and (optionally) mediaType:

```js
// scripts/finish.mjs — node scripts/finish.mjs, then rm it
import { readFileSync } from 'node:fs'
const env = {}; for (const l of readFileSync('.env','utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g,'') }
const S = env.VITE_CONTENTFUL_SPACE, T = env.CONTENTFUL_MANAGEMENT_TOKEN
const cma = async (p, o={}) => { const r = await fetch(`https://api.contentful.com/spaces/${S}/environments/master${p}`, { ...o, headers:{ Authorization:'Bearer '+T, 'Content-Type':'application/vnd.contentful.management.v1+json', ...(o.headers||{}) } }); const b = r.status===204?null:await r.json(); if(!r.ok) throw new Error(r.status+' '+JSON.stringify(b)); return b }
const curl = s => s.replace(/'/g, '’')
const TITLES = new Set(JSON.parse(readFileSync('scripts/songs.json','utf8')).map(x => curl(x.title)))
let all = [], skip = 0
while (true) { const pg = await cma(`/entries?content_type=story&limit=100&skip=${skip}`); all = all.concat(pg.items); skip += 100; if (skip >= pg.total) break }
for (const e of all) {
  if (!TITLES.has(e.fields.storyTitle?.['en-US']) || e.sys.publishedVersion) continue
  await cma('/entries/'+e.sys.id+'/published', { method:'PUT', headers:{ 'X-Contentful-Version': String(e.sys.version) } })
  console.log('✓ published', e.fields.storyTitle['en-US'])
}
```
To also patch a cover before publishing, PUT the entry with
`fields.bookCoverUrl = { 'en-US': '<url>' }` (bump `X-Contentful-Version`) first.
Note titles are stored **curly-quoted** — normalize apostrophes when matching.
Filter by `fields.relatedCity.sys.id=<cityId>` if a title exists in multiple cities.

## Deploy

App changes (new field support, UI) are on `main` and auto-deploy via Netlify.
Content changes go straight to Contentful (no deploy). The user's standing prefs:
commit **and push** freely without asking; they verify UI changes themselves
(skip the preview-server check).
