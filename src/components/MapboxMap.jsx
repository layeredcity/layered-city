import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const SYLLABLE_BREAKS = {
  'Amsterdam':  'Amster​dam',
  'Copenhagen': 'Copen​hagen',
  'Barcelona':  'Barce​lona',
  'Edinburgh':  'Edin​burgh',
  'Budapest':   'Buda​pest',
  'Istanbul':   'Istan​bul',
  'Stockholm':  'Stock​holm',
  'Brussels':   'Brus​sels',
  'Dubrovnik':  'Du​brov​nik',
  'Ljubljana':  'Ljub​lja​na',
  'Reykjavik':  'Reyk​ja​vik',
  'Salzburg':   'Salz​burg',
  'Lisbon':     'Lis​bon',
  'Berlin':     'Ber​lin',
  'Madrid':     'Mad​rid',
}

const FLY_DURATION = 4500
const PANEL_TRANSITION = 520

export default function MapboxMap({ city, cities, allStories, stories, omdbCache, bookCache, focusStory, onStoryPin, onStoryClick, onCityClick }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const markerDataRef = useRef([]) // { el, id, imdbId, isbn }
  const omdbCacheRef = useRef(omdbCache)
  const bookCacheRef = useRef(bookCache)
  const cityMarkersRef = useRef([])
  const flyTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const citySelectedAtRef = useRef(null)
  const movListenerRef = useRef(null)
  const visibleIdsRef = useRef(new Set())
  omdbCacheRef.current = omdbCache
  bookCacheRef.current = bookCache

  useEffect(() => {
    if (!containerRef.current) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [7.75, 48.57],
      zoom: 4.2,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map
    return () => map.remove()
  }, [])

  useEffect(() => {
    clearTimeout(flyTimerRef.current)
    if (!mapRef.current) return
    if (!city || !city.coordinates) {
      flyTimerRef.current = setTimeout(() => {
        if (!mapRef.current) return
        mapRef.current.resize()
        mapRef.current.flyTo({
          center: [7.75, 48.57],
          zoom: 4.2,
          duration: 1800,
          essential: true,
          easing: t => 1 - Math.pow(1 - t, 3),
        })
      }, PANEL_TRANSITION)
      return
    }
    citySelectedAtRef.current = Date.now()
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
  }, [city?.id])

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
      markerDataRef.current.forEach(({ el, id }) => {
        el.style.opacity = !visibleIdsRef.current.size || visibleIdsRef.current.has(id) ? '1' : '0'
      })
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

        // Wrapper: Mapbox sets transform here for positioning
        const wrapper = document.createElement('div')
        wrapper.style.cssText = 'width:48px;height:48px;'

        // Inner: we control visuals + hover transitions here
        const inner = document.createElement('div')
        inner.className = 'city-marker'
        if (c.heroImage) inner.style.backgroundImage = `url(${c.heroImage}?w=96&h=96&fit=fill)`
        else inner.style.backgroundColor = '#153B8F'

        const overlay = document.createElement('div')
        overlay.className = 'city-marker__overlay'
        const nameEl = document.createElement('span')
        nameEl.className = 'city-marker__name'
        nameEl.textContent = SYLLABLE_BREAKS[c.name] || c.name
        overlay.appendChild(nameEl)
        inner.appendChild(overlay)
        wrapper.appendChild(inner)
        wrapper.addEventListener('click', () => onCityClick?.(c))

        const marker = new mapboxgl.Marker(wrapper)
          .setLngLat([c.coordinates.lon, c.coordinates.lat])
          .addTo(map)
        cityMarkersRef.current.push(marker)
        setTimeout(() => { inner.style.opacity = '1' }, 200 + Math.random() * 600)
      })
    }

    if (map.loaded()) addCityMarkers()
    else map.on('load', addCityMarkers)
  }, [cities, city])

  // Create/destroy markers when the full story set changes (city switch)
  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    markerDataRef.current = []
    clearTimeout(revealTimerRef.current)

    if (!allStories || !allStories.length) return
    const map = mapRef.current

    const addMarkers = () => {
      allStories.forEach(story => {
        const loc = story.location
        if (!loc) return
        const lon = loc.lon ?? (loc.coordinates && loc.coordinates[0])
        const lat = loc.lat ?? (loc.coordinates && loc.coordinates[1])
        if (!lon || !lat) return
        const isVideo = (story.mediaType || '').toLowerCase() === 'video'
        const borderRadius = isVideo ? '50%' : '10px'
        const el = document.createElement('div')
        const cachedPoster = story.imdbId ? omdbCacheRef.current?.[story.imdbId]?.poster : null
        const cachedCover = story.bookCoverUrl || (story.isbn ? bookCacheRef.current?.[story.isbn]?.cover : null)
        const portraitImg = cachedPoster || cachedCover
        const imgSrc = story.channelIcon || story.artworkImage || portraitImg
        if (imgSrc) {
          const isPoster = portraitImg && !story.channelIcon && !story.artworkImage
          const pinW = isPoster ? '28px' : '36px'
          const pinH = isPoster ? '42px' : '36px'
          const pinR = isPoster ? '4px' : borderRadius
          el.style.cssText = 'width:' + pinW + ';height:' + pinH + ';border-radius:' + pinR + ';background-image:url(' + imgSrc + ');background-size:cover;background-position:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;opacity:0;transition:opacity 0.35s ease;'
        } else {
          const t = (story.mediaType || '').toLowerCase()
          // Book/movie/TV pins are portrait (2:3) when they have art; match that
          // for their text placeholders too, and spell out BOOK rather than "BOO".
          const isPortraitType = t === 'book' || t === 'movie' || t === 'tv'
          const boxW = isPortraitType ? '28px' : '32px'
          const boxH = isPortraitType ? '42px' : '32px'
          const boxR = isPortraitType ? '4px' : borderRadius
          const fontSize = isPortraitType ? '8px' : '10px'
          el.style.cssText = 'width:' + boxW + ';height:' + boxH + ';border-radius:' + boxR + ';background:#1A1714;color:white;display:flex;align-items:center;justify-content:center;font-size:' + fontSize + ';font-weight:700;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;font-family:sans-serif;opacity:0;transition:opacity 0.35s ease;'
          el.textContent = t === 'book' ? 'BOOK' : (story.mediaType || '').slice(0, 3).toUpperCase()
        }
        el.addEventListener('click', () => onStoryClick?.(story))
        // Wrap the visual element so Mapbox positions the wrapper and only ever
        // touches the wrapper's opacity (for globe/terrain occlusion). We animate
        // the inner element's opacity for filter show/hide — otherwise Mapbox
        // rewrites el.style.opacity on every move/zoom and un-hides filtered pins.
        const wrapper = document.createElement('div')
        wrapper.style.cssText = 'display:inline-block;line-height:0;'
        wrapper.appendChild(el)
        const marker = new mapboxgl.Marker(wrapper)
          .setLngLat([lon, lat])
          .addTo(map)
        markersRef.current.push(marker)
        markerDataRef.current.push({ el, id: story.id, imdbId: story.imdbId || null, isbn: story.isbn || null })
      })

      const animEnd = (citySelectedAtRef.current || 0) + PANEL_TRANSITION + FLY_DURATION
      const revealDelay = Math.max(0, animEnd - 500 - Date.now())
      revealTimerRef.current = setTimeout(() => {
        markerDataRef.current.forEach(({ el, id }) => {
          setTimeout(() => {
            el.style.opacity = !visibleIdsRef.current.size || visibleIdsRef.current.has(id) ? '1' : '0'
          }, Math.random() * 500)
        })
      }, revealDelay)
    }

    if (map.loaded()) addMarkers()
    else map.on('load', addMarkers)
  }, [allStories])

  // Update marker visibility when filtered set changes — no recreate, just fade
  useEffect(() => {
    visibleIdsRef.current = new Set((stories || []).map(s => s.id))
    markerDataRef.current.forEach(({ el, id }) => {
      el.style.opacity = !visibleIdsRef.current.size || visibleIdsRef.current.has(id) ? '1' : '0'
    })
  }, [stories])

  useEffect(() => {
    if (!omdbCache) return
    markerDataRef.current.forEach(({ el, imdbId }) => {
      if (!imdbId) return
      const omdb = omdbCache[imdbId]
      if (!omdb?.poster) return
      el.style.backgroundImage = `url(${omdb.poster})`
      el.style.backgroundSize = 'cover'
      el.style.backgroundPosition = 'center'
      el.style.width = '28px'
      el.style.height = '42px'
      el.style.borderRadius = '4px'
      el.textContent = ''
    })
  }, [omdbCache])

  useEffect(() => {
    if (!bookCache) return
    markerDataRef.current.forEach(({ el, isbn }) => {
      if (!isbn) return
      const book = bookCache[isbn]
      if (!book?.cover) return
      el.style.backgroundImage = `url(${book.cover})`
      el.style.backgroundSize = 'cover'
      el.style.backgroundPosition = 'center'
      el.style.width = '28px'
      el.style.height = '42px'
      el.style.borderRadius = '4px'
      el.textContent = ''
    })
  }, [bookCache])

  return <div ref={containerRef} className="mapbox-map" />
}
