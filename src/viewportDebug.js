// Temporary: shows what the phone reports about its screen and viewport, to
// fix the strip at the bottom on iPhones. Open with ?vpdebug in the URL, or
// tap the Layered City logo five times quickly (works in the home-screen app,
// which has no address bar).
export function setupViewportDebug() {
  if (/[?&]vpdebug/.test(location.search)) return showViewportDebug()
  let taps = []
  document.addEventListener('click', e => {
    if (!e.target.closest?.('.logo')) return
    const now = Date.now()
    taps = taps.filter(t => now - t < 2000).concat(now)
    if (taps.length >= 5) { taps = []; showViewportDebug() }
  })
}

let shown = false
function showViewportDebug() {
  if (shown) return
  shown = true
  const probe = (css) => {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;' + css
    document.body.appendChild(el)
    const h = el.getBoundingClientRect().height
    el.remove()
    return Math.round(h)
  }
  const box = document.createElement('pre')
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:40%;z-index:99999;background:rgba(0,0,0,0.85);color:#7CFC9A;font:12px/1.4 ui-monospace,monospace;padding:10px;border-radius:8px;white-space:pre-wrap;pointer-events:none'
  const render = () => {
    const app = document.querySelector('.app')
    const vv = window.visualViewport
    const lines = {
      standalone: String(window.navigator.standalone),
      'display-mode standalone': String(window.matchMedia('(display-mode: standalone)').matches),
      'html.is-standalone': String(document.documentElement.classList.contains('is-standalone')),
      '--screen-h': getComputedStyle(document.documentElement).getPropertyValue('--screen-h') || '(unset)',
      'screen.height': screen.height,
      innerHeight: window.innerHeight,
      'visualViewport.height': vv ? Math.round(vv.height) : 'n/a',
      'docEl.clientHeight': document.documentElement.clientHeight,
      '100vh': probe('height:100vh'), '100lvh': probe('height:100lvh'), '100dvh': probe('height:100dvh'), '100svh': probe('height:100svh'),
      'safe top': probe('height:env(safe-area-inset-top)'), 'safe bottom': probe('height:env(safe-area-inset-bottom)'),
      '.app rect': app ? JSON.stringify(app.getBoundingClientRect().toJSON(), (k, v) => typeof v === 'number' ? Math.round(v) : v) : 'n/a',
      '.app height css': app ? getComputedStyle(app).height : 'n/a',
    }
    box.textContent = Object.entries(lines).map(([k, v]) => k + ': ' + v).join('\n')
  }
  document.body.appendChild(box)
  render(); setInterval(render, 1000)
}
