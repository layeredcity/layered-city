---
name: upload-podcasts-to-contentful
description: Turn pasted per-city podcast episodes into Contentful entries for the Layered City app, creating any missing shows (channels) automatically. Use whenever the user pastes a batch of podcast episodes for a city (title, show, hosts, place, duration, description, listen links) to be uploaded, or asks to "add these podcast episodes / this episode" to a city's Podcasts section. Formats the content into scripts/podcasts.json and runs scripts/import-podcasts.mjs.
---

# Upload podcast episodes to Contentful

Layered City's Podcasts section is a place-pinned set of real episodes about a
city. This skill ingests pasted episode content and creates `story` entries via
`scripts/import-podcasts.mjs`.

**Podcasts are modelled differently from songs/books/films.** An episode is a
`story` that **links to a `channel`** (the show) and *inherits its media type
from the channel* — the episode itself stores no `mediaType`. So the crux of the
work is resolving each episode's show to a channel:

- If the show already exists as a channel, the importer links to it.
- If not, the importer **creates the channel** — which requires a `publisher`
  entry and a `channelIcon` asset (both mandatory on the `channel` type). It
  finds/creates the publisher and pulls the show's official artwork from Apple's
  iTunes API automatically.

## Prerequisites

- Run from the repo root (`/Users/rnee/layered-city`), not a worktree.
- `.env` must contain `VITE_CONTENTFUL_SPACE` and `CONTENTFUL_MANAGEMENT_TOKEN`
  (the management token is the one that can write).
- The city must already exist as a `city` entry in Contentful.

## Workflow

1. **Parse the pasted content into `scripts/podcasts.json`** — an array of
   objects, one per episode (see `scripts/podcasts.example.json`). Required keys:
   `city`, `title`, `show`, `description`. Shape:

   ```json
   {
     "city": "Athens",
     "title": "Thucydides",
     "show": "In Our Time",
     "publisher": "BBC",
     "lat": 37.9780, "lon": 23.7173,
     "description": "One- or two-sentence 'why listen' note (max 256 chars).",
     "spotify": "In Our Time Thucydides",
     "apple": "In Our Time Thucydides",
     "minutes": 45, "seconds": 39,
     "date": "2015-01-29"
   }
   ```

2. **Import (drafts):** `npm run import:podcasts`. Creates the episodes as
   **unpublished drafts** and creates/publishes any missing channels along the
   way. Add `--enrich` to fill missing durations/dates from Apple; add
   `--publish` to publish the episodes too:

   ```bash
   npm run import:podcasts -- --enrich          # fill gaps from Apple, drafts
   npm run import:podcasts -- --enrich --publish # …and publish
   npm run import:podcasts -- --dry-run          # report only, write nothing
   ```

3. **Report** what was created, which shows were newly created, and every "To
   finish / verify" line (missing location/duration/date, and any enriched
   episode to sanity-check).

## Field-mapping rules (how to turn the paste into JSON)

The pasted format is usually: a title line, a `📍 place (lat, lon) · Show ·
Hosts · year/date` line, a `⏱ Duration:` line, a description paragraph, then
`▶ Spotify: … · Apple Podcasts: …`.

- **city** — the city being worked on (constant for the batch).
- **title** — the episode title. Strip trailing show-name suffixes the user adds
  for their own notes (e.g. `— BBC Witness History (preferred show)`).
- **show** — the show name on the 📍 line (the token after the place). This is
  matched to a channel case-insensitively. Use the show's real name (e.g.
  `The Ancients`, not `The Ancients, History Hit`).
- **publisher** — only used when the show's channel must be **created**. Use the
  network/producer: `BBC` (In Our Time, Witness History), `History Hit`
  (The Ancients, Dan Snow's History Hit), the hosts for independent shows
  (The Rest is History → "Tom Holland and Dominic Sandbrook"). If omitted, the
  importer falls back to the show name. Ignored when the channel already exists.
- **lat / lon** — from the `(lat, lon)` on the 📍 line. Both or neither. Location
  is required to *publish* an entry but not to create it.
- **description** — the paragraph. **Hard limit 256 chars** (`storyDescription`
  is a Symbol). Tighten to fit cleanly; never let it truncate mid-word.
- **spotify / apple** — the listen links from the ▶ line. Paste the search terms
  or full URLs; the importer adds the scheme/host for bare search terms. Only one
  button shows in the app (it uses `mediaUrl` = spotify, falling back to apple).
- **minutes / seconds** — parse the `⏱ Duration:` line. `1 hr 9 min` → 69/0;
  `9:35` → 9/35. If it's approximate/"to confirm", **omit** it and rely on
  `--enrich` (Apple has authoritative runtimes) or leave blank and flag.
- **date** — the year or date on the 📍 line. Accepts `2015`, `2015-01-29`,
  `2025-03`, or `March 2025` (the importer normalizes — note Contentful itself
  rejects bare year-month, so month precision is stored as the 1st). If unknown,
  omit and rely on `--enrich`.
- **hosts / guests, ★ ratings** — not stored on the episode; ignore (hosts feed
  the publisher only when creating a new channel).

## Enrichment (Apple lookups) — recommended

Pass `--enrich` and the importer fills any missing `minutes`/`date` from the
iTunes episode API, matching by show + title. **It logs every enriched episode
so the match can be verified** — always relay those lines to the user, because:

- **Multi-part series** (e.g. The Rest is History's "Thermopylae & Salamis" is
  two episodes) — enrichment picks one part. Decide whether to keep a single
  entry (use Part 1) or split into two entries.
- **Re-aired / archived** BBC episodes can resolve to a newer airing than the one
  the user had in mind; check the date/interviewee still matches the description.

## Publishing model

- **Channels** (and their publishers + artwork assets) are always created **and
  published** — an episode can only resolve its show on the live site if the
  channel is published.
- **Episodes** are created as **drafts** by default (so they can be eyeballed),
  and published only with `--publish`. Unlike music, podcasts need no per-episode
  artwork (the channel carries it), so publishing straight away is fine once the
  batch looks right.

## Notes

- No quality ratings are set. Episodes sort within the Podcasts section by their
  `qualityRating` tier; unrated episodes show as a flat list (add ratings by hand
  later if desired).
- `scripts/podcasts.json` is gitignored (transient working data);
  `scripts/podcasts.example.json` is the committed template.
- For a single episode, same flow — a one-element array.
- If a new show has no artwork on Apple (rare), the importer errors for that
  episode; create the channel by hand in Contentful, then re-run.
