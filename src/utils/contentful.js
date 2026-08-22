import { createClient } from 'contentful'

const client = createClient({
  space: import.meta.env.VITE_CONTENTFUL_SPACE,
  accessToken: import.meta.env.VITE_CONTENTFUL_TOKEN,
})

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
  }))
}

// Dishes worth eating in a city. Unlike stories, food carries no location — a
// dish outlives the restaurants that serve it — so these never reach the map.
// Ordered by the curated listOrder, with any unordered dish falling to the end.
export async function fetchFoodsForCity(cityId) {
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
        description: f.foodDescription,
        neighborhood: f.foodNeighborhood || null,
        listOrder: f.listOrder ?? null,
        image: f.foodImage?.fields?.file?.url
          ? 'https:' + f.foodImage.fields.file.url
          : null,
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
  const res = await client.getEntries({
    content_type: 'story',
    'fields.relatedCity.sys.id': cityId,
    limit: 500,
    include: 2,
  })
  return res.items.map(item => {
    const f = item.fields
    const channel = f.channel?.fields
    return {
      id: item.sys.id,
      title: f.storyTitle,
      description: f.storyDescription,
      qualityRating: f.qualityRating,
      location: f.storyLocation,
      secondaryLocation: f.secondaryLocation,
      mediaUrl: f.mediaUrl,
      secondaryUrl: f.secondaryUrl,
      minutes: f.numberOfMinutes,
      seconds: f.numberOfSeconds,
      publishDate: f.originalPublishDate,
      channelName: channel?.channelName || null,
      creatorName: f.creatorName || null,
      channelIcon: channel?.channelIcon?.fields?.file?.url
        ? 'https:' + channel.channelIcon.fields.file.url
        : null,
      artworkImage: f.artworkImage?.fields?.file?.url
        ? 'https:' + f.artworkImage.fields.file.url
        : null,
      mediaType: f.mediaType || channel?.mediaType || null,
      genre: f.genre || null,
      imdbId: f.imdbId || null,
      isbn: f.isbnNumber || null,
      bookCoverUrl: f.bookCoverUrl || null,
      coverImageUrl: f.coverImageUrl || null,
      // A copy of the cover hosted on Contentful (npm run mirror:covers), so a
      // book's art doesn't depend on Open Library being reachable at page load.
      // Falls back to bookCoverUrl when a book hasn't been mirrored yet.
      coverAsset: f.coverAsset?.fields?.file?.url
        ? 'https:' + f.coverAsset.fields.file.url
        : null,
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
  })
}
