import { createClient } from 'contentful'
import { smartenEntries } from './smartQuotes'
import { repoImage, repoFoodImage, repoWordAudio, repoFoodAudio } from './covers'

const rawClient = createClient({
  space: import.meta.env.VITE_CONTENTFUL_SPACE,
  accessToken: import.meta.env.VITE_CONTENTFUL_TOKEN,
})

// Every response gets typographic quotes and apostrophes (utils/smartQuotes.js).
const client = {
  getEntries: async query => smartenEntries(await rawClient.getEntries(query)),
}

export async function fetchCities() {
  const res = await client.getEntries({
    content_type: 'city',
    order: 'fields.cityName',
    limit: 200,
  })
  return res.items.map(item => ({
    id: item.sys.id,
    name: item.fields.cityName,
    country: item.fields.countryName,
    continent: item.fields.continent,
    isFeatured: item.fields.isFeatured,
    coordinates: item.fields.cityCoordinates,
    heroImage: item.fields.cityHeroImage?.fields?.file?.url
      ? 'https:' + item.fields.cityHeroImage.fields.file.url
      : null,
    quote: item.fields.cityQuote,
    quoteAttribution: item.fields.cityQuoteAttribution,
    mapHeight: item.fields.cityMapHeight,
    latLngDelta: item.fields.latitudeLongitudeDelta,
    musicPlaylistSpotify: item.fields.musicPlaylistSpotify || null,
    wordsPreamble: item.fields.wordsPreamble || null,
    wordsVariant: item.fields.wordsVariant || 'standard',
    wordsPublished: item.fields.wordsPublished || false,
  }))
}

// The Words tier: a per-city phrasebook of `word` entries. Category, label, and
// order are derived in the app (see utils/words.js); this just returns the flat
// list of published words for a city.
export async function fetchWordsForCity(cityId) {
  const res = await client.getEntries({
    content_type: 'word',
    'fields.city.sys.id': cityId,
    limit: 200,
  })
  return res.items.map(item => {
    const f = item.fields
    return {
      id: item.sys.id,
      slot: f.slot,
      local: f.local,
      phonetic: f.phonetic || null,
      meaning: f.meaning || null,
      context: f.context || null,
      groupNote: f.groupNote || null,
      phoneticApproximate: f.phoneticApproximate || false,
      deepCutOrder: f.deepCutOrder ?? null,
      audioUrl: repoWordAudio(item.sys.id)
        || (f.audio?.fields?.file?.url ? 'https:' + f.audio.fields.file.url : null),
    }
  })
}

// Dishes worth eating in a city. Unlike stories, food carries no location — a
// dish outlives the restaurants that serve it — so these never reach the map.
// Ordered by the curated listOrder, with any unordered dish falling to the end.
export async function fetchFoodsForCity(cityId, cityName) {
  const res = await client.getEntries({
    content_type: 'food',
    'fields.relatedCity.sys.id': cityId,
    limit: 200,
  })
  return res.items
    .map(item => {
      const f = item.fields
      return {
        id: item.sys.id,
        name: f.foodName,
        englishName: f.foodEnglishName || null,
        description: f.foodDescription,
        listOrder: f.listOrder ?? null,
        audioUrl: repoFoodAudio(item.sys.id),
        // Repo copy first (utils/covers.js); Contentful image as the fallback.
        image: repoFoodImage(cityName, f.foodName)
          || (f.foodImage?.fields?.file?.url ? 'https:' + f.foodImage.fields.file.url : null),
      }
    })
    // Sorted here rather than by the API: Contentful orders by Unicode
    // codepoint, which would put "Pastel" ahead of "Pastéis".
    .sort((a, b) => {
      if (a.listOrder == null && b.listOrder == null) return (a.name || '').localeCompare(b.name || '', 'pt')
      if (a.listOrder == null) return 1
      if (b.listOrder == null) return -1
      return a.listOrder - b.listOrder
    })
}

