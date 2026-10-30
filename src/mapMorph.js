// List ⇄ map "morph" on phones: the thumbnails you can see in the list fly to
// their own pins on the map (and back), so it reads as the same content
// changing shape rather than one screen replacing another. From the city
// overview, where there are no thumbnails, the map grows as a circle out of
// the Map button instead.

const EASE = 'cubic-bezier(.2,.8,.2,1)'
const FLY_MS = 620
const STAGGER_MS = 28
const MAX_ITEMS = 14
const PIN = 36

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Thumbnails currently on screen in the open list: [{ id, el, rect }].
export function visibleListIcons() {
  const seen = new Set()
  const out = []
  for (const row of document.querySelectorAll('.stories-scroll [data-morph-id]')) {
    const id = row.getAttribute('data-morph-id')
    if (seen.has(id)) continue
    const el = row.firstElementChild
    if (!el) continue
    const rect = el.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight || !rect.width) continue
    seen.add(id)
    out.push({ id, el, rect })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function pinRect(map, story) {
  const loc = story?.location
  const lon = loc?.lon ?? loc?.coordinates?.[0]
  const lat = loc?.lat ?? loc?.coordinates?.[1]
  if (lon == null || lat == null || !map) return null
  const p = map.project([lon, lat])
  const box = map.getContainer().getBoundingClientRect()
  const x = box.left + p.x, y = box.top + p.y
  if (x < -PIN || y < -PIN || x > window.innerWidth + PIN || y > window.innerHeight + PIN) return null
  return { left: x - PIN / 2, top: y - PIN / 2, width: PIN, height: PIN }
}

// Fly a copy of each element from one rect to another, with a small lift in
// the middle of the path. Resolves when the last one lands.
function fly(pairs) {
  return Promise.all(pairs.map(({ el, from, to, toOpacity = 1 }, i) => {
    const clone = el.cloneNode(true)
    clone.removeAttribute('id')
    Object.assign(clone.style, {
      position: 'fixed', left: from.left + 'px', top: from.top + 'px',
      width: from.width + 'px', height: from.height + 'px', margin: '0',
      zIndex: '70', pointerEvents: 'none', transformOrigin: '50% 50%',
      boxSizing: 'border-box',
    })
    document.body.appendChild(clone)
    const dx = (to.left + to.width / 2) - (from.left + from.width / 2)
    const dy = (to.top + to.height / 2) - (from.top + from.height / 2)
    const s = Math.min(to.width / from.width, to.height / from.height)
    const lift = -Math.min(60, 20 + Math.abs(dx) * 0.15)
    const anim = clone.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + lift}px) scale(${(1 + s) / 2})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: toOpacity },
    ], { duration: FLY_MS, delay: i * STAGGER_MS, easing: EASE, fill: 'forwards' })
    return anim.finished.catch(() => {}).then(() =>
      clone.animate([{ opacity: toOpacity }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.catch(() => {})
    ).then(() => clone.remove())
  }))
}

function circle(layer, origin, open) {
  const cx = origin.left + origin.width / 2, cy = origin.top + origin.height / 2
  const small = `circle(28px at ${cx}px ${cy}px)`, big = `circle(150vmax at ${cx}px ${cy}px)`
  return layer.animate(
    [{ clipPath: open ? small : big }, { clipPath: open ? big : small }],
    { duration: open ? 560 : 460, easing: open ? EASE : 'cubic-bezier(.6,0,.8,.2)', fill: 'forwards' }
  ).finished.catch(() => {})
}

// List → map. `items` were measured before the map was shown.
export function morphToMap({ items, storyById, map, layer, origin }) {
  if (!layer || reducedMotion()) return Promise.resolve()
  const pairs = items.map(it => ({ el: it.el, from: it.rect, to: pinRect(map, storyById[it.id]) })).filter(p => p.to)
  if (!pairs.length) return circle(layer, origin, true).then(() => layer.getAnimations().forEach(a => a.cancel()))
  layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' })
  return fly(pairs)
}

// Map → list. Call before hiding the map; resolves when it can be hidden.
export function morphToList({ storyById, map, layer, origin }) {
  if (!layer || reducedMotion()) return Promise.resolve()
  const items = visibleListIcons()
  const pairs = items.map(it => {
    const from = pinRect(map, storyById[it.id])
    return from && { el: it.el, from, to: it.rect }
  }).filter(Boolean)
  if (!pairs.length) return circle(layer, origin, false)
  const fade = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, delay: 80, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})
  // The list sits under the map; flying copies start pin-sized, so let them
  // grow from the pin back into the row.
  return Promise.all([fade, fly(pairs)])
}
