import { createCodeChallenge, createCodeVerifier } from "../spotify/pkce"
import { SOUNDCLOUD_AUTH, soundcloudTokenEndpoint } from "./constants"
import {
  clearSoundcloudPkcePending,
  readSoundcloudPkcePending,
  saveSoundcloudPkcePending,
  saveSoundcloudTokens,
  soundcloudRedirectUri,
  type SoundcloudTokenBundle,
} from "./session"

export function startSoundcloudLogin(clientId: string, onError?: (message: string) => void): void {
  clearSoundcloudPkcePending()
  sessionStorage.setItem("playmix_oauth_pending", "soundcloud")
  const verifier = createCodeVerifier()
  const state = crypto.randomUUID()
  saveSoundcloudPkcePending(verifier, state)
  void createCodeChallenge(verifier)
    .then((challenge) => {
      const u = new URL(SOUNDCLOUD_AUTH)
      u.searchParams.set("client_id", clientId)
      u.searchParams.set("redirect_uri", soundcloudRedirectUri())
      u.searchParams.set("response_type", "code")
      u.searchParams.set("code_challenge_method", "S256")
      u.searchParams.set("code_challenge", challenge)
      u.searchParams.set("state", state)
      window.location.assign(u.toString())
    })
    .catch((e: unknown) => {
      clearSoundcloudPkcePending()
      const msg = e instanceof Error ? e.message : "Could not start SoundCloud login (PKCE)."
      onError?.(msg)
    })
}

export async function finishSoundcloudLoginFromUrl(
  search: string,
  clientId: string,
): Promise<void | string> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
  const err = params.get("error")
  if (err) {
    const desc = params.get("error_description")?.trim() || err
    if (err === "invalid_client") {
      return `${desc} — In SoundCloud (soundcloud.com/you/apps), confirm the Client ID and that the redirect URI is exactly ${soundcloudRedirectUri()}. If the error persists at the token step, set SOUNDCLOUD_CLIENT_SECRET in web/.env (local only; gitignored) and restart the dev server.`
    }
    return desc
  }
  const code = params.get("code")
  const state = params.get("state")?.trim()
  if (!code) return "Missing authorization code."
  const pending = readSoundcloudPkcePending()
  if (!pending || !state || state !== pending.state.trim()) {
    return "SoundCloud sign-in did not match this session (use one tab, or tap Connect again)."
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: soundcloudRedirectUri(),
    client_id: clientId,
    code_verifier: pending.verifier,
  })
  const res = await fetch(soundcloudTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  })
  const raw = await res.text()
  if (!res.ok) {
    clearSoundcloudPkcePending()
    try {
      const j = JSON.parse(raw) as { error_description?: string; error?: string }
      const core = j.error_description?.trim() || j.error || raw || `SoundCloud token HTTP ${res.status}`
      if (j.error === "invalid_client") {
        return `${core} — Add SOUNDCLOUD_CLIENT_SECRET to web/.env (shown only on your machine; the file is gitignored), restart npm run dev, then try SoundCloud again. Also verify redirect URI matches your app registration exactly.`
      }
      return core
    } catch {
      return raw || `SoundCloud token HTTP ${res.status}`
    }
  }
  const json = JSON.parse(raw) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  const bundle: SoundcloudTokenBundle = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresInSec: json.expires_in ?? 3600,
  }
  saveSoundcloudTokens(bundle)
  clearSoundcloudPkcePending()
  return undefined
}

export async function refreshSoundcloudAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<boolean> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })
  const res = await fetch(soundcloudTokenEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  })
  const raw = await res.text()
  if (!res.ok) return false
  const json = JSON.parse(raw) as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }
  saveSoundcloudTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSec: json.expires_in ?? 3600,
  })
  return true
}
