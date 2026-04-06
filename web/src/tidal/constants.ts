/** Match Android OAuthConstants.TIDAL_SCOPES (space-separated). */
export const TIDAL_SCOPES = ["collection.read", "playlists.read", "user.read"].join(" ")

export const TIDAL_AUTH = "https://login.tidal.com/authorize"

/**
 * Token URL: browser CORS may block the real host; in dev default to Vite proxy (see vite.config.ts).
 * Set VITE_TIDAL_DIRECT_TOKEN=1 to call auth.tidal.com directly.
 */
export const TIDAL_TOKEN =
  import.meta.env.DEV && ((import.meta.env.VITE_TIDAL_DIRECT_TOKEN ?? "") as string) !== "1"
    ? "/__tidal-token"
    : "https://auth.tidal.com/v1/oauth2/token"

/**
 * Open API v2 base (path after /v2). In dev, default proxy prefix /__tidal/v2 → openapi.tidal.com/v2.
 * Set VITE_TIDAL_DIRECT_API=1 for direct https://openapi.tidal.com/v2.
 */
export const TIDAL_OPENAPI_BASE =
  import.meta.env.DEV && ((import.meta.env.VITE_TIDAL_DIRECT_API ?? "") as string) !== "1"
    ? "/__tidal/v2"
    : "https://openapi.tidal.com/v2"
