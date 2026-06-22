# Spotify playlist generator

`generate-spotify-playlists.mjs` builds one **public Spotify playlist per city**
from the song URLs you've already entered in Contentful, then writes each
playlist's URL back onto the city entry (field `musicPlaylistSpotify`). The app
embeds that playlist in the city's Music section.

Run it whenever you add or change songs:

```bash
npm run playlists
```

It's idempotent — re-running updates the same playlists in place (it reuses the
playlist already linked on each city and replaces its tracks), so you can run it
as often as you like.

## One-time setup

You need four values added to your `.env` (which is gitignored). Two you already
have (`VITE_CONTENTFUL_SPACE`, `VITE_CONTENTFUL_TOKEN`); add these:

### 1. Spotify developer app → `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. **Create app**. Name it anything (e.g. "Layered City").
3. In the app settings, add this exact **Redirect URI**:
   `http://127.0.0.1:8888/callback`
4. Copy the **Client ID** and **Client secret** into `.env`:
   ```
   SPOTIFY_CLIENT_ID=...
   SPOTIFY_CLIENT_SECRET=...
   ```

The first run opens your browser to authorize the app against *your* Spotify
account (this is whose account the playlists live on). The login happens entirely
in your browser — the script never sees your password. A refresh token is cached
in `.spotify-token.json` (gitignored) so later runs don't prompt again.

### 2. Contentful management token → `CONTENTFUL_MANAGEMENT_TOKEN`

The CDN token in `.env` is read-only. Writing the playlist URL back needs a
Content Management API token:

1. In Contentful: **Settings → API keys → Content management tokens →
   Generate personal token**.
2. Add it to `.env`:
   ```
   CONTENTFUL_MANAGEMENT_TOKEN=...
   ```

The script automatically adds the `musicPlaylistSpotify` field to the city
content type on first run if it isn't there yet.

## Notes

- Songs are added to each playlist in chronological order (oldest first), matching
  the order in the app's Music section.
- A song is included if either of its URL fields contains a Spotify track link.
  Songs without a Spotify link are skipped and listed in the run summary.
- Apple Music isn't covered: Apple's API can't create public, shareable
  playlists, so the per-song Apple links remain the Apple-side experience.
