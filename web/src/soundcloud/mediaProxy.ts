import { isSoundcloudPlaybackCdnHost } from "./mediaHosts"

function directMedia(): boolean {
  return ((import.meta.env.VITE_SOUNDCLOUD_DIRECT_MEDIA ?? "") as string) === "1"
}

/**
 * Use same-origin `/__soundcloud-media` whenever the app is served from the local Vite server.
 * `import.meta.env.DEV` is false for `vite build` + `vite preview`, so we also match loopback
 * hostnames — otherwise the proxy middleware runs but the client never calls it (CORS again).
 */
function useLocalViteSoundcloudMediaProxy(): boolean {
  if (directMedia()) return false
  if (import.meta.env.DEV) return true
  if (typeof window === "undefined") return false
  const h = window.location.hostname
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true
  /**
   * `vite` / `vite preview` with `--host` (LAN IP or machine name): hostname is not loopback but
   * the app is still served by Vite and `/__soundcloud-media` exists.
   */
  const p = window.location.port
  if (p === "5173" || p === "4173") return true
  return false
}

/**
 * SoundCloud HLS is loaded via hls.js (XHR or fetch). Playback CDNs often omit CORS for arbitrary
 * origins → fatal `manifestLoadError`. The Vite dev/preview server exposes `GET /__soundcloud-media?url=…`.
 * For real production hosting, set `VITE_SOUNDCLOUD_MEDIA_PROXY_BASE` to your backend (same `?url=` contract).
 */
export function rewriteSoundcloudMediaUrlForBrowser(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url, typeof window !== "undefined" ? window.location.href : "http://127.0.0.1/")
  } catch {
    return url
  }
  if (!isSoundcloudPlaybackCdnHost(parsed.hostname)) return url

  const absolute = parsed.href
  const base = (import.meta.env.VITE_SOUNDCLOUD_MEDIA_PROXY_BASE ?? "").trim().replace(/\/$/, "")
  if (base) {
    return `${base}?url=${encodeURIComponent(absolute)}`
  }
  if (useLocalViteSoundcloudMediaProxy()) {
    return `/__soundcloud-media?url=${encodeURIComponent(absolute)}`
  }
  return url
}

/** For hls.js XhrLoader: call `xhr.open` with a proxied URL when applicable. */
export function soundcloudHlsXhrSetup(xhr: XMLHttpRequest, url: string): void {
  const next = rewriteSoundcloudMediaUrlForBrowser(url)
  if (next !== url) {
    xhr.open("GET", next, true)
  }
}

function requestUsedMediaProxy(originalUrl: string): boolean {
  return rewriteSoundcloudMediaUrlForBrowser(originalUrl) !== originalUrl
}

/**
 * hls.js hooks that rewrite CDN URLs to `/__soundcloud-media` and pass OAuth to the dev proxy
 * so Node can authorize with SoundCloud CDNs that reject anonymous fetches.
 */
export function createSoundcloudHlsNetworkHooks(accessToken: string | undefined): {
  xhrSetup: (xhr: XMLHttpRequest, url: string) => void
  fetchSetup: (context: { url: string }, initParams: RequestInit) => Request
} {
  return {
    xhrSetup(xhr, url) {
      soundcloudHlsXhrSetup(xhr, url)
      xhr.withCredentials = false
      if (accessToken && requestUsedMediaProxy(url)) {
        xhr.setRequestHeader("X-SoundCloud-Proxy-Authorization", `OAuth ${accessToken}`)
      }
    },
    fetchSetup(context, initParams) {
      const next = rewriteSoundcloudMediaUrlForBrowser(context.url)
      const headers = new Headers(initParams.headers as HeadersInit | undefined)
      if (accessToken && requestUsedMediaProxy(context.url)) {
        headers.set("X-SoundCloud-Proxy-Authorization", `OAuth ${accessToken}`)
      }
      return new Request(next, { ...initParams, headers })
    },
  }
}
