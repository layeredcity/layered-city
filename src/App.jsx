import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import './App.css'
import { fetchCities, fetchStoriesForCity } from './utils/contentful'
import MapboxMap from './components/MapboxMap'

const QUALITY_LABELS = ['', 'Okay', 'Good', 'Interesting', 'Great', 'Essential']

const FILTERS = [
  { label: 'All',         types: ['podcast', 'video', 'audiotour', 'movie', 'tv', 'book'] },
  { label: 'Podcasts',    types: ['podcast'],      emptyLabel: 'podcasts',    singular: 'podcast',          icon: 'podcast',   unitSingular: 'episode',          unitPlural: 'episodes' },
  { label: 'Videos',      types: ['video'],         emptyLabel: 'videos',      singular: 'video',            icon: 'video',     unitSingular: 'video',            unitPlural: 'videos' },
  { label: 'Audio tours', types: ['audiotour'],     emptyLabel: 'audio tours', singular: 'audio tour',       icon: 'audiotour', unitSingular: 'audio tour',       unitPlural: 'audio tours' },
  { label: 'Movies & TV', types: ['movie', 'tv'],   emptyLabel: 'movies & TV', singular: 'movie or TV show', icon: 'movietv',   unitSingular: 'movie or TV show', unitPlural: 'movies & TV shows', alwaysShow: true },
  { label: 'Books',       types: ['book'],           emptyLabel: 'books',       singular: 'book',             icon: 'book',      unitSingular: 'book',             unitPlural: 'books',             alwaysShow: true },
]

const TYPE_ICONS = {
  podcast: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/>
      <path d="M19 10v1a7 7 0 01-14 0v-1"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polygon points="10,8 16,12 10,16" fill="currentColor" stroke="none"/>
    </svg>
  ),
  audiotour: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0118 0v6"/>
      <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z"/>
      <path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>
    </svg>
  ),
  movietv: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.18"/>
      <line x1="7" y1="2" x2="7" y2="22"/>
      <line x1="17" y1="2" x2="17" y2="22"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <line x1="2" y1="7" x2="7" y2="7"/>
      <line x1="2" y1="17" x2="7" y2="17"/>
      <line x1="17" y1="17" x2="22" y2="17"/>
      <line x1="17" y1="7" x2="22" y2="7"/>
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
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
            <div className="story-modal__why">Why listen?</div>
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
              <div className="logo__title">The world's best content about places in Europe</div>
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
            else setMobileView('list')
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {detailView === 'stories' ? selectedCity.name : 'All cities'}
          </div>
        )}
        {selectedCity && (
          <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden'}}>
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
                    filteredStories.map(story => <StoryItem key={story.id} story={story} onSelect={setSelectedStory} />)
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
    </div>
  )
}
