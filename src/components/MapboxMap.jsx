import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const FLY_DURATION = 4500
const PANEL_TRANSITION = 520

export default function MapboxMap({ city, cities, stories, focusStory, onStoryPin, onStoryClick, onCityClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const markerDataRef = useRef([]) // { el, id }
  const cityMarkersRef = useRef([])
  const flyTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const citySelectedAtRef = useRef(null)
  const movListenerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [13, 50],
      zoom: 4.2,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    if (!mapRef.current || !city || !city.coordinates) return
    citySelectedAtRef.current = Date.now()
    clearTimeout(flyTimerRef.current)
    flyTimerRef.current = setTimeout(() => {
      if (!mapRef.current) return
      mapRef.current.resize()
      mapRef.current.flyTo({
        center: [city.coordinates.lon, city.coordinates.lat],
        zoom: 12,
        duration: FLY_DURATION,
        essential: true,
        easing: t => 1 - Math.pow(1 - t, 3),
      })
    }, PANEL_TRANSITION)
  }, [city && city.id])

  // Track pin position for modal anchor, dim other pins
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean up previous move listener
    if (movListenerRef.current) {
      map.off('move', movListenerRef.current)
      movListenerRef.current = null
    }

    if (!focusStory?.location) {
      onStoryPin?.(null)
      markerDataRef.current.forEach(({ el }) => { el.style.opacity = '1' })
      return
    }

    const loc = focusStory.location
    const lon = loc.lon ?? (loc.coordinates && loc.coordinates[0])
    const lat = loc.lat ?? (loc.coordinates && loc.coordinates[1])
    if (!lon || !lat) return

    // Dim other markers, highlight focused one
    markerDataRef.current.forEach(({ el, id }) => {
      el.style.opacity = id === focusStory.id ? '1' : '0.15'
    })

    const updatePos = () => {
      const p = map.project([lon, lat])
      onStoryPin?.({ x: p.x, y: p.y })
    }

    movListenerRef.current = updatePos
    map.on('move', updatePos)
    updatePos()

    map.flyTo({
      center: [lon, lat],
      zoom: 15,
      duration: 1200,
      essential: true,
      padding: { top: 340, bottom: 60, left: 60, right: 60 },
      easing: t => 1 - Math.pow(1 - t, 3),
    })
  }, [focusStory?.id])

  useEffect(() => {
    const map = mapRef.current
    cityMarkersRef.current.forEach(m => m.remove())
    cityMarkersRef.current = []
    if (!map || city || !cities?.length) return

    const addCityMarkers = () => {
      cities.forEach(c => {
        if (!c.coordinates) return
        const el = document.createElement('div')
        if (c.heroImage) {
          el.style.cssText = `width:48px;height:48px;border-radius:50%;background-image:url(${c.heroImage}?w=96&h=96&fit=fill);background-size:cover;background-position:center;border:2.5px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.3);cursor:pointer;opacity:0;transition:opacity 0.4s ease;`
        } else {
          el.style.cssText = `width:48px;height:48px;border-radius:50%;background:#153B8F;border:2.5px solid white;box-shadow:0 2px 10px rgba(0,0,0,0.3);cursor:pointer;display:flex;align-items:center;justify-content:center;color:white;font-size:15px;font-weight:700;font-family:sans-serif;opacity:0;transition:opacity 0.4s ease;`
          el.textContent = c.name.slice(0, 1)
        }
        el.addEventListener('click', () => onCityClick?.(c))
        const marker = new mapboxgl.Marker(el)
          .setLngLat([c.coordinates.lon, c.coordinates.lat])
          .addTo(map)
        cityMarkersRef.current.push(marker)
        setTimeout(() => { el.style.opacity = '1' }, 200 + Math.random() * 600)
      })
    }

    if (map.loaded()) addCityMarkers()
    else map.on('load', addCityMarkers)
  }, [cities, city])

  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    markerDataRef.current = []
    clearTimeout(revealTimerRef.current)

    if (!stories || !stories.length) return
    const map = mapRef.current

    const addMarkers = () => {
      stories.forEach(story => {
        const loc = story.location
        if (!loc) return
        const lon = loc.lon ?? (loc.coordinates && loc.coordinates[0])
        const lat = loc.lat ?? (loc.coordinates && loc.coordinates[1])
        if (!lon || !lat) return
        const isVideo = (story.mediaType || '').toLowerCase() === 'video'
        const borderRadius = isVideo ? '50%' : '10px'
        const el = document.createElement('div')
        if (story.channelIcon) {
          el.style.cssText = 'width:36px;height:36px;border-radius:' + borderRadius + ';background-image:url(' + story.channelIcon + ');background-size:cover;background-position:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;opacity:0;transition:opacity 0.35s ease;'
        } else {
          el.style.cssText = 'width:32px;height:32px;border-radius:' + borderRadius + ';background:#1A1714;color:white;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;font-family:sans-serif;opacity:0;transition:opacity 0.35s ease;'
          el.textContent = (story.mediaType || '').slice(0, 3).toUpperCase()
        }
        el.addEventListener('click', () => onStoryClick?.(story))
        const marker = new mapboxgl.Marker(el)
          .setLngLat([lon, lat])
          .addTo(map)
        markersRef.current.push(marker)
        markerDataRef.current.push({ el, id: story.id })
      })

      const animEnd = (citySelectedAtRef.current || 0) + PANEL_TRANSITION + FLY_DURATION
      const revealDelay = Math.max(0, animEnd - 500 - Date.now())
      revealTimerRef.current = setTimeout(() => {
        markerDataRef.current.forEach(({ el }) => {
          setTimeout(() => { el.style.opacity = '1' }, Math.random() * 500)
        })
      }, revealDelay)
    }

    if (map.loaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [stories])

  return <div ref={containerRef} className="mapbox-map" />
}
