import { TIDAL_OPENAPI_BASE } from "./constants"
import { loadTidalRefreshToken, tidalAccessTokenIfValid } from "./session"
import { refreshTidalAccessToken } from "./authFlow"

const TIDAL_LOG =
  import.meta.env.DEV && ((import.meta.env.VITE_TIDAL_LOG ?? "") as string) === "1"

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function guessCountryCode(): string {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale
    const m = loc.match(/-([A-Z]{2})$/i)
    if (m) return m[1].toUpperCase()
  } catch {
    /* ignore */
  }
  return "US"
}

export interface TidalPlaylistItem {
  id: string
  name: string
  trackCount: number
  ownerLabel: string
}

type JsonApiDoc = {
  data?: unknown[]
  included?: { type?: string; id?: string; attributes?: Record<string, unknown>; relationships?: unknown }[]
  links?: { next?: string }
}

type JsonIncluded = NonNullable<JsonApiDoc["included"]>[number]

function buildIncludedMap(included: JsonApiDoc["included"]): Map<string, JsonIncluded> {
  const map = new Map<string, JsonIncluded>()
  if (!included) return map
  for (const o of included) {
    const t = o.type
    const id = o.id
    if (t && id) map.set(`${t}:${id}`, o)
  }
  return map
}

function parsePlaylistFromIncluded(pl: {
  id?: string
  attributes?: { name?: string; numberOfItems?: number; externalLinks?: { href?: string; meta?: { type?: string } }[] }
  relationships?: { owners?: { data?: { id?: string }[] } }
}): TidalPlaylistItem {
  const id = pl.id?.trim() || "unknown"
  const attrs = pl.attributes
  const name = (attrs?.name as string | undefined)?.trim() || "Playlist"
  const trackCount =
    typeof attrs?.numberOfItems === "number" ? attrs.numberOfItems : Number(attrs?.numberOfItems ?? 0) || 0
  const owners = pl.relationships?.owners?.data
  const ownerLabel =
    owners?.[0]?.id?.trim() ||
    (Array.isArray(owners) && owners.length > 0 ? String(owners[0]?.id ?? "") : "") ||
    "TIDAL"
  return { id, name, trackCount, ownerLabel: ownerLabel || "TIDAL" }
}

function tidalErrorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as { errors?: { detail?: string; title?: string }[] }
    const e = j.errors?.[0]
    return (e?.detail || e?.title || body).slice(0, 400)
  } catch {
    return body.slice(0, 400)
  }
}

function resolveNextUrl(currentUrl: string, next: string): string | null {
  try {
    if (/^https?:\/\//i.test(next)) return next
    return new URL(next, currentUrl).toString()
  } catch {
    return null
  }
}

const LIST_PAGE_GAP_MS = 600
const MAX_PAGES = 8

export type TidalPlaylistResult =
  | { ok: true; items: TidalPlaylistItem[]; truncated?: boolean }
  | { ok: false; status: number; detail: string }

async function tidalJson(
  accessToken: string,
  url: string,
  clientId: string,
): Promise<{ ok: true; doc: JsonApiDoc } | { ok: false; status: number; body: string }> {
  let token = accessToken
  let triedRefresh = false

  for (;;) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
      },
    })
    const body = await res.text()
    if (TIDAL_LOG) {
      const preview = body.length > 900 ? `${body.slice(0, 900)}…` : body
      console.log(`[tidal] ${res.status} ${url}\n${preview}`)
    }

    if (res.status === 401 && !triedRefresh) {
      const rt = loadTidalRefreshToken()
      if (rt && (await refreshTidalAccessToken(clientId, rt))) {
        const next = tidalAccessTokenIfValid()
        if (next) {
          token = next
          triedRefresh = true
          continue
        }
      }
    }

    if (!res.ok) {
      return { ok: false, status: res.status, body }
    }
    try {
      return { ok: true, doc: JSON.parse(body) as JsonApiDoc }
    } catch {
      return { ok: false, status: res.status, body }
    }
  }
}

