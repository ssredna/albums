# Album Rack

Your saved Spotify albums as spines on a shelf. Click a spine to pull the record out, press play and the record flies onto the turntable and plays right in the browser.

Static Svelte + Vite app. Sign-in uses Spotify's PKCE flow in the browser, so there is no backend and no client secret.

## Setup

1. Create an app at <https://developer.spotify.com/dashboard> (the app owner needs Spotify Premium).
   - **APIs used:** Web API and Web Playback SDK
   - **Redirect URIs:** `http://127.0.0.1:5173/callback` (Spotify rejects `localhost`)
2. Copy the Client ID:
   ```bash
   cp .env.example .env.local   # then paste the Client ID
   ```
3. Run:
   ```bash
   npm install
   npm run dev
   ```
   Open <http://127.0.0.1:5173> (not `localhost`, or the redirect won't match).

Playing in the browser uses the Web Playback SDK, which needs Spotify Premium for whoever is listening. Without it, play opens the album in Spotify instead.

Development Mode allows up to 5 users. Anyone besides the owner must be added under **User Management** in the dashboard.

## Deploying

`npm run build` outputs static files to `dist/`. Host them anywhere with HTTPS and add `https://<your-domain>/callback` as a redirect URI. The host must serve `index.html` for `/callback` (SPA fallback). Cloudflare Pages does this by default; on Netlify, add a `/* /index.html 200` rewrite.

## How it works

- `src/lib/auth.ts`: PKCE sign-in, token storage and refresh
- `src/lib/spotify.ts`: pages through `GET /me/albums` (50 per request)
- `src/lib/cache.ts`: caches the album list so the rack appears instantly, then refreshes in the background
- `src/lib/player.svelte.ts`: Web Playback SDK wrapper; starts albums on the in-browser device
- `src/lib/color.ts`: samples each cover's dominant colour for its spine (cached)
- `src/components/Rack.svelte`, `Spine.svelte`: the shelf
- `src/components/Player.svelte`, `Vinyl.svelte`: the turntable, the spinning record and its flight from the shelf
