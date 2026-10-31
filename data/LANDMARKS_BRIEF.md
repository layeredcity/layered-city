# Landmarks brief

Layered City pins media (books, films, songs, podcasts, videos, tours) to real
places. A **Landmark** groups the stories pinned at one well-known place, such
as a museum, cathedral, palace, square or market, so that the map shows one
pin, and the Landmarks section lists the place with its stories underneath.
Vienna is done: see `src/data/landmarks.json` for the format and tone.

## Input
For each city, `data/landmark-candidates/<slug>.json` lists:
- **place:** the exact place names stories are pinned to.
- **stories:** the story count for each place.
- **types:** the story media types.
- **near_within_150m:** other place names whose pins sit within 150 m.

## Output
Write `data/landmark-drafts/<slug>.json` as a JSON array:

```
[{ "id": "kebab-case", "name": "English name", "type": "museum|church|palace|music|cafe|cemetery|building|landmark",
   "places": ["exact place string", ...], "description": "…" }]
```

## Rules
- **Stories:** a landmark needs **at least 2 stories in total** across its
  `places`. Never create a landmark with none; there are no empty landmarks.
- **`places`:** must be copied **exactly** from the candidate file, including
  curly apostrophes and parenthetical details.
- **Merging places:** merge several place names into one landmark only when
  they really are the same landmark. Good merges:
  - a palace complex and its parts (the Hofburg treasury, Heldenplatz in front
    of the Hofburg);
  - a cathedral and its own square;
  - a museum and its own courtyard.

  Don't merge neighbouring but separate places, such as two different museums,
  or a café that happens to be across the street.
- **What to skip:** whole areas, neighbourhoods, districts, streets, rivers,
  parks that are really "the city", stations (unless iconic, e.g. a famous
  railway station building), and generic spots.
- **`type`:**
  - `music` covers opera houses, concert halls and music venues.
  - `palace` covers castles and palaces.
  - `church` covers churches, mosques, synagogues and crypts.
  - `building` covers notable buildings, bridges and towers.
  - `landmark` covers anything else (squares, markets, monuments, ferris
    wheels).
- **`name`:** the English name a traveller would know (e.g. "Hagia Sophia",
  "Prado Museum", "St Vitus Cathedral").
- **`description`:** one or two plain sentences, at most 160 characters,
  saying what the place is and what you'll find there.
  - Assume the reader knows nothing.
  - No name-dropping and no insider trivia.
  - Curly quotes and apostrophes (’ “ ”).
  - Only state facts you are sure of.
  - No salesy words ("must-see", "iconic", "stunning", "breathtaking").
- **Tools:** don't use WebFetch. Use your own knowledge (and WebSearch only if
  you truly need to confirm a fact).

Validate with python: the file parses, every place exists in the candidates,
every landmark has 2 or more stories, every description is 160 characters or
fewer, and the ids are unique.
