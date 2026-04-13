import { SPOTIFY_API } from "./constants"

const SPOTIFY_LOG =
  import.meta.env.DEV && ((import.meta.env.VITE_SPOTIFY_LOG ?? "") as string) === "1"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Spotify returns 429 with Retry-After header (seconds) or retry_after in JSON body. */
function retryAfterMs(res: Response, body: string, attemptIndex: number): number {
  const header = res.headers.get("Retry-After")
  if (header) {
    const sec = Number.parseInt(header, 10)
    if (!Number.isNaN(sec) && sec > 0) {
      return Math.min(sec * 1000, 120_000)
    }
  }
  try {
    const j = JSON.parse(body) as {
      retry_after?: number
      error?: { retry_after?: number; message?: string }
    }
    const ra = j.retry_after ?? j.error?.retry_after
    if (typeof ra === "number" && ra > 0) {
      return Math.min(ra * 1000, 120_000)
    }
  } catch {
    /* ignore */
  }
  return Math.min(2500 * 2 ** attemptIndex, 60_000)
}

function retryAfterSecondsFromResponse(res: Response, body: string): number | undefined {
  const header = res.headers.get("Retry-After")
  if (header) {
    const sec = Number.parseInt(header, 10)
    if (!Number.isNaN(sec) && sec > 0) return sec
  }
  try {
    const j = JSON.parse(body) as {
      retry_after?: number
      error?: { retry_after?: number }
    }
    const ra = j.retry_after ?? j.error?.retry_after
    if (typeof ra === "number" && ra > 0) return ra
  } catch {
    /* ignore */
  }
  return undefined
}

type JsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: string; retryAfterSeconds?: number }

/** One retry only; stacking long Retry-After waits made "Refresh" look hung for many minutes. */
const RATE_LIMIT_MAX_ATTEMPTS = 2

function capped429WaitMs(res: Response, body: string, attempt: number): number {
  const fromSpotify = retryAfterMs(res, body, attempt)
  return Math.min(Math.max(fromSpotify, 2000), 25_000)
}

/** Space out requests so dev / small Spotify quotas do not burst-limit. */
const PLAYLIST_LIST_PAGE_GAP_MS = 700
const PLAYLIST_ITEMS_PAGE_GAP_MS = 550
/** Fewer pages ⇒ fewer API calls when the account is rate-limited. */
const PLAYLIST_LIST_MAX_PAGES = 2

async function jsonRes<T>(
  accessToken: string,
  url: string,
): Promise<JsonResult<T>> {
  for (let attempt = 0; attempt < RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    })
    const body = await res.text()
    if (SPOTIFY_LOG) {
      const preview =
        body.length > 900 ? `${body.slice(0, 900)}… (${body.length} chars)` : body
      console.log(`[spotify] ${res.status} ${url}\n${preview}`)
    }
    if (res.status === 429 && attempt < RATE_LIMIT_MAX_ATTEMPTS - 1) {
      await sleep(capped429WaitMs(res, body, attempt))
      continue
    }
    if (!res.ok) {
      const raSec = res.status === 429 ? retryAfterSecondsFromResponse(res, body) : undefined
      return { ok: false, status: res.status, body, retryAfterSeconds: raSec }
    }
    try {
      return { ok: true, data: JSON.parse(body) as T }
    } catch {
      return { ok: false, status: res.status, body }
    }
  }
  return {
    ok: false,
    status: 429,
    body: JSON.stringify({ error: { message: "Too many requests" } }),
  }
}

export interface MePlaylistItem {
  id: string
  name: string
  tracks?: { total: number }
  owner?: { id?: string; display_name?: string }
  images?: { url?: string }[]
}

export interface MePlaylistsPage {
  items: MePlaylistItem[]
  next: string | null
}

export type PlaylistFetchResult =
  | { ok: true; items: MePlaylistItem[]; truncated?: boolean }
  | { ok: false; status: number; detail: string }

export async function fetchSpotifyCurrentUserId(
  accessToken: string,
): Promise<{ ok: true; id: string } | { ok: false; status: number; detail: string }> {
  const r = await jsonRes<{ id?: string }>(accessToken, `${SPOTIFY_API}/me`)
  if (!r.ok) {
    let detail = r.body.slice(0, 400)
    try {
      const j = JSON.parse(r.body) as { error?: { message?: string } }
      if (j.error?.message) detail = j.error.message
    } catch {
      /* use raw */
    }
    if (r.status === 429 && r.retryAfterSeconds != null) {
      const s = r.retryAfterSeconds
      const min = Math.max(1, Math.round(s / 60))
      detail = `${detail} Spotify says wait ${s}s (~${min} min) before trying again.`
    }
    return { ok: false, status: r.status, detail }
  }
  const id = r.data.id?.trim()
  if (!id) return { ok: false, status: 500, detail: "Spotify /me response missing id." }
  return { ok: true, id }
}

