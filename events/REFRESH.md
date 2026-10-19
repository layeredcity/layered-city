# Events refresh (weekly)

The Events section is a pilot for Vienna. Once a week, a scheduled session rewrites
`src/data/events.json` with what's on in the city over the next four weeks. The app
drops past events by itself, so nothing breaks between refreshes.

## 1. Get fresh source pages

Don't open web pages yourself: WebFetch asks the owner for approval on every URL.
A GitHub job does the fetching instead and commits the page text to
`events/raw/<city>/`.

1. `git pull --rebase origin main`
2. Look at `FETCHED` near the top of any file in `events/raw/vienna/`. If it is
   more than 2 days old, trigger a fetch:
   - `date -u > events/run-fetch`, then commit and push.
   - Poll `https://api.github.com/repos/layeredcity/layered-city/actions/runs?per_page=1&event=push`
     with curl until `status` is `completed`, then pull.
3. `events/raw/vienna/_status.json` lists each source with its HTTP status and
   size. `*.txt` holds the page text, with links shown as `⟨url⟩`.
   `*.events.json` holds any schema.org Event data found on the page.
4. If a source is consistently 404, failing or nearly empty, fix or replace its
   URL in `events/sources/vienna.json`. The homepage's links (in the `.txt`)
   usually show the right listing page.

You can use WebSearch to find candidates or a source the job doesn't cover yet.
Search results show only titles and URLs, so every date, time and venue must
come from a raw source file. If something looks good but isn't covered, add its
URL to `events/sources/vienna.json`, refetch and read it.

## 2. Choose events

The window runs from today to 28 days out. Aim for 25–40 entries.

- **Who it's for:** a curious, well-read English-speaking traveller who likes
  culture, food, history and design, and who'd rather see what locals go to than
  a tourist show.
- **Leave out:** costumed "Mozart concert" sellers, hop-on/off and other
  permanent tourist products, private or trade events, kids-only events, and
  anything sold out with no returns or standing places.
- **Aim for a mix:**
  - opera and ballet (pick standout productions, not every night);
  - concerts (classical, jazz, Wienerlied, pop/rock at real venues);
  - theatre and dance, flagging anything with English surtitles or in English;
  - film festivals and special screenings;
  - exhibitions (new openings, plus anything closing within the window, with
    "last chance" in the copy);
  - seasonal and public traditions (holidays, markets, Martinigansl goose season,
    Heuriger, ball season);
  - talks, design fairs and free things.
- **One-off events beat long runs.** For opera and theatre, list a production
  once, on its next date, and give the other dates in `when`.
- **Long runs:** an exhibition, festival or market lasting longer than the
  window is one entry with `start` and `end`. The app shows it under "On now".

## 3. Format

`src/data/events.json` is keyed by city name:

```json
{
  "Vienna": {
    "updated": "YYYY-MM-DD",
    "events": [
      {
        "id": "viennale-2026",
        "title": "Viennale",
        "category": "Film",
        "start": "2026-10-22",
        "end": "2026-11-03",
        "time": "",
        "when": "Oct 22–Nov 3 · Gartenbaukino, Stadtkino and others",
        "venue": "Gartenbaukino",
        "description": "…",
        "why": "…",
        "url": "https://…",
        "linkLabel": "Programme and tickets",
        "language": "Original language with English subtitles",
        "source": "viennale"
      }
    ]
  }
}
```

- **`id`:** a stable slug. Keep the same id for the same event across refreshes.
- **`category`:** one of Opera, Ballet, Classical, Jazz, Concert, Theatre, Dance,
  Film, Exhibition, Festival, Market, Food & drink, Tradition, Talk, Design, Sport,
  Free.
- **Dates:**
  - `start` and `end` are `YYYY-MM-DD`; leave `end` out for a single date.
  - `time` is `"HH:MM"` (24h), or empty.
- **`when`:** a short human line: time, other dates, price or the standing-place
  tip. Keep it under 70 characters.
- **`venue`:** the plain name a map search will find, such as "Musikverein" or
  "Wiener Staatsoper".
