import { TIDAL_AUTH, TIDAL_SCOPES, TIDAL_TOKEN } from "./constants"
import { createCodeChallenge, createCodeVerifier } from "../spotify/pkce"
import {
  clearTidalPkcePending,
  readTidalPkcePending,
  saveTidalPkcePending,
  saveTidalTokens,
  tidalRedirectUri,
  type TidalTokenBundle,
} from "./session"

export function startTidalLogin(clientId: string, onError?: (message: string) => void): void {
  clearTidalPkcePending()
  sessionStorage.setItem("playmix_oauth_pending", "tidal")
  const verifier = createCodeVerifier()
  const state = crypto.randomUUID()
  saveTidalPkcePending(verifier, state)
  void createCodeChallenge(verifier)
    .then((challenge) => {
      const u = new URL(TIDAL_AUTH)
      u.searchParams.set("client_id", clientId)
      u.searchParams.set("response_type", "code")
      u.searchParams.set("redirect_uri", tidalRedirectUri())
      u.searchParams.set("scope", TIDAL_SCOPES)
      u.searchParams.set("code_challenge_method", "S256")
      u.searchParams.set("code_challenge", challenge)
      u.searchParams.set("state", state)
      window.location.assign(u.toString())
    })
    .catch((e: unknown) => {
      clearTidalPkcePending()
      const msg = e instanceof Error ? e.message : "Could not start TIDAL login (PKCE)."
      onError?.(msg)
    })
}

export async function finishTidalLoginFromUrl(
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
  const pending = readTidalPkcePending()
  if (!pending || !state || state !== pending.state.trim()) {
    return "TIDAL sign-in did not match this session (use one tab, or tap Connect again)."
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: tidalRedirectUri(),
    client_id: clientId,
    code_verifier: pending.verifier,
  })
  const res = await fetch(TIDAL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const raw = await res.text()
  if (!res.ok) {
    clearTidalPkcePending()
    try {
      const j = JSON.parse(raw) as { error_description?: string; error?: string }
      return j.error_description || j.error || raw
    } catch {
      return raw || `TIDAL token error HTTP ${res.status}`
    }
  }
  const json = JSON.parse(raw) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  const bundle: TidalTokenBundle = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: json.expires_in ?? 3600,
  }
  saveTidalTokens(bundle)
  clearTidalPkcePending()
  return undefined
}

export async function refreshTidalAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<boolean> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const res = await fetch(TIDAL_TOKEN, {
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
  saveTidalTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSec: json.expires_in ?? 3600,
  })
  return true
}