/** Lists from [/me/playlists] include followed playlists; keep only those owned by the logged-in user. */
export async function fetchAllPlaylistSummaries(
  accessToken: string,
): Promise<PlaylistFetchResult> {
  const me = await fetchSpotifyCurrentUserId(accessToken)
  if (!me.ok) return me
  const myId = me.id
  const out: MePlaylistItem[] = []
  let nextUrl: string | null = `${SPOTIFY_API}/me/playlists?limit=50`
  let pageCount = 0
  let truncated = false
  while (nextUrl) {
    pageCount++
    if (pageCount > PLAYLIST_LIST_MAX_PAGES) {
      truncated = true
      break
    }
    const current: string = nextUrl
    nextUrl = null
    const page: JsonResult<MePlaylistsPage> = await jsonRes<MePlaylistsPage>(
      accessToken,
      current,
    )
    if (!page.ok) {
      let detail = page.body.slice(0, 400)
      try {
        const j = JSON.parse(page.body) as { error?: { message?: string } }
        if (j.error?.message) detail = j.error.message
      } catch {
        /* use raw */
      }
      if (page.status === 429 && page.retryAfterSeconds != null) {
        const s = page.retryAfterSeconds
        const min = Math.max(1, Math.round(s / 60))
        detail = `${detail} Spotify says wait ${s}s (~${min} min) before trying again.`
      }
      return { ok: false, status: page.status, detail }
    }
    const chunk = (page.data.items ?? []).filter((p) => p.owner?.id === myId)
    out.push(...chunk)
    nextUrl = page.data.next
    if (nextUrl) await sleep(PLAYLIST_LIST_PAGE_GAP_MS)
  }
  return { ok: true, items: out, truncated: truncated || undefined }
}

export interface PlaylistTrackRow {
  track?: {
    id?: string
    uri?: string
    name?: string
    type?: string
    artists?: { name?: string }[]
    album?: { name?: string }
    duration_ms?: number
  }
  item?: {
    id?: string
    uri?: string
    name?: string
    type?: string
    artists?: { name?: string }[]
    album?: { name?: string }
    duration_ms?: number
  }
}

export interface PlaylistItemsPage {
  items: PlaylistTrackRow[]
  next: string | null
}

export async function fetchPlaylistItems(
  accessToken: string,
  playlistId: string,
  market: string,
): Promise<PlaylistTrackRow[]> {
  const rows: PlaylistTrackRow[] = []
  let nextUrl: string | null =
    `${SPOTIFY_API}/playlists/${encodeURIComponent(playlistId)}/items?limit=50&market=${encodeURIComponent(market)}`
  while (nextUrl) {
    const current: string = nextUrl
    nextUrl = null
    const page: JsonResult<PlaylistItemsPage> = await jsonRes<PlaylistItemsPage>(
      accessToken,
      current,
    )
    if (!page.ok) break
    rows.push(...(page.data.items ?? []))
    nextUrl = page.data.next
    if (nextUrl) await sleep(PLAYLIST_ITEMS_PAGE_GAP_MS)
  }
  return rows
}

let meProfileCache: { country: string | null; exp: number } | null = null
const ME_CACHE_MS = 45 * 60 * 1000

export function clearMeProfileCache(): void {
  meProfileCache = null
}

export async function fetchMeCountry(accessToken: string): Promise<string | null> {
  if (meProfileCache && meProfileCache.exp > Date.now()) {
    return meProfileCache.country
  }
  const r = await jsonRes<{ country?: string }>(accessToken, `${SPOTIFY_API}/me`)
  const country = r.ok && r.data.country ? r.data.country : null
  if (r.ok) {
    meProfileCache = { country, exp: Date.now() + ME_CACHE_MS }
  }
  return country
}

export type SpotifySearchTrackHit = {
  uri: string
  name: string
  artistLine: string
  durationMs: number | null
  image: string | null
}

/** Top track hit for a text query (for Playmix search). */
export async function searchSpotifyTopTrack(
  accessToken: string,
  query: string,
): Promise<
  { ok: true; track: SpotifySearchTrackHit } | { ok: false; status: number; detail: string }
> {
  const q = query.trim()
  if (!q) return { ok: false, status: 400, detail: "Empty search query." }
  const marketParam = "from_token"
  const url =
    `${SPOTIFY_API}/search?` +
    new URLSearchParams({
      q,
      type: "track",
      limit: "1",
      market: marketParam,
    }).toString()
  const r = await jsonRes<{
    tracks?: {
      items?: {
        uri?: string
        name?: string
        duration_ms?: number
        artists?: { name?: string }[]
        album?: { images?: { url?: string }[] }
      }[]
    }
  }>(accessToken, url)
  if (!r.ok) {
    let detail = r.body.slice(0, 400)
    try {
      const j = JSON.parse(r.body) as { error?: { message?: string } }
      if (j.error?.message) detail = j.error.message
    } catch {
      /* keep */
    }
    return { ok: false, status: r.status, detail }
  }
  const item = r.data.tracks?.items?.[0]
  if (!item) {
    return { ok: false, status: 404, detail: "No tracks found for that search." }
  }
  const uri = item.uri?.trim()
  const name = item.name?.trim()
  if (!uri || !name) {
    return { ok: false, status: 404, detail: "No tracks found for that search." }
  }
  const artists = (item.artists ?? []).map((a) => a.name).filter(Boolean).join(", ")
  const image = item.album?.images?.[0]?.url ?? null
  const durationMs =
    typeof item.duration_ms === "number" && item.duration_ms > 0 ? item.duration_ms : null
  return {
    ok: true,
    track: { uri, name, artistLine: artists, durationMs, image },
  }
}

export async function fetchPlaylistMeta(
  accessToken: string,
  playlistId: string,
): Promise<
  | { ok: true; name: string; image?: string }
  | { ok: false; status: number; body: string }
> {
  const r = await jsonRes<{ name?: string; images?: { url?: string }[] }>(
    accessToken,
    `${SPOTIFY_API}/playlists/${encodeURIComponent(playlistId)}?market=from_token`,
  )
  if (!r.ok) return { ok: false, status: r.status, body: r.body }
  const img = r.data.images?.[0]?.url
  return { ok: true, name: r.data.name || "Playlist", image: img }
}
