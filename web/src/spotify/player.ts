import { SPOTIFY_API } from "./constants"

export type SpotifyRepeatState = "off" | "context" | "track"

export interface SpotifyPlaybackState {
  isPlaying: boolean
  progressMs: number
  durationMs: number | null
  item: {
    uri: string
    name: string
    artists: string
    image: string | null
    album: string | null
  } | null
  contextUri: string | null
  deviceName: string | null
  repeatState: SpotifyRepeatState
  shuffle: boolean
}

async function spotifyRequest(
  accessToken: string,
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  })
  const body = await res.text()
  return { status: res.status, body }
}

function errorDetail(status: number, body: string): string {
  if (!body) return `HTTP ${status}`
  try {
    const j = JSON.parse(body) as { error?: { message?: string; reason?: string } }
    return j.error?.message || j.error?.reason || body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

/** GET /me/player — 204 when nothing available. */
export async function fetchPlaybackState(
  accessToken: string,
): Promise<SpotifyPlaybackState | null> {
  const { status, body } = await spotifyRequest(accessToken, `${SPOTIFY_API}/me/player`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  if (status === 204 || !body) return null
  if (!status.toString().startsWith("2")) return null
  try {
    const j = JSON.parse(body) as {
      is_playing?: boolean
      progress_ms?: number
      repeat_state?: string
      shuffle_state?: boolean
      item?: {
        uri?: string
        name?: string
        duration_ms?: number
        artists?: { name?: string }[]
        album?: { name?: string; images?: { url?: string }[] }
      }
      context?: { uri?: string | null }
      device?: { name?: string }
    }
    const item = j.item
    if (!item?.name) return null
    const image = item.album?.images?.[0]?.url ?? null
    const artists = (item.artists ?? []).map((a) => a.name).filter(Boolean).join(", ")
    const rs = j.repeat_state
    const repeatState: SpotifyRepeatState =
      rs === "track" || rs === "context" ? rs : "off"
    return {
      isPlaying: !!j.is_playing,
      progressMs: typeof j.progress_ms === "number" ? j.progress_ms : 0,
      durationMs:
        typeof item.duration_ms === "number" && item.duration_ms > 0 ? item.duration_ms : null,
      item: {
        uri: item.uri ?? "",
        name: item.name,
        artists,
        image,
        album: item.album?.name ?? null,
      },
      contextUri: j.context?.uri ?? null,
      deviceName: j.device?.name ?? null,
      repeatState,
      shuffle: !!j.shuffle_state,
    }
  } catch {
    return null
  }
}

export type PlaybackCommandResult =
  | { ok: true }
  | { ok: false; status: number; detail: string }

/** Start playlist from the beginning on the user’s active Spotify Connect device. */
export async function startPlaylistPlayback(
  accessToken: string,
  playlistId: string,
): Promise<PlaybackCommandResult> {
  const url = `${SPOTIFY_API}/me/player/play`
  const { status, body } = await spotifyRequest(accessToken, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context_uri: `spotify:playlist:${playlistId}` }),
  })
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

/** Play a specific track within playlist context (Next/Prev stay in playlist). */
export async function playPlaylistTrack(
  accessToken: string,
  playlistId: string,
  trackUri: string,
): Promise<PlaybackCommandResult> {
  const url = `${SPOTIFY_API}/me/player/play`
  const { status, body } = await spotifyRequest(accessToken, url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context_uri: `spotify:playlist:${playlistId}`,
      offset: { uri: trackUri },
    }),
  })
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function setPaused(accessToken: string, pause: boolean): Promise<PlaybackCommandResult> {
  const path = pause ? "pause" : "play"
  const { status, body } = await spotifyRequest(accessToken, `${SPOTIFY_API}/me/player/${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: pause ? undefined : "{}",
  })
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function skipToNext(accessToken: string): Promise<PlaybackCommandResult> {
  const { status, body } = await spotifyRequest(accessToken, `${SPOTIFY_API}/me/player/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function skipToPrevious(accessToken: string): Promise<PlaybackCommandResult> {
  const { status, body } = await spotifyRequest(accessToken, `${SPOTIFY_API}/me/player/previous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function setShuffle(
  accessToken: string,
  shuffle: boolean,
): Promise<PlaybackCommandResult> {
  const q = new URLSearchParams({ state: shuffle ? "true" : "false" })
  const { status, body } = await spotifyRequest(
    accessToken,
    `${SPOTIFY_API}/me/player/shuffle?${q}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" },
  )
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function setRepeatMode(
  accessToken: string,
  state: SpotifyRepeatState,
): Promise<PlaybackCommandResult> {
  const q = new URLSearchParams({ state })
  const { status, body } = await spotifyRequest(
    accessToken,
    `${SPOTIFY_API}/me/player/repeat?${q}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" },
  )
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

export async function seekToPosition(
  accessToken: string,
  positionMs: number,
): Promise<PlaybackCommandResult> {
  const ms = Math.max(0, Math.floor(positionMs))
  const q = new URLSearchParams({ position_ms: String(ms) })
  const { status, body } = await spotifyRequest(
    accessToken,
    `${SPOTIFY_API}/me/player/seek?${q}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" },
  )
  if (status === 204 || status === 202) return { ok: true }
  return { ok: false, status, detail: errorDetail(status, body) }
}

