import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

mapboxgl.accessToken = 'pk.eyJ1IjoibGF5ZXJlZGNpdHkiLCJhIjoiY2tienE5cjZ4MGh2ZTJ4cXF4Z2I4OXRjYyJ9.ftQfTdSQGilagh7Ic-26zw'

export default function MapboxMap({ city, stories }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    if (!containerRef.current) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: city ? [city.coordinates?.lon ?? 0, city.coordinates?.lat ?? 0] : [10, 48],
      zoom: city ? 11 : 4,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    if (!mapRef.current || !city?.coordinates) return
    mapRef.current.flyTo({
      center: [city.coordinates.lon, city.coordinates.lat],
      zoom: 12,
      duration: 1200,
      essential: true,
    })
  }, [city?.id])

  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    if (!stories?.length) return

    const map = mapRef.current

    const addMarkers = () => {
      stories.forEach(story => {
        const loc = story.location
        if (!loc) return
        const lon = loc.lon ?? loc.coordinates?.[0]
        const lat = loc.lat ?? loc.coordinates?.[1]
        if (!lon || !lat) return

        const el = document.createElement('div')
        if (story.channelIcon) {
          el.style.cssText = `width:36px;height:36px;border-radius:50%;background-image:url(${story.channelIcon});background-size:cover;background-position:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;`
        } else {
          el.style.cssText = `width:32px;height:32px;border-radius:50%;background:#1A1714;color:white;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;`
          el.textContent = mediaTypeEmoji(story.mediaType)
        }

        const popup = new mapboxgl.Popup({ offset: 20, maxWidth: '220px' })
          .setHTML(`<div style="font-family:'DM Sans',sans-serif;padding:4px 0;"><div style="font-size:13px;font-weight:500;color:#1A1714;line-height:1.3;margin-bottom:4px;">${story.title}</div><div style="font-size:11px;color:#C8412A;text-transform:uppercase;letter-spacing:0.06em;">${story.mediaType || ''} · ${story.channelName || ''}</div></div>`)

        const marker = new mapboxgl.Marker(el)
          .setLngLat([lon, lat])
          .setPopup(popup)
          .addTo(map)

        el.addEventListener('click', () => {
          if (story.mediaUrl) window.open(story.mediaUrl, '_blank')
        })

        markersRef.current.push(marker)
      })
    }

    if (map.loaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [stories])

  return <div ref={containerRef} className="mapbox-map" />
}

function mediaTypeEmoji(type) {
  if (!type) return '📍'
  const t = type.toLowerCase()
  if (t.includes('podcast')) return '🎙'
  if (t.includes('video')) return '▶'
  if (t.includes('book')) return '📖'
  if (t.includes('audio')) return '🎧'
  if (t.includes('movie') || t.includes('film')) return '🎬'
  return '📍'
}
