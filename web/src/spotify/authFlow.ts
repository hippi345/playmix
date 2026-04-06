import {
  SPOTIFY_AUTH,
  SPOTIFY_SCOPES,
  SPOTIFY_TOKEN,
} from "./constants"
import { createCodeChallenge, createCodeVerifier } from "./pkce"
import {
  clearPkcePending,
  readPkcePending,
  redirectUri,
  savePkcePending,
  saveTokens,
  type TokenBundle,
} from "./session"

export function startSpotifyLogin(
  clientId: string,
  onError?: (message: string) => void,
): void {
  sessionStorage.setItem("playmix_oauth_pending", "spotify")
  clearPkcePending()
  const verifier = createCodeVerifier()
  const state = crypto.randomUUID()
  savePkcePending(verifier, state)
  void createCodeChallenge(verifier)
    .then((challenge) => {
      const u = new URL(SPOTIFY_AUTH)
      u.searchParams.set("client_id", clientId)
      u.searchParams.set("response_type", "code")
      u.searchParams.set("redirect_uri", redirectUri())
      u.searchParams.set("scope", SPOTIFY_SCOPES)
      u.searchParams.set("code_challenge_method", "S256")
      u.searchParams.set("code_challenge", challenge)
      u.searchParams.set("state", state)
      u.searchParams.set("show_dialog", "true")
      window.location.assign(u.toString())
    })
    .catch((e: unknown) => {
      clearPkcePending()
      const msg = e instanceof Error ? e.message : "Could not start secure login (PKCE)."
      onError?.(msg)
    })
}

export async function finishSpotifyLoginFromUrl(
  search: string,
  clientId: string,
): Promise<void | string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const err = params.get("error")
  if (err) {
    return params.get("error_description") || err
  }
  const code = params.get("code")
  const state = params.get("state")?.trim()
  if (!code) return "Missing authorization code."
  const pending = readPkcePending()
  if (!pending || !state || state !== pending.state.trim()) {
    return "Sign-in did not match this session (use one browser tab, or try Connect again)."
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: pending.verifier,
  })
  const res = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const raw = await res.text()
  if (!res.ok) {
    clearPkcePending()
    try {
      const j = JSON.parse(raw) as { error_description?: string; error?: string }
      return j.error_description || j.error || raw
    } catch {
      return raw || `Token error HTTP ${res.status}`
    }
  }
  const json = JSON.parse(raw) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  const bundle: TokenBundle = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: json.expires_in ?? 3600,
  }
  saveTokens(bundle)
  clearPkcePending()
  return undefined
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<boolean> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const res = await fetch(SPOTIFY_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const raw = await res.text()
  if (!res.ok) return false
  const json = JSON.parse(raw) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  saveTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSec: json.expires_in ?? 3600,
  })
  return true
}
