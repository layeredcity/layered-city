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
work is resolving each episode's show to a channel (see the section below).

- If the show already exists as a channel, the importer links to it.
- If not, the importer **creates the channel** — which requires a `publisher`
  entry and a `channelIcon` asset (both mandatory on the `channel` type). It
  finds/creates the publisher and pulls the show's official artwork from Apple's
  iTunes API automatically.

## Autonomy — run this end to end without asking permission

The user does **not** want to be asked for step-by-step approval on this task.
Run the whole flow — parse the paste, verify shows, create channels/publishers/
artwork, create and publish episodes, enrich from Apple, verify and fix data —
and report at the end. Use sensible defaults for the small calls (which listen
link is primary, trimming a long description to fit 256, date normalization,
leaving a genuinely unknown field blank and flagging it). A normal batch has
**no major decisions**. Only pause for something genuinely consequential and
irreversible (deleting/overwriting existing content) or a real ambiguity you
can't resolve sensibly — surface everything else in the final summary.

## Prerequisites

- Run from the repo root (`/Users/rnee/layered-city`), not a worktree.
- `.env` must contain `VITE_CONTENTFUL_SPACE`, `VITE_CONTENTFUL_TOKEN`, and
  `CONTENTFUL_MANAGEMENT_TOKEN` (the management token is the one that can write).
- The city must already exist as a `city` entry in Contentful.

## Workflow

1. **Parse the paste into `scripts/podcasts.json`** — an array of episode objects
   (see `scripts/podcasts.example.json`). Required keys: `city`, `title`, `show`,
   `description`. Shape:

   ```json
   {
     "city": "Athens", "title": "Thucydides", "show": "In Our Time", "publisher": "BBC",
     "lat": 37.9780, "lon": 23.7173,
     "description": "One- or two-sentence 'why listen' note (max 256 chars).",
     "spotify": "In Our Time Thucydides", "apple": "In Our Time Thucydides",
     "minutes": 45, "seconds": 39, "date": "2015-01-29"
   }
   ```

2. **Resolve every show to a channel FIRST** (see next section) — this is where
   the care goes. Then pre-check description lengths (all ≤ 256).

3. **Import.** The standard command is `--enrich --publish` (fill durations/dates
   from Apple, and publish — podcasts need no per-episode artwork, so drafts add
   nothing):

   ```bash
   npm run import:podcasts -- --enrich --publish   # standard
   npm run import:podcasts -- --dry-run            # report only, write nothing
   npm run import:podcasts -- --enrich             # drafts (rarely needed)
   ```

4. **Verify after import** (see that section) and **report** — what was created,
   which channels are new, every enriched match to sanity-check, and every gap.

## Resolving each show to a channel — the crux

Do this deliberately; it's where mistakes happen.

**1. Reuse existing channels — match the EXACT stored name.** Many shows recur
across cities. The importer matches channels by exact (normalized) `channelName`;
a near-miss silently creates a **duplicate channel**. The user often writes a
show slightly differently than it's stored — normalize it yourself:
- `BBC Witness History` → the channel is **`Witness History`**
- `Monocle Radio, The Menu` → **`Monocle: The Menu`**
- `Dan Snow's History Hit, with guide X` → **`Dan Snow's History Hit`**
- `The Ancients, History Hit` → **`The Ancients`**

If unsure whether a show already exists, list channels first
(`content_type=channel`) and match against stored names.

**2. Verify each NEW show on Apple before creating its channel.** Query
`https://itunes.apple.com/search?term=<show>&media=podcast&entity=podcast`.
Confirm it returns a single real podcast with artwork.
- **Search plainly.** Over-specifying pushes the real show out of results —
  `"Ancient Greece Today Hellenic Studies"` failed; `"Ancient Greece Today"`
  matched. Add qualifiers only if a bare search is ambiguous.
- **Keyword-stuffed Apple names** (`"True Spies: Espionage | Investigation | …"`)
  — set the clean `show` yourself (`True Spies`); the importer's artwork lookup
  falls back to the first result, which is still the right show.
- **Long real names** (`"History of the Germans from the Middle Ages to
  Reunification"`) — a short `show` (`History of the Germans`) still gets the
  right art via first-result fallback.

**3. Generic / umbrella names that don't map to one podcast.** Find the actual
show the episode lives in (search `entity=podcastEpisode`), and use *that* as the
channel — then flag it if the real name reads oddly.
- `SBS Audio` is a network; the Nadia Comăneci episode was in **`Who's Your Don
  Bradman?`**. `Empire` is generic → **`Empire: World History`**.
