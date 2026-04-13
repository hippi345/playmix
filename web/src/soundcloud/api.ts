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

/**
 * `GET /tracks/…/streams` often returns absolute `https://api.soundcloud.com/tracks/…/streams/{id}/http`
 * links. The browser must request those through the dev proxy (same as other API calls) with OAuth.
 */
function soundcloudStreamRequestUrl(absoluteUrl: string): string {
  try {
    const u = new URL(absoluteUrl)
    if (u.hostname === "api.soundcloud.com" && SOUNDCLOUD_API_BASE.startsWith("/")) {
      return `${SOUNDCLOUD_API_BASE}${u.pathname}${u.search}`
    }
  } catch {
    /* ignore */
  }
  return absoluteUrl
}

function isApiSoundcloudStreamsResourceUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.hostname === "api.soundcloud.com" &&
      u.pathname.includes("/tracks/") &&
      u.pathname.includes("/streams/")
    )
  } catch {
    return false
  }
}

/**
 * Dev: browser + `__soundcloud-api` often hides `Location` on 302. Vite runs
 * `GET /__soundcloud-sign-stream?url=` in Node and returns `{ ok, url }`.
 */
function soundcloudDevStreamSignUrl(apiStreamUrl: string): string | null {
  if (!SOUNDCLOUD_API_BASE.startsWith("/")) return null
  if (!isApiSoundcloudStreamsResourceUrl(apiStreamUrl)) return null
  return `/__soundcloud-sign-stream?url=${encodeURIComponent(apiStreamUrl)}`
}

/** API paths like `…/streams/{uuid}/http-preview` always resolve to ~30s preview — never queue as full playback. */
function isSoundcloudApiPreviewStreamPath(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.hostname !== "api.soundcloud.com") return false
    return u.pathname.toLowerCase().includes("/http-preview")
  } catch {
    return false
  }
}

function isPreviewTranscoding(t: Record<string, unknown>): boolean {
  if (t.snipped === true) return true
  const preset = typeof t.preset === "string" ? t.preset.toLowerCase() : ""
  if (preset.includes("preview") || preset.includes("snippet")) return true
  return false
}

/** Full-length progressive MP3 chain (not preview) — avoids ~15s preview responses from generic `/stream`. */
function pickFullProgressiveTranscodingUrl(d: Record<string, unknown>): string | null {
  const media = d.media as Record<string, unknown> | undefined
  const list = media?.transcodings
  if (!Array.isArray(list)) return null
  for (const raw of list) {
    const t = raw as Record<string, unknown>
    if (isPreviewTranscoding(t)) continue
    const fmt = t.format as Record<string, unknown> | undefined
    if (fmt?.protocol !== "progressive") continue
    const url = typeof t.url === "string" ? t.url : ""
    if (url) return rewriteApiHref(url)
  }
  return null
}

/** AAC/HLS chain (SoundCloud’s preferred format); use with hls.js in the browser. */
function pickFullHlsTranscodingUrl(d: Record<string, unknown>): string | null {
  const media = d.media as Record<string, unknown> | undefined
  const list = media?.transcodings
  if (!Array.isArray(list)) return null
  for (const raw of list) {
    const t = raw as Record<string, unknown>
    if (isPreviewTranscoding(t)) continue
    const fmt = t.format as Record<string, unknown> | undefined
    if (fmt?.protocol !== "hls") continue
    const url = typeof t.url === "string" ? t.url : ""
    if (url) return rewriteApiHref(url)
  }
  return null
}

/** Some track JSON nests `media.transcodings` under alternate keys — walk the tree. */
function pickFirstDeepTranscoding(trackMeta: Record<string, unknown>): {
  url: string
  playbackUsesHls: boolean
} | null {
  const candidates: { url: string; playbackUsesHls: boolean; score: number }[] = []
  const walk = (n: unknown, depth: number) => {
    if (depth > 12 || n == null) return
    if (Array.isArray(n)) {
      n.forEach((x) => walk(x, depth + 1))
      return
    }
    if (typeof n !== "object") return
    const o = n as Record<string, unknown>
    const fmt = o.format
    const protocol =
      fmt && typeof fmt === "object"
        ? String((fmt as Record<string, unknown>).protocol ?? "")
        : ""
    const url = typeof o.url === "string" ? o.url : ""
    if (
      url.startsWith("http") &&
      (protocol === "hls" || protocol === "progressive") &&
      !isPreviewTranscoding(o)
    ) {
      const rew = rewriteApiHref(url)
      const score = protocol === "hls" ? 100 : 40
      candidates.push({ url: rew, playbackUsesHls: protocol === "hls", score })
    }
    for (const v of Object.values(o)) walk(v, depth + 1)
  }
  walk(trackMeta, 0)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return { url: best.url, playbackUsesHls: best.playbackUsesHls }
}

