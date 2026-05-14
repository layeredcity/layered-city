import { useState, useEffect, useCallback, useMemo } from 'react'
import './App.css'
import { fetchCities, fetchStoriesForCity } from './utils/contentful'
import MapboxMap from './components/MapboxMap'

const FILTERS = [
  { label: 'All',         types: ['podcast', 'video', 'audiotour', 'movie', 'tv', 'book'] },
  { label: 'Podcast',     types: ['podcast'] },
  { label: 'Video',       types: ['video'] },
  { label: 'Audio tour',  types: ['audiotour'] },
  { label: 'Movies & TV', types: ['movie', 'tv'] },
  { label: 'Books',       types: ['book'] },
]

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

function StoryItem({ story }) {
  const duration = formatDuration(story.minutes, story.seconds)
  const label = mediaTypeLabel(story.mediaType)
  const url = story.mediaUrl || story.secondaryUrl || null
  return (
    <div className="story-item" onClick={() => url && window.open(url, '_blank')} style={{cursor: url ? 'pointer' : 'default'}}>
      <StoryIcon story={story} />
      <div className="story-item__body">
        <div className="story-item__title">{story.title}</div>
        <div className="story-item__meta">
          <span className="story-item__type">{label}</span>
          {story.channelName && (
            <span className="story-item__source"> · {story.channelName}</span>
          )}
        </div>
        <QualityStars rating={story.qualityRating} />
      </div>
      {duration && <span className="story-item__duration">{duration}</span>}
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
  const [mobileView, setMobileView] = useState('list')

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
    setSelectedCity(city)
    setActiveFilter('All')
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
  }, [])

  const currentFilter = FILTERS.find(f => f.label === activeFilter) || FILTERS[0]

  const filteredStories = useMemo(() =>
    stories
      .filter(s => currentFilter.types.includes((s.mediaType || '').toLowerCase()))
      .sort((a, b) => (b.qualityRating || 0) - (a.qualityRating || 0)),
    [stories, currentFilter]
  )

  const hasStories = (filter) =>
    stories.some(s => filter.types.includes((s.mediaType || '').toLowerCase()))

  if (loading) {
    return (
      <div className="loading-screen">
        <img className="loading-screen__logo" src="/logo.png" alt="Layered City" />
        <p>Loading cities...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <aside className={"panel-cities" + (mobileView === 'detail' ? ' panel-cities--hidden' : '')}>
        <div className="panel-cities__header">
          <div className="logo" onClick={() => { setSelectedCity(null); setStories([]) }} style={{cursor:'pointer'}}>
            <img className="logo__img" src="/logo.png" alt="Layered City" />
            <div className="logo__text-block">
              <div className="logo__title">The internet's best content about places in Europe</div>
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
                {storyCounts[city.id] != null && (
                  <div className="city-item__count">{storyCounts[city.id]} stories</div>
                )}
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
          <div className="mobile-back" onClick={() => setMobileView('list')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            All cities
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
            <div className="detail-filters">
              {FILTERS.map(f => {
                const has = hasStories(f)
                return (
                  <button
                    key={f.label}
                    className={"filter-chip" + (activeFilter === f.label ? ' filter-chip--active' : '') + (!has ? ' filter-chip--empty' : '')}
                    onClick={() => has && setActiveFilter(f.label)}
                  >{f.label}</button>
                )
              })}
            </div>
            <div className="stories-count">
              {storiesLoading ? 'Loading...' : filteredStories.length + ' ' + activeFilter.toLowerCase() + (filteredStories.length !== 1 ? 's' : '')}
            </div>
            <div className="stories-scroll">
              {storiesLoading ? (
                <div style={{padding:'40px',textAlign:'center',color:'var(--ink-light)',fontStyle:'italic',fontFamily:'var(--font-display)',fontSize:'17px'}}>Loading stories...</div>
              ) : filteredStories.length === 0 ? (
                <div style={{padding:'40px',textAlign:'center',color:'var(--ink-xlight)',fontFamily:'var(--font-display)',fontStyle:'italic',fontSize:'17px'}}>
                  No {activeFilter.toLowerCase()} content for {selectedCity.name} yet.
                </div>
              ) : (
                filteredStories.map(story => <StoryItem key={story.id} story={story} />)
              )}
              {!storiesLoading && selectedCity.quote && (
                <div className="city-quote">
                  <div className="city-quote__text">"{selectedCity.quote}"</div>
                  {selectedCity.quoteAttribution && (
                    <div className="city-quote__attribution">— {selectedCity.quoteAttribution}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="panel-map">
        <MapboxMap city={selectedCity} stories={filteredStories} />
      </div>
    </div>
  )
}
