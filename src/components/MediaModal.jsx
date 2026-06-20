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

export default function MediaModal({ story, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!story) return null

  const url = story.mediaUrl || story.secondaryUrl
  const embedUrl = getYouTubeEmbedUrl(url) || url
  const isVideo = !!getYouTubeEmbedUrl(url)

  return (
    <div className="media-modal-overlay" onClick={onClose}>
      <div className={`media-modal${isVideo ? ' media-modal--video' : ' media-modal--web'}`} onClick={e => e.stopPropagation()}>
        <button className="media-modal__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <div className={isVideo ? 'media-modal__frame-wrap' : 'media-modal__web-wrap'}>
          <iframe
            className="media-modal__iframe"
            src={embedUrl}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            title={story.title}
          />
        </div>
      </div>
    </div>
  )
}