function pickStreamApiUrl(trackMeta: Record<string, unknown>, _trackId: string): {
  url: string
  playbackUsesHls: boolean
} | null {
  /** HLS before progressive — progressive `/http` resolutions often 302 to ~30s preview; AAC HLS is full-length. */
  const hls = pickFullHlsTranscodingUrl(trackMeta)
  if (hls) return { url: hls, playbackUsesHls: true }
  const progressive = pickFullProgressiveTranscodingUrl(trackMeta)
  if (progressive) return { url: progressive, playbackUsesHls: false }
  const deep = pickFirstDeepTranscoding(trackMeta)
  if (deep) return deep
  /** `/tracks/{id}/stream` is EOL and returns ~30s snippets per SoundCloud — do not use as fallback. */
  return null
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

/** Text search (Playmix). API may return `{ collection }` or a raw array. */
export async function searchSoundcloudTracks(
  accessToken: string,
  clientId: string,
  query: string,
  limit = 5,
): Promise<SoundcloudTracksResult> {
  const q = query.trim()
  if (!q) return { ok: false, status: 400, detail: "Empty search query." }
  const lim = Math.min(50, Math.max(1, limit))
  const url =
    `${SOUNDCLOUD_API_BASE}/tracks?` +
    new URLSearchParams({
      q,
      limit: String(lim),
      linked_partitioning: "true",
    }).toString()
  const r = await soundcloudJson<SoundcloudCollectionJson | unknown[]>(accessToken, url, clientId)
  if (!r.ok) return { ok: false, status: r.status, detail: r.body.slice(0, 400) }
  const raw = r.data
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as SoundcloudCollectionJson).collection)
      ? ((raw as SoundcloudCollectionJson).collection ?? [])
      : []
  const items: SoundcloudTrackRow[] = []
  for (const row of rows) {
    if (row && typeof row === "object") {
      const t = parseTrack(row as Record<string, unknown>)
      if (t) items.push(t)
    }
  }
  return { ok: true, items }
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

export type SoundcloudPlaybackAttempt = {
  audioSrc: string
  playbackUsesHls: boolean
}

export type SoundcloudPreparePlaybackResult =
  | {
      ok: true
      /** In order: prefer AAC HLS (full-length); progressive MP3 last (often preview when via API). */
      playbackAttempts: SoundcloudPlaybackAttempt[]
      /** Revoke blob URLs when replacing the track; noop for direct CDN URLs. */
      release: () => void
      durationMs: number
      artworkUrl: string | null
      title: string
      artistLine: string
    }
  | { ok: false; detail: string }

type StreamAttempt =
  | { ok: true; audioSrc: string; release: () => void }
  | { ok: false; detail: string; unauthorized: boolean }

/** SoundCloud nests stream URLs in `/tracks/{id}/streams` (not only in `media.transcodings` on the track). */
function streamsApiCandidates(trackId: string, urn: string | undefined): string[] {
  const segments = new Set<string>()
  segments.add(trackId)
  segments.add(`soundcloud:tracks:${trackId}`)
  if (urn) segments.add(urn)
  return [...segments].map(
    (seg) => `${SOUNDCLOUD_API_BASE}/tracks/${encodeURIComponent(seg)}/streams`,
  )
}

function unwrapStreamsPayload(data: Record<string, unknown>): Record<string, unknown> {
  const merge = (base: Record<string, unknown>, extra: Record<string, unknown>) => ({
    ...base,
    ...extra,
  })
  const nestedObj = data.stream_urls ?? data.urls
  if (nestedObj && typeof nestedObj === "object" && !Array.isArray(nestedObj)) {
    return merge(data, nestedObj as Record<string, unknown>)
  }
  const streams = data.streams
  if (Array.isArray(streams)) {
    let flat: Record<string, unknown> = { ...data }
    for (const item of streams) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        flat = merge(flat, item as Record<string, unknown>)
      }
    }
    return flat
  }
  if (streams && typeof streams === "object" && !Array.isArray(streams)) {
    return merge(data, streams as Record<string, unknown>)
  }
  return data
}

