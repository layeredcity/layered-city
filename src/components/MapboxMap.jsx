import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import { placeholderGlyphMarkup } from '../mediaGlyphs'
import { sizedAsset } from '../utils/images'

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
  'Bucharest':  'Bucha​rest',
  'Marseille':  'Mar​seille',
  'Liverpool':  'Liver​pool',
  'Manchester': 'Man​chester',
  'Reykjavík':  'Reyk​ja​vík',
}

const FLY_DURATION = 4500
const ROUTE_COLOR = '#C8412A'

// Every place a thread stops, in order. Chapters that span several cities list
// them in `points`; the rest are one stop at the chapter's own coordinates.
const threadStops = t => t.chapters.flatMap((c, i) =>
  (c.points?.length ? c.points : [{ lat: c.lat, lon: c.lon }]).map(p => ({ n: i + 1, lat: p.lat, lon: p.lon, line: !c.points?.length })))
const PANEL_TRANSITION = 520

// Landmark pin glyphs (same shapes as LANDMARK_ICONS in App.jsx, as strings
// because markers are plain DOM).
const LP = d => '<svg viewBox="0 0 24 24" fill="currentColor"><path d="' + d + '"/></svg>'
const LANDMARK_PIN_SVGS = {
  museum: LP('M12 1.5 1.5 7v2.5h21V7L12 1.5ZM3.5 11h3v7.5h-3V11Zm5 0h3v7.5h-3V11Zm4.99 0h3v7.5h-3V11Zm5.01 0h3v7.5h-3V11ZM1.5 20h21v2.5h-21V20Z'),
  church: LP('M11 1h2v2.5h2v2h-2v2.4l5 3.6V23h-4.5v-5a1.5 1.5 0 0 0-3 0v5H6V11.5l5-3.6V5.5H9v-2h2V1Z'),
  palace: LP('M12 2 9 5.5V8h6V5.5L12 2ZM1 9.5h4V7l2 1.5V10h10V8.5L19 7v2.5h4V23h-8.5v-5a2.5 2.5 0 0 0-5 0v5H1V9.5Zm3.5 4v3h2v-3h-2Zm15 0h-2v3h2v-3Z'),
  music: LP('M20 2v13.5a3.5 3.5 0 1 1-2-3.16V6.3l-9 2v9.2a3.5 3.5 0 1 1-2-3.16V4.7L20 2Z'),
  cafe: LP('M3 8h14v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V8Zm14 1h1.5a3.5 3.5 0 0 1 0 7H17v-2h1.5a1.5 1.5 0 0 0 0-3H17V9ZM2 21.5h16V23H2v-1.5Z'),
  cemetery: LP('M12 2a7 7 0 0 1 7 7v11H5V9a7 7 0 0 1 7-7Zm-1 4v2.5H8.5v2H11V16h2v-5.5h2.5v-2H13V6h-2ZM3 21.5h18V23H3v-1.5Z'),
  building: LP('M2 5h20v18h-7v-5h-6v5H2V5Zm3 3v2.5h2.5V8H5Zm5.75 0v2.5h2.5V8h-2.5ZM16.5 8v2.5H19V8h-2.5ZM5 13v2.5h2.5V13H5Zm11.5 0v2.5H19V13h-2.5ZM10.75 13v2.5h2.5V13h-2.5ZM1 1.5h22V4H1V1.5Z'),
  landmark: LP('M12 1a8 8 0 0 1 8 8c0 5.5-6.2 12.4-7.3 13.6a1 1 0 0 1-1.4 0C10.2 21.4 4 14.5 4 9a8 8 0 0 1 8-8Zm0 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z'),
}

