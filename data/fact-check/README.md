# Monthly fact check

A scheduled Claude session runs this once a month, a couple of days after the
monthly link check (`.github/workflows/monthly-link-check.yml`, the 1st of each
month). Over about a year it works through every thread and every city.

## Files

- `links.json`: the latest link check. `broken` is almost certainly dead;
  `check` needs a look (often a site blocking robots).
- `log.json`: when each thread and city was last fact-checked (`null` means
  never), plus a short list of past runs.
- `reports/YYYY-MM.md`: one report per run.

## What a run does

1. **Pull the latest.** `git pull --rebase origin main`. If `links.json` is
   more than 10 days old, the link check didn't run: touch
   `data/fact-check/run-links`, push, wait for the workflow, and pull again.
   Also refresh the story text: touch `data/run-dump-text`, push, wait for the
   "Dump text" workflow, and pull. This container can't reach Contentful
   directly; GitHub's runners can.

2. **Links.** List every `broken` link in the report with city, story title,
   and URL. For each, search for where the media lives now (a new YouTube
   upload of the same video, a moved podcast page) and give the replacement
   URL if you find one. Skim `check` entries and list only the ones that look
   really dead. Don't edit Contentful; Ryan fixes these.

3. **Threads.** *Until December 17, 2026: don't edit `src/data/threads.json`.
   ElevenLabs credits are used up until then, so a changed sentence couldn't be
   re-recorded. List thread errors in the report instead; Ryan plans a full
   fact check and rewrite of the older threads once credits renew.*
   Take the 6 threads in `log.json` checked longest ago (never
   checked first, then oldest date). For each chapter, check every factual
   claim (names, dates, places, numbers, who did what) against published
   sources using WebSearch and WebFetch. Wikipedia is fine for a first look;
   prefer a museum, archive, or other primary source when a claim is shaky.
   - Fix clear errors directly in `src/data/threads.json`, following the
     writing rules in `CLAUDE.md`. Change as few words as possible: each
     changed sentence is re-recorded by the narration workflow, which costs
     ElevenLabs credits. If a fix changes what a chapter says about one of
     its stories, update that chapter's `mediaNote` too.
   - Don't rewrite for style, and don't change a claim that sources disagree
     on. List those in the report instead.
   - Record every fix in the report: thread, chapter, old wording, new
     wording, and the source.

4. **Cities.** Take the 2 cities checked longest ago (only 1 if either has
   more than 200 stories in `data/text/stories.json`). Read each story's
   `desc` and check its factual claims the same way. Descriptions live in
   Contentful, so don't change them; list each error in the report with the
   story title, the wrong claim, the correction, and the source.

5. **Log and report.** Write `reports/YYYY-MM.md` with a short summary at the
   top (how much was checked, how many problems), then sections for links,
   threads, and cities. Update `log.json` with today's date for each thread
   and city you finished, and add a line to `runs`. If you run out of time
   partway through a thread or city, leave its date unchanged.

6. **Commit and push** to main with a message like "Monthly fact check
   (2027-01)", ending with the attribution lines the session gives you.

7. **Tell Ryan** in the session's final message: what was checked, what was
   fixed in threads, and how many items in the report need him (broken links
   and description errors). Keep it to a few lines.
