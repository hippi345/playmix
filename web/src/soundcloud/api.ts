import { refreshSoundcloudAccessToken } from "./authFlow"
import { SOUNDCLOUD_API_BASE } from "./constants"
import {
  loadSoundcloudRefreshToken,
  soundcloudAccessTokenIfValid,
} from "./session"

const SOUNDCLOUD_LOG =
  import.meta.env.DEV && ((import.meta.env.VITE_SOUNDCLOUD_LOG ?? "") as string) === "1"

type SoundcloudCollectionJson = {
  collection?: unknown[]
  next_href?: string | null
}

type SoundcloudJsonOk<T> = { ok: true; data: T }
type SoundcloudJsonErr = { ok: false; status: number; body: string }

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function rewriteApiHref(href: string): string {
  if (!SOUNDCLOUD_API_BASE.startsWith("/")) return href
  try {
    const u = new URL(href)
    if (u.hostname === "api.soundcloud.com") {
      return `${SOUNDCLOUD_API_BASE}${u.pathname}${u.search}`
    }
  } catch {
    /* ignore */
  }
  return href
}

export interface SoundcloudPlaylistItem {
  id: string
  name: string
  cover: string | null
  trackCount: number
  permalinkUrl: string | null
}

export interface SoundcloudTrackRow {
  id: string
  title: string
  artistLine: string
  durationMs: number | null
  permalinkUrl: string
}

function parsePlaylist(raw: Record<string, unknown>): SoundcloudPlaylistItem | null {
  const id = raw.id != null ? String(raw.id) : ""
  if (!id) return null
  const name = String(raw.title ?? raw.name ?? "Playlist").trim() || "Playlist"
  const art = typeof raw.artwork_url === "string" ? raw.artwork_url : null
  const tc =
    typeof raw.track_count === "number"
      ? raw.track_count
      : Number(raw.track_count ?? raw.tracks_count ?? 0) || 0
  const pl = typeof raw.permalink_url === "string" ? raw.permalink_url : null
  return { id, name, cover: art, trackCount: tc, permalinkUrl: pl }
}

function parseTrack(raw: Record<string, unknown>): SoundcloudTrackRow | null {
  const id = raw.id != null ? String(raw.id) : ""
  if (!id) return null
  const permalinkUrl = typeof raw.permalink_url === "string" ? raw.permalink_url : ""
  if (!permalinkUrl) return null
  const title = String(raw.title ?? "Track").trim() || "Track"
  const user = raw.user as Record<string, unknown> | undefined
  const artistLine =
    (typeof user?.username === "string" && user.username) ||
    (typeof user?.full_name === "string" && user.full_name) ||
    ""
  const durationMs = typeof raw.duration === "number" && raw.duration > 0 ? raw.duration : null
  return { id, title, artistLine, durationMs, permalinkUrl }
}

async function soundcloudJson<T>(
  accessToken: string,
  url: string,
  clientId: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  let token = accessToken
  let triedRefresh = false
  for (;;) {
    const res = await fetch(url, {
      headers: {
        Authorization: `OAuth ${token}`,
        Accept: "application/json; charset=utf-8",
      },
    })
    const body = await res.text()
    if (SOUNDCLOUD_LOG) {
      const preview = body.length > 900 ? `${body.slice(0, 900)}…` : body
      console.log(`[soundcloud] ${res.status} ${url}\n${preview}`)
    }
    if (res.status === 401 && !triedRefresh) {
      const rt = loadSoundcloudRefreshToken()
      if (rt && (await refreshSoundcloudAccessToken(clientId, rt))) {
        const next = soundcloudAccessTokenIfValid()
        if (next) {
          token = next
          triedRefresh = true
          continue
        }
      }
    }
    if (!res.ok) return { ok: false, status: res.status, body }
    try {
      return { ok: true, data: JSON.parse(body) as T }
    } catch {
      return { ok: false, status: res.status, body: body.slice(0, 400) }
    }
  }
}

const LIST_PAGE_GAP_MS = 550
const TRACK_PAGE_GAP_MS = 450
const MAX_LIST_PAGES = 6
const MAX_TRACK_PAGES = 12

export type SoundcloudPlaylistListResult =
  | { ok: true; items: SoundcloudPlaylistItem[]; truncated?: boolean }
  | { ok: false; status: number; detail: string }

export async function fetchMySoundcloudPlaylists(
  accessToken: string,
  clientId: string,
): Promise<SoundcloudPlaylistListResult> {
  const items: SoundcloudPlaylistItem[] = []
  let next: string | null = `${SOUNDCLOUD_API_BASE}/me/playlists?limit=50&linked_partitioning=true`
  let pages = 0
  while (next && pages < MAX_LIST_PAGES) {
    const r: SoundcloudJsonOk<SoundcloudCollectionJson> | SoundcloudJsonErr =
      await soundcloudJson<SoundcloudCollectionJson>(accessToken, next, clientId)
    if (!r.ok) {
      return { ok: false, status: r.status, detail: r.body.slice(0, 400) }
    }
    const col = r.data.collection
    if (Array.isArray(col)) {
      for (const row of col) {
        if (row && typeof row === "object") {
          const p = parsePlaylist(row as Record<string, unknown>)
          if (p) items.push(p)
        }
      }
    }
    const nh: string | null | undefined = r.data.next_href
    next = typeof nh === "string" && nh ? rewriteApiHref(nh) : null
    pages++
    if (next) await sleep(LIST_PAGE_GAP_MS)
  }
  return { ok: true, items, truncated: !!next }
}

