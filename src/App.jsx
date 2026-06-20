import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './App.css'
import { fetchCities, fetchStoriesForCity } from './utils/contentful'
import MapboxMap from './components/MapboxMap'
import MiniMap from './components/MiniMap'

const QUALITY_LABELS = ['', 'Marginally interesting', 'Somewhat interesting', 'Interesting', 'Very interesting', "Editor's pick"]

const FILTERS = [
  { label: 'All',    types: ['podcast', 'video', 'audiotour', 'movie', 'tv', 'book', 'speak'] },
  { label: 'Watch',  types: ['video', 'movie', 'tv'], emptyLabel: 'videos',      icon: 'watch',  unitSingular: 'video',      unitPlural: 'videos' },
  { label: 'Listen', types: ['podcast'],              emptyLabel: 'podcasts',    icon: 'listen', unitSingular: 'episode',    unitPlural: 'episodes' },
  { label: 'Read',   types: ['book'],                 emptyLabel: 'books',       icon: 'read',   unitSingular: 'book',       unitPlural: 'books',        alwaysShow: true },
  { label: 'Walk',   types: ['audiotour'],            emptyLabel: 'audio tours', icon: 'walk',   unitSingular: 'audio tour', unitPlural: 'audio tours' },
  { label: 'Speak',  types: ['speak'],                emptyLabel: 'phrases',     icon: 'speak',  unitSingular: 'phrase',     unitPlural: 'phrases',      alwaysShow: true },
]

const TYPE_ICONS = {
  watch: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <polygon points="9,8 17,10.5 9,13" fill="currentColor" stroke="none"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  listen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0118 0v6"/>
      <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z"/>
      <path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>
    </svg>
  ),
  read: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>
    </svg>
  ),
  walk: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13" cy="4" r="2"/>
      <line x1="13" y1="6" x2="11" y2="13"/>
      <line x1="11.5" y1="9" x2="15.5" y2="8"/>
      <line x1="11.5" y1="9" x2="8" y2="11.5"/>
      <line x1="11" y1="13" x2="14" y2="20"/>
      <line x1="11" y1="13" x2="8" y2="20"/>
    </svg>
  ),
  speak: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  ),
}

