import { useEffect } from 'react'

function getYouTubeId(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const embedMatch = u.pathname.match(/\/embed\/([^/?]+)/)
      if (embedMatch) return embedMatch[1]
    }
  } catch {}
  return null
}

export function getYouTubeEmbedUrl(url) {
  const id = getYouTubeId(url)
  if (!id) return null
  return `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`
}

export default function VideoModal({ embedUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!embedUrl) return null

  return (
    <div className="video-modal-overlay" onClick={onClose}>
      <div className="video-modal" onClick={e => e.stopPropagation()}>
        <button className="video-modal__close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <div className="video-modal__frame-wrap">
          <iframe
            className="video-modal__iframe"
            src={embedUrl}
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            title="Video"
          />
        </div>
      </div>
    </div>
  )
}
