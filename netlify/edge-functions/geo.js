// Approximate visitor location from Netlify's IP geolocation (city level, no
// browser permission prompt). The app uses it only to move the nearest city
// to the top of the list; nothing is stored or logged.
export default async (request, context) => {
  const g = context.geo || {}
  const body = { lat: g.latitude ?? null, lon: g.longitude ?? null, city: g.city ?? null, country: g.country?.code ?? null }
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  })
}

export const config = { path: '/api/geo' }