function CityOverview({ city, stories, storiesLoading, onSelectFilter }) {
  if (storiesLoading) {
    return (
      <div style={{padding:'40px',textAlign:'center',color:'var(--ink-light)',fontStyle:'italic',fontFamily:'var(--font-display)',fontSize:'17px'}}>
        Loading...
      </div>
    )
  }
  const sections = FILTERS.slice(1)
    .map(f => ({ filter: f, count: stories.filter(s => f.types.includes((s.mediaType || '').toLowerCase())).length }))
    .filter(({ filter, count }) => count > 0 || filter.alwaysShow)
  return (
    <div className="city-overview">
      {sections.map(({ filter, count }) => (
        <div key={filter.label} className="overview-item" onClick={() => onSelectFilter(filter.label)}>
          <div className="overview-item__icon-wrap">{TYPE_ICONS[filter.icon]}</div>
          <div className="overview-item__body">
            <div className="overview-item__label">{filter.label}</div>
            <div className="overview-item__count">{count === 0 ? 'Coming soon' : count + ' ' + (count === 1 ? filter.unitSingular : filter.unitPlural)}</div>
          </div>
          <svg className="overview-item__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      ))}
      {city.quote && (
        <div className="city-quote">
          <div className="city-quote__text">“{city.quote}”</div>
          {city.quoteAttribution && (
            <div className="city-quote__attribution">{city.quoteAttribution}</div>
          )}
        </div>
      )}
    </div>
  )
}

function mediaTypeLabel(type) {
  if (!type) return 'Story'
  const t = type.toLowerCase()
  if (t === 'podcast') return 'Podcast'
  if (t === 'video') return 'Video'
  if (t === 'audiotour') return 'Audio tour'
  if (t === 'movie') return 'Movie'
  if (t === 'tv') return 'TV'
  if (t === 'book') return 'Book'
  return type
}

function iconShape(type) {
  if (!type) return 'podcast'
  return type.toLowerCase() === 'video' ? 'video' : 'podcast'
}

function formatDuration(minutes, seconds) {
  if (!minutes && !seconds) return null
  const m = minutes || 0
  const s = seconds || 0
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem > 0 ? h + 'h ' + rem + 'm' : h + 'h'
  }
  if (s > 0) return m + 'm ' + s + 's'
  return m + 'm'
}

function QualityStars({ rating, max = 5 }) {
  if (!rating) return null
  return (
    <div className="quality-stars">
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} className={"quality-star" + (i < rating ? " quality-star--filled" : "")} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.7-5.2 2.7 1-5.9-4.3-4.1 5.9-.9z" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      ))}
    </div>
  )
}

function StoryIcon({ story }) {
  const shape = iconShape(story.mediaType)
  const label = mediaTypeLabel(story.mediaType)
  if (story.channelIcon) {
    return (
      <img
        className={"story-item__icon-" + shape}
        src={story.channelIcon + '?w=112&h=112&fit=fill'}
        alt={story.channelName}
      />
    )
  }
  return (
    <div
      className="story-item__icon--placeholder"
      style={{borderRadius: shape === 'video' ? '50%' : '14px'}}
    >
      {label.slice(0,3).toUpperCase()}
    </div>
  )
}

function StoryModal({ story, onClose }) {
  if (!story) return null
  const shape = iconShape(story.mediaType)
  const label = mediaTypeLabel(story.mediaType)
  const duration = formatDuration(story.minutes, story.seconds)
  const qualityLabel = QUALITY_LABELS[story.qualityRating] || null
  const url = story.mediaUrl || story.secondaryUrl || null
  return (
    <div className="story-modal-overlay" onClick={onClose}>
      <div className="story-modal" onClick={e => e.stopPropagation()}>
        <button className="story-modal__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
        </button>
        <div className="story-modal__header">
          <StoryIcon story={story} />
          <div className="story-modal__header-text">
            <div className="story-modal__type">{label}</div>
            {story.channelName && <div className="story-modal__channel">from {story.channelName}</div>}
          </div>
        </div>
        <h2 className="story-modal__title">{story.title}</h2>
        {story.description && (
          <>
            <div className="story-modal__why">
              {story.mediaType?.toLowerCase() === 'video' ? 'Why watch?' : story.mediaType?.toLowerCase() === 'audiotour' ? 'Why take the tour?' : 'Why listen?'}
            </div>
            <p className="story-modal__desc">{story.description}</p>
          </>
        )}
        <div className="story-modal__meta">
          <QualityStars rating={story.qualityRating} />
          {qualityLabel && <span className="story-modal__quality-label">{qualityLabel}</span>}
          {duration && <span className="story-modal__duration">{duration}</span>}
        </div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="story-modal__btn">
            {story.mediaType?.toLowerCase() === 'video'
              ? <svg viewBox="0 0 24 24" fill="currentColor" className="story-modal__btn-icon"><polygon points="5,3 19,12 5,21"/></svg>
              : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
            }
            {story.mediaType?.toLowerCase() === 'video' ? 'Watch the video' : story.mediaType?.toLowerCase() === 'audiotour' ? 'Listen to the audio tour' : 'Listen to the episode'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </a>
        )}
      </div>
    </div>
  )
}

function StoryItem({ story, onSelect }) {
  const duration = formatDuration(story.minutes, story.seconds)
  const label = mediaTypeLabel(story.mediaType)
  return (
    <div className="story-item" onClick={() => onSelect(story)} style={{cursor: 'pointer'}}>
      <StoryIcon story={story} />
      <div className="story-item__body">
        <div className="story-item__title">{story.title}</div>
        <div className="story-item__meta">
          <span className="story-item__type">{label}</span>
          {story.channelName && (
            <span className="story-item__source"> from {story.channelName}</span>
          )}
          {duration && (
            <span className="story-item__source"> · {duration}</span>
          )}
        </div>
        <QualityStars rating={story.qualityRating} />
      </div>
    </div>
  )
}

