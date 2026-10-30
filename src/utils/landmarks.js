// Landmarks (pilot, Vienna only): places where several stories are pinned,
// grouped so they read as one place on the map and in their own section.
// Defined by hand in src/data/landmarks.json; a story belongs to a landmark
// when its pin's place name is one of that landmark's `places`. Only
// landmarks with at least MIN_STORIES stories are shown; no empty landmarks.
import data from '../data/landmarks.json'

const MIN_STORIES = 2

export function cityLandmarks(cityName, stories) {
  const defs = data[cityName]
  if (!defs || !stories?.length) return []
  return defs.map(def => {
    const members = stories.filter(s => s.location && def.places.includes(s.locationName))
    if (members.length < MIN_STORIES) return null
    const pts = members.map(s => ({ lat: s.location.lat ?? s.location.coordinates?.[1], lon: s.location.lon ?? s.location.coordinates?.[0] }))
    const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length
    const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length
    return {
      id: 'landmark-' + def.id,
      mediaType: 'landmark',
      title: def.name,
      description: def.description,
      location: { lat, lon },
      locationName: def.name,
      landmark: { ...def, members },
    }
  }).filter(Boolean).sort((a, b) => b.landmark.members.length - a.landmark.members.length)
}

// "11 stories · 5 videos, 3 podcasts, 2 books, 1 movie"
const NOUN = { video: ['video', 'videos'], podcast: ['podcast', 'podcasts'], book: ['book', 'books'], movie: ['movie', 'movies'], tv: ['TV show', 'TV shows'], music: ['song', 'songs'], audiotour: ['tour', 'tours'] }
export function landmarkSummary(lm) {
  const counts = {}
  lm.members.forEach(s => { const t = (s.mediaType || '').toLowerCase(); counts[t] = (counts[t] || 0) + 1 })
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${(NOUN[t] || [t, t + 's'])[n === 1 ? 0 : 1]}`)
  return `${lm.members.length} stories · ${parts.join(', ')}`
}