- **`description`:** at most 220 characters. Say what it is, naming the work,
  composer, director, artist or band, with a few words introducing people the
  reader may not know.
- **`why`:** one sentence, at most 160 characters, on why a traveller might want
  to go. It should be specific, such as the only chance to hear X, the way
  Viennese actually spend the holiday, or standing places from €15. Don't write
  "a must-see" or "unforgettable".
- **`language`:** required, and always explicit, so nobody has to wonder. Examples:
  "In English", "In German, no English", "In German with English surtitles",
  "Sung in Italian, English subtitles on the seat screens", "Original language with
  English subtitles", "No language needed" (instrumental music, dance, most
  exhibitions). Base it on a raw source file. If the source doesn't say, write
  "Language not confirmed, check before booking". Never guess.
- **`url`:** the event's own page from the raw source file, or the listing page if
  the event has none. Never build a URL by hand.
- **`source`:** the raw file the dates came from, for checking.

## Voice: plain-spoken, for someone who knows nothing about it

Assume the reader knows nothing about the art form, the venue or the people.
Don't assume or imply they know opera, film history or Vienna. Write the way you'd
tell a friend about it over coffee, not the way a programme note reads.

- **Lead with what it actually is and what you'll experience:** "A comic opera
  about a girl raised by an army regiment. Light, silly and easy to follow, even
  if you’ve never been to an opera." Not a list of the cast and creative team.
- **Use few names.** Mention a person only if a traveller would recognise them or
  needs them, and then say in plain words who they are and why they matter to
  the reader. One name per entry at most is a good default; often none. No
  conductors, directors or casts unless one is famous to non-fans (Jonas
  Kaufmann can stay, as "one of the world’s best-known tenors").
- **No insider trivia** (nine high Cs, founding histories, who initiated what).
- **Explain places.** Never use a hall or room name on its own ("Metallener Saal");
  say what and where it is, or just name the building ("at the Konzerthaus").
  Explain German terms (Stehplatz = standing place, Heuriger = wine tavern).
- **Keep it short and light:** one or two short sentences, no stacked clauses, no
  semicolons, and fewer than about three proper nouns per entry.
- **`why`:** one plain sentence on what's in it for a visitor, such as a chance to
  hear the director of an Oscar winner in person, the cheapest way into the opera,
  or what Viennese actually do on the holiday.

Before and after:

- **Too dense:** “Austria’s biggest festival of contemporary music, founded in
  1988 at the initiative of Claudio Abbado, with a month of events across the
  city.”
  **Better:** “A month of new and experimental music in concert halls, clubs and
  churches around the city. Expect anything from orchestras to sound
  installations.”
- **Too dense:** “Donizetti’s comedy in Laurent Pelly’s production, with Erin
  Morley and Xabier Anduaga; Evelino Pidò conducts.”
  **Better:** “A comic opera about a girl raised by a regiment of soldiers. It’s
  short, funny and a gentle first opera.”
- **Good:** “A chance to hear a key figure of German film in person.” (Just make
  sure `language` says whether the talk is in English.)

Style: plain, dry, factual and warm, with curly quotes (’ “ ”). No salesy words
("hidden gem", "must-see", "delightful", "charming", "fun"). **Never invent a date,
time, price or event.** If the sources don't confirm it, leave it out.

## 4. Validate and publish

- Check with python:
  - the JSON parses;
  - every entry has id, title, category, start, venue, language, description, why and url;
  - dates are valid and `end` ≥ `start`;
  - every entry overlaps the window;
  - description and why are within their length limits;
  - no ids are duplicated.
- Set `updated` to today. Sort the events by `start`.
- Commit only `src/data/events.json` and any `events/sources/` changes, with the
  message "Refresh Vienna events" and the attribution lines. Then run
  `git pull --rebase origin main && git push origin HEAD:main`. Netlify deploys on
  push.
- Finish with a short summary of what's new this week: 5–8 highlights in one
  line each, plus any source that failed.
