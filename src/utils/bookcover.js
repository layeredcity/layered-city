// Resolve a book cover from Open Library by ISBN — no API key, no quota.
// We verify the cover actually exists by loading the image (`?default=false`
// makes Open Library 404 when it has no cover), which works cross-origin
// without CORS. Returns { cover } or null if there's no cover.

export function fetchBook(isbn) {
  if (!isbn) return Promise.resolve(null)
  const clean = String(isbn).replace(/[^0-9Xx]/g, '') // strip hyphens/spaces
  if (!clean) return Promise.resolve(null)
  const url = `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg?default=false`
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth > 1 ? { cover: url } : null)
    img.onerror = () => resolve(null)
    img.src = url
  })
}
