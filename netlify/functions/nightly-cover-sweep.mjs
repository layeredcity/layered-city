// Nightly safety net for cover mirroring.
//
// The webhook handles the normal case within seconds of publishing. This exists
// for everything the webhook can't catch: a webhook delivery that failed, an
// edit made while the site was mid-deploy, or a cover that couldn't be mirrored
// earlier because the source was temporarily down.
//
// It processes a capped batch per run so a single invocation stays well inside
// its time budget. Anything left over is picked up the next night — and the log
// says how much is outstanding, so a backlog is visible rather than silent.

import { makeClient, findStale, mirrorStory } from '../../shared/mirror-core.mjs'

const BATCH = 20

export default async () => {
  // See mirror-cover-background.mjs: the space id is shared with the site, but
  // the management token must never carry a VITE_ prefix or Vite would ship it
  // to the browser.
  const space = process.env.VITE_CONTENTFUL_SPACE || process.env.CONTENTFUL_SPACE_ID
  const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN
  if (!space || !token) {
    console.error('missing VITE_CONTENTFUL_SPACE or CONTENTFUL_MANAGEMENT_TOKEN')
    return new Response('not configured', { status: 500 })
  }

  const client = makeClient({ space, token })
  const { total, batch } = await findStale(client, { limit: BATCH })

  if (!total) { console.log('nothing to mirror — every cover is current'); return new Response('ok') }
  console.log(`${total} cover(s) need mirroring; doing up to ${batch.length} this run`)

  let done = 0, failed = 0
  for (const id of batch) {
    try {
      const r = await mirrorStory(client, id)
      if (r.status === 'mirrored') { done++; console.log(`✓ ${r.title}${r.width && r.width < 200 ? `  ⚠ low-res ${r.width}px` : ''}`) }
    } catch (e) {
      failed++
      console.error(`✗ ${id}: ${e.message}`)
    }
  }

  const left = total - done
  console.log(`done: ${done} mirrored, ${failed} failed, ${left} still outstanding`)
  return new Response('ok')
}

// Runs at 04:10 UTC daily — a quiet hour, and offset from the top of the hour
// so it isn't competing with everything else scheduled on the hour.
export const config = { schedule: '10 4 * * *' }