export async function fetchTidalPlaylistSummaries(
  accessToken: string,
  clientId: string,
): Promise<TidalPlaylistResult> {
  const country = guessCountryCode()
  const base =
    `${TIDAL_OPENAPI_BASE}/userCollectionPlaylists/me/relationships/items` +
    `?countryCode=${encodeURIComponent(country)}&include=items&sort=-addedAt`

  const out: TidalPlaylistItem[] = []
  let nextUrl: string | null = base
  let page = 0
  let truncated = false

  while (nextUrl && page < MAX_PAGES) {
    page++
    const current: string = nextUrl
    nextUrl = null
    const r = await tidalJson(accessToken, current, clientId)
    if (!r.ok) {
      return {
        ok: false,
        status: r.status,
        detail: tidalErrorDetail(r.body),
      }
    }
    const { doc } = r
    const includedMap = buildIncludedMap(doc.included)
    const dataArr = doc.data
    if (Array.isArray(dataArr)) {
      for (const ref of dataArr) {
        const item = ref as { type?: string; id?: string }
        const id = item.id?.trim()
        if (!id) continue
        const refType = item.type?.trim() || ""
        const pl =
          includedMap.get(`${refType}:${id}`) ?? includedMap.get(`playlists:${id}`)
        if (pl && typeof pl === "object" && "attributes" in pl) {
          out.push(parsePlaylistFromIncluded(pl as Parameters<typeof parsePlaylistFromIncluded>[0]))
        } else {
          out.push({
            id,
            name: "Playlist",
            trackCount: 0,
            ownerLabel: "TIDAL",
          })
        }
      }
    }
    const nextRaw = doc.links?.next
    if (!nextRaw?.trim()) break
    const resolved = resolveNextUrl(current, nextRaw)
    if (!resolved || resolved === current) break
    nextUrl = resolved
    await sleep(LIST_PAGE_GAP_MS)
  }
  if (nextUrl) truncated = true
  return { ok: true, items: out, truncated: truncated || undefined }
}

export interface TidalTrackRow {
  id: string
  name: string
  artistLine: string
  durationSec: number | null
}

export type TidalPlaylistItemsResult =
  | { ok: true; items: TidalTrackRow[]; coverUrl?: string | null; truncated?: boolean }
  | { ok: false; status: number; detail: string }

function albumCoverFromIncluded(al: JsonIncluded | undefined): string | null {
  if (!al?.attributes) return null
  const attrs = al.attributes as Record<string, unknown>
  const links = attrs.externalLinks
  if (!Array.isArray(links)) return null
  for (const L of links as { href?: string; meta?: { type?: string } }[]) {
    const href = typeof L.href === "string" ? L.href.trim() : ""
    const typ = L.meta?.type
    if (!href) continue
    if (typ === "IMAGE" || typ === "COVER" || typ === "ARTWORK" || /cover|image/i.test(typ || ""))
      return href
  }
  for (const L of links as { href?: string; meta?: { type?: string } }[]) {
    const href = typeof L.href === "string" ? L.href.trim() : ""
    if (href && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(href)) return href
  }
  return null
}

function parseTidalTrackRow(
  tr: JsonIncluded,
  includedMap: Map<string, JsonIncluded>,
): TidalTrackRow | null {
  if (!tr.id?.trim()) return null
  const attrs = tr.attributes as Record<string, unknown> | undefined
  const name =
    (typeof attrs?.name === "string" && attrs.name.trim()) ||
    (typeof attrs?.title === "string" && attrs.title.trim()) ||
    "Track"
  let durationSec: number | null = null
  const dur = attrs?.duration
  if (typeof dur === "number" && Number.isFinite(dur)) {
    durationSec = dur > 2000 ? Math.round(dur / 1000) : Math.round(dur)
  }

  const artistBits: string[] = []
  if (Array.isArray(attrs?.artists)) {
    for (const a of attrs.artists as { name?: string }[]) {
      const n = a?.name?.trim()
      if (n) artistBits.push(n)
    }
  }
  if (artistBits.length === 0 && attrs?.artist && typeof attrs.artist === "object") {
    const main = (attrs.artist as { name?: string }).name?.trim()
    if (main) artistBits.push(main)
  }
  const relArt = (tr as { relationships?: { artists?: { data?: { type?: string; id?: string }[] } } })
    .relationships?.artists?.data
  if (artistBits.length === 0 && Array.isArray(relArt)) {
    for (const ref of relArt) {
      const k = ref.type && ref.id ? `${ref.type}:${ref.id}` : ref.id ? `artists:${ref.id}` : ""
      if (!k) continue
      const art = includedMap.get(k) ?? includedMap.get(`artists:${ref.id}`)
      const an = (art?.attributes as { name?: string } | undefined)?.name?.trim()
      if (an) artistBits.push(an)
    }
  }

  return {
    id: tr.id.trim(),
    name,
    artistLine: artistBits.join(", "),
    durationSec: durationSec != null && durationSec >= 0 ? durationSec : null,
  }
}

function dereferenceToTrackResource(
  node: JsonIncluded | undefined,
  includedMap: Map<string, JsonIncluded>,
  depth: number,
): JsonIncluded | undefined {
  if (!node || depth > 5) return node
  if (/track/i.test(String(node.type ?? ""))) return node
  const rel = node.relationships as
    | {
        track?: { data?: { type?: string; id?: string } | null }
        item?: { data?: { type?: string; id?: string } | null }
      }
    | undefined
  const ref = rel?.track?.data ?? rel?.item?.data
  const id = ref?.id?.trim()
  if (!id) return node
  const typ = ref?.type?.trim()
  const k = typ ? `${typ}:${id}` : `tracks:${id}`
  const next =
    includedMap.get(k) ??
    includedMap.get(`tracks:${id}`) ??
    includedMap.get(`items:${id}`)
  if (!next || next === node) return node
  return dereferenceToTrackResource(next, includedMap, depth + 1)
}

