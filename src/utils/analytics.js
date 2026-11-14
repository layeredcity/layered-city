// Privacy-friendly pageview counting with GoatCounter (no cookies, no
// personal data). Off until GOATCOUNTER_CODE is set to the site code from
// goatcounter.com, e.g. 'layeredcity' for layeredcity.goatcounter.com.
const GOATCOUNTER_CODE = ''

let loading = null
function load() {
  if (!GOATCOUNTER_CODE || typeof document === 'undefined') return null
  if (loading) return loading
  // No automatic count: the app reports each page itself, since it changes
  // pages without reloading.
  window.goatcounter = { no_onload: true }
  loading = new Promise(resolve => {
    const s = document.createElement('script')
    s.async = true
    s.src = 'https://gc.zgo.at/count.js'
    s.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`
    s.onload = resolve
    document.head.appendChild(s)
  })
  return loading
}

let last = null
export function trackPageview() {
  if (!GOATCOUNTER_CODE || location.hostname !== 'layeredcity.com') return
  const path = location.pathname
  if (path === last) return
  last = path
  load()?.then(() => window.goatcounter?.count?.({ path, title: document.title }))
}