function streamUrlFromJsonValue(v: unknown): string | null {
  if (typeof v === "string" && v.startsWith("http")) return v
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    for (const k of ["url", "href", "link", "stream_url"]) {
      const s = o[k]
      if (typeof s === "string" && s.startsWith("http")) return s
    }
  }
  return null
}

function getStreamsField(obj: Record<string, unknown>, key: string): string | null {
  const direct = streamUrlFromJsonValue(obj[key])
  if (direct) return direct
  const norm = key.toLowerCase().replace(/-/g, "_")
  for (const [k, v] of Object.entries(obj)) {
    const kn = k.toLowerCase().replace(/-/g, "_")
    if (kn === norm) {
      const u = streamUrlFromJsonValue(v)
      if (u) return u
    }
  }
  return null
}

/** When the JSON shape doesn’t match flat `*_url` keys, still find playable links. */
function harvestStreamAttemptsFromJson(node: Record<string, unknown>): SoundcloudPlaybackAttempt[] {
  const found = new Set<string>()
  const walk = (n: unknown, depth: number) => {
    if (depth > 14) return
    if (typeof n === "string" && n.startsWith("http")) {
      if (isSoundcloudApiPreviewStreamPath(n)) return
      const low = n.toLowerCase()
      if (
        low.includes("/streams/") ||
        low.includes("media-streaming.soundcloud") ||
        low.includes(".sndcdn.com") ||
        low.endsWith(".soundcloud.cloud") ||
        low.includes(".soundcloud.cloud/")
      ) {
        found.add(n)
      }
      return
    }
    if (n && typeof n === "object") {
      if (Array.isArray(n)) n.forEach((x) => walk(x, depth + 1))
      else Object.values(n).forEach((x) => walk(x, depth + 1))
    }
  }
  walk(node, 0)
  const urls = [...found].filter((u) => !isLikelyPreviewCdnUrl(u))
  const scored = urls.map((url) => ({
    url,
    score: scoreHarvestedStreamUrl(url),
    hls: guessHarvestedUrlIsHls(url),
  }))
  scored.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const out: SoundcloudPlaybackAttempt[] = []
  for (const s of scored) {
    if (seen.has(s.url)) continue
    seen.add(s.url)
    out.push(normalizeAttemptFromUrl(s.url, s.hls))
  }
  return out
}

function scoreHarvestedStreamUrl(url: string): number {
  const u = url.toLowerCase()
  let s = 0
  if (u.includes("/hls")) s += 120
  if (u.includes("aac_160") || u.includes("aac160")) s += 40
  if (u.includes("aac")) s += 25
  if (u.includes("media-streaming")) s += 35
  if (u.includes("api.soundcloud.com") && u.includes("/streams/")) s += 15
  if (u.includes("/http")) s += 8
  if (u.includes(".mp3")) s += 5
  return s
}

function guessHarvestedUrlIsHls(url: string): boolean {
  const u = url.toLowerCase()
  return (
    u.includes(".m3u8") ||
    u.includes("/hls") ||
    u.includes("hls_") ||
    u.includes("media-streaming.soundcloud")
  )
}

function mergeStreamPlaybackAttempts(
  primary: SoundcloudPlaybackAttempt[],
  extra: SoundcloudPlaybackAttempt[],
): SoundcloudPlaybackAttempt[] {
  const seen = new Set<string>()
  const out: SoundcloudPlaybackAttempt[] = []
  for (const list of [primary, extra]) {
    for (const a of list) {
      if (!a.audioSrc.startsWith("http")) continue
      if (seen.has(a.audioSrc)) continue
      seen.add(a.audioSrc)
      out.push(a)
    }
  }
  return out
}

/** CDN preview clips (e.g. `cf-preview-media…/preview/0/30/…`) — not full tracks. */
function isLikelyPreviewCdnUrl(url: string): boolean {
  const u = url.toLowerCase()
  return u.includes("preview-media") || u.includes("cf-preview") || /\/preview\/\d/.test(u)
}