export default function App() {
  const [cities, setCities] = useState([])
  const [storyCounts, setStoryCounts] = useState({})
  const [selectedCity, setSelectedCity] = useState(null)
  const [stories, setStories] = useState([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')
  const [detailView, setDetailView] = useState('overview')
  const [mobileView, setMobileView] = useState('list')
  const [selectedStory, setSelectedStory] = useState(null)
  const modalAnchorRef = useRef(null)

  // iOS PWA: force app to fill the physical screen height
  useEffect(() => {
    const setScreenHeight = () => {
      document.documentElement.style.setProperty('--screen-h', window.screen.height + 'px')
    }
    setScreenHeight()
    window.addEventListener('orientationchange', () => setTimeout(setScreenHeight, 100))
  }, [])

  const closeStoryWithFade = useCallback(() => {
    if (modalAnchorRef.current) {
      modalAnchorRef.current.style.transition = 'opacity 0.2s ease'
      modalAnchorRef.current.style.opacity = '0'
    }
    setTimeout(() => setSelectedStory(null), 200)
  }, [])

  useEffect(() => {
    fetchCities().then(async data => {
      setCities(data)
      setLoading(false)
      const counts = {}
      await Promise.all(data.map(async city => {
        try {
          const stories = await fetchStoriesForCity(city.id)
          counts[city.id] = stories.length
          setStoryCounts(prev => ({ ...prev, [city.id]: stories.length }))
        } catch (e) {
          counts[city.id] = 0
        }
      }))
    }).catch(err => {
      console.error('Failed to fetch cities:', err)
      setLoading(false)
    })
  }, [])

  const selectCity = useCallback(async (city) => {
    closeStoryWithFade()
    setSelectedCity(city)
    setActiveFilter('All')
    setDetailView('overview')
    setMobileView('detail')
    setStoriesLoading(true)
    try {
      const data = await fetchStoriesForCity(city.id)
      setStories(data)
      setStoryCounts(prev => ({ ...prev, [city.id]: data.length }))
    } catch (err) {
      console.error('Failed to fetch stories:', err)
      setStories([])
    } finally {
      setStoriesLoading(false)
    }
  }, [closeStoryWithFade])

  const currentFilter = FILTERS.find(f => f.label === activeFilter) || FILTERS[0]

  const filteredStories = useMemo(() =>
    stories
      .filter(s => currentFilter.types.includes((s.mediaType || '').toLowerCase()))
      .sort((a, b) => (b.qualityRating || 0) - (a.qualityRating || 0)),
    [stories, currentFilter]
  )

  const mapStories = detailView === 'overview' ? stories : filteredStories

  if (loading) {
    return (
      <div className="loading-screen">
        <img className="loading-screen__logo" src="/logo.png" alt="Layered City" />
        <p>Loading cities...</p>
      </div>
    )
  }

  return (
    <div className={"app" + (selectedCity ? ' app--city-selected' : '')}>
      <aside className={"panel-cities" + (mobileView === 'detail' ? ' panel-cities--hidden' : '')}>
        <div className="panel-cities__header">
          <div className="logo" onClick={() => { closeStoryWithFade(); setSelectedCity(null); setStories([]); setDetailView('overview'); setActiveFilter('All'); setMobileView('list') }} style={{cursor:'pointer'}}>
            <img className="logo__img" src="/logo.png" alt="Layered City" />
            <div className="logo__text-block">
              <div className="logo__title">The guidebook companion for curious travelers in Europe</div>
              <div className="logo__sub">Curated and written by Ryan Nee</div>
            </div>
          </div>
        </div>
        <div className="panel-cities__scroll">
          {cities.map(city => (
            <div
              key={city.id}
              className={"city-item" + (selectedCity && selectedCity.id === city.id ? ' city-item--active' : '')}
              onClick={() => selectCity(city)}
            >
              <div className="city-item__info">
                <div className="city-item__name">{city.name}</div>
                <div className="city-item__country">{city.country}</div>
              </div>
              {city.heroImage
                ? <img className="city-item__thumb" src={city.heroImage + '?w=128&h=128&fit=fill'} alt={city.name} />
                : <div className="city-item__thumb city-item__thumb--placeholder">?</div>
              }
            </div>
          ))}
        </div>
      </aside>

      <section className={"panel-detail" + (selectedCity ? ' panel-detail--open' : '')}>
        {mobileView === 'detail' && selectedCity && (
          <div className="mobile-back" onClick={() => {
            if (detailView === 'stories') { closeStoryWithFade(); setDetailView('overview'); setActiveFilter('All') }
            else { closeStoryWithFade(); setSelectedCity(null); setStories([]); setDetailView('overview'); setActiveFilter('All'); setMobileView('list') }
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {detailView === 'stories' ? selectedCity.name : 'All cities'}
          </div>
        )}
        {selectedCity && (
          <div style={{display:'flex',flexDirection:'column',position:'absolute',top:0,left:0,right:0,bottom:0,overflow:'hidden'}}>
            <div className="city-hero">
              {selectedCity.heroImage
                ? <img className="city-hero__img" src={selectedCity.heroImage + '?w=840&h=560&fit=fill'} alt={selectedCity.name} />
                : <div className="city-hero__img" style={{background:'var(--border)'}} />
              }
              <div className="city-hero__overlay" />
              <div className="city-hero__text">
                <div className="city-hero__name">{selectedCity.name}</div>
                <div className="city-hero__country">{selectedCity.country}</div>
              </div>
            </div>
            <div className={"nav-slide-track" + (detailView === 'stories' ? ' nav-slide-track--stories' : '')}>
              <div className="nav-slide-panel">
                <CityOverview
                  city={selectedCity}
                  stories={stories}
                  storiesLoading={storiesLoading}
                  onSelectFilter={f => { setActiveFilter(f); setDetailView('stories') }}
                />
              </div>
              <div className="nav-slide-panel">
                <div className="overview-back" onClick={() => { closeStoryWithFade(); setDetailView('overview'); setActiveFilter('All') }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  All categories
                </div>
                <div className="stories-header">
                  <div className="stories-header__title">{currentFilter.label}</div>
                </div>
                <div className="stories-scroll">
                  {storiesLoading ? (
                    <div style={{padding:'40px',textAlign:'center',color:'var(--ink-light)',fontStyle:'italic',fontFamily:'var(--font-display)',fontSize:'17px'}}>Loading stories...</div>
                  ) : filteredStories.length === 0 ? (
                    <div style={{padding:'40px',textAlign:'center',color:'var(--ink-xlight)',fontFamily:'var(--font-display)',fontStyle:'italic',fontSize:'17px'}}>
                      Layered City does not yet have any {currentFilter.emptyLabel} about {selectedCity.name}.
                    </div>
                  ) : (
                    [5, 4, 3, 2, 1].flatMap(rating => {
                      const group = filteredStories.filter(s => (s.qualityRating || 0) === rating)
                      if (!group.length) return []
                      const label = rating === 5 && group.length > 1 ? "Editor's picks" : QUALITY_LABELS[rating]
                      return [
                        <div key={'heading-' + rating} className="story-group-heading">{label}</div>,
                        ...group.map(story => <StoryItem key={story.id} story={story} onSelect={setSelectedStory} />)
                      ]
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="panel-map">
        <MapboxMap
          city={selectedCity}
          cities={cities}
          allStories={stories}
          stories={mapStories}
          onCityClick={selectCity}
          focusStory={selectedStory}
          onStoryClick={setSelectedStory}
          onStoryPin={pos => {
            if (modalAnchorRef.current) {
              modalAnchorRef.current.style.left = (pos?.x ?? -9999) + 'px'
              modalAnchorRef.current.style.top  = (pos?.y ?? -9999) + 'px'
            }
          }}
        />
        {selectedStory && (
          <div ref={modalAnchorRef} className="story-modal-anchor">
            <StoryModal story={selectedStory} onClose={() => setSelectedStory(null)} />
            <div className="story-modal-arrow" />
          </div>
        )}
      </div>

      {/* Mobile story detail panel */}
      <div className={"panel-story" + (selectedStory ? ' panel-story--open' : '')}>
        {selectedStory && (() => {
          const s = selectedStory
          const label = mediaTypeLabel(s.mediaType)
          const duration = formatDuration(s.minutes, s.seconds)
          const qualityLabel = QUALITY_LABELS[s.qualityRating] || null
          const url = s.mediaUrl || s.secondaryUrl || null
          const whyLabel = ['video', 'movie', 'tv'].includes(s.mediaType?.toLowerCase()) ? 'Why watch?' : s.mediaType?.toLowerCase() === 'audiotour' ? 'Why walk it?' : s.mediaType?.toLowerCase() === 'book' ? 'Why read it?' : 'Why listen?'
          return (
            <>
              <div className="mobile-back" onClick={() => setSelectedStory(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back
              </div>
              <div className="panel-story__scroll">
                <div className="panel-story__content">
                  <div className="story-modal__header">
                    <StoryIcon story={s} />
                    <div className="story-modal__header-text">
                      <div className="story-modal__type">{label}</div>
                      {s.channelName && <div className="story-modal__channel">from {s.channelName}</div>}
                    </div>
                  </div>
                  <h2 className="story-modal__title">{s.title}</h2>
                  {s.description && (
                    <>
                      <div className="story-modal__why">{whyLabel}</div>
                      <p className="story-modal__desc">{s.description}</p>
                    </>
                  )}
                  <div className="story-modal__meta">
                    <QualityStars rating={s.qualityRating} />
                    {qualityLabel && <span className="story-modal__quality-label">{qualityLabel}</span>}
                    {duration && <span className="story-modal__duration">{duration}</span>}
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer" className="story-modal__btn">
                      {s.mediaType?.toLowerCase() === 'video'
                        ? <svg viewBox="0 0 24 24" fill="currentColor" className="story-modal__btn-icon"><polygon points="5,3 19,12 5,21"/></svg>
                        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
                      }
                      {s.mediaType?.toLowerCase() === 'video' ? 'Watch the video' : s.mediaType?.toLowerCase() === 'audiotour' ? 'Listen to the audio tour' : 'Listen to the episode'}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  )}
                </div>
                <MiniMap story={s} />
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
