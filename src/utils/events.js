// Events pilot: a weekly-refreshed "what's on" list per city, kept in
// src/data/events.json (written by the scheduled Events refresh, not Contentful).
// Dates are plain YYYY-MM-DD in the city's local time; anything that has ended
// before today drops off on its own between refreshes.
import data from '../data/events.json'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => iso(new Date())
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
const span = e => (parse(e.end || e.start) - parse(e.start)) / 86400000

// A run of three days or more (an exhibition, a festival, a market) that has
// already started reads as "on now" rather than as a dated event.
const isOngoing = (e, t) => e.end && span(e) >= 3 && e.start <= t

export function upcomingEvents(cityName) {
  const city = data[cityName]
  if (!city) return []
  const t = today()
  return (city.events || []).filter(e => (e.end || e.start) >= t)
}

export function eventsUpdated(cityName) {
  const u = data[cityName]?.updated
  if (!u) return null
  const d = parse(u)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function groupEvents(events) {
  const t = today()
  const groups = []
  const ongoing = events.filter(e => isOngoing(e, t)).sort((a, b) => a.end.localeCompare(b.end))
  if (ongoing.length) groups.push({ key: 'ongoing', label: 'On now', events: ongoing })
  const byDay = {}
  for (const e of events) if (!isOngoing(e, t)) (byDay[e.start] ||= []).push(e)
  for (const day of Object.keys(byDay).sort()) {
    const d = parse(day)
    const label = day === t ? 'Today'
      : day === addDays(t, 1) ? 'Tomorrow'
      : `${LONG_DAYS[d.getDay()]} ${d.getDate()} ${LONG_MONTHS[d.getMonth()]}`
    groups.push({ key: day, label, events: byDay[day].sort((a, b) => (a.time || '').localeCompare(b.time || '')) })
  }
  return groups
}

export function eventDateBadge(e) {
  const t = today()
  if (isOngoing(e, t)) {
    const d = parse(e.end)
    return { top: 'Until', main: d.getDate(), bottom: MONTHS[d.getMonth()], range: true }
  }
  const d = parse(e.start)
  if (e.end && e.end !== e.start) {
    const end = parse(e.end)
    return { top: DAYS[d.getDay()], main: d.getDate(), bottom: `${MONTHS[d.getMonth()]}–${end.getDate()} ${MONTHS[end.getMonth()]}`, range: true }
  }
  return { top: DAYS[d.getDay()], main: d.getDate(), bottom: MONTHS[d.getMonth()] }
}

// The calendar line next to the date box: extra date info (other dates, last
// chance, premiere), or for a run with nothing extra, its full span. A single
// date with nothing extra needs no line; the box already says it.
export function eventDateText(e) {
  if (e.dateNote) return e.dateNote
  const fmt = s => { const d = parse(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
  if (e.end && e.end !== e.start) return `${fmt(e.start)} – ${fmt(e.end)}`
  return null
}

// Events as story-shaped objects, so the map pins, the desktop pop-up and the
// mobile detail panel can treat them like any other item. The full event rides
// along on `event`. An event with no single venue ("Various venues") gets no
// location and so no pin, but still opens from the list.
export function eventStories(cityName) {
  return upcomingEvents(cityName).map(e => ({
    id: 'event-' + e.id,
    mediaType: 'event',
    title: e.titleEnglish || e.title,
    description: e.description,
    location: e.lat && e.lon ? { lat: e.lat, lon: e.lon } : null,
    locationName: e.venue + (e.venueNote ? `, ${e.venueNote}` : ''),
    event: e,
  }))
}

// Secondary navigation inside Events: a handful of plain groups a traveller
// would think in, built from the finer `category` on each event. Opera counts
// as music (that's how most visitors think of it); ballet and dance as stage.
export const EVENT_GROUPS = [
  { label: 'Music', categories: ['Opera', 'Classical', 'Jazz', 'Concert'] },
  { label: 'Art', categories: ['Exhibition', 'Design'] },
  { label: 'Stage', categories: ['Theatre', 'Ballet', 'Dance'] },
  { label: 'Film', categories: ['Film'] },
  { label: 'Around town', categories: ['Festival', 'Market', 'Tradition', 'Food & drink', 'Talk', 'Sport', 'Free'] },
]
export function eventGroupOf(e) {
  if (e.group && EVENT_GROUPS.some(g => g.label === e.group)) return e.group
  return (EVENT_GROUPS.find(g => g.categories.includes(e.category)) || EVENT_GROUPS[EVENT_GROUPS.length - 1]).label
}