function firstAlbumCoverForTrack(
  tr: JsonIncluded,
  includedMap: Map<string, JsonIncluded>,
): string | null {
  const relAl = (tr as { relationships?: { albums?: { data?: { type?: string; id?: string }[] } } }).relationships
    ?.albums?.data
  if (!Array.isArray(relAl) || relAl.length === 0) return null
  const ref = relAl[0]
  const k =
    ref.type && ref.id ? `${ref.type}:${ref.id}` : ref.id ? `albums:${ref.id}` : ""
  if (!k) return null
  const al = includedMap.get(k) ?? (ref.id ? includedMap.get(`albums:${ref.id}`) : undefined)
  return albumCoverFromIncluded(al)
}

async function fetchTidalPlaylistItemsFromRelationshipPath(
  accessToken: string,
  clientId: string,
  playlistId: string,
  country: string,
  relSegment: "items" | "tracks",
): Promise<TidalPlaylistItemsResult> {
  const include =
    relSegment === "items"
      ? "items,items.artists,items.albums"
      : "tracks,tracks.artists,tracks.albums"
  const base =
    `${TIDAL_OPENAPI_BASE}/playlists/${encodeURIComponent(playlistId)}` +
    `/relationships/${relSegment}` +
    `?countryCode=${encodeURIComponent(country)}` +
    `&include=${encodeURIComponent(include)}`
  const out: TidalTrackRow[] = []
  let nextUrl: string | null = base
  let page = 0
  let truncated = false
  let coverUrl: string | null = null

  while (nextUrl && page < MAX_PAGES) {
    page++
    const pageUrl: string = nextUrl
    nextUrl = null
    let pageDoc = await tidalJson(accessToken, pageUrl, clientId)
    if (!pageDoc.ok && pageDoc.status === 400 && page === 1 && include.includes(",")) {
      const simpleUrl =
        `${TIDAL_OPENAPI_BASE}/playlists/${encodeURIComponent(playlistId)}` +
        `/relationships/${relSegment}` +
        `?countryCode=${encodeURIComponent(country)}` +
        `&include=${encodeURIComponent(relSegment)}`
      pageDoc = await tidalJson(accessToken, simpleUrl, clientId)
    }
    if (!pageDoc.ok) {
      return {
        ok: false,
        status: pageDoc.status,
        detail: tidalErrorDetail(pageDoc.body),
      }
    }
    const { doc } = pageDoc
    const includedMap = buildIncludedMap(doc.included)
    const dataArr = doc.data
    if (Array.isArray(dataArr)) {
      for (const ref of dataArr) {
        const item = ref as { type?: string; id?: string }
        const id = item.id?.trim()
        if (!id) continue
        const typ = item.type?.trim() || ""
        const keys = [`${typ}:${id}`, `tracks:${id}`, `items:${id}`, `videos:${id}`]
        let tr: JsonIncluded | undefined
        for (const key of keys) {
          tr = includedMap.get(key)
          if (tr) break
        }
        if (!tr) {
          for (const [, v] of includedMap) {
            if (v.id === id && /track/i.test(String(v.type ?? ""))) {
              tr = v
              break
            }
          }
        }
        if (!tr) continue
        const resolved = dereferenceToTrackResource(tr, includedMap, 0) ?? tr
        const row = parseTidalTrackRow(resolved, includedMap)
        if (row) {
          out.push(row)
          if (!coverUrl) coverUrl = firstAlbumCoverForTrack(resolved, includedMap)
        }
      }
    }
    const nextRaw = doc.links?.next
    if (!nextRaw?.trim()) break
    const resolvedNext = resolveNextUrl(pageUrl, nextRaw)
    if (!resolvedNext || resolvedNext === pageUrl) break
    nextUrl = resolvedNext
    await sleep(LIST_PAGE_GAP_MS)
  }
  if (nextUrl) truncated = true
  return { ok: true, items: out, coverUrl, truncated: truncated || undefined }
}

/**
 * Tracks in a playlist (JSON:API). Tries `relationships/items` then `relationships/tracks`.
 */
export async function fetchTidalPlaylistItems(
  accessToken: string,
  clientId: string,
  playlistId: string,
): Promise<TidalPlaylistItemsResult> {
  const country = guessCountryCode()
  const fromItems = await fetchTidalPlaylistItemsFromRelationshipPath(
    accessToken,
    clientId,
    playlistId,
    country,
    "items",
  )
  if (fromItems.ok && fromItems.items.length > 0) return fromItems

  const fromTracks = await fetchTidalPlaylistItemsFromRelationshipPath(
    accessToken,
    clientId,
    playlistId,
    country,
    "tracks",
  )
  if (fromTracks.ok && fromTracks.items.length > 0) return fromTracks
  if (fromTracks.ok) return fromTracks
  if (fromItems.ok) return fromItems
  return fromTracks
}
