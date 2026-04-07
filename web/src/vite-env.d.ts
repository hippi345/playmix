/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SPOTIFY_CLIENT_ID?: string
  readonly VITE_TIDAL_CLIENT_ID?: string
  readonly VITE_SOUNDCLOUD_CLIENT_ID?: string
  /** Defaults to http://127.0.0.1:5173/callback if unset */
  readonly VITE_SPOTIFY_REDIRECT_URI?: string
  readonly VITE_TIDAL_REDIRECT_URI?: string
  readonly VITE_SOUNDCLOUD_REDIRECT_URI?: string
  /** Optional absolute URL for token exchange (e.g. your backend); default dev: /__soundcloud-token proxy */
  readonly VITE_SOUNDCLOUD_TOKEN_URL?: string
  /** Dev: skip proxy and POST to SoundCloud token URL directly (may hit CORS in the browser). */
  readonly VITE_SOUNDCLOUD_DIRECT_TOKEN?: string
  readonly VITE_SOUNDCLOUD_DIRECT_API?: string
  /**
   * Load manifests/segments directly from SoundCloud CDNs (may hit CORS). Default: use /__soundcloud-media on localhost.
   */
  readonly VITE_SOUNDCLOUD_DIRECT_MEDIA?: string
  /** Production: absolute base URL of a proxy that implements `?url=` like dev `GET /__soundcloud-media?url=` */
  readonly VITE_SOUNDCLOUD_MEDIA_PROXY_BASE?: string
  readonly VITE_SOUNDCLOUD_LOG?: string
  readonly VITE_SOUNDCLOUD_PROXY_LOG?: string
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
