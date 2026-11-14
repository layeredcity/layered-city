import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// After the build, write static pages for link previews and search engines
// (scripts/prerender.mjs). A failure there never fails the build.
const prerender = {
  name: 'layered-city-prerender',
  apply: 'build',
  async closeBundle() {
    try { await (await import('./scripts/prerender.mjs')).default() }
    catch (e) { console.warn('[prerender] skipped:', e.message) }
  },
}

export default defineConfig({
  plugins: [react(), prerender],
})
