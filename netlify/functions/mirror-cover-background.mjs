// Contentful webhook target: mirrors a story's cover image the moment it's
// published, so nobody has to remember to run a script after editing a URL.
//
// It's a *background* function (the "-background" suffix is what makes Netlify
// treat it as one). Netlify returns 202 to Contentful immediately and lets this
// run for up to 15 minutes, which matters because Contentful's asset processing
// takes a few seconds and a normal function would time out first.
//
// Loop safety: linking the mirror edits the entry, which fires this webhook
// again. That second run finds the mirror already matches the source URL and
// stops. One extra no-op invocation, no loop.

import { makeClient, mirrorStory } from '../../shared/mirror-core.mjs'

export default async (req) => {
  const secret = process.env.COVER_WEBHOOK_SECRET
  if (secret && req.headers.get('x-webhook-secret') !== secret) {
    console.log('rejected: bad or missing x-webhook-secret')
    return new Response('forbidden', { status: 403 })
  }

  // Reuses the space id the site already has. The token is deliberately NOT
  // VITE_-prefixed: Vite inlines VITE_* vars into the browser bundle, so a
  // write-capable management token under that name would be handed to every
  // visitor. VITE_CONTENTFUL_TOKEN is a read-only delivery token and is fine
  // there; this one must never be.
  const space = process.env.VITE_CONTENTFUL_SPACE || process.env.CONTENTFUL_SPACE_ID
  const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN
  if (!space || !token) {
    console.error('missing VITE_CONTENTFUL_SPACE or CONTENTFUL_MANAGEMENT_TOKEN')
    return new Response('not configured', { status: 500 })
  }

  let payload
  try { payload = await req.json() } catch { return new Response('bad json', { status: 400 }) }

  const entryId = payload?.sys?.id
  if (!entryId) return new Response('no entry id', { status: 400 })

  try {
    const client = makeClient({ space, token })
    const result = await mirrorStory(client, entryId)
    console.log(`${entryId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}${result.title ? ` — ${result.title}` : ''}${result.pruned ? ' [pruned old asset]' : ''}`)
    return new Response(JSON.stringify(result), { status: 200 })
  } catch (e) {
    // Log and return 200: Contentful retries on failure, and a retry storm on a
    // permanently broken source URL helps nobody. The nightly sweep will pick
    // this up again anyway.
    console.error(`${entryId}: failed — ${e.message}`)
    return new Response(JSON.stringify({ status: 'failed', error: e.message }), { status: 200 })
  }
}
