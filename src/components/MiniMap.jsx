import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { musicGlyphMarkup } from '../mediaGlyphs'
import { sizedAsset } from '../utils/images'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

export default function MiniMap({ story, omdbData, bookData }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !story?.location) return
    const loc = story.location
    const lon = loc.lon ?? loc.coordinates?.[0]
    const lat = loc.lat ?? loc.coordinates?.[1]
    if (!lon || !lat) return

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [lon, lat],
      zoom: 14,
      interactive: false,
    })

    const isVideo = (story.mediaType || '').toLowerCase() === 'video'
    const borderRadius = isVideo ? '50%' : '10px'
    const el = document.createElement('div')
    // Same image priority as the main map's pins: channel icon, then album art,
    // then our mirrored cover, a manual override, or the OMDb poster / book cover.
    const portraitImg = sizedAsset(story.coverAsset, 96) || story.coverImageUrl || omdbData?.poster || story.bookCoverUrl || bookData?.cover
    if (story.channelIcon) {
      el.style.cssText = `width:40px;height:40px;border-radius:${borderRadius};background-image:url(${story.channelIcon}?w=80&h=80&fit=fill);background-size:cover;background-position:center;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);`
    } else if (story.artworkImage || portraitImg) {
      const isPoster = !story.artworkImage
      const w = isPoster ? 30 : 40, h = isPoster ? 45 : 40, r = isPoster ? '4px' : borderRadius
      el.style.cssText = `width:${w}px;height:${h}px;border-radius:${r};background-image:url(${story.artworkImage ? story.artworkImage + "?w=96&h=96&fit=fill" : portraitImg});background-size:cover;background-position:center;border:2.5px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);`
    } else {
      el.style.cssText = `width:36px;height:36px;border-radius:${borderRadius};background:#1A1714;color:white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:sans-serif;`
      // Songs without album art get the music-note glyph rather than "MUS".
      if ((story.mediaType || '').toLowerCase() === 'music') el.innerHTML = `<span style="display:flex;opacity:0.5">${musicGlyphMarkup(18)}</span>`
      else el.textContent = (story.mediaType || '').slice(0, 3).toUpperCase()
    }

    map.on('load', () => {
      new mapboxgl.Marker(el).setLngLat([lon, lat]).addTo(map)
    })

    return () => map.remove()
  }, [story?.id, omdbData?.poster, bookData?.cover])

  if (!story?.location) return null
  return <div ref={containerRef} className="mini-map" />
}
