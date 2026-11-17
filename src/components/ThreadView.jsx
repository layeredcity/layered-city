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
import LABELS from '../data/thread-photo-labels.json'
import { sentences } from '../utils/sentences'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const ROUTE_COLOR = '#C8412A'

// A Commons image with a short label for what it shows (thread-photo-labels.json)
// and its credit line (the licences require one).
function ThreadPhoto({ file, className }) {
  const p = file && PHOTOS[file]
  if (!p) return null
  return (
    <figure className={className}>
      <div className={className + '__frame'}><img src={p.src} alt="" width={p.w} height={p.h} /></div>
      <figcaption>{LABELS[file] && <span className="thread-cap__label">{LABELS[file]}</span>}<a href={p.page} target="_blank" rel="noreferrer">{p.author.replace(/^(.+?)\1$/, '$1')}{p.license ? ` · ${p.license}` : ''}</a></figcaption>
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
const CHIME_LEAD = 1.3 // seconds of chime before the title starts

export default function ThreadView({ thread, onClose, renderStory, startChapter = null }) {
  const scrollRef = useRef(null)
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const sectionRefs = useRef([])
  const [active, setActive] = useState(-1) // -1 = the intro, whole route in view
  const [stories, setStories] = useState({})

  // Narration (prototype). If public/audio/<slug>/index.json exists (made by
  // scripts/thread-audio.mjs), a Listen button plays the thread aloud one
  // segment at a time and highlights the sentence being read, scrolling to
  // keep it in view.
  const [narration, setNarration] = useState(null)
  const [seg, setSeg] = useState(-1) // segment playing, -1 = stopped
  const [paused, setPaused] = useState(false)
  const [readingKey, setReadingKey] = useState(null)
  const audioRef = useRef(null)
  // ?voices=trial plays a test recording with other voices, from
  // public/audio/<slug>--trial/, when one exists. It sticks for the visit.
  const trial = (() => {
    try {
      if (new URLSearchParams(window.location.search).get('voices') === 'trial') sessionStorage.setItem('lc-voices', 'trial')
      return sessionStorage.getItem('lc-voices') === 'trial'
    } catch { return new URLSearchParams(window.location.search).get('voices') === 'trial' }
  })()
  // ?chime=trial plays a short sound before the narration starts and after it
  // finishes. A trial only; it sticks for the visit.
  const chime = (() => {
    try {
      if (new URLSearchParams(window.location.search).get('chime') === 'trial') sessionStorage.setItem('lc-chime', 'trial')
      return sessionStorage.getItem('lc-chime') === 'trial'
    } catch { return new URLSearchParams(window.location.search).get('chime') === 'trial' }
  })()
  const chimedRef = useRef(false)
  const leadRef = useRef(null) // timer that starts the narration under the chime
  const audioDir = narration?.dir || thread.slug
  useEffect(() => {
    let live = true
    setNarration(null)
    const load = dir => fetch(`/audio/${dir}/index.json`).then(r => r.ok ? r.json().catch(() => null) : null).catch(() => null).then(d => d?.segments?.length ? { ...d, dir } : null)
    ;(trial ? load(`${thread.slug}--trial`).then(d => d || load(thread.slug)) : load(thread.slug)).then(d => { if (live && d) setNarration(d) }).catch(() => {})
    return () => { live = false }
  }, [thread.slug, trial])
  const stopNarration = () => {
    const a = audioRef.current
    if (a) { a.pause(); a.removeAttribute('src') }
    setSeg(-1); setPaused(false); setReadingKey(null)
    chimedRef.current = false
    clearTimeout(leadRef.current); leadRef.current = null
  }
  // The chime plays on the same audio element as the narration, so phones that
  // only allow audio started by a tap still play the narration after it.
  const playChime = (a, then) => {
    a.ontimeupdate = null
    a.onended = then
    a.src = '/audio/chime-trial.mp3'
    a.volume = 0.7
    a.play().catch(() => then())
  }
  const playSegment = n => {
    if (!narration) return
    const a = audioRef.current || (audioRef.current = new Audio())
    if (n >= narration.segments.length) {
      if (chime) { setReadingKey(null); playChime(a, stopNarration) } else stopNarration()
      return
    }
    // Opening chime: it plays on its own element while the narration starts
    // CHIME_LEAD seconds in, so the title overlaps the chime's fade. The
    // narration element is started muted and paused right away, inside the tap,
    // so phones still let it play when the timer fires.
    const opening = chime && !chimedRef.current
    if (opening) chimedRef.current = true
    a.volume = 1
    const sg = narration.segments[n]
    a.src = `/audio/${audioDir}/${sg.file}`
    a.ontimeupdate = () => {
      let k = sg.marks[0]?.key
      for (const m of sg.marks) { if (m.t <= a.currentTime + 0.05) k = m.key; else break }
      setReadingKey(k)
    }
    a.onended = () => playSegment(n + 1)
    if (opening) {
      let started = false
      a.muted = true
      a.play().then(() => { if (!started) { a.pause(); a.currentTime = 0 } a.muted = false }).catch(() => { a.muted = false })
      const c = new Audio('/audio/chime-trial.mp3')
      c.volume = 0.7
      const go = () => { clearTimeout(leadRef.current); leadRef.current = setTimeout(() => { leadRef.current = null; started = true; a.muted = false; a.play().catch(() => {}) }, CHIME_LEAD * 1000) }
      c.addEventListener('playing', go, { once: true })
      c.play().catch(() => { clearTimeout(leadRef.current); leadRef.current = null; started = true; a.muted = false; a.play().catch(() => {}) })
      setSeg(n); setPaused(false); setReadingKey(null)
    } else {
      a.play().catch(() => {})
      setSeg(n); setPaused(false); setReadingKey(sg.marks[0]?.key || null)
    }
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('previoustrack', () => skip(-1))
        navigator.mediaSession.setActionHandler('nexttrack', () => skip(1))
      } catch { /* not supported */ }
      try { navigator.mediaSession.metadata = new window.MediaMetadata({ title: n === 0 ? thread.title : thread.chapters[n - 1].heading, artist: 'Layered City', album: thread.title }) } catch { /* not supported */ }
    }
  }
  // Previous / next chapter. "Previous" first restarts the current chapter
  // if it's more than a few seconds in, like a music player.
  const segRef = useRef(-1)
  segRef.current = seg
  const skip = d => {
    const a = audioRef.current
    const cur = segRef.current
    if (cur < 0 || !narration) return
    if (d < 0 && a && a.currentTime > 3) { a.currentTime = 0; return }
    const n = Math.min(Math.max(0, cur + d), narration.segments.length - 1)
    if (n !== cur || d < 0) playSegment(n)
  }
  const togglePause = () => {
    const a = audioRef.current
    if (!a) return
    if (leadRef.current) { clearTimeout(leadRef.current); leadRef.current = null; setPaused(true); return }
    if (a.paused) { a.play().catch(() => {}); setPaused(false) } else { a.pause(); setPaused(true) }
  }
  useEffect(() => () => { audioRef.current?.pause() }, [])
  // Follow the sentence being read, gently. Scroll only when it is about to
  // pass behind the player bar (or has gone off the top), and then only as far
  // as needed to put it a little past halfway down. While the chapter's photo
  // can stay in view without hiding the sentence, stop with the photo's top
  // edge at the top of the column, since the text often describes what's in it.
  useEffect(() => {
    const root = scrollRef.current
    if (!readingKey || !root) return
    if (/^c\d+-h$/.test(readingKey)) return // a new chapter: handled below
    const el = root.querySelector(`[data-rk="${readingKey}"]`)
    if (!el) return
    const box = root.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const top = r.top - box.top, bottom = r.bottom - box.top
    const vis = root.clientHeight
    const floor = vis - 110 // clear of the player bar
    if (top >= vis * 0.08 && bottom <= floor) return
    let target
    if (top < vis * 0.08) {
      target = root.scrollTop + top - vis * 0.3
    } else {
      const need = root.scrollTop + bottom - floor
      target = Math.max(need, root.scrollTop + top - vis * 0.55)
      const photo = el.closest('.thread-ch')?.querySelector('.thread-img')
      if (photo) {
        const photoTop = root.scrollTop + photo.getBoundingClientRect().top - box.top - 12
        if (photoTop > root.scrollTop) target = Math.max(need, Math.min(target, photoTop))
      }
    }
    root.scrollTo({ top: target, behavior: 'smooth' })
  }, [readingKey])
  const rd = k => 'rd' + (readingKey === k ? ' is-reading' : '')
  const totalMin = narration ? Math.round(narration.segments.reduce((t, x) => t + (x.dur || 0), 0) / 60) : 0

  const hero = thread.image && PHOTOS[thread.image]

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

  // While narration plays, the map follows the narrator: it starts moving to a
  // chapter as soon as its title begins, rather than waiting for the scroll.
  const narratingRef = useRef(false)
  useEffect(() => {
    narratingRef.current = seg >= 0 && !paused
    if (seg >= 0 && !paused) setActive(seg - 1)
  }, [seg, paused])

  // At the start of each chapter, bring its top to the top of the column, so
  // the reading starts high with the photo in view below the heading.
  useEffect(() => {
    const root = scrollRef.current
    const el = seg >= 1 && sectionRefs.current[seg - 1]
    if (!root || !el) return
    const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top
    root.scrollTo({ top, behavior: 'smooth' })
  }, [seg])

  // Otherwise, which chapter is being read: the one crossing a line 35% down
  // the column.
  useEffect(() => {
    const root = scrollRef.current
    const onScroll = () => {
      if (narratingRef.current) return
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.35
      let idx = -1
      sectionRefs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= line) idx = i })
      // At the very bottom the last chapter counts as read, even if it's too
      // short for its top to reach the line.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) idx = sectionRefs.current.length - 1
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
          {/* Top block on the city page's royal blue, like a landmark: the photo
              tinted and fading into the blue, then the heading and intro in
              light type, then the photo credit. The chapters stay on white. */}
          <div className="thread-top">
            {hero && (
              <div className="thread-top__hero">
                <img src={hero.src} alt="" width={hero.w} height={hero.h} />
                <div className="thread-top__overlay" />
              </div>
            )}
          <header className={'thread__head' + (hero ? ' thread__head--over' : '')}>
            <div className="thread__kicker">Thread</div>
            <h1 className={"thread__title " + rd('title')} data-rk="title">{thread.title}</h1>
            <div className="thread__dates">{thread.dates}</div>
            {narration && (
              <button type="button" className="thread-listen" onClick={() => (seg < 0 ? playSegment(0) : togglePause())}>
                {seg >= 0 && !paused
                  ? <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                  : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>}
                {seg < 0 ? `Listen · ${totalMin} min` : paused ? 'Resume' : 'Pause'}
              </button>
            )}
            {/* The intro's first sentence is the lead, set larger; the rest of
                the intro runs on as one paragraph. */}
            {(() => {
              const ss = sentences(thread.intro.join(' '))
              return <>
                <p className="thread__dek"><span className={rd('i-0')} data-rk="i-0">{ss[0]}</span></p>
                {ss.length > 1 && <p className="thread__intro">{ss.slice(1).map((x, j) => <span key={j} className={rd(`i-${j + 1}`)} data-rk={`i-${j + 1}`}>{x} </span>)}</p>}
              </>
            })()}
            {hero && (
              <a className="thread-top__credit" href={hero.page} target="_blank" rel="noreferrer">
                {LABELS[thread.image] ? `${LABELS[thread.image]} · ` : ''}Photo: {hero.author.replace(/^(.+?)\1$/, '$1')}{hero.license ? ` · ${hero.license}` : ''}
              </a>
            )}
          </header>
          </div>
          <ol className="thread__chapters">
            {thread.chapters.map((c, i) => (
              <li key={i} ref={el => { sectionRefs.current[i] = el }} className={'thread-ch' + (i === active ? ' is-active' : '')}>
                <div className="thread-ch__rail">{narration
                  ? <button type="button" className="thread-ch__num thread-ch__num--play" onClick={() => playSegment(i + 1)} aria-label={`Listen from chapter ${i + 1}`} title="Listen from here">{i + 1}</button>
                  : <span className="thread-ch__num">{i + 1}</span>}</div>
                <div className="thread-ch__body">
                  <div className="thread-ch__when">{c.when}</div>
                  <h2 className={"thread-ch__heading " + rd(`c${i}-h`)} data-rk={`c${i}-h`}>{c.heading}</h2>
                  <div className="thread-ch__place">{c.place}</div>
                  <ThreadPhoto file={c.image} className="thread-img" />
                  <p className="thread-ch__text">{sentences(c.text).map((x, j) => <span key={j} className={rd(`c${i}-${j}`)} data-rk={`c${i}-${j}`}>{x} </span>)}</p>
                  {c.tip && <p className="thread-ch__tip"><span className="thread-ch__tip-label">If you go</span>{c.tip}</p>}
                  {c.stories.length > 0 && (
                    <div className={'thread-ch__stories ' + rd(`c${i}-m`)} data-rk={`c${i}-m`}>
                      {c.mediaNote
                        // Listed in the order the narrator describes them. While one
                        // is being described it plays its hover state and the others dim.
                        ? c.stories.map((id, j) => {
                          const st = stories[id]
                          if (!st) return null
                          const k = `c${i}-m${j}`
                          const describing = readingKey && readingKey.startsWith(`c${i}-m`) && readingKey !== `c${i}-m`
                          return <div key={st.id} data-rk={k} className={'thread-ch__story' + (readingKey === k ? ' is-described' : describing ? ' is-dimmed' : '')}>{renderStory(st)}</div>
                        })
                        : c.stories.map(id => stories[id]).filter(Boolean).sort((a, b) => typeRank(a) - typeRank(b)).map(st => <div key={st.id}>{renderStory(st)}</div>)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {seg >= 0 && (
            <div className="thread-player">
              <button type="button" className="thread-player__btn" onClick={togglePause} aria-label={paused ? 'Resume' : 'Pause'}>
                {paused
                  ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
                  : <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>}
              </button>
              {/* Two short lines: what the chapter is about, then where and which stop.
                  Chapters carry a `short` label (and `shortPlace` when the city
                  field isn't the real place); otherwise the heading is used. */}
              <div className="thread-player__label">
                {seg === 0
                  ? <><span className="thread-player__title">{thread.title}</span><span className="thread-player__sub">Introduction</span></>
                  : (c => <><span className="thread-player__title">{c.short || c.heading}</span><span className="thread-player__sub">{seg} of {thread.chapters.length} · {c.shortPlace || c.city}</span></>)(thread.chapters[seg - 1])}
              </div>
              <button type="button" className="thread-player__btn thread-player__btn--skip" onClick={() => skip(-1)} aria-label="Previous chapter">
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="2.5" height="14" rx="1" /><path d="M19 6.2v11.6a1 1 0 0 1-1.53.85L9.6 13.7a.85.85 0 0 1 0-1.44l7.87-4.95A1 1 0 0 1 19 6.2z" /></svg>
              </button>
              <button type="button" className="thread-player__btn thread-player__btn--skip" onClick={() => skip(1)} disabled={seg >= narration.segments.length - 1} aria-label="Next chapter">
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.5" y="5" width="2.5" height="14" rx="1" /><path d="M5 6.2v11.6a1 1 0 0 0 1.53.85l7.87-4.95a.85.85 0 0 0 0-1.44L6.53 7.31A1 1 0 0 0 5 6.2z" /></svg>
              </button>
              <button type="button" className="thread-player__btn thread-player__btn--stop" onClick={stopNarration} aria-label="Stop">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
