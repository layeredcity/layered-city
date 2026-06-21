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
  }))
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
      mediaType: f.mediaType || channel?.mediaType || null,
      imdbId: f.imdbId || null,
      releaseYear: f.releaseYear || null,
      season: f.seasonNumber || null,
      episode: f.episodeNumber || null,
      categories: (f.categories || []).map(c => c.fields?.name || c.fields?.categoryName || ''),
    }
  })
}