export type SoundcloudTracksResult =
  | { ok: true; items: SoundcloudTrackRow[]; truncated?: boolean }
  | { ok: false; status: number; detail: string }

export async function fetchSoundcloudPlaylistTracks(
  accessToken: string,
  clientId: string,
  playlistId: string,
): Promise<SoundcloudTracksResult> {
  const items: SoundcloudTrackRow[] = []
  let next: string | null =
    `${SOUNDCLOUD_API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=150&linked_partitioning=true`
  let pages = 0
  while (next && pages < MAX_TRACK_PAGES) {
    const r: SoundcloudJsonOk<SoundcloudCollectionJson> | SoundcloudJsonErr =
      await soundcloudJson<SoundcloudCollectionJson>(accessToken, next, clientId)
    if (!r.ok) {
      return { ok: false, status: r.status, detail: r.body.slice(0, 400) }
    }
    const col = r.data.collection
    if (Array.isArray(col)) {
      for (const row of col) {
        if (row && typeof row === "object") {
          const t = parseTrack(row as Record<string, unknown>)
          if (t) items.push(t)
        }
      }
    }
    const nh: string | null | undefined = r.data.next_href
    next = typeof nh === "string" && nh ? rewriteApiHref(nh) : null
    pages++
    if (next) await sleep(TRACK_PAGE_GAP_MS)
  }
  return { ok: true, items, truncated: !!next }
}

export type SoundcloudPlaylistMetaResult =
  | { ok: true; name: string; artworkUrl: string | null; permalinkUrl: string | null }
  | { ok: false; status: number; detail: string }

export async function fetchSoundcloudPlaylistMeta(
  accessToken: string,
  clientId: string,
  playlistId: string,
): Promise<SoundcloudPlaylistMetaResult> {
  const url = `${SOUNDCLOUD_API_BASE}/playlists/${encodeURIComponent(playlistId)}?show_tracks=false`
  const r = await soundcloudJson<Record<string, unknown>>(accessToken, url, clientId)
  if (!r.ok) return { ok: false, status: r.status, detail: r.body.slice(0, 400) }
  const d = r.data
  const name = String(d.title ?? d.name ?? "Playlist").trim() || "Playlist"
  const artworkUrl = typeof d.artwork_url === "string" ? d.artwork_url : null
  const permalinkUrl = typeof d.permalink_url === "string" ? d.permalink_url : null
  return { ok: true, name, artworkUrl, permalinkUrl }
}

export type SoundcloudPreparePlaybackResult =
  | {
      ok: true
      objectUrl: string
      revoke: () => void
      durationMs: number
      artworkUrl: string | null
      title: string
      artistLine: string
    }
  | { ok: false; detail: string }

/** Download progressive stream via API (auth header); returns a blob URL for HTMLAudioElement. */
export async function prepareSoundcloudTrackPlayback(
  accessToken: string,
  clientId: string,
  trackId: string,
  fallbackDurationMs?: number | null,
): Promise<SoundcloudPreparePlaybackResult> {
  const metaUrl = `${SOUNDCLOUD_API_BASE}/tracks/${encodeURIComponent(trackId)}`
  const meta = await soundcloudJson<Record<string, unknown>>(accessToken, metaUrl, clientId)
  if (!meta.ok) {
    return { ok: false, detail: `Track metadata HTTP ${meta.status}: ${meta.body.slice(0, 200)}` }
  }
  const d = meta.data
  const access = typeof d.access === "string" ? d.access : ""
  if (access === "blocked") {
    return { ok: false, detail: "This track is not streamable (blocked)." }
  }
  if (d.streamable === false) {
    return { ok: false, detail: "This track is not streamable." }
  }
  let durationMs = typeof d.duration === "number" && d.duration > 0 ? d.duration : 0
  if (durationMs <= 0 && fallbackDurationMs != null && fallbackDurationMs > 0) {
    durationMs = fallbackDurationMs
  }
  if (durationMs <= 0) {
    durationMs = 1
  }

  const streamUrl = `${SOUNDCLOUD_API_BASE}/tracks/${encodeURIComponent(trackId)}/stream`
  let blob: Blob | null = null
  let lastErr = ""
  for (const authHdr of [`OAuth ${accessToken}`, `Bearer ${accessToken}`]) {
    const res = await fetch(streamUrl, {
      headers: { Authorization: authHdr, Accept: "*/*" },
    })
    if (!res.ok) {
      lastErr = await res.text().catch(() => `HTTP ${res.status}`)
      continue
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase()
    if (ct.includes("application/json")) {
      const txt = await res.text()
      lastErr = txt.slice(0, 200)
      continue
    }
    blob = await res.blob()
    break
  }
  if (!blob) {
    return {
      ok: false,
      detail: lastErr ? `Stream: ${lastErr.slice(0, 240)}` : "Could not download audio stream.",
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  const title = String(d.title ?? "Track").trim() || "Track"
  const user = d.user as Record<string, unknown> | undefined
  const artistLine =
    (typeof user?.username === "string" && user.username) ||
    (typeof user?.full_name === "string" && user.full_name) ||
    ""
  const artworkUrl = typeof d.artwork_url === "string" ? d.artwork_url : null

  return {
    ok: true,
    objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
    durationMs,
    artworkUrl,
    title,
    artistLine,
  }
}
