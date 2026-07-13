---
name: upload-music-to-contentful
description: Turn pasted per-city music selections into draft Contentful song entries for the Layered City app. Use whenever the user pastes a batch of songs for a city (title, artist, year, location, description, streaming links) to be uploaded, or asks to "add this song / these songs" to a city's Music section. Formats the content into scripts/songs.json, validates it, and runs the importer to create unpublished drafts.
---

# Upload music selections to Contentful

Layered City's Music section is a chronological, place-pinned song portrait of each
city. This skill ingests the user's pasted song content and creates **draft
(unpublished)** `story` entries in Contentful via `scripts/import-content.mjs`. The
user finishes each draft by hand (album cover, any missing fields) and publishes it.

Companion skill: `city-music-portrait` *generates* the 15-song content; this skill
*uploads* it. They're often used back to back.

## Prerequisites

- Run from the repo root (`/Users/rnee/layered-city`), not the worktree.
- `.env` must contain `VITE_CONTENTFUL_SPACE`, `VITE_CONTENTFUL_TOKEN`, and
  `CONTENTFUL_MANAGEMENT_TOKEN`. (The management token is the one that can write.)
- `scripts/import-content.mjs` and `scripts/validate-songs.mjs` exist.
- The city must already exist as a `city` entry in Contentful (the validator checks this).

## Workflow

1. **Parse the pasted content into `scripts/songs.json`** — an array of objects, one
   per song, using this shape (all keys optional except `city` + `title`):

   ```json
   {
     "city": "Lisbon",
     "title": "La Vie en Rose",
     "artist": "Édith Piaf",
     "year": 1947,
     "genre": "chanson",
     "lat": 38.7156,
     "lon": -9.1245,
     "minutes": 3,
     "seconds": 7,
     "description": "One- or two-sentence 'why listen' note (max 256 chars).",
     "spotify": "open.spotify.com/search/Édith Piaf La Vie en Rose",
     "apple": "music.apple.com/us/search?term=Édith Piaf La Vie en Rose"
   }
   ```

2. **Validate:** `npm run validate:songs`. Fix any ERROR lines before importing.
   Note the "to finish" list — those are gaps (duration/location/year/artist) the
   user completes later; they don't block the import.

3. **Import:** `npm run import:songs`. Creates unpublished drafts. It's idempotent —
   re-running skips songs whose `city + title + artist` already exist, so it's safe.

4. **Report** what was created, and surface every "to finish" item (missing
   duration, generic location, approximated year, missing artist) so the user knows
   exactly what to complete in Contentful. Remind them the drafts still need album
   covers and publishing.

## Field-mapping rules (how to turn the paste into JSON)

The pasted format is usually: a title line, a `📍 place (lat, lon) · Artist (Country) ·
year · genre · ★rating` line, a `⏱ Duration:` line, a description paragraph, then
`▶ Spotify: … · Apple Music: …`.

- **city** — the city being worked on (constant for the batch).
- **title** — the song title line. Keep intentional punctuation/quotes (e.g. `"Heroes"`).
- **artist** — the name before `(Country)`. Ignore the country. If the artist slot is
  a placeholder rather than a name (e.g. "a 1939 wartime standard"), **omit** `artist`
  and flag it.
- **year** — must be a **4-digit integer**. Convert `1950s`→`1955`, `c. 1600`→`1600`,
  `~1965`→`1965` (pick a specific year) and flag the approximation. If the year is
  "traditional" or unknown, **omit** `year` and flag it (it will sort as oldest).
- **genre** — the genre token from the 📍 line (e.g. `fado`, `synth-pop`, `grime`).
  Copy it verbatim into `genre`. Maps to the `genre` field.
- **lat / lon** — from the `(lat, lon)` in the 📍 line. Include both or neither. If only
  a place *name* is given with no coordinates, either geocode it (OpenStreetMap
  Nominatim, then sanity-check it's inside the city) or use a city-center point, and
  flag it as needing a real pin. Location is required to *publish* but not to import.
- **minutes / seconds** — parse the `⏱ Duration:` line. `3:07`→`minutes:3, seconds:7`.
  If it says "version-dependent" / "varies" with no single clean time, **omit** both
  and flag it.
- **description** — the paragraph. **Hard limit 256 characters** (`storyDescription` is
  a Symbol). If longer, tighten it to fit cleanly — don't let it be truncated mid-word.
  Preserve the "the title means …" gloss and the place reference where possible.
- **spotify / apple** — paste the search URLs as-is (no scheme needed). The importer
  adds `https://` and percent-encodes spaces/accents.
- **★ star ratings** — ignore entirely; the app ranks music by year, not rating.

## Validation constraints (what the validator enforces)

- Hard errors (block import): unparseable JSON; missing title/city/description;
  description > 256 chars; non-4-digit year; lat without lon (or vice versa);
  out-of-range coordinates; a city that doesn't exist in Contentful.
- Soft (flag, still import): in-file duplicates; songs missing
  duration/location/year/artist.

## Backfilling fields on existing entries

To add a newly-added field (e.g. `genre`) to songs already in Contentful, run the
importer with `--update`:

```bash
npm run import:songs -- --update
```

In update mode the importer **only fills fields that are currently empty** on a
matched entry (so it never clobbers manual edits like album covers), and it
**re-publishes** entries that were already published (drafts stay drafts). It
matches by `city + title + artist`, so build the JSON from the **live** titles/
artists (the user may have renamed some) — fetch them from Contentful first, then
attach the new field. Songs with no match are skipped, never created.

## Notes

- The importer auto-converts straight quotes/apostrophes to typographic (curly)
  ones in the title, description, and creator; dedup is quote-insensitive so this
  never causes duplicates.
- The importer creates **drafts only** and never publishes (except re-publishing in `--update`).
- `scripts/songs.json` is gitignored (transient working data). `scripts/songs.example.json`
  is the committed template.
- For a single song ("add this one to Lisbon"), same flow — a one-element array.
