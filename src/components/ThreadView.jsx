// A cross-city thread ("Caravaggio", "Uprisings"): a near full-screen page
// with the story told in chapters on the left and a map of Europe on the
// right. Scrolling the chapters moves the map from stop to stop along the
// route; tapping a stop on the map scrolls to its chapter. On phones the map
// sits in a strip across the top.
//
// The chapters and their story IDs live in src/data/threads.json; the
// stories themselves are ordinary Contentful stories, fetched by ID.
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { fetchStoriesByIds } from '../utils/contentful'
import PHOTOS from '../data/thread-photos.json'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const ROUTE_COLOR = '#C8412A'

// A Commons image with its credit line (the licences require one).
function ThreadPhoto({ file, className }) {
  const p = file && PHOTOS[file]
  if (!p) return null
  return (
    <figure className={className}>
      <div className={className + '__frame'}><img src={p.src} alt="" width={p.w} height={p.h} /></div>
      <figcaption><a href={p.page} target="_blank" rel="noreferrer">{p.author.replace(/^(.+?)\1$/, '$1')}{p.license ? ` · ${p.license}` : ''}</a></figcaption>
    </figure>
  )
}

function chapterPoints(ch) {
  return ch.points?.length ? ch.points : [{ lat: ch.lat, lon: ch.lon, label: ch.city }]
}

// Stories in a chapter are listed in the same type order as a landmark.
const TYPE_ORDER = ['video', 'podcast', 'book', 'movie', 'tv', 'music', 'audiotour']
const typeRank = s => { const i = TYPE_ORDER.indexOf((s.mediaType || '').toLowerCase()); return i < 0 ? 99 : i }

// The chapter map never zooms in further than this, so a stop still shows its
// surroundings rather than a few streets.
const MAX_ZOOM = 7.5

export default function ThreadView({ thread, onClose, renderStory, startChapter = null }) {
  const scrollRef = useRef(null)
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const sectionRefs = useRef([])
  const [active, setActive] = useState(-1) // -1 = the intro, whole route in view
  const [stories, setStories] = useState({})

  const allIds = useMemo(() => thread.chapters.flatMap(c => c.stories), [thread])
  useEffect(() => {
    let live = true
    fetchStoriesByIds(allIds).then(list => { if (live) setStories(Object.fromEntries(list.map(s => [s.id, s]))) }).catch(() => {})
    return () => { live = false }
  }, [allIds])

  // Every stop, for fitting the whole route.
  const bounds = useMemo(() => {
    const b = new mapboxgl.LngLatBounds()
    thread.chapters.forEach(c => chapterPoints(c).forEach(p => b.extend([p.lon, p.lat])))
    return b
  }, [thread])

  // Map: route line plus a numbered marker per chapter (one per point for
  // chapters that span several cities).
  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/light-v11',
      bounds,
      fitBoundsOptions: { padding: 70 },
      attributionControl: false,
    })
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map
    map.on('load', () => {
      const main = thread.chapters.filter(c => !c.points?.length).map(c => [c.lon, c.lat])
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: main } } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ROUTE_COLOR, 'line-width': 2.5, 'line-opacity': 0.75 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
    })
    markersRef.current = []
    thread.chapters.forEach((c, i) => {
      chapterPoints(c).forEach(p => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'thread-marker'
        el.textContent = String(i + 1)
        el.title = c.points?.length ? p.label : c.place
        el.addEventListener('click', () => {
          sectionRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
        const m = new mapboxgl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map)
        markersRef.current.push({ i, el, m })
      })
    })
    return () => map.remove()
  }, [thread, bounds])

  // Which chapter is being read: the one crossing a line 35% down the column.
  useEffect(() => {
    const root = scrollRef.current
    const onScroll = () => {
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.35
      let idx = -1
      sectionRefs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= line) idx = i })
      setActive(idx)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [])

  // Opened from a story: jump to the chapter it belongs to.
  useEffect(() => {
    if (startChapter == null) return
    const t = setTimeout(() => sectionRefs.current[startChapter]?.scrollIntoView({ block: 'start' }), 350)
    return () => clearTimeout(t)
  }, [startChapter, thread])

  // Move the map to the chapter being read.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach(({ i, el }) => {
      el.classList.toggle('is-active', i === active)
      el.classList.toggle('is-past', i < active)
    })
    const narrow = window.innerWidth <= 768
    const pad = narrow ? 36 : 80
    if (active < 0) { map.fitBounds(bounds, { padding: pad, duration: 1600 }); return }
    const c = thread.chapters[active]
    if (c.points?.length) {
      const b = new mapboxgl.LngLatBounds()
      c.points.forEach(p => b.extend([p.lon, p.lat]))
      map.fitBounds(b, { padding: pad, duration: 2200, essential: true })
    } else {
      const z = Math.min(c.zoom - 3, MAX_ZOOM) - (narrow ? 1 : 0)
      map.flyTo({ center: [c.lon, c.lat], zoom: Math.max(4, z), duration: 2200, curve: 0.8, essential: true })
    }
  }, [active, thread, bounds])

  // Esc closes.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="thread-overlay" onClick={onClose}>
      <div className="thread" onClick={e => e.stopPropagation()} role="dialog" aria-label={thread.title}>
        <button className="thread__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
        </button>
        <div className="thread__map" ref={mapEl} />
        <div className="thread__scroll" ref={scrollRef}>
          <ThreadPhoto file={thread.image} className="thread-hero" />
          <header className="thread__head">
            <div className="thread__kicker">{thread.kind} · {thread.chapters.length} stops</div>
            <h1 className="thread__title">{thread.title}</h1>
            <div className="thread__dates">{thread.dates}</div>
            {/* The intro's first sentence is the lead, set larger; the rest of
                the intro runs on as one paragraph. */}
            {(() => {
              const text = thread.intro.join(' ')
              const m = text.match(/^(.+?[.!?])\s+(.*)$/s)
              return m
                ? <><p className="thread__dek">{m[1]}</p><p className="thread__intro">{m[2]}</p></>
                : <p className="thread__dek">{text}</p>
            })()}
            <div className="thread__start">Scroll to follow the thread</div>
          </header>
          <ol className="thread__chapters">
            {thread.chapters.map((c, i) => (
              <li key={i} ref={el => { sectionRefs.current[i] = el }} className={'thread-ch' + (i === active ? ' is-active' : '')}>
                <div className="thread-ch__rail"><span className="thread-ch__num">{i + 1}</span></div>
                <div className="thread-ch__body">
                  <div className="thread-ch__when">{c.when}</div>
                  <h2 className="thread-ch__heading">{c.heading}</h2>
                  <div className="thread-ch__place">{c.place}</div>
                  <ThreadPhoto file={c.image} className="thread-img" />
                  <p className="thread-ch__text">{c.text}</p>
                  {c.tip && <p className="thread-ch__tip"><span className="thread-ch__tip-label">If you go</span>{c.tip}</p>}
                  {c.stories.length > 0 && (
                    <div className="thread-ch__stories">
                      {c.stories.map(id => stories[id]).filter(Boolean).sort((a, b) => typeRank(a) - typeRank(b)).map(st => <div key={st.id}>{renderStory(st)}</div>)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div className="thread__end">End of the thread</div>
        </div>
      </div>
    </div>
  )
}
