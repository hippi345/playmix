const ACCESS = "playmix_tidal_access"
const REFRESH = "playmix_tidal_refresh"
const EXPIRES = "playmix_tidal_expires_at"
const VERIFIER = "playmix_tidal_pkce_verifier"
const STATE = "playmix_tidal_pkce_state"

/**
 * Register this exact redirect in the TIDAL developer portal.
 * Loopback `localhost` vs `127.0.0.1` are different redirect URIs — most portals only list one;
 * mismatches can yield an empty/malformed response and Chrome shows "invalid response".
 */
export function tidalRedirectUri(): string {
  const fromEnv = import.meta.env.VITE_TIDAL_REDIRECT_URI?.trim()
  if (fromEnv) return fromEnv
  if (typeof window !== "undefined" && window.location?.origin) {
    const o = window.location.origin.replace(/\/$/, "")
    // Align with a typical dev registration on 127.0.0.1 (see VITE_TIDAL_REDIRECT_URI in .env).
    if (o === "http://localhost:5173" || o === "https://localhost:5173") {
      return "http://127.0.0.1:5173/callback"
    }
    return `${o}/callback`
  }
  return "http://127.0.0.1:5173/callback"
}

export function saveTidalPkcePending(verifier: string, state: string): void {
  sessionStorage.setItem(VERIFIER, verifier)
  sessionStorage.setItem(STATE, state)
}

export function readTidalPkcePending(): { verifier: string; state: string } | null {
  const verifier = sessionStorage.getItem(VERIFIER)
  const state = sessionStorage.getItem(STATE)
  if (!verifier || !state) return null
  return { verifier, state }
}

export function clearTidalPkcePending(): void {
  sessionStorage.removeItem(VERIFIER)
  sessionStorage.removeItem(STATE)
}

export interface TidalTokenBundle {
  accessToken: string
  refreshToken: string | null
  expiresInSec: number
}

export function saveTidalTokens(b: TidalTokenBundle): void {
  localStorage.setItem(ACCESS, b.accessToken)
  if (b.refreshToken) localStorage.setItem(REFRESH, b.refreshToken)
  const at = Date.now() + b.expiresInSec * 1000
  localStorage.setItem(EXPIRES, String(at))
}

export function clearTidalTokens(): void {
  localStorage.removeItem(ACCESS)
  localStorage.removeItem(REFRESH)
  localStorage.removeItem(EXPIRES)
}

export function loadTidalRefreshToken(): string | null {
  return localStorage.getItem(REFRESH)
}

export function tidalAccessTokenIfValid(): string | null {
  const t = localStorage.getItem(ACCESS)
  const exp = Number(localStorage.getItem(EXPIRES) || "0")
  if (!t || exp < Date.now() + 60_000) return null
  return t
}
