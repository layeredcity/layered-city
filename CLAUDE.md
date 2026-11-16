# Layered City

## Writing style

These apply to all text in the app: Contentful descriptions, threads, About, UI copy, labels, and captions.

- Plain, dry, and straightforward. No salesy phrasing or heavy emphasis.
- Always use the Oxford (serial) comma: "Paris, Rome, and Vienna", "met, traded, or died".
- American English: color, center, theater, organize, traveled, gray; dates as “September 12, 1945”; “St.” and “Dr.” with a period; commas and periods inside closing quotation marks. Proper names keep their own spelling (Estates Theatre, Royal Albert Hall).
- Curly quotes and apostrophes (converted automatically at load, but write them curly anyway).

## Threads

Threads are read as stories, and some are narrated aloud.

- Each chapter should read as one connected passage, not a list of facts. Link sentences to each other, and link each chapter to the one before (“His next plan was…”, “Paris wore him out.”).
- Keep sentences to one idea each. Avoid both short, cryptic fragments and long sentences that pack in several ideas.
- Never name-drop. The first time a person, place, group, or work appears, say who or what it is in a few words (“Goupil & Co, a large firm of art dealers”, “Arles, a small town in Provence”). Readers should never feel they were expected to know already.
- Prefer a few well-introduced names over a list of names.
- A chapter can have a `mediaNote` in `src/data/threads.json`, which the narrator says after the chapter text. It is spoken only, never shown. It has a `lead` and an `items` list. The lead says why someone might want to explore further (“Here are two ways to look harder at The Potato Eaters.”); vary it from chapter to chapter and avoid “below”. Each item is one sentence describing one story, in the same order as the chapter’s `stories` array, because the page shows them in that order and highlights each one as it is described. A chapter with a single story has no lead: fold the reason into the one item. Update the note whenever that chapter’s stories change.
- Each chapter of a narrated thread has a `short` label for the player bar: one to three words naming the subject (“Spinoza”, “Tulip mania”, “The bunker”). Add `shortPlace` when the chapter’s `city` isn’t the real place (“Nuenen”, “Potsdam”).
