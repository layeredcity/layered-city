// Contentful-hosted images are resized and re-encoded on the fly, so we only
// ever pull down roughly what we display — a mirrored book cover is ~48 KB at
// full size but ~9 KB at w=180 and ~3 KB at w=96. That matters: asset bandwidth
// is the metered resource on our Contentful plan, and it stops serving rather
// than billing once it's spent.
//
// Remote URLs (Open Library, OMDb) are returned untouched — these params would
// be meaningless to them.
export function sizedAsset(url, width) {
  if (!url || !url.includes('images.ctfassets.net')) return url
  return `${url}?w=${width}&fm=webp&q=80`
}
