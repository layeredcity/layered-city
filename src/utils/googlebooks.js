// Fetch book metadata (cover, authors, description, rating) from the free
// Google Books API by ISBN. No API key needed for light client-side use.
// Mirrors utils/omdb.js — returns null when nothing usable is found.

export async function fetchBook(isbn) {
  if (!isbn) return null
  const clean = String(isbn).replace(/[^0-9Xx]/g, '') // strip hyphens/spaces
  if (!clean) return null
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}`)
    const data = await res.json()
    const info = data.items?.[0]?.volumeInfo
    if (!info) return null
    // Cover thumbnails come back as http with a curled-edge flag; clean them up.
    let cover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null
    if (cover) cover = cover.replace(/^http:/, 'https:').replace('&edge=curl', '')
    return {
      cover,
      authors: info.authors || null,
      description: info.description || null,
      rating: info.averageRating ?? null,        // 1–5, often absent
      ratingsCount: info.ratingsCount ?? null,
      title: info.title || null,
      publishedYear: info.publishedDate ? String(info.publishedDate).slice(0, 4) : null,
    }
  } catch {
    return null
  }
}