function normalizeAttemptFromUrl(url: string, declaredHls: boolean): SoundcloudPlaybackAttempt {
  const low = url.toLowerCase()
  const playbackUsesHls =
    declaredHls ||
    low.includes(".m3u8") ||
    low.includes("playlist.m3u8") ||
    low.includes("media-streaming.soundcloud")
  return { audioSrc: url, playbackUsesHls }
}

/**
 * All **full** stream URLs from `GET /tracks/…/streams`, best order for in-browser playback.
 * Prefer **AAC HLS first**: `http_mp3_128_url` often resolves through the API to a ~30s preview CDN clip;
 * HLS transcodes typically get full-length `media-streaming` manifests (media proxy handles CORS).
 * See https://developers.soundcloud.com/blog/api-streaming-urls/
 */
function collectFullStreamAttemptsFromStreamsApi(flat: Record<string, unknown>): SoundcloudPlaybackAttempt[] {
  const order: [string, boolean][] = [
    ["hls_aac_160_url", true],
    ["hls_aac_96_url", true],
    ["hls_mp3_128_url", true],
    ["hls_opus_64_url", true],
    ["http_mp3_128_url", false],
  ]
  const seen = new Set<string>()
  const out: SoundcloudPlaybackAttempt[] = []
  for (const [key, useHls] of order) {
    const v = getStreamsField(flat, key)
    if (!v || isLikelyPreviewCdnUrl(v) || isSoundcloudApiPreviewStreamPath(v)) continue
    const att = normalizeAttemptFromUrl(v, useHls)
    if (seen.has(att.audioSrc)) continue
    seen.add(att.audioSrc)
    out.push(att)
  }
  return out
}

async function fetchTrackStreamsPayload(
  accessToken: string,
  clientId: string,
  trackId: string,
  urn: string | undefined,
): Promise<Record<string, unknown> | null> {
  for (const url of streamsApiCandidates(trackId, urn)) {
    const r = await soundcloudJson<Record<string, unknown>>(accessToken, url, clientId)
    if (r.ok) return unwrapStreamsPayload(r.data)
  }
  return null
}

/**
 * Prefer HTTP 302 Location (CDN) so the browser streams the full file. Buffering the body through
 * fetch()+blob() — especially via the dev proxy — often truncates long MP3s (~10–15s of audio).
 */
async function fetchSoundcloudStreamPlayback(
  accessToken: string,
  streamUrl: string,
): Promise<StreamAttempt> {
  const signUrl = soundcloudDevStreamSignUrl(streamUrl)
  if (signUrl) {
    let lastErr = ""
    let saw401 = false
    for (const authHdr of [`OAuth ${accessToken}`, `Bearer ${accessToken}`]) {
      const res = await fetch(signUrl, {
        headers: { Authorization: authHdr, Accept: "application/json" },
      })
      if (res.status === 401) {
        saw401 = true
        lastErr = "Unauthorized"
        continue
      }
      let j: { ok?: boolean; url?: string; error?: string }
      try {
        j = (await res.json()) as { ok?: boolean; url?: string; error?: string }
      } catch {
        lastErr = `stream sign HTTP ${res.status}`
        continue
      }
      if (res.ok && j.ok === true && typeof j.url === "string" && j.url.startsWith("http")) {
        return { ok: true, audioSrc: j.url, release: () => {} }
      }
      lastErr = j.error || `stream sign HTTP ${res.status}`
    }
    return {
      ok: false,
      detail: lastErr || "stream sign failed",
      unauthorized: saw401,
    }
  }

  const reqUrl = soundcloudStreamRequestUrl(streamUrl)
  let lastErr = ""
  let saw401 = false
  /** Match `soundcloudJson` (`OAuth`); try `Bearer` second. Never bail on first 401. */
  for (const authHdr of [`OAuth ${accessToken}`, `Bearer ${accessToken}`]) {
    const manual = await fetch(reqUrl, {
      headers: { Authorization: authHdr, Accept: "*/*" },
      redirect: "manual",
    })

    if (manual.status === 401) {
      saw401 = true
      lastErr = "Unauthorized (trying alternate Authorization scheme)"
      continue
    }

    if (manual.status >= 300 && manual.status < 400) {
      const loc = manual.headers.get("Location")
      if (loc) {
        const audioSrc = loc.startsWith("http")
          ? loc
          : new URL(loc, "https://api.soundcloud.com").href
        return { ok: true, audioSrc, release: () => {} }
      }
      lastErr = `Stream redirect HTTP ${manual.status} without Location`
      continue
    }

    if (manual.ok) {
      /** Signed stream resources normally 302; some stacks return JSON `{ url }` instead. */
      if (isApiSoundcloudStreamsResourceUrl(streamUrl)) {
        const ct = (manual.headers.get("content-type") || "").toLowerCase()
        if (ct.includes("application/json")) {
          try {
            const j = (await manual.json()) as Record<string, unknown>
            const data = j.data && typeof j.data === "object" ? (j.data as Record<string, unknown>) : null
            const cand =
              (typeof j.url === "string" && j.url) ||
              (typeof j.location === "string" && j.location) ||
              (typeof j.redirect_url === "string" && j.redirect_url) ||
              (data && typeof data.url === "string" && data.url) ||
              ""
            if (typeof cand === "string" && cand.startsWith("http")) {
              return { ok: true, audioSrc: cand, release: () => {} }
            }
          } catch {
            /* fall through */
          }
          lastErr = "stream resource JSON had no usable url"
          continue
        }
        await manual.blob().catch(() => {})
        lastErr = "stream resource returned 200 (expected 302 Location to full CDN URL)"
        continue
      }
      const ct = (manual.headers.get("content-type") || "").toLowerCase()
      if (ct.includes("application/json")) {
        lastErr = (await manual.text()).slice(0, 200)
        continue
      }
      const blob = await manual.blob()
      const objectUrl = URL.createObjectURL(blob)
      return {
        ok: true,
        audioSrc: objectUrl,
        release: () => URL.revokeObjectURL(objectUrl),
      }
    }

    lastErr = (await manual.text().catch(() => "")) || `HTTP ${manual.status}`
  }
  return {
    ok: false,
    detail: lastErr || "Could not open stream",
    unauthorized: saw401,
  }
}

