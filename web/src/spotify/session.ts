const ACCESS = "playmix_spotify_access"
const REFRESH = "playmix_spotify_refresh"
const EXPIRES = "playmix_spotify_expires_at"
const VERIFIER = "playmix_pkce_verifier"
const STATE = "playmix_pkce_state"

/**
 * Must match a redirect URI registered in the Spotify app settings, byte-for-byte.
 * Prefer setting VITE_SPOTIFY_REDIRECT_URI in .env when using a non-default host/port.
 */
export function redirectUri(): string {
  const fromEnv = import.meta.env.VITE_SPOTIFY_REDIRECT_URI?.trim()
  if (fromEnv) return fromEnv
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/callback`
  }
  return "http://127.0.0.1:5173/callback"
}

export function savePkcePending(verifier: string, state: string): void {
  sessionStorage.setItem(VERIFIER, verifier)
  sessionStorage.setItem(STATE, state)
}

export function readPkcePending(): { verifier: string; state: string } | null {
  const verifier = sessionStorage.getItem(VERIFIER)
  const state = sessionStorage.getItem(STATE)
  if (!verifier || !state) return null
  return { verifier, state }
}

export function clearPkcePending(): void {
  sessionStorage.removeItem(VERIFIER)
  sessionStorage.removeItem(STATE)
}

export interface TokenBundle {
  accessToken: string
  refreshToken: string | null
  expiresInSec: number
}

export function saveTokens(b: TokenBundle): void {
  localStorage.setItem(ACCESS, b.accessToken)
  if (b.refreshToken) localStorage.setItem(REFRESH, b.refreshToken)
  const at = Date.now() + b.expiresInSec * 1000
  localStorage.setItem(EXPIRES, String(at))
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS)
  localStorage.removeItem(REFRESH)
  localStorage.removeItem(EXPIRES)
}

export function loadRefreshToken(): string | null {
  return localStorage.getItem(REFRESH)
}

export function accessTokenIfValid(): string | null {
  const t = localStorage.getItem(ACCESS)
  const exp = Number(localStorage.getItem(EXPIRES) || "0")
  if (!t || exp < Date.now() + 60_000) return null
  return t
}