- `History of Ideas` (LRB) — the show's art is under `Talking Politics: HISTORY
  OF IDEAS`, but the current episode lives in `Past Present Future`; a plain
  `History of Ideas` show name pulls the right art via fallback.

**4. Sources that AREN'T Apple podcasts** (archive clips, radio broadcasts —
e.g. `RTÉ Archives`). The importer would grab a wrong first-result image
(`"Talking History"`), so **do not auto-source these**. Instead:
   a. Ask the user for an icon URL (they'll paste one).
   b. Create the channel by hand: publisher + an asset uploaded from that URL +
      the channel (mediaType `podcast`), all published. (See the one-off scripts
      pattern used this session — publisher → `createAsset` from URL → channel.)
   c. Then run the episodes through the importer with `show` set to that exact
      channel name — it finds the existing channel and just links. The channel is
      reusable for future clips from the same source.

## Field-mapping rules (paste → JSON)

Paste format: a title line, `📍 place (lat, lon) · Show · Hosts · year/date`,
`⏱ Duration:`, a description paragraph, then `▶ Spotify: … · Apple Podcasts: …`.

- **title** — the episode title. Strip the user's own note suffixes
  (`— BBC Witness History (preferred show)`).
- **show** — normalized per the section above.
- **publisher** — only used when creating a channel. Network/producer: `BBC`,
  `History Hit`, `Noiser`, `SPYSCAPE`, `Chora Media`, `Getty`; the hosts for
  indie shows. Falls back to the show name if omitted. Ignored for existing
  channels.
- **lat / lon** — from the 📍 line; both or neither. Needed to *publish*.
- **description** — **hard limit 256** (`storyDescription` is a Symbol). Trim to
  fit cleanly; never truncate mid-word. Always length-check before importing.
- **spotify / apple** — the ▶ search terms or URLs (bare terms get the host
  prepended). Only one button shows in the app (`mediaUrl`=spotify, fallback
  apple).
- **minutes / seconds** — `1 hr 9 min` → 69/0; `9:35` → 9/35. Approximate /
  "to confirm" → omit and let `--enrich` fill (Apple has authoritative runtimes).
- **date** — `2015`, `2015-01-29`, `2025-03`, or `March 2025` all work; the
  importer normalizes. **Contentful rejects bare year-month** (`2025-03`) — the
  importer converts it to the 1st (`2025-03-01`), so month precision shows as
  day 1. Omit if unknown and rely on `--enrich`.
- **hosts / guests, ★ ratings** — not stored (hosts only feed a new channel's
  publisher).

## Enrichment (`--enrich`) — powerful but VERIFY every match

`--enrich` fills missing `minutes`/`date` from the iTunes episode API, matching
by show + title. It logs each match. **Always check the logged matches** — the
matcher is fuzzy and regularly grabs the wrong episode:

- **Wrong episode within a show.** Generic titles or un-indexed episodes make it
  pick something else entirely — "Vikings and the Founding of Dublin" matched
  *"Brian Boru"*; "How the Book of Kells Works" matched *"Sei Shonagon"*. If a
  match is clearly wrong, **clear the duration/date** (a wrong runtime is worse
  than none) and, if you can, look up the correct episode with a topic-specific
  search and patch it.
- **Series entries** (the title is a series name, or the show is an N-part
  series) — enrichment grabs a trailer / "Welcome!" / single chapter, which
  misrepresents the whole. Seen: Piping Up (`Welcome!` 1:01), Ireland Said Yes
  (trailer 0:30), The Bloodied Field (trailer 2:40), Ulysses (one chapter of a
  29h dramatization). **Clear the misleading duration**; keep the date if roughly
  right; flag as a series.
- **Multi-part episodes** — the user usually says "Part N"; enrichment may return
  a different part. Verify (Marathon/Thermopylae are 2-parters).
- **Shows not indexed at the episode level** return no runtime — History Daily,
  Composers Datebook, Not Another Whisky Podcast, Danielle Oteri's Italy, RTÉ
  Archives, some BBC archive. Leave blank and flag; a **targeted manual lookup**
  (`entity=podcastEpisode`, filtered to the show's `collectionName`) often finds
  it under a slightly different search — then patch the entry.
- **Re-aired BBC episodes** resolve to a newer airing than the original; check
  the date/interviewee still fits the description.

## Creative / renamed titles

The user sometimes gives punchy, non-literal display titles (e.g. "Choosing
hemlock over exile" for a Socrates episode). Then `--enrich` **can't find the
episode** — it searches the literal `title`. Handle it one of two ways:
- If the user includes the **original episode title** (they may), look it up on
  Apple by that original title and put `minutes`/`seconds`/`date` **directly in
  the JSON** — skip `--enrich` for those.
- Otherwise enrich via the topic carried in the **spotify/apple search terms**.

When *renaming* existing entries in bulk, match old→entry fuzzily (the user's
"old" title is often a shortened form of the stored one) and **dry-run first**,
printing old→matched→new, before applying.

## Verify after import

Spot-check via the delivery (CDN) API for the city's podcast episodes:
- durations/dates look sane (flag very long runtimes, series, wrong-episode risk);
- **exactly one channel per show** (a duplicate means a name near-miss slipped
  through step 1 of channel resolution);
- **every channel has an icon** (flag any missing);
- relay the new-channel list so the user can eyeball the smaller/indie shows'
  artwork in Contentful.

## Publishing model & notes

- **Channels** (+ publishers + artwork assets) are always created **and
  published** — an episode can't resolve its show on the live site otherwise.
- **Episodes** publish with `--publish` (the standard here).
- No quality ratings are set; unrated episodes show as a flat list.
- `scripts/podcasts.json` is gitignored (transient); `scripts/podcasts.example.json`
  is the committed template.
- Single episode → a one-element array, same flow.
