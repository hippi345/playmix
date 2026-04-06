/** Match Android OAuthConstants.SPOTIFY_SCOPES (space-separated). */
export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ")

export const SPOTIFY_AUTH = "https://accounts.spotify.com/authorize"
export const SPOTIFY_TOKEN = "https://accounts.spotify.com/api/token"

/** In dev, default to Vite proxy so npm terminal can log API status (see vite.config.ts). */
export const SPOTIFY_API =
  import.meta.env.DEV && ((import.meta.env.VITE_SPOTIFY_DIRECT_API ?? "") as string) !== "1"
    ? "/__spotify/v1"
    : "https://api.spotify.com/v1"
