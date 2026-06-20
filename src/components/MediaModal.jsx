import { useEffect } from 'react'

function getYouTubeId(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = u.pathname.match(/\/embed\/([^/?]+)/)
      if (m) return m[1]
    }
  } catch {}
  return null
}

export function getYouTubeEmbedUrl(url) {
  const id = getYouTubeId(url)
  if (!id) return null
  return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`
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

function ctaLabel(mediaType) {
  const t = (mediaType || '').toLowerCase()
  if (t === 'audiotour') return 'Start the audio tour'
  if (t === 'book') return 'Find the book'
  return 'Open to listen'
}

export default function MediaModal({ story, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!story) return null

  const url = story.mediaUrl || story.secondaryUrl
  const embedUrl = getYouTubeEmbedUrl(url)
  const duration = formatDuration(story.minutes, story.seconds)

  return (
    <div className="media-modal-overlay" onClick={onClose}>
      <div className={`media-modal${embedUrl ? ' media-modal--video' : ' media-modal--card'}`} onClick={e => e.stopPropagation()}>
        <button className="media-modal__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        {embedUrl ? (
          <div className="media-modal__frame-wrap">
            <iframe
              className="media-modal__iframe"
              src={embedUrl}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
              title={story.title}
            />
          </div>
        ) : (
          <div className="media-modal__card">
            {story.channelIcon
              ? <img className="media-modal__artwork" src={story.channelIcon + '?w=160&h=160&fit=fill'} alt={story.channelName} />
              : <div className="media-modal__artwork media-modal__artwork--placeholder" />
            }
            <div className="media-modal__card-body">
              <div className="media-modal__card-title">{story.title}</div>
              {story.channelName && (
                <div className="media-modal__card-channel">from {story.channelName}</div>
              )}
              {duration && (
                <div className="media-modal__card-duration">{duration}</div>
              )}
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="media-modal__card-btn"
                  onClick={e => e.stopPropagation()}
                >
                  {ctaLabel(story.mediaType)}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                  </svg>
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