export default function MapboxMap({ city, cities, allStories, stories, omdbCache, bookCache, focusStory, onStoryPin, onStoryClick, onCityClick, shownKey, onReady, threadPreview, threadMode, threadCounts, threadCity, onThreadCityHover, onThreadCityClick, aboutPhotos }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const markerDataRef = useRef([]) // { el, id, imdbId, isbn }
  const omdbCacheRef = useRef(omdbCache)
  const bookCacheRef = useRef(bookCache)
  const cityMarkersRef = useRef([])
  const cityElsRef = useRef([]) // { name, wrapper }
  const threadModeRef = useRef(threadMode)
  const previewMarkersRef = useRef([])
  const previewAnimRef = useRef(null)
  threadModeRef.current = threadMode
  // The city circles shrink to dots in both Threads and About.
  const dotModeRef = useRef(false)
  dotModeRef.current = !!threadMode || !!aboutPhotos
  const aboutOnRef = useRef(false)
  aboutOnRef.current = !!aboutPhotos
  const aboutMarkersRef = useRef([])
  const threadCountsRef = useRef(threadCounts)
  threadCountsRef.current = threadCounts
  const threadCityRef = useRef(threadCity)
  threadCityRef.current = threadCity
  const threadCbRef = useRef({})
  threadCbRef.current = { hover: onThreadCityHover, click: onThreadCityClick }
  const flyTimerRef = useRef(null)
  const revealTimerRef = useRef(null)
  const citySelectedAtRef = useRef(null)
  const movListenerRef = useRef(null)
  const visibleIdsRef = useRef(new Set())
  // map.loaded() goes false again whenever tiles are loading, and 'load' only
  // fires once; remember that it fired so late callers don't wait forever.
  const styleReadyRef = useRef(false)
  // Landmarks: below GROUP_ZOOM a landmark's stories fold into its one pin;
  // zoomed in closer, the landmark pin gives way to the individual stories.
  const GROUP_ZOOM = 16
  const groupedRef = useRef(true)
  const markerInfoRef = useRef({}) // id -> { landmarkId, isLandmark }
  const focusIdRef = useRef(null)
  const zoomOK = id => {
    const info = markerInfoRef.current[id]
    if (!info) return true
    if (info.isLandmark) return groupedRef.current
    if (info.landmarkId) return !groupedRef.current
    return true
  }
  const shownId = id => (!visibleIdsRef.current.size || visibleIdsRef.current.has(id)) && zoomOK(id)
  omdbCacheRef.current = omdbCache
  bookCacheRef.current = bookCache

  useEffect(() => {
    if (!containerRef.current) return
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [7.75, 48.57],
      zoom: 3.8,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    // "Where am I?" — the blue dot, for finding what's around you when you're
    // out in the city. Asks for location only when tapped.
    map.addControl(new mapboxgl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserHeading: true,
    }), 'top-right')
    mapRef.current = map
    map.once('load', () => { styleReadyRef.current = true })
    onReady?.(map)
    map.on('zoom', () => {
      const grouped = map.getZoom() < GROUP_ZOOM
      if (grouped === groupedRef.current) return
      groupedRef.current = grouped
      markerDataRef.current.forEach(({ el, id }) => {
        const visible = shownId(id)
        el.style.opacity = visible ? (focusIdRef.current && focusIdRef.current !== id ? '0.15' : '1') : '0'
        el.style.pointerEvents = visible ? 'auto' : 'none'
      })
    })
    return () => map.remove()
  }, [])

  // On phones the map lives in a hidden layer until the Map button opens it;
  // a map created at zero size needs a resize once it becomes visible.
  useEffect(() => {
    if (!shownKey || !mapRef.current) return
    const id = requestAnimationFrame(() => mapRef.current?.resize())
    return () => cancelAnimationFrame(id)
  }, [shownKey])

  useEffect(() => {
    clearTimeout(flyTimerRef.current)
    if (!mapRef.current) return
    if (!city || !city.coordinates) {
      flyTimerRef.current = setTimeout(() => {
        if (!mapRef.current) return
        mapRef.current.resize()
        mapRef.current.flyTo({
          center: [7.75, 48.57],
          zoom: 3.8,
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

    focusIdRef.current = focusStory?.location ? focusStory.id : null
    if (!focusStory?.location) {
      onStoryPin?.(null)
      markerDataRef.current.forEach(({ el, id }) => {
        const visible = shownId(id)
        el.style.opacity = visible ? '1' : '0'
        el.style.pointerEvents = visible ? 'auto' : 'none'
      })
      return
    }

    const loc = focusStory.location
    const lon = loc.lon ?? (loc.coordinates && loc.coordinates[0])
    const lat = loc.lat ?? (loc.coordinates && loc.coordinates[1])
    if (!lon || !lat) return

    // Dim other markers, highlight focused one. Markers hidden by the active
    // filter stay hidden (and unclickable) rather than reappearing dimmed.
    markerDataRef.current.forEach(({ el, id }) => {
      const visible = shownId(id)
      el.style.opacity = id === focusStory.id ? '1' : (visible ? '0.15' : '0')
      el.style.pointerEvents = visible ? 'auto' : 'none'
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
      // Leave room above the pin for the pop-up. Landmark pop-ups are tall
      // (photo + description + stories), so they get most of the height.
      padding: { top: focusStory.mediaType === 'landmark' ? Math.round(Math.min(map.getContainer().clientHeight * 0.72, 680)) : 340, bottom: 60, left: 60, right: 60 },
      easing: t => 1 - Math.pow(1 - t, 3),
    })
  }, [focusStory?.id])

  useEffect(() => {
    const map = mapRef.current
    cityMarkersRef.current.forEach(m => m.remove())
    cityMarkersRef.current = []
    cityElsRef.current = []
    if (!map || city || !cities?.length) return

    const addCityMarkers = () => {
      cities.forEach(c => {
        if (!c.coordinates) return

        // Wrapper: Mapbox sets transform here for positioning
        const wrapper = document.createElement('div')
        wrapper.style.cssText = 'width:48px;height:48px;'
        // A hovered city comes to the front, so a neighbour's circle can't
        // cover its enlarged name (Liverpool under Manchester).
        wrapper.className = 'city-marker-wrap'

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
        // Threads view: the dot's hit area (larger than the dot itself, smaller
        // than the photo's, so neighbours don't steal each other's hovers) and
        // the name label that appears on hover.
        const hit = document.createElement('span')
        hit.className = 'city-marker__hit'
        const tlabel = document.createElement('span')
        tlabel.className = 'city-marker__tlabel'
        wrapper.append(hit, tlabel)
        hit.addEventListener('mouseenter', () => {
          const n = threadCountsRef.current?.[c.name] || 0
          tlabel.textContent = `${c.name} · ${n} thread${n === 1 ? '' : 's'}`
          wrapper.classList.add('is-hover')
          threadCbRef.current.hover?.(c.name)
        })
        hit.addEventListener('mouseleave', () => { wrapper.classList.remove('is-hover'); threadCbRef.current.hover?.(null) })
        hit.addEventListener('click', e => { e.stopPropagation(); threadCbRef.current.click?.(c.name) })
        cityElsRef.current.push({ name: c.name, wrapper, inner, tlabel, lon: c.coordinates.lon })
        wrapper.addEventListener('click', () => { if (!dotModeRef.current) onCityClick?.(c) })

        const marker = new mapboxgl.Marker(wrapper)
          .setLngLat([c.coordinates.lon, c.coordinates.lat])
          .addTo(map)
        cityMarkersRef.current.push(marker)
        setTimeout(() => { inner.style.opacity = '1' }, 200 + Math.random() * 600)
      })
      applyThreadMode()
      applyThreadCity()
    }

    if (styleReadyRef.current || map.loaded()) addCityMarkers()
    else map.once('load', addCityMarkers)
  }, [cities, city])

  // Threads view: cities shrink to small dots that can't be clicked (a click
  // would leave the Threads section); hovering a thread enlarges its cities.
  // Switching between Cities and Threads, the circles shrink or grow with a
  // springy overshoot, in a wave that sweeps across the map from west to east.
  // The spring is a keyframe animation; the class sets the resting state.
  const SPRING_GROW = [0.3, 1.14, 0.95, 1.02, 1]
  const SPRING_SHRINK = [1, 0.2, 0.36, 0.28, 0.3]
  const SPRING_OFFSETS = [0, 0.42, 0.66, 0.84, 1]
  const applyThreadMode = () => {
    const on = dotModeRef.current
    cityElsRef.current.forEach(({ wrapper }) => wrapper.classList.toggle('is-about', aboutOnRef.current))
    const els = cityElsRef.current.filter(({ wrapper }) => wrapper.classList.contains('is-thread-mode') !== on)
    if (!els.length) return
    const lons = els.map(e => e.lon)
    const min = Math.min(...lons), span = Math.max(Math.max(...lons) - min, 1)
    els.forEach(({ wrapper, inner, lon }) => {
      const overlay = inner.firstChild
      // Into About the circles shrink and fade out on the plain CSS transition.
      const animate = inner.animate && inner.style.opacity === '1' && !(on && aboutOnRef.current)
      // A CSS transition would override the keyframes, so pause transitions
      // while the class changes and the spring plays.
      if (animate) { inner.style.transition = 'none'; if (overlay) overlay.style.transition = 'none' }
      wrapper.classList.toggle('is-thread-mode', on)
      if (!animate) return
      const delay = Math.round(((lon - min) / span) * 380)
      const scales = on ? SPRING_SHRINK : SPRING_GROW
      inner.getAnimations?.().forEach(a => a.cancel())
      inner.animate(scales.map((v, i) => ({ transform: `scale(${v})`, offset: SPRING_OFFSETS[i] })),
        { duration: 720, delay, easing: 'ease-out', fill: 'backwards' })
      clearTimeout(inner._modeTimer)
      inner._modeTimer = setTimeout(() => { inner.style.transition = ''; if (overlay) overlay.style.transition = '' }, delay + 760)
      overlay?.animate([{ opacity: on ? 0 : 1 }, { opacity: on ? 1 : 0 }],
        { duration: 300, delay: delay + (on ? 120 : 0), easing: 'ease', fill: 'backwards' })
    })
  }
  useEffect(applyThreadMode, [threadMode, !!aboutPhotos])

  // About: photos of Ryan pinned where they were taken, like prints dropped
  // on the map, each a little crooked, in a white frame with a shadow.
  useEffect(() => {
    const map = mapRef.current
    const old = aboutMarkersRef.current
    aboutMarkersRef.current = []
    old.forEach(({ m, card }) => { card.classList.add('is-leaving'); setTimeout(() => m.remove(), 300) })
    if (!map || !aboutPhotos) return
    const add = () => {
      aboutPhotos.forEach((ph, i) => {
        // The map positions the wrapper with a transform, so the tilt and the
        // drop-in animation live on the inner card.
        const wrap = document.createElement('div')
        wrap.className = 'about-photo-wrap'
        const card = document.createElement('figure')
        card.className = 'about-photo'
        card.style.setProperty('--tilt', ph.tilt + 'deg')
        card.style.animationDelay = (250 + i * 160) + 'ms'
        // Front: the photo. Back (shown on hover, flipped): caption, then place.
        const flip = document.createElement('div')
        flip.className = 'about-photo__flip'
        const front = document.createElement('div')
        front.className = 'about-photo__face about-photo__front'
        const img = document.createElement('img')
        img.src = ph.src; img.alt = ph.alt; img.width = 900; img.height = 675
        front.appendChild(img)
        const back = document.createElement('figcaption')
        back.className = 'about-photo__face about-photo__back'
        const place = document.createElement('span')
        place.className = 'about-photo__place'; place.textContent = ph.place
        const cap = document.createElement('span')
        cap.className = 'about-photo__caption'; cap.textContent = ph.caption
        back.append(cap, place)
        flip.append(front, back)
        card.appendChild(flip)
        wrap.appendChild(card)
        const m = new mapboxgl.Marker({ element: wrap }).setLngLat([ph.lon, ph.lat]).addTo(map)
        aboutMarkersRef.current.push({ m, card })
      })
    }
    if (styleReadyRef.current || map.loaded()) add()
    else map.once('load', add)
  }, [aboutPhotos])

  // Threads view: the city the list is filtered to stays enlarged, with its
  // name showing.
  const applyThreadCity = () => {
    const sel = threadModeRef.current ? threadCityRef.current : null
    cityElsRef.current.forEach(({ name, wrapper, tlabel }) => {
      const on = name === sel
      wrapper.classList.toggle('is-selected', on)
      if (on) { const n = threadCountsRef.current?.[name] || 0; tlabel.textContent = `${name} · ${n} thread${n === 1 ? '' : 's'}` }
    })
  }
  useEffect(applyThreadCity, [threadCity, threadMode])

  // Threads view: hovering a thread in the list draws its route on the map.
  // The map itself stays where it is; cities off the route fade back.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    cancelAnimationFrame(previewAnimRef.current)
    previewMarkersRef.current.forEach(m => m.remove())
    previewMarkersRef.current = []
    const clear = () => {
      for (const id of ['thread-preview', 'thread-preview-casing']) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource('thread-preview')) map.removeSource('thread-preview')
    }
    if (!threadPreview) {
      clear()
      cityElsRef.current.forEach(({ wrapper }) => wrapper.classList.remove('is-faded', 'is-on-route'))
      return
    }
    if (!(styleReadyRef.current || map.loaded())) return
    clear()

    const stops = threadStops(threadPreview)
    const onRoute = new Set(threadPreview.chapters.flatMap(c => [c.city, ...(c.points || []).map(p => p.label)]))
    cityElsRef.current.forEach(({ name, wrapper }) => {
      wrapper.classList.toggle('is-on-route', onRoute.has(name))
      wrapper.classList.toggle('is-faded', !onRoute.has(name))
    })

    const coords = stops.filter(p => p.line).map(p => [p.lon, p.lat])
    map.addSource('thread-preview', { type: 'geojson', lineMetrics: true, data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } })
    const layout = { 'line-cap': 'round', 'line-join': 'round' }
    map.addLayer({ id: 'thread-preview-casing', type: 'line', source: 'thread-preview', layout, paint: { 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.8 } })
    map.addLayer({ id: 'thread-preview', type: 'line', source: 'thread-preview', layout, paint: { 'line-color': ROUTE_COLOR, 'line-width': 2.5 } })

    // Draw the line from the first stop to the last, and pop each number in
    // as the line reaches it. If line trimming isn't supported, the whole
    // line simply appears.
    const DRAW = 900
    const setTrim = t => {
      try {
        const v = t >= 1 ? [0, 0] : [Math.max(t, 0.0001), 1]
        map.setPaintProperty('thread-preview', 'line-trim-offset', v)
        map.setPaintProperty('thread-preview-casing', 'line-trim-offset', v)
      } catch { /* older renderer: no trim, line shows at once */ }
    }
    setTrim(0)

    // A small red dot per place, popping in as the line reaches it. Stops in
    // our cities sit under the city's enlarged photo; the dots mark the rest
    // (Arles, Nuenen).
    const places = []
    stops.forEach(p => {
      if (!places.some(q => Math.abs(q.lat - p.lat) < 0.05 && Math.abs(q.lon - p.lon) < 0.05)) places.push(p)
    })
    const total = threadPreview.chapters.length
    places.forEach(pl => {
      const el = document.createElement('div')
      el.className = 'thread-stop-dot'
      el.style.animationDelay = Math.round(((pl.n - 1) / Math.max(total - 1, 1)) * DRAW) + 'ms'
      // The map positions the wrapper with a transform; the pop animation
      // (also a transform) must stay on the inner element.
      const wrap = document.createElement('div')
      wrap.className = 'thread-preview-wrap'
      wrap.appendChild(el)
      previewMarkersRef.current.push(new mapboxgl.Marker({ element: wrap }).setLngLat([pl.lon, pl.lat]).addTo(map))
    })

    const t0 = performance.now()
    const step = now => {
      const t = Math.min((now - t0) / DRAW, 1)
      setTrim(1 - Math.pow(1 - t, 2))
      if (t < 1) previewAnimRef.current = requestAnimationFrame(step)
    }
    previewAnimRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(previewAnimRef.current)
  }, [threadPreview])

  // Create/destroy markers when the full story set changes (city switch)
  useEffect(() => {
    if (!mapRef.current) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []
    markerDataRef.current = []
    markerInfoRef.current = {}
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
        // Same priority as the list icons: our Contentful mirror, then a manual
        // override, then the remote source. Pins are tiny, so ask for a tiny image.
        const portraitImg = sizedAsset(story.coverAsset, 96) || story.coverImageUrl || cachedPoster || cachedCover
        const imgSrc = story.channelIcon || story.artworkImage || portraitImg
        markerInfoRef.current[story.id] = { landmarkId: story.landmarkId || null, isLandmark: story.mediaType === 'landmark' }
        if (story.mediaType === 'landmark') {
          const n = story.landmark?.members?.length || ''
          el.className = 'landmark-pin landmark-pin--' + (story.landmark?.type || 'landmark')
          el.style.cssText = 'opacity:0;pointer-events:none;transition:opacity 0.35s ease;'
          el.innerHTML = '<span class="landmark-pin__icon"></span><span class="landmark-pin__count">' + n + '</span>'
          const icon = LANDMARK_PIN_SVGS[story.landmark?.type] || LANDMARK_PIN_SVGS.landmark
          el.firstChild.innerHTML = icon
        } else if (story.mediaType === 'event') {
          // A tiny desk calendar: red header strip, day number underneath.
          // Matches the list's date box: a run already under way shows its end date.
          const ev = story.event || {}
          const ongoing = ev.end && ev.start <= new Date().toISOString().slice(0, 10)
          const d = Number((ongoing ? ev.end : ev.start || '').slice(8, 10)) || ''
          const top = ongoing ? 'UNTIL' : ['SUN','MON','TUE','WED','THU','FRI','SAT'][new Date(ev.start + 'T12:00').getDay()]
          el.className = 'event-pin'
          el.style.cssText = 'opacity:0;pointer-events:none;transition:opacity 0.35s ease;'
          el.innerHTML = '<span class="event-pin__top">' + top + '</span><span class="event-pin__day">' + d + '</span>'
        } else if (imgSrc) {
          const isPoster = portraitImg && !story.channelIcon && !story.artworkImage
          const pinW = isPoster ? '28px' : '36px'
          const pinH = isPoster ? '42px' : '36px'
          const pinR = isPoster ? '4px' : borderRadius
          el.style.cssText = 'width:' + pinW + ';height:' + pinH + ';border-radius:' + pinR + ';background-image:url(' + imgSrc + ');background-size:cover;background-position:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 0.35s ease;'
        } else {
          const t = (story.mediaType || '').toLowerCase()
          // Book/movie/TV pins are portrait (2:3) when they have art; match that
          // for their text placeholders too, and spell out BOOK rather than "BOO".
          const isPortraitType = t === 'book' || t === 'movie' || t === 'tv'
          const boxW = isPortraitType ? '28px' : '32px'
          const boxH = isPortraitType ? '42px' : '32px'
          const boxR = isPortraitType ? '4px' : borderRadius
          const fontSize = isPortraitType ? '8px' : '10px'
          el.style.cssText = 'width:' + boxW + ';height:' + boxH + ';border-radius:' + boxR + ';background:#1A1714;color:white;display:flex;align-items:center;justify-content:center;font-size:' + fontSize + ';font-weight:700;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;font-family:sans-serif;opacity:0;pointer-events:none;transition:opacity 0.35s ease;'
          // Songs, books and films without art get a grey glyph rather than a word.
          const glyph = placeholderGlyphMarkup(t, 15)
          if (glyph) el.innerHTML = '<span style="display:flex;opacity:0.5">' + glyph + '</span>'
          else el.textContent = t === 'book' ? 'BOOK' : (story.mediaType || '').slice(0, 3).toUpperCase()
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

      // Fade the pins in as the map settles on the city. Capture THIS run's
      // markers in a local snapshot: reading the shared markerDataRef when the
      // timer fires was racy — a quick city-to-city switch could leave the
      // callback iterating a set that had already been emptied and rebuilt, so
      // the new city's pins never received an opacity and stayed invisible until
      // the city was re-selected (which collapses the delay to ~0). The snapshot
      // always refers to the markers this run created; a stale run harmlessly
      // sets opacity on its own already-removed nodes.
      const created = markerDataRef.current.slice()
      const animEnd = (citySelectedAtRef.current || 0) + PANEL_TRANSITION + FLY_DURATION
      const revealDelay = Math.max(0, Math.min(animEnd - 500 - Date.now(), FLY_DURATION))
      revealTimerRef.current = setTimeout(() => {
        created.forEach(({ el, id }) => {
          setTimeout(() => {
            const visible = shownId(id)
            el.style.opacity = visible ? '1' : '0'
            el.style.pointerEvents = visible ? 'auto' : 'none'
          }, Math.random() * 500)
        })
      }, revealDelay)
    }

    if (styleReadyRef.current || map.loaded()) addMarkers()
    else map.once('load', addMarkers)
  }, [allStories])

  // Update marker visibility when filtered set changes — no recreate, just fade
  useEffect(() => {
    visibleIdsRef.current = new Set((stories || []).map(s => s.id))
    markerDataRef.current.forEach(({ el, id }) => {
      const visible = shownId(id)
      el.style.opacity = visible ? '1' : '0'
      el.style.pointerEvents = visible ? 'auto' : 'none'
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
