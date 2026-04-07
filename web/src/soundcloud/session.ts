const ACCESS = "playmix_soundcloud_access"
const REFRESH = "playmix_soundcloud_refresh"
const EXPIRES = "playmix_soundcloud_expires_at"
const VERIFIER = "playmix_soundcloud_pkce_verifier"
const STATE = "playmix_soundcloud_pkce_state"

/** Register this exact redirect in the SoundCloud app portal (same path as Spotify/TIDAL). */
export function soundcloudRedirectUri(): string {
  const fromEnv = import.meta.env.VITE_SOUNDCLOUD_REDIRECT_URI?.trim()
  if (fromEnv) return fromEnv
  if (typeof window !== "undefined" && window.location?.origin) {
    const o = window.location.origin.replace(/\/$/, "")
    if (o === "http://localhost:5173" || o === "https://localhost:5173") {
      return "http://127.0.0.1:5173/callback"
    }
    return `${o}/callback`
  }
  return "http://127.0.0.1:5173/callback"
}

export function saveSoundcloudPkcePending(verifier: string, state: string): void {
  sessionStorage.setItem(VERIFIER, verifier)
  sessionStorage.setItem(STATE, state)
}

export function readSoundcloudPkcePending(): { verifier: string; state: string } | null {
  const verifier = sessionStorage.getItem(VERIFIER)
  const state = sessionStorage.getItem(STATE)
  if (!verifier || !state) return null
  return { verifier, state }
}

export function clearSoundcloudPkcePending(): void {
  sessionStorage.removeItem(VERIFIER)
  sessionStorage.removeItem(STATE)
}

export interface SoundcloudTokenBundle {
  accessToken: string
  refreshToken: string | null
  expiresInSec: number
}

export function saveSoundcloudTokens(b: SoundcloudTokenBundle): void {
  localStorage.setItem(ACCESS, b.accessToken)
  if (b.refreshToken) localStorage.setItem(REFRESH, b.refreshToken)
  const at = Date.now() + b.expiresInSec * 1000
  localStorage.setItem(EXPIRES, String(at))
}

export function clearSoundcloudTokens(): void {
  localStorage.removeItem(ACCESS)
  localStorage.removeItem(REFRESH)
  localStorage.removeItem(EXPIRES)
}

export function loadSoundcloudRefreshToken(): string | null {
  return localStorage.getItem(REFRESH)
}

export function soundcloudAccessTokenIfValid(): string | null {
  const t = localStorage.getItem(ACCESS)
  const exp = Number(localStorage.getItem(EXPIRES) || "0")
  if (!t || exp < Date.now() + 60_000) return null
  return t
}
