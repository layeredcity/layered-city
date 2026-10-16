// Covers, album art and channel icons copied into this repo by
// scripts/sync-covers.mjs (nightly GitHub Action). Preferred over Contentful:
// they don't count against the Contentful record limit or its bandwidth, and
// they keep working if a source site goes away. Anything published since the
// last sync isn't in the map yet and falls back to Contentful or its source.
import map from '../data/covers.json'
import foodMap from '../data/food-images.json'
import { slugify } from './slugify'
import wordAudioMap from '../data/word-audio.json'
import foodAudioMap from '../data/food-audio.json'

export function repoImage(kind, id) {
  const hash = id && map[kind]?.[id]
  return hash ? `/covers/${kind}/${id}-${hash}.webp` : null
}

// Dish images live in the repo too (scripts/add-food-images.mjs), matched by
// city and dish name rather than Contentful ID so they can be added without
// touching Contentful at all.

export function repoFoodImage(cityName, foodName) {
  const city = slugify(cityName), dish = slugify(foodName)
  const hash = foodMap[city]?.[dish]
  return hash ? `/food/${city}/${dish}-${hash}.webp` : null
}

// Words audio generated with ElevenLabs (scripts/generate-word-audio.mjs): the
// phrase at normal speed, a pause, then slowly. Preferred over Contentful audio.
export function repoWordAudio(wordId) {
  const v = wordAudioMap[wordId]
  if (!v) return null
  const [city, hash] = v.split('/')
  return `/words-audio/${city}/${wordId}-${hash}.mp3`
}

// Local dish names spoken in the city's voice (same generator, kind "food").
export function repoFoodAudio(foodId) {
  const v = foodAudioMap[foodId]
  if (!v) return null
  const [city, hash] = v.split('/')
  return `/food-audio/${city}/${foodId}-${hash}.mp3`
}