async function fetchSoundcloudStreamFollowBlob(
  accessToken: string,
  streamUrl: string,
): Promise<StreamAttempt> {
  const reqUrl = soundcloudStreamRequestUrl(streamUrl)
  let lastErr = ""
  let saw401 = false
  for (const authHdr of [`OAuth ${accessToken}`, `Bearer ${accessToken}`]) {
    const res = await fetch(reqUrl, {
      headers: { Authorization: authHdr, Accept: "*/*" },
      redirect: "follow",
    })
    if (res.status === 401) {
      saw401 = true
      lastErr = "Unauthorized"
      continue
    }
    if (!res.ok) {
      lastErr = await res.text().catch(() => `HTTP ${res.status}`)
      continue
    }
    if (isApiSoundcloudStreamsResourceUrl(streamUrl)) {
      lastErr = "stream resource should redirect; follow mode reached 200 body"
      await res.blob().catch(() => {})
      continue
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase()
    if (ct.includes("application/json")) {
      lastErr = (await res.text()).slice(0, 200)
      continue
    }
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    return {
      ok: true,
      audioSrc: objectUrl,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  }
  return {
    ok: false,
    detail: lastErr || "Could not download audio stream.",
    unauthorized: saw401,
  }
}

/**
 * New streams payload may point at signed `api.soundcloud.com/.../streams/{uuid}/http` resources.
 * Resolve each to a CDN URL (302 Location) or blob before the player / media proxy sees them.
 */
async function resolveStreamsApiPlaybackAttempts(
  accessToken: string,
  clientId: string,
  attempts: SoundcloudPlaybackAttempt[],
): Promise<{ attempts: SoundcloudPlaybackAttempt[]; releaseExtra: () => void }> {
  let token = accessToken
  const extraReleases: (() => void)[] = []
  const out: SoundcloudPlaybackAttempt[] = []

  for (const att of attempts) {
    if (isSoundcloudApiPreviewStreamPath(att.audioSrc)) continue
    if (!isApiSoundcloudStreamsResourceUrl(att.audioSrc)) {
      out.push(att)
      continue
    }
    let r = await fetchSoundcloudStreamPlayback(token, att.audioSrc)
    if (!r.ok && r.unauthorized) {
      const rt = loadSoundcloudRefreshToken()
      if (rt && (await refreshSoundcloudAccessToken(clientId, rt))) {
        const next = soundcloudAccessTokenIfValid()
        if (next) {
          token = next
          r = await fetchSoundcloudStreamPlayback(token, att.audioSrc)
        }
      }
    }
    if (!r.ok) continue

    if (isLikelyPreviewCdnUrl(r.audioSrc)) {
      r.release()
      continue
    }

    extraReleases.push(r.release)
    const low = r.audioSrc.toLowerCase()
    const playbackUsesHls =
      att.playbackUsesHls ||
      low.includes(".m3u8") ||
      low.includes("playlist.m3u8") ||
      low.includes("media-streaming.soundcloud") ||
      low.includes("hls")
    out.push({ audioSrc: r.audioSrc, playbackUsesHls })
  }

  return {
    attempts: out,
    releaseExtra: () => {
      for (const fn of extraReleases) {
        fn()
      }
    },
  }
}

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

  const title = String(d.title ?? "Track").trim() || "Track"
  const user = d.user as Record<string, unknown> | undefined
  const artistLine =
    (typeof user?.username === "string" && user.username) ||
    (typeof user?.full_name === "string" && user.full_name) ||
    ""
  const artworkUrl = typeof d.artwork_url === "string" ? d.artwork_url : null
  const urn = typeof d.urn === "string" ? d.urn : undefined

  let token = accessToken
  const streamsPayload = await fetchTrackStreamsPayload(token, clientId, trackId, urn)
  let rawAttempts: SoundcloudPlaybackAttempt[] = []
  if (streamsPayload) {
    rawAttempts = mergeStreamPlaybackAttempts(
      collectFullStreamAttemptsFromStreamsApi(streamsPayload),
      harvestStreamAttemptsFromJson(streamsPayload),
    )
  }
  if (rawAttempts.length === 0) {
    rawAttempts = harvestStreamAttemptsFromJson(d)
  }
  if (rawAttempts.length > 0) {
    const { attempts, releaseExtra } = await resolveStreamsApiPlaybackAttempts(
      token,
      clientId,
      rawAttempts,
    )
    if (attempts.length > 0) {
      if (SOUNDCLOUD_LOG) {
        console.log(
          "[soundcloud] /tracks/…/streams attempts (order matters):",
          attempts.map((x) => `${x.playbackUsesHls ? "HLS" : "mp3"} ${x.audioSrc.slice(0, 72)}…`),
        )
      }
      return {
        ok: true,
        playbackAttempts: attempts,
        release: releaseExtra,
        durationMs,
        artworkUrl,
        title,
        artistLine,
      }
    }
  }

  const picked = pickStreamApiUrl(d, trackId)
  if (!picked) {
    return {
      ok: false,
      detail:
        "SoundCloud did not return playable full-length URLs for this track. If this keeps happening, disconnect and reconnect SoundCloud.",
    }
  }
  const { url: streamUrl, playbackUsesHls: chosenHls } = picked
  let playbackUsesHls = chosenHls
  let streamRes = await fetchSoundcloudStreamPlayback(token, streamUrl)
  if (!streamRes.ok && streamRes.unauthorized) {
    const rt = loadSoundcloudRefreshToken()
    if (rt && (await refreshSoundcloudAccessToken(clientId, rt))) {
      const next = soundcloudAccessTokenIfValid()
      if (next) {
        token = next
        streamRes = await fetchSoundcloudStreamPlayback(token, streamUrl)
      }
    }
  }
  if (!streamRes.ok) {
    streamRes = await fetchSoundcloudStreamFollowBlob(token, streamUrl)
    if (!streamRes.ok && streamRes.unauthorized) {
      return { ok: false, detail: "SoundCloud session expired." }
    }
  }
  if (!streamRes.ok) {
    return {
      ok: false,
      detail: streamRes.detail ? `Stream: ${streamRes.detail.slice(0, 280)}` : "Could not open stream.",
    }
  }

  const srcLower = streamRes.audioSrc.toLowerCase()
  if (!playbackUsesHls && (srcLower.includes(".m3u8") || srcLower.includes("hls"))) {
    playbackUsesHls = true
  }

  return {
    ok: true,
    playbackAttempts: [{ audioSrc: streamRes.audioSrc, playbackUsesHls }],
    release: streamRes.release,
    durationMs,
    artworkUrl,
    title,
    artistLine,
  }
}
