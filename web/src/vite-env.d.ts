/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string
  readonly VITE_TIDAL_CLIENT_ID?: string
  /** Defaults to http://127.0.0.1:5173/callback if unset */
  readonly VITE_SPOTIFY_REDIRECT_URI?: string
  readonly VITE_TIDAL_REDIRECT_URI?: string
  /** Dev: call auth.tidal.com token URL directly (default: use Vite proxy /__tidal-token) */
  readonly VITE_TIDAL_DIRECT_TOKEN?: string
  /** Dev: call openapi.tidal.com directly (default: use Vite proxy /__tidal/...) */
  readonly VITE_TIDAL_DIRECT_API?: string
  readonly VITE_TIDAL_LOG?: string
  readonly VITE_TIDAL_PROXY_LOG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