export async function fetchStoriesForCity(cityId) {
  // Paged: London is past 500 stories, the most one request can return
  // with linked entries included.
  const items = []
  for (let skip = 0; ; ) {
    const res = await client.getEntries({
      content_type: 'story',
      'fields.relatedCity.sys.id': cityId,
      limit: 400,
      skip,
      include: 2,
    })
    items.push(...res.items)
    skip += res.items.length
    if (!res.items.length || skip >= res.total) break
  }
  return items.map(mapStory)
  // TV is switched off for now (Ryan, Nov 2026): shows stay in Contentful
  // but don't appear anywhere in the app. Remove 'tv' here to bring them back.
    .filter(s => !HIDDEN_TYPES.includes((s.mediaType || '').toLowerCase()))
}

// Specific stories by ID, in the order given (for cross-city threads).
export async function fetchStoriesByIds(ids) {
  const items = []
  for (let i = 0; i < ids.length; i += 100) {
    const res = await client.getEntries({ content_type: 'story', 'sys.id[in]': ids.slice(i, i + 100).join(','), limit: 100, include: 2 })
    items.push(...res.items)
  }
  const byId = Object.fromEntries(items.map(it => [it.sys.id, mapStory(it)]))
  return ids.map(id => byId[id]).filter(Boolean)
}

const UNRATED_TYPES = ['podcast', 'video']

function mapStory(item) {
    const f = item.fields
    const channel = f.channel?.fields
    return {
      id: item.sys.id,
      title: f.storyTitle,
      description: f.storyDescription,
      // Podcast and video ratings are hidden until more of them are rated
      // (Ryan, Nov 2026); remove the type check to show them again.
      qualityRating: UNRATED_TYPES.includes((f.mediaType || channel?.mediaType || '').toLowerCase()) ? null : f.qualityRating,
      location: f.storyLocation,
      locationName: f.locationName || null,
      secondaryLocation: f.secondaryLocation,
      mediaUrl: f.mediaUrl,
      secondaryUrl: f.secondaryUrl,
      minutes: f.numberOfMinutes,
      seconds: f.numberOfSeconds,
      publishDate: f.originalPublishDate,
      channelName: channel?.channelName || null,
      creatorName: f.creatorName || null,
      channelIcon: repoImage('channel', f.channel?.sys?.id)
        || (channel?.channelIcon?.fields?.file?.url ? 'https:' + channel.channelIcon.fields.file.url : null),
      // Album art. About half the songs store it as an uploaded asset and the
      // rest as a pasted coverImageUrl; both must show as square album art,
      // not as a book-style portrait cover.
      artworkImage: repoImage('artwork', item.sys.id)
        || (f.artworkImage?.fields?.file?.url ? 'https:' + f.artworkImage.fields.file.url : null)
        || (((f.mediaType || channel?.mediaType || '').toLowerCase() === 'music')
          ? (repoImage('story', item.sys.id) || f.coverImageUrl || null) : null),
      mediaType: f.mediaType || channel?.mediaType || null,
      genre: f.genre || null,
      imdbId: f.imdbId || null,
      isbn: f.isbnNumber || null,
      bookCoverUrl: f.bookCoverUrl || null,
      coverImageUrl: f.coverImageUrl || null,
      // Our own copy of the cover, so a book's art doesn't depend on Open
      // Library being reachable at page load: the repo copy first (see
      // utils/covers.js), then an older Contentful-hosted mirror. Null means
      // the app falls back to coverImageUrl / bookCoverUrl.
      coverAsset: repoImage('story', item.sys.id)
        || (f.coverAsset?.fields?.file?.url ? 'https:' + f.coverAsset.fields.file.url : null),
      goodreadsRating: f.goodreadsRating ?? null,
      // Audio-tour fields (VoiceMap): a 0–5 star rating with its review count,
      // the price, and the walking distance in km (miles derived in the UI).
      rating: f.rating ?? null,
      numberOfRatings: f.numberOfRatings ?? null,
      priceUsd: f.priceUsd ?? null,
      distanceKm: f.distanceKm ?? null,
      releaseYear: f.releaseYear || null,
      season: f.seasonNumber || null,
      episode: f.episodeNumber || null,
      categories: (f.categories || []).map(c => c.fields?.name || c.fields?.categoryName || ''),
    }
}
const HIDDEN_TYPES = ['tv']
