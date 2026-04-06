# Playmix (Web)

Vite + React + TypeScript front end that mirrors the Android app’s Spotify scopes and uses the same Web API patterns (PKCE, `/me/playlists`, `/playlists/{id}/items`).

## Setup

1. Copy `.env.example` to `.env` and set `VITE_SPOTIFY_CLIENT_ID` (same value as `spotify.client.id` in the Android `local.properties`).

2. In [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → your app → **Redirect URIs**, add **exactly**:
   - `http://127.0.0.1:5173/callback`  
   (Copy from the banner on the app home screen if you use a custom `VITE_SPOTIFY_REDIRECT_URI`.)

3. Install and run:

   ```bash
   cd web
   npm install
   npm run dev
   ```

4. Open **`http://127.0.0.1:5173/`** in **Chrome, Edge, or Firefox** — not the embedded “Simple Browser” inside VS Code / Cursor; Spotify OAuth often fails there with **“invalid response”**.

5. Click **Connect Spotify**, approve, then **Refresh playlists** and open a playlist.

## Production

Set your deployed origin in `VITE_SPOTIFY_REDIRECT_URI` (e.g. `https://yourdomain.com/callback`) and add that exact URL in the Spotify app settings. Build with `npm run build` and host the `dist/` folder on HTTPS.

## Notes

- Tokens are stored in `localStorage` (refresh) and session timing in `localStorage`; PKCE verifier uses `sessionStorage` during login.
- Spotify may return empty or restricted data for playlists you only **follow** (not own/collaborate); that matches current Web API behavior.
