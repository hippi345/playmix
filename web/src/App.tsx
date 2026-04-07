import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NowPlayingBar } from "./components/NowPlayingBar"
import { ServiceSidebar } from "./components/ServiceSidebar"
import {
  clearMeProfileCache,
  fetchAllPlaylistSummaries,
  fetchMeCountry,
  fetchPlaylistItems,
  fetchPlaylistMeta,
  type MePlaylistItem,
  type PlaylistTrackRow,
} from "./spotify/api"
import {
  fetchPlaybackState,
  playPlaylistTrack,
  seekToPosition,
  setPaused,
  setRepeatMode,
  setShuffle,
  skipToNext,
  skipToPrevious,
  startPlaylistPlayback,
  type SpotifyPlaybackState,
  type SpotifyRepeatState,
} from "./spotify/player"
import type { NowPlayingBarModel } from "./components/NowPlayingBar"
import {
  finishSpotifyLoginFromUrl,
  refreshAccessToken,
  startSpotifyLogin,
} from "./spotify/authFlow"
import {
  accessTokenIfValid,
  clearTokens,
  loadRefreshToken,
  readPkcePending,
} from "./spotify/session"
import {
  fetchTidalPlaylistItems,
  fetchTidalPlaylistSummaries,
  type TidalPlaylistItem,
  type TidalTrackRow,
} from "./tidal/api"
import {
  finishTidalLoginFromUrl,
  refreshTidalAccessToken,
  startTidalLogin,
} from "./tidal/authFlow"
import { openTidalPlaylist, openTidalTrack, tidalPlaylistUrl } from "./tidal/deeplink"
import {
  clearTidalTokens,
  loadTidalRefreshToken,
  readTidalPkcePending,
  tidalAccessTokenIfValid,
} from "./tidal/session"
import {
  fetchMySoundcloudPlaylists,
  fetchSoundcloudPlaylistMeta,
  fetchSoundcloudPlaylistTracks,
  prepareSoundcloudTrackPlayback,
  type SoundcloudPlaylistItem,
  type SoundcloudTrackRow,
} from "./soundcloud/api"
import {
  finishSoundcloudLoginFromUrl,
  refreshSoundcloudAccessToken,
  startSoundcloudLogin,
} from "./soundcloud/authFlow"
import { openSoundcloudPermalink } from "./soundcloud/deeplink"
import {
  createSoundcloudHlsNetworkHooks,
  rewriteSoundcloudMediaUrlForBrowser,
} from "./soundcloud/mediaProxy"
import {
  clearSoundcloudTokens,
  loadSoundcloudRefreshToken,
  readSoundcloudPkcePending,
  soundcloudAccessTokenIfValid,
} from "./soundcloud/session"

type LibraryTab = "all" | "spotify" | "tidal" | "soundcloud"

type SoundcloudDeckState = {
  queue: SoundcloudTrackRow[]
  queueIndex: number
  trackId: string
  title: string
  artistLine: string
  artworkUrl: string | null
  durationMs: number
  positionMs: number
  isPlaying: boolean
  loading: boolean
}

type UnifiedPlaylist =
  | {
      service: "spotify"
      id: string
      name: string
      cover: string | null
    }
  | {
      service: "tidal"
      id: string
      name: string
      owner: string
    }
  | {
      service: "soundcloud"
      id: string
      name: string
      cover: string | null
    }

/** Hides raw OAuth/state tokens from the alert (user-readable messages contain spaces or punctuation). */
function isLikelyOpaqueTokenMessage(message: string): boolean {
  const s = message.trim()
  return s.length >= 18 && s.length <= 256 && /^[A-Za-z0-9_-]+$/.test(s)
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function trackRowTitle(row: PlaylistTrackRow): string {
  const t = row.track ?? row.item
  if (!t || t.type === "episode") return "(not a track)"
  return t.name || "(untitled)"
}

function trackRowArtists(row: PlaylistTrackRow): string {
  const t = row.track ?? row.item
  if (!t?.artists?.length) return ""
  return t.artists.map((a) => a.name).filter(Boolean).join(", ")
}

function trackUri(row: PlaylistTrackRow): string | null {
  const t = row.track ?? row.item
  return t?.uri?.trim() || null
}

function formatTidalTrackDuration(sec: number | null): string {
  if (sec == null || sec < 0 || !Number.isFinite(sec)) return ""
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

function unifiedPlaylistMatchesQuery(p: UnifiedPlaylist, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (p.name.toLowerCase().includes(q)) return true
  if (p.service === "tidal" && p.owner?.toLowerCase().includes(q)) return true
  return false
}

function formatSoundcloudDuration(ms: number | null): string {
  if (ms == null || ms < 0 || !Number.isFinite(ms)) return ""
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

function spotifyRowIsPlayableTrack(row: PlaylistTrackRow): boolean {
  const t = row.track ?? row.item
  if (t?.type && t.type !== "track") return false
  return true
}

function spotifyCover(p: MePlaylistItem): string | null {
  return p.images?.find((i) => i.url)?.url ?? null
}

export default function App() {
  const spotifyClientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID?.trim() || ""
  const tidalClientId = import.meta.env.VITE_TIDAL_CLIENT_ID?.trim() || ""
  const soundcloudClientId = import.meta.env.VITE_SOUNDCLOUD_CLIENT_ID?.trim() || ""
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (err != null && isLikelyOpaqueTokenMessage(err)) setErr(null)
  }, [err])
  const [signedIn, setSignedIn] = useState(false)
  const [playlists, setPlaylists] = useState<MePlaylistItem[]>([])
  const [playlistListNote, setPlaylistListNote] = useState<string | null>(null)
  const playlistsLoadRef = useRef(false)

  const [tidalSignedIn, setTidalSignedIn] = useState(false)
  const [tidalPlaylists, setTidalPlaylists] = useState<TidalPlaylistItem[]>([])
  const [tidalListNote, setTidalListNote] = useState<string | null>(null)
  const tidalLoadRef = useRef(false)

  const [libraryTab, setLibraryTab] = useState<LibraryTab>("all")

  const [selectedSpotifyId, setSelectedSpotifyId] = useState<string | null>(null)
  const [selectedTidal, setSelectedTidal] = useState<TidalPlaylistItem | null>(null)
  const [detailName, setDetailName] = useState<string>("")
  const [detailCover, setDetailCover] = useState<string | null>(null)
  const [tracks, setTracks] = useState<PlaylistTrackRow[]>([])
  const [tracksNote, setTracksNote] = useState<string | null>(null)
  const [tidalDetailTracks, setTidalDetailTracks] = useState<TidalTrackRow[]>([])
  const [tidalTracksNote, setTidalTracksNote] = useState<string | null>(null)
  /** Full-screen playlist + tracks (separate from main grid). */
  const [playlistDetailView, setPlaylistDetailView] = useState(false)
  const [libraryRefreshing, setLibraryRefreshing] = useState(false)
  const [playlistLibrarySearch, setPlaylistLibrarySearch] = useState("")
  const [playlistDetailTrackSearch, setPlaylistDetailTrackSearch] = useState("")

  const [soundcloudSignedIn, setSoundcloudSignedIn] = useState(false)
  const [soundcloudPlaylists, setSoundcloudPlaylists] = useState<SoundcloudPlaylistItem[]>([])
  const [soundcloudListNote, setSoundcloudListNote] = useState<string | null>(null)
  const soundcloudLoadRef = useRef(false)
  const [selectedSoundcloud, setSelectedSoundcloud] = useState<SoundcloudPlaylistItem | null>(null)
  const [soundcloudDetailTracks, setSoundcloudDetailTracks] = useState<SoundcloudTrackRow[]>([])
  const [soundcloudTracksNote, setSoundcloudTracksNote] = useState<string | null>(null)
  const [soundcloudDeck, setSoundcloudDeck] = useState<SoundcloudDeckState | null>(null)

  const soundcloudAudioRef = useRef<HTMLAudioElement | null>(null)
  const soundcloudHlsRef = useRef<InstanceType<typeof import("hls.js").default> | null>(null)
  const soundcloudStreamReleaseRef = useRef<(() => void) | null>(null)
  const soundcloudDeckRef = useRef<SoundcloudDeckState | null>(null)
  const loadSoundcloudAtIndexRef = useRef<(q: SoundcloudTrackRow[], i: number) => void>(() => {})

  const [spotifyPlayback, setSpotifyPlayback] = useState<SpotifyPlaybackState | null>(null)
  /** Set when the user starts a TIDAL playlist from Playmix; cleared when Spotify starts playing. */
  const [tidalNowPlaying, setTidalNowPlaying] = useState<{
    playlistName: string
    playlistId: string
  } | null>(null)

  const closePlaylistDetail = useCallback(() => {
    setPlaylistDetailView(false)
    setSelectedSpotifyId(null)
    setSelectedTidal(null)
    setDetailName("")
    setDetailCover(null)
    setTracks([])
    setTracksNote(null)
    setTidalDetailTracks([])
    setTidalTracksNote(null)
    setSelectedSoundcloud(null)
    setSoundcloudDetailTracks([])
    setSoundcloudTracksNote(null)
    setPlaylistDetailTrackSearch("")
  }, [])

  const syncSession = useCallback(async () => {
    let t = accessTokenIfValid()
    if (!t) {
      const rt = loadRefreshToken()
      if (rt && spotifyClientId) {
        const ok = await refreshAccessToken(spotifyClientId, rt)
        if (ok) t = accessTokenIfValid()
      }
    }
    setSignedIn(!!t)
    return t
  }, [spotifyClientId])

  const syncTidalSession = useCallback(async () => {
    let t = tidalAccessTokenIfValid()
    if (!t) {
      const rt = loadTidalRefreshToken()
      if (rt && tidalClientId) {
        const ok = await refreshTidalAccessToken(tidalClientId, rt)
        if (ok) t = tidalAccessTokenIfValid()
      }
    }
    setTidalSignedIn(!!t)
    return t
  }, [tidalClientId])

  const syncSoundcloudSession = useCallback(async () => {
    let t = soundcloudAccessTokenIfValid()
    if (!t) {
      const rt = loadSoundcloudRefreshToken()
      if (rt && soundcloudClientId) {
        const ok = await refreshSoundcloudAccessToken(soundcloudClientId, rt)
        if (ok) t = soundcloudAccessTokenIfValid()
      }
    }
    setSoundcloudSignedIn(!!t)
    return t
  }, [soundcloudClientId])

  const refreshPlaybackUi = useCallback(async () => {
    const t = await syncSession()
    if (!t) {
      setSpotifyPlayback(null)
      return
    }
    setSpotifyPlayback(await fetchPlaybackState(t))
  }, [syncSession])

  /** Pause Spotify Connect playback so in-browser SoundCloud can take over. */
  const pauseSpotifyRemote = useCallback(async () => {
    if (!spotifyClientId) return
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    const r = await setPaused(t, true)
    if (!r.ok) return
    await refreshPlaybackUi()
  }, [spotifyClientId, syncSession, refreshPlaybackUi])

  const revokeSoundcloudBlobUrl = useCallback(() => {
    soundcloudStreamReleaseRef.current?.()
    soundcloudStreamReleaseRef.current = null
  }, [])

  const pauseLocalSoundcloud = useCallback(() => {
    const a = soundcloudAudioRef.current
    if (a && !a.paused) a.pause()
    setSoundcloudDeck((d) => (d ? { ...d, isPlaying: false } : d))
  }, [])

  const loadAndPlaySoundcloudAtIndex = useCallback(
    async (queue: SoundcloudTrackRow[], index: number) => {
      if (!soundcloudClientId) return
      const row = queue[index]
      if (!row) return
      setTidalNowPlaying(null)
      setErr(null)
      const t = await syncSoundcloudSession()
      if (!t) {
        setErr("SoundCloud session expired. Connect again from the sidebar.")
        setSoundcloudDeck(null)
        return
      }

      const audio = soundcloudAudioRef.current
      if (audio) {
        audio.onended = null
        audio.pause()
        revokeSoundcloudBlobUrl()
        audio.removeAttribute("src")
        audio.load()
      }

      setSoundcloudDeck({
        queue,
        queueIndex: index,
        trackId: row.id,
        title: row.title,
        artistLine: row.artistLine,
        artworkUrl: null,
        durationMs: row.durationMs ?? 1,
        positionMs: 0,
        isPlaying: false,
        loading: true,
      })

      const prep = await prepareSoundcloudTrackPlayback(t, soundcloudClientId, row.id, row.durationMs)
      if (!prep.ok) {
        setErr(prep.detail)
        setSoundcloudDeck(null)
        return
      }

      const a = soundcloudAudioRef.current
      if (!a) {
        revokeSoundcloudBlobUrl()
        setSoundcloudDeck(null)
        setErr("Audio element not ready.")
        return
      }

      setSoundcloudDeck({
        queue,
        queueIndex: index,
        trackId: row.id,
        title: prep.title,
        artistLine: prep.artistLine || row.artistLine,
        artworkUrl: prep.artworkUrl,
        durationMs: prep.durationMs,
        positionMs: 0,
        isPlaying: false,
        loading: false,
      })

      const attempts = prep.playbackAttempts.filter((x) => x.audioSrc?.trim())
      if (attempts.length === 0) {
        revokeSoundcloudBlobUrl()
        setSoundcloudDeck(null)
        setErr("SoundCloud returned no playable URLs for this track.")
        return
      }

      const waitAudioCanPlay = () =>
        new Promise<void>((resolve, reject) => {
          if (a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
            resolve()
            return
          }
          const tm = window.setTimeout(() => {
            a.removeEventListener("canplay", onReady)
            a.removeEventListener("error", onFail)
            reject(new Error("SoundCloud audio timed out while loading."))
          }, 30_000)
          const onReady = () => {
            window.clearTimeout(tm)
            resolve()
          }
          const onFail = () => {
            window.clearTimeout(tm)
            const err = a.error
            const code = err?.code ?? 0
            const msg =
              code === 4
                ? "This audio source is not supported or could not be loaded (codec / network / rights)."
                : err?.message || "Audio failed to load."
            reject(new Error(msg))
          }
          a.addEventListener("canplay", onReady, { once: true })
          a.addEventListener("error", onFail, { once: true })
        })

      let setupError: string | null = null
      for (let ai = 0; ai < attempts.length; ai++) {
        const { audioSrc, playbackUsesHls: attHls } = attempts[ai]
        const srcLow = audioSrc.toLowerCase()
        const looksLikeHls =
          attHls ||
          srcLow.includes(".m3u8") ||
          srcLow.includes("playlist.m3u8") ||
          srcLow.includes("media-streaming.soundcloud")

        soundcloudHlsRef.current?.destroy()
        soundcloudHlsRef.current = null
        revokeSoundcloudBlobUrl()
        soundcloudStreamReleaseRef.current = null
        a.pause()
        a.removeAttribute("src")
        a.load()

        try {
          if (looksLikeHls) {
            const mod = await import("hls.js")
            const HlsCtor = mod.default
            const canMse = typeof HlsCtor.isSupported === "function" && HlsCtor.isSupported()
            const canNativeHls = !!a.canPlayType?.("application/vnd.apple.mpegurl")
            if (canMse) {
              const hlsNet = createSoundcloudHlsNetworkHooks(t)
              const hls = new HlsCtor({
                enableWorker: false,
                xhrSetup: hlsNet.xhrSetup,
                fetchSetup: hlsNet.fetchSetup,
              })
              soundcloudHlsRef.current = hls
              hls.loadSource(rewriteSoundcloudMediaUrlForBrowser(audioSrc))
              hls.attachMedia(a)
              soundcloudStreamReleaseRef.current = () => {
                hls.destroy()
                soundcloudHlsRef.current = null
                prep.release()
              }
              await new Promise<void>((resolve, reject) => {
                const tm = window.setTimeout(() => {
                  hls.off(HlsCtor.Events.MANIFEST_PARSED, onParsed)
                  hls.off(HlsCtor.Events.ERROR, onErr)
                  reject(new Error("SoundCloud HLS manifest timed out."))
                }, 30_000)
                const onParsed = () => {
                  window.clearTimeout(tm)
                  hls.off(HlsCtor.Events.MANIFEST_PARSED, onParsed)
                  hls.off(HlsCtor.Events.ERROR, onErr)
                  resolve()
                }
                const onErr = (
                  _: unknown,
                  data: { fatal?: boolean; type?: string; details?: string },
                ) => {
                  if (!data.fatal) return
                  window.clearTimeout(tm)
                  hls.off(HlsCtor.Events.MANIFEST_PARSED, onParsed)
                  hls.off(HlsCtor.Events.ERROR, onErr)
                  const detail = data.details || data.type || "HLS error"
                  reject(
                    new Error(
                      detail === "manifestLoadError"
                        ? "HLS manifest could not load (often CDN CORS). Trying another format if available…"
                        : detail,
                    ),
                  )
                }
                hls.on(HlsCtor.Events.MANIFEST_PARSED, onParsed)
                hls.on(HlsCtor.Events.ERROR, onErr)
              })
            } else if (canNativeHls) {
              soundcloudHlsRef.current = null
              a.src = rewriteSoundcloudMediaUrlForBrowser(audioSrc)
              soundcloudStreamReleaseRef.current = prep.release
              await waitAudioCanPlay()
            } else {
              throw new Error(
                "HLS playback needs Chrome, Firefox, Edge, or Safari (native HLS).",
              )
            }
          } else {
            soundcloudHlsRef.current = null
            a.src = rewriteSoundcloudMediaUrlForBrowser(audioSrc)
            soundcloudStreamReleaseRef.current = prep.release
            await waitAudioCanPlay()
          }
          setupError = null
          break
        } catch (e) {
          soundcloudHlsRef.current?.destroy()
          soundcloudHlsRef.current = null
          setupError = e instanceof Error ? e.message : String(e)
          if (ai === attempts.length - 1) {
            revokeSoundcloudBlobUrl()
            setSoundcloudDeck(null)
            setErr(
              attempts.length > 1
                ? `Could not play this track after ${attempts.length} tries. Last error: ${setupError}`
                : setupError,
            )
            return
          }
        }
      }

      if (setupError) {
        return
      }

      a.onended = () => {
        const deck = soundcloudDeckRef.current
        if (!deck) return
        const next = deck.queueIndex + 1
        if (next < deck.queue.length) {
          loadSoundcloudAtIndexRef.current(deck.queue, next)
        } else {
          setSoundcloudDeck({
            ...deck,
            isPlaying: false,
            positionMs: deck.durationMs,
          })
        }
      }

      try {
        await pauseSpotifyRemote()
        await a.play()
        setSoundcloudDeck((prev) =>
          prev && prev.trackId === row.id ? { ...prev, isPlaying: true, positionMs: 0 } : prev,
        )
      } catch (e) {
        revokeSoundcloudBlobUrl()
        setSoundcloudDeck(null)
        setErr(e instanceof Error ? e.message : "SoundCloud playback failed.")
      }
    },
    [pauseSpotifyRemote, soundcloudClientId, revokeSoundcloudBlobUrl, syncSoundcloudSession],
  )

  useEffect(() => {
    loadSoundcloudAtIndexRef.current = (q, i) => {
      void loadAndPlaySoundcloudAtIndex(q, i)
    }
  }, [loadAndPlaySoundcloudAtIndex])

  useEffect(() => {
    soundcloudDeckRef.current = soundcloudDeck
  }, [soundcloudDeck])

  useEffect(() => {
    if (!soundcloudDeck?.isPlaying || soundcloudDeck.loading) return
    const a = soundcloudAudioRef.current
    if (!a) return
    const id = window.setInterval(() => {
      const ms = Math.floor(a.currentTime * 1000)
      setSoundcloudDeck((d) => {
        if (!d || d.loading) return d
        const cap = Math.max(d.durationMs, 1)
        return { ...d, positionMs: Math.min(cap, ms) }
      })
    }, 400)
    return () => window.clearInterval(id)
  }, [soundcloudDeck?.isPlaying, soundcloudDeck?.trackId, soundcloudDeck?.loading])

  useEffect(() => {
    const a = soundcloudAudioRef.current
    if (!a) return
    const onMeta = () => {
      const raw = a.duration
      if (!Number.isFinite(raw) || raw <= 0) return
      const dur = Math.floor(raw * 1000)
      setSoundcloudDeck((d) => (d && dur > d.durationMs ? { ...d, durationMs: dur } : d))
    }
    a.addEventListener("loadedmetadata", onMeta)
    return () => a.removeEventListener("loadedmetadata", onMeta)
  }, [])

  const nowPlayingBarModel = useMemo((): NowPlayingBarModel | null => {
    const sp = spotifyPlayback
    const tidal = tidalNowPlaying
    const sc = soundcloudDeck

    if (sp?.isPlaying && sp.item) {
      return { source: "spotify", state: sp }
    }

    if (sc && !sp?.isPlaying) {
      return {
        source: "soundcloud",
        trackKey: sc.trackId,
        title: sc.title,
        subtitle: sc.artistLine,
        artworkUrl: sc.artworkUrl,
        durationMs: sc.durationMs,
        positionMs: sc.positionMs,
        isPlaying: sc.isPlaying,
        loading: sc.loading,
        canNext: sc.queueIndex + 1 < sc.queue.length,
      }
    }

    if (tidal) {
      return {
        source: "tidal",
        title: tidal.playlistName,
        subtitle: "In TIDAL web tab — pause there if you switch to Spotify",
      }
    }

    if (sp?.item) {
      return { source: "spotify", state: sp }
    }

    return null
  }, [spotifyPlayback, tidalNowPlaying, soundcloudDeck])

  useEffect(() => {
    if (spotifyPlayback?.isPlaying) {
      setTidalNowPlaying(null)
    }
  }, [spotifyPlayback?.isPlaying])

  useEffect(() => {
    if (!signedIn) {
      setSpotifyPlayback(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      const t = await syncSession()
      if (!t || cancelled) return
      const st = await fetchPlaybackState(t)
      if (!cancelled) setSpotifyPlayback(st)
    }
    void tick()
    const id = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [signedIn, syncSession])

  const loadPlaylists = useCallback(async () => {
    if (playlistsLoadRef.current) return
    playlistsLoadRef.current = true
    setErr(null)
    setPlaylistListNote(null)
    setBusy(true)
    try {
      let t = await syncSession()
      if (!t) {
        setErr("Session expired. Sign out and connect Spotify again.")
        setSignedIn(false)
        return
      }
      let result = await fetchAllPlaylistSummaries(t)
      if (!result.ok && result.status === 401 && spotifyClientId) {
        const rt = loadRefreshToken()
        if (rt && (await refreshAccessToken(spotifyClientId, rt))) {
          t = accessTokenIfValid()
          if (t) result = await fetchAllPlaylistSummaries(t)
        }
      }
      if (!result.ok) {
        setErr(
          result.status === 403
            ? `Spotify blocked playlists (${result.detail}). Check scopes and dashboard app settings.`
            : result.status === 429
              ? `Spotify rate limit (429): ${result.detail} Wait a few minutes, then refresh.`
              : `Could not load playlists (HTTP ${result.status}): ${result.detail}`,
        )
        setPlaylists([])
        return
      }
      setPlaylists(result.items)
      if (result.truncated) {
        setPlaylistListNote(
          `Loaded the first ${result.items.length} playlists only (page cap to reduce API calls).`,
        )
      }
    } catch (e: unknown) {
      setErr(
        e instanceof TypeError && e.message === "Failed to fetch"
          ? "Network error loading Spotify."
          : e instanceof Error
            ? e.message
            : "Network error.",
      )
      setPlaylists([])
    } finally {
      playlistsLoadRef.current = false
      setBusy(false)
    }
  }, [spotifyClientId, syncSession])

  const loadTidalPlaylists = useCallback(async () => {
    if (tidalLoadRef.current) return
    tidalLoadRef.current = true
    setErr(null)
    setTidalListNote(null)
    setBusy(true)
    try {
      let t = await syncTidalSession()
      if (!t) {
        setErr("TIDAL session expired. Connect TIDAL again.")
        setTidalSignedIn(false)
        return
      }
      let result = await fetchTidalPlaylistSummaries(t, tidalClientId)
      if (!result.ok && result.status === 401 && tidalClientId) {
        const rt = loadTidalRefreshToken()
        if (rt && (await refreshTidalAccessToken(tidalClientId, rt))) {
          t = tidalAccessTokenIfValid()
          if (t) result = await fetchTidalPlaylistSummaries(t, tidalClientId)
        }
      }
      if (!result.ok) {
        setErr(`TIDAL playlists (HTTP ${result.status}): ${result.detail}`)
        setTidalPlaylists([])
        return
      }
      setTidalPlaylists(result.items)
      if (result.truncated) {
        setTidalListNote(
          `Showing the first ${result.items.length} playlists (page cap). More may exist in your library.`,
        )
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Network error loading TIDAL.")
      setTidalPlaylists([])
    } finally {
      tidalLoadRef.current = false
      setBusy(false)
    }
  }, [tidalClientId, syncTidalSession])

  const loadSoundcloudPlaylists = useCallback(async () => {
    if (soundcloudLoadRef.current) return
    soundcloudLoadRef.current = true
    setErr(null)
    setSoundcloudListNote(null)
    setBusy(true)
    try {
      let t = await syncSoundcloudSession()
      if (!t) {
        setErr("SoundCloud session expired. Connect SoundCloud again.")
        setSoundcloudSignedIn(false)
        return
      }
      let result = await fetchMySoundcloudPlaylists(t, soundcloudClientId)
      if (!result.ok && result.status === 401 && soundcloudClientId) {
        const rt = loadSoundcloudRefreshToken()
        if (rt && (await refreshSoundcloudAccessToken(soundcloudClientId, rt))) {
          t = soundcloudAccessTokenIfValid()
          if (t) result = await fetchMySoundcloudPlaylists(t, soundcloudClientId)
        }
      }
      if (!result.ok) {
        setErr(`SoundCloud playlists (HTTP ${result.status}): ${result.detail}`)
        setSoundcloudPlaylists([])
        return
      }
      setSoundcloudPlaylists(result.items)
      if (result.truncated) {
        setSoundcloudListNote(
          `Showing the first ${result.items.length} SoundCloud playlists (page cap). More may exist.`,
        )
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Network error loading SoundCloud.")
      setSoundcloudPlaylists([])
    } finally {
      soundcloudLoadRef.current = false
      setBusy(false)
    }
  }, [soundcloudClientId, syncSoundcloudSession])

  const refreshAllLibraries = useCallback(async () => {
    const hasSpotify = signedIn && !!spotifyClientId
    const hasTidal = tidalSignedIn && !!tidalClientId
    const hasSoundcloud = soundcloudSignedIn && !!soundcloudClientId
    if (!hasSpotify && !hasTidal && !hasSoundcloud) return
    setLibraryRefreshing(true)
    setErr(null)
    try {
      if (hasSpotify) await loadPlaylists()
      if (hasTidal) await loadTidalPlaylists()
      if (hasSoundcloud) await loadSoundcloudPlaylists()
    } finally {
      setLibraryRefreshing(false)
    }
  }, [
    signedIn,
    tidalSignedIn,
    soundcloudSignedIn,
    spotifyClientId,
    tidalClientId,
    soundcloudClientId,
    loadPlaylists,
    loadTidalPlaylists,
    loadSoundcloudPlaylists,
  ])

  const toggleSpotifySidebar = useCallback(() => {
    if (!spotifyClientId) return
    setErr(null)
    if (signedIn) {
      clearTokens()
      clearMeProfileCache()
      setSignedIn(false)
      setPlaylists([])
      closePlaylistDetail()
      setTracks([])
      setSpotifyPlayback(null)
    } else {
      startSpotifyLogin(spotifyClientId, setErr)
    }
  }, [spotifyClientId, signedIn, closePlaylistDetail])

  const toggleTidalSidebar = useCallback(() => {
    if (!tidalClientId) return
    setErr(null)
    if (tidalSignedIn) {
      clearTidalTokens()
      setTidalSignedIn(false)
      setTidalPlaylists([])
      closePlaylistDetail()
      setTidalNowPlaying(null)
    } else {
      startTidalLogin(tidalClientId, setErr)
    }
  }, [tidalClientId, tidalSignedIn, closePlaylistDetail])

  const toggleSoundcloudSidebar = useCallback(() => {
    if (!soundcloudClientId) return
    setErr(null)
    if (soundcloudSignedIn) {
      const a = soundcloudAudioRef.current
      if (a) {
        a.onended = null
        a.pause()
        a.removeAttribute("src")
      }
      revokeSoundcloudBlobUrl()
      setSoundcloudDeck(null)
      clearSoundcloudTokens()
      setSoundcloudSignedIn(false)
      setSoundcloudPlaylists([])
      closePlaylistDetail()
    } else {
      startSoundcloudLogin(soundcloudClientId, setErr)
    }
  }, [soundcloudClientId, soundcloudSignedIn, closePlaylistDetail, revokeSoundcloudBlobUrl])

  useEffect(() => {
    if (!signedIn || !spotifyClientId) return
    void loadPlaylists()
  }, [signedIn, spotifyClientId, loadPlaylists])

  useEffect(() => {
    if (!tidalSignedIn || !tidalClientId) return
    void loadTidalPlaylists()
  }, [tidalSignedIn, tidalClientId, loadTidalPlaylists])

  useEffect(() => {
    if (!soundcloudSignedIn || !soundcloudClientId) return
    void loadSoundcloudPlaylists()
  }, [soundcloudSignedIn, soundcloudClientId, loadSoundcloudPlaylists])

  const spotifyLibraryLinked = signedIn && !!spotifyClientId
  const tidalLibraryLinked = tidalSignedIn && !!tidalClientId
  const soundcloudLibraryLinked = soundcloudSignedIn && !!soundcloudClientId
  const linkedServiceCount = [spotifyLibraryLinked, tidalLibraryLinked, soundcloudLibraryLinked].filter(
    Boolean,
  ).length
  const showLibraryAllTab = linkedServiceCount >= 2

  useEffect(() => {
    const sp = spotifyLibraryLinked
    const td = tidalLibraryLinked
    const sc = soundcloudLibraryLinked
    const pickFirst = (): LibraryTab => {
      if (sp) return "spotify"
      if (td) return "tidal"
      return "soundcloud"
    }
    if (libraryTab === "all" && linkedServiceCount < 2) {
      setLibraryTab(pickFirst())
      return
    }
    if (libraryTab === "spotify" && !sp) {
      if (td) setLibraryTab("tidal")
      else if (sc) setLibraryTab("soundcloud")
      return
    }
    if (libraryTab === "tidal" && !td) {
      if (sp) setLibraryTab("spotify")
      else if (sc) setLibraryTab("soundcloud")
      return
    }
    if (libraryTab === "soundcloud" && !sc) {
      if (sp) setLibraryTab("spotify")
      else if (td) setLibraryTab("tidal")
    }
  }, [
    libraryTab,
    spotifyLibraryLinked,
    tidalLibraryLinked,
    soundcloudLibraryLinked,
    linkedServiceCount,
  ])

  useEffect(() => {
    const path = window.location.pathname
    if (!path.endsWith("/callback")) {
      void syncSession()
      void syncTidalSession()
      void syncSoundcloudSession()
      return
    }

    const oauthSearch = window.location.search
    const qs = new URLSearchParams(oauthSearch.startsWith("?") ? oauthSearch.slice(1) : oauthSearch)
    const urlState = qs.get("state")?.trim() ?? ""

    const pendingFlag = sessionStorage.getItem("playmix_oauth_pending")
    sessionStorage.removeItem("playmix_oauth_pending")

    /**
     * Never assume Spotify when `playmix_oauth_pending` is missing — that routed TIDAL callbacks
     * through Spotify token exchange and broke the other session. Infer provider from OAuth
     * `state` vs PKCE session storage when the flag is lost (new tab, refresh, Strict Mode, etc.).
     */
    let provider: "spotify" | "tidal" | "soundcloud" | null = null
    if (pendingFlag === "tidal") provider = "tidal"
    else if (pendingFlag === "spotify") provider = "spotify"
    else if (pendingFlag === "soundcloud") provider = "soundcloud"
    else {
      const tidalPk = readTidalPkcePending()
      const spotifyPk = readPkcePending()
      const scPk = readSoundcloudPkcePending()
      if (urlState && tidalPk && urlState === tidalPk.state.trim()) provider = "tidal"
      else if (urlState && spotifyPk && urlState === spotifyPk.state.trim()) provider = "spotify"
      else if (urlState && scPk && urlState === scPk.state.trim()) provider = "soundcloud"
    }

    window.history.replaceState({}, "", "/")

    if (!provider) {
      setBusy(false)
      void syncSession()
      void syncTidalSession()
      void syncSoundcloudSession()
      return
    }

    setBusy(true)

    if (provider === "tidal") {
      if (!tidalClientId) {
        setBusy(false)
        setErr("Set VITE_TIDAL_CLIENT_ID in web/.env (and register the redirect URI in the TIDAL portal).")
        void syncSession()
        void syncTidalSession()
        void syncSoundcloudSession()
        return
      }
      void (async () => {
        const msg = await finishTidalLoginFromUrl(oauthSearch, tidalClientId)
        setBusy(false)
        if (msg) setErr(msg)
        else {
          setErr(null)
          await syncTidalSession()
          await syncSession()
          await syncSoundcloudSession()
        }
      })()
      return
    }

    if (provider === "soundcloud") {
      if (!soundcloudClientId) {
        setBusy(false)
        setErr("Set VITE_SOUNDCLOUD_CLIENT_ID in web/.env and restart the dev server.")
        void syncSession()
        void syncTidalSession()
        void syncSoundcloudSession()
        return
      }
      void (async () => {
        const msg = await finishSoundcloudLoginFromUrl(oauthSearch, soundcloudClientId)
        setBusy(false)
        if (msg) setErr(msg)
        else {
          setErr(null)
          await syncSoundcloudSession()
          await syncSession()
          await syncTidalSession()
        }
      })()
      return
    }

    if (!spotifyClientId) {
      setBusy(false)
      setErr("Set VITE_SPOTIFY_CLIENT_ID in web/.env")
      void syncSession()
      void syncTidalSession()
      void syncSoundcloudSession()
      return
    }
    void (async () => {
      const msg = await finishSpotifyLoginFromUrl(oauthSearch, spotifyClientId)
      setBusy(false)
      if (msg) setErr(msg)
      else {
        setErr(null)
        await syncSession()
        await syncTidalSession()
        await syncSoundcloudSession()
      }
    })()
  }, [
    spotifyClientId,
    tidalClientId,
    soundcloudClientId,
    syncSession,
    syncTidalSession,
    syncSoundcloudSession,
  ])

  const unifiedGrid = useMemo((): UnifiedPlaylist[] => {
    const s: UnifiedPlaylist[] = playlists.map((p) => ({
      service: "spotify",
      id: p.id,
      name: p.name,
      cover: spotifyCover(p),
    }))
    const td: UnifiedPlaylist[] = tidalPlaylists.map((p) => ({
      service: "tidal",
      id: p.id,
      name: p.name,
      owner: p.ownerLabel,
    }))
    const sc: UnifiedPlaylist[] = soundcloudPlaylists.map((p) => ({
      service: "soundcloud",
      id: p.id,
      name: p.name,
      cover: p.cover,
    }))
    if (libraryTab === "spotify") return s
    if (libraryTab === "tidal") return td
    if (libraryTab === "soundcloud") return sc
    return [...s, ...td, ...sc].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )
  }, [playlists, tidalPlaylists, soundcloudPlaylists, libraryTab])

  const filteredUnifiedGrid = useMemo(
    () => unifiedGrid.filter((p) => unifiedPlaylistMatchesQuery(p, playlistLibrarySearch)),
    [unifiedGrid, playlistLibrarySearch],
  )

  const spotifyFilteredTrackEntries = useMemo(() => {
    const q = playlistDetailTrackSearch.trim().toLowerCase()
    const entries: { row: PlaylistTrackRow; indexInPlaylist: number }[] = []
    tracks.forEach((row, i) => {
      if (!spotifyRowIsPlayableTrack(row)) return
      const text = `${trackRowTitle(row)} ${trackRowArtists(row)}`.toLowerCase()
      if (q && !text.includes(q)) return
      entries.push({ row, indexInPlaylist: i })
    })
    return entries
  }, [tracks, playlistDetailTrackSearch])

  const tidalFilteredTrackEntries = useMemo(() => {
    const q = playlistDetailTrackSearch.trim().toLowerCase()
    return tidalDetailTracks
      .map((row, indexInPlaylist) => ({ row, indexInPlaylist }))
      .filter(({ row }) => {
        if (!q) return true
        return `${row.name} ${row.artistLine}`.toLowerCase().includes(q)
      })
  }, [tidalDetailTracks, playlistDetailTrackSearch])

  const soundcloudFilteredTrackEntries = useMemo(() => {
    const q = playlistDetailTrackSearch.trim().toLowerCase()
    return soundcloudDetailTracks
      .map((row, indexInPlaylist) => ({ row, indexInPlaylist }))
      .filter(({ row }) => {
        if (!q) return true
        return `${row.title} ${row.artistLine}`.toLowerCase().includes(q)
      })
  }, [soundcloudDetailTracks, playlistDetailTrackSearch])

  const loadSpotifyDetail = async (id: string) => {
    const t = await syncSession()
    if (!t) return
    setPlaylistDetailTrackSearch("")
    setBusy(true)
    setErr(null)
    setDetailName("")
    setDetailCover(null)
    setSelectedSpotifyId(id)
    setSelectedTidal(null)
    setSelectedSoundcloud(null)
    setSoundcloudDetailTracks([])
    setSoundcloudTracksNote(null)
    setTracks([])
    setTracksNote(null)
    setTidalDetailTracks([])
    setTidalTracksNote(null)
    try {
      const meta = await fetchPlaylistMeta(t, id)
      if (!meta.ok) {
        setDetailName("")
        setDetailCover(null)
        setErr(`Playlist HTTP ${meta.status}: ${meta.body.slice(0, 200)}`)
        setPlaylistDetailView(false)
        setSelectedSpotifyId(null)
        return
      }
      setDetailName(meta.name)
      setDetailCover(meta.image ?? null)
      await delay(350)
      const country = (await fetchMeCountry(t)) || "from_token"
      await delay(350)
      const items = await fetchPlaylistItems(t, id, country)
      setTracks(items)
      if (items.length === 0) {
        setTracksNote(
          "No tracks loaded (playlist may be empty, or you may only follow this playlist — owned playlists work best).",
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const handleSpotifyPlaylistActivate = async (id: string) => {
    setPlaylistDetailView(true)
    setTidalNowPlaying(null)
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) {
      setPlaylistDetailView(false)
      return
    }
    await loadSpotifyDetail(id)
  }

  const handleTidalPlaylistActivate = async (p: TidalPlaylistItem) => {
    setPlaylistDetailTrackSearch("")
    setPlaylistDetailView(true)
    setSelectedSoundcloud(null)
    setSoundcloudDetailTracks([])
    setSoundcloudTracksNote(null)
    setSelectedSpotifyId(null)
    setSelectedTidal(p)
    setDetailName(p.name)
    setDetailCover(null)
    setTracks([])
    setTracksNote(null)
    setTidalDetailTracks([])
    setTidalTracksNote(null)
    setTidalNowPlaying(null)
    setBusy(true)
    setErr(null)
    const t = await syncTidalSession()
    if (!t) {
      setBusy(false)
      closePlaylistDetail()
      return
    }
    const result = await fetchTidalPlaylistItems(t, tidalClientId, p.id)
    setBusy(false)
    if (!result.ok) {
      setErr(result.detail)
      setDetailCover(null)
      closePlaylistDetail()
      return
    }
    setTidalDetailTracks(result.items)
    setDetailCover(result.coverUrl ?? null)
    if (result.items.length === 0) {
      setTidalTracksNote("No tracks returned for this playlist (empty list or API shape mismatch).")
    } else if (result.truncated) {
      setTidalTracksNote("Showing the first pages of tracks only (fetch cap).")
    }
  }

  const handleSoundcloudPlaylistActivate = async (p: SoundcloudPlaylistItem) => {
    const a = soundcloudAudioRef.current
    if (a) {
      a.onended = null
      a.pause()
      a.removeAttribute("src")
    }
    revokeSoundcloudBlobUrl()
    setSoundcloudDeck(null)
    setPlaylistDetailTrackSearch("")
    setPlaylistDetailView(true)
    setSelectedSpotifyId(null)
    setSelectedTidal(null)
    setTracks([])
    setTracksNote(null)
    setTidalDetailTracks([])
    setTidalTracksNote(null)
    setSelectedSoundcloud(p)
    setDetailName(p.name)
    setDetailCover(p.cover)
    setSoundcloudDetailTracks([])
    setSoundcloudTracksNote(null)
    setTidalNowPlaying(null)
    setBusy(true)
    setErr(null)
    const t = await syncSoundcloudSession()
    if (!t) {
      setBusy(false)
      closePlaylistDetail()
      return
    }
    const [meta, tr] = await Promise.all([
      fetchSoundcloudPlaylistMeta(t, soundcloudClientId, p.id),
      fetchSoundcloudPlaylistTracks(t, soundcloudClientId, p.id),
    ])
    setBusy(false)
    if (!tr.ok) {
      setErr(tr.detail)
      setDetailCover(null)
      closePlaylistDetail()
      return
    }
    if (meta.ok) {
      setDetailName(meta.name)
      setDetailCover(meta.artworkUrl ?? p.cover)
      setSelectedSoundcloud({
        ...p,
        name: meta.name,
        cover: meta.artworkUrl ?? p.cover,
        permalinkUrl: meta.permalinkUrl ?? p.permalinkUrl,
      })
    }
    setSoundcloudDetailTracks(tr.items)
    if (tr.items.length === 0) {
      setSoundcloudTracksNote("No tracks loaded for this playlist.")
    } else if (tr.truncated) {
      setSoundcloudTracksNote("Showing the first pages of tracks only (fetch cap).")
    }
  }

  const handlePlayTrack = async (row: PlaylistTrackRow) => {
    if (!selectedSpotifyId) return
    setTidalNowPlaying(null)
    const uri = trackUri(row)
    if (!uri) return
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await playPlaylistTrack(t, selectedSpotifyId, uri)
    setBusy(false)
    if (!r.ok) {
      if (r.status === 404) {
        setErr(
          "No active Spotify device. Open Spotify on your phone, desktop, or web player, then try again.",
        )
      } else {
        setErr(r.detail)
      }
      return
    }
    pauseLocalSoundcloud()
    await refreshPlaybackUi()
  }

  const handlePlayPauseBar = async () => {
    const t = accessTokenIfValid() || (await syncSession())
    if (!t || nowPlayingBarModel?.source !== "spotify" || !nowPlayingBarModel.state.item) return
    const sp = nowPlayingBarModel.state
    const wasPaused = !sp.isPlaying
    setBusy(true)
    const r = await setPaused(t, sp.isPlaying)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    if (wasPaused) pauseLocalSoundcloud()
    await refreshPlaybackUi()
  }

  const handleSpotifySeekBar = async (positionMs: number) => {
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await seekToPosition(t, positionMs)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    await refreshPlaybackUi()
  }

  const handleSpotifySkipPrevious = async () => {
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await skipToPrevious(t)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    pauseLocalSoundcloud()
    await refreshPlaybackUi()
  }

  const handleSpotifySkipNext = async () => {
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await skipToNext(t)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    pauseLocalSoundcloud()
    await refreshPlaybackUi()
  }

  const handleSpotifyShuffleBar = async () => {
    const st = spotifyPlayback
    if (!st) return
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await setShuffle(t, !st.shuffle)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    await refreshPlaybackUi()
  }

  const handleSpotifyRepeatCycleBar = async () => {
    const st = spotifyPlayback
    if (!st) return
    const order: SpotifyRepeatState[] = ["off", "context", "track"]
    const idx = Math.max(0, order.indexOf(st.repeatState))
    const next = order[(idx + 1) % order.length]
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await setRepeatMode(t, next)
    setBusy(false)
    if (!r.ok) {
      setErr(r.detail)
      return
    }
    await refreshPlaybackUi()
  }

  const handleDetailPlaySpotify = async () => {
    if (!selectedSpotifyId) return
    setTidalNowPlaying(null)
    const t = accessTokenIfValid() || (await syncSession())
    if (!t) return
    setBusy(true)
    setErr(null)
    const r = await startPlaylistPlayback(t, selectedSpotifyId)
    setBusy(false)
    if (!r.ok) {
      if (r.status === 404) {
        setErr(
          "No active Spotify device. Open Spotify on your phone, desktop, or web player, then try again.",
        )
      } else {
        setErr(r.detail)
      }
      return
    }
    pauseLocalSoundcloud()
    await refreshPlaybackUi()
  }

  const handleSoundcloudPlayPauseBar = useCallback(async () => {
    if (!soundcloudDeck || soundcloudDeck.loading) return
    const el = soundcloudAudioRef.current
    if (!el?.src) return
    try {
      if (el.paused) {
        await pauseSpotifyRemote()
        await el.play()
        setSoundcloudDeck((d) => (d ? { ...d, isPlaying: true } : d))
      } else {
        el.pause()
        setSoundcloudDeck((d) => (d ? { ...d, isPlaying: false } : d))
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "SoundCloud playback failed.")
    }
  }, [pauseSpotifyRemote, soundcloudDeck])

  const handleSoundcloudSeekBar = useCallback((ms: number) => {
    const el = soundcloudAudioRef.current
    if (!el) return
    el.currentTime = ms / 1000
    setSoundcloudDeck((d) => (d ? { ...d, positionMs: ms } : d))
  }, [])

  const handleSoundcloudPreviousBar = useCallback(() => {
    const d = soundcloudDeck
    if (!d || d.loading) return
    if (d.queueIndex > 0) {
      void loadAndPlaySoundcloudAtIndex(d.queue, d.queueIndex - 1)
    } else {
      const el = soundcloudAudioRef.current
      if (el) el.currentTime = 0
      setSoundcloudDeck((d0) => (d0 ? { ...d0, positionMs: 0 } : d0))
    }
  }, [soundcloudDeck, loadAndPlaySoundcloudAtIndex])

  const handleSoundcloudNextBar = useCallback(() => {
    const d = soundcloudDeck
    if (!d || d.loading || d.queueIndex + 1 >= d.queue.length) return
    void loadAndPlaySoundcloudAtIndex(d.queue, d.queueIndex + 1)
  }, [soundcloudDeck, loadAndPlaySoundcloudAtIndex])

  if (!spotifyClientId && !tidalClientId && !soundcloudClientId) {
    return (
      <main className="config-screen">
        <h1>Playmix</h1>
        <p>Create <code>web/.env</code> with at least one of:</p>
        <ul>
          <li>
            <code>VITE_SPOTIFY_CLIENT_ID=…</code>
          </li>
          <li>
            <code>VITE_TIDAL_CLIENT_ID=…</code>
          </li>
          <li>
            <code>VITE_SOUNDCLOUD_CLIENT_ID=…</code>
          </li>
        </ul>
        <p className="muted">
          Register redirect <code>http://127.0.0.1:5173/callback</code> in each developer portal (and match{" "}
          <code>VITE_*_REDIRECT_URI</code> if you override it).
        </p>
      </main>
    )
  }

  const showLibrary =
    (libraryTab !== "tidal" && libraryTab !== "soundcloud" && signedIn && playlists.length > 0) ||
    (libraryTab !== "spotify" && libraryTab !== "soundcloud" && tidalSignedIn && tidalPlaylists.length > 0) ||
    (libraryTab !== "spotify" && libraryTab !== "tidal" && soundcloudSignedIn && soundcloudPlaylists.length > 0) ||
    (libraryTab === "all" &&
      ((signedIn && playlists.length > 0) ||
        (tidalSignedIn && tidalPlaylists.length > 0) ||
        (soundcloudSignedIn && soundcloudPlaylists.length > 0)))

  const inPlaylistDetail =
    playlistDetailView &&
    (selectedSpotifyId != null || selectedTidal != null || selectedSoundcloud != null)

  const anyServiceConfigured = !!(spotifyClientId || tidalClientId || soundcloudClientId)
  const anyServiceSignedIn =
    (spotifyClientId && signedIn) ||
    (tidalClientId && tidalSignedIn) ||
    (soundcloudClientId && soundcloudSignedIn)

  return (
    <div className="app">
      <audio
        ref={soundcloudAudioRef}
        preload="auto"
        playsInline
        aria-hidden
        style={{ position: "fixed", width: 0, height: 0, opacity: 0, pointerEvents: "none", left: 0, bottom: 0 }}
      />
      <ServiceSidebar
        spotifyConfigured={!!spotifyClientId}
        tidalConfigured={!!tidalClientId}
        soundcloudConfigured={!!soundcloudClientId}
        spotifyLinked={signedIn}
        tidalLinked={tidalSignedIn}
        soundcloudLinked={soundcloudSignedIn}
        busy={busy}
        refreshingLibraries={libraryRefreshing}
        onRefreshAll={() => void refreshAllLibraries()}
        onToggleSpotify={() => toggleSpotifySidebar()}
        onToggleTidal={() => toggleTidalSidebar()}
        onToggleSoundcloud={() => toggleSoundcloudSidebar()}
      />
      <div className="app__body">
        <div className="app__main">
          <header className="app-header app-header--minimal">
            <h1 className="app-brand__title">Playmix</h1>
          </header>

        {err && !isLikelyOpaqueTokenMessage(err) ? (
          <div role="alert" className="alert">
            {err}
          </div>
        ) : null}

        {anyServiceConfigured && !anyServiceSignedIn ? (
          <p className="empty-state" style={{ marginBottom: "1.25rem" }}>
            Use the <strong>left sidebar</strong> to sign in to Spotify, TIDAL, or SoundCloud. Your library
            appears here after you connect at least one service.
          </p>
        ) : null}

        {anyServiceSignedIn ? (
          inPlaylistDetail ? (
            <>
              <nav className="playlist-view-nav" aria-label="Playlist">
                <button
                  type="button"
                  className="btn btn--ghost playlist-view-nav__back"
                  disabled={busy}
                  onClick={() => closePlaylistDetail()}
                >
                  ← Back to playlists
                </button>
              </nav>
              <section className="playlist-detail playlist-detail--page">
                <div className="playlist-detail__hero">
                  <div className="playlist-detail__art">
                    {detailCover ? <img src={detailCover} alt="" /> : null}
                  </div>
                  <div className="playlist-detail__info">
                    <h2>
                      {detailName ||
                        (busy && (selectedSpotifyId != null || selectedSoundcloud != null)
                          ? "Loading playlist…"
                          : "Playlist")}
                    </h2>
                    <p className="muted" style={{ margin: 0 }}>
                      {selectedSpotifyId
                        ? "Tap a track to start there, or Play on Spotify to start from the top (Spotify Connect on your active device)."
                        : selectedSoundcloud
                          ? "Play tracks in the bar below, or open SoundCloud in a new tab."
                          : "Track list from TIDAL’s catalog API. Playback: use the buttons below or open a track (Hands off to tidal.com / your TIDAL app when configured)."}
                    </p>
                    <div className="playlist-detail__actions">
                      {selectedSpotifyId ? (
                        <button
                          type="button"
                          className="btn btn--spotify"
                          disabled={busy}
                          onClick={() => void handleDetailPlaySpotify()}
                        >
                          Play on Spotify
                        </button>
                      ) : selectedSoundcloud ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--soundcloud"
                            disabled={
                              busy ||
                              soundcloudDetailTracks.length === 0 ||
                              !soundcloudSignedIn ||
                              !soundcloudClientId
                            }
                            onClick={() => void loadAndPlaySoundcloudAtIndex(soundcloudDetailTracks, 0)}
                          >
                            Play in Playmix
                          </button>
                          {selectedSoundcloud.permalinkUrl ? (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() =>
                                openSoundcloudPermalink(selectedSoundcloud.permalinkUrl ?? "")
                              }
                            >
                              Open in SoundCloud
                            </button>
                          ) : null}
                        </>
                      ) : selectedTidal ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--tidal"
                            onClick={() => {
                              setTidalNowPlaying({
                                playlistName: selectedTidal.name,
                                playlistId: selectedTidal.id,
                              })
                              openTidalPlaylist(selectedTidal.id)
                            }}
                          >
                            Open in TIDAL
                          </button>
                          <a
                            className="btn btn--ghost"
                            href={tidalPlaylistUrl(selectedTidal.id)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                              setTidalNowPlaying({
                                playlistName: selectedTidal.name,
                                playlistId: selectedTidal.id,
                              })
                            }}
                          >
                            Web link
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                {(selectedSpotifyId && tracks.length > 0) ||
                (selectedTidal && tidalDetailTracks.length > 0) ||
                (selectedSoundcloud && soundcloudDetailTracks.length > 0) ? (
                  <div className="playlist-detail__track-search">
                    <label className="playlist-search-label" htmlFor="playlist-detail-track-search">
                      Search tracks
                    </label>
                    <input
                      id="playlist-detail-track-search"
                      type="search"
                      className="playlist-search-input"
                      placeholder="Filter by title or artist…"
                      value={playlistDetailTrackSearch}
                      onChange={(e) => setPlaylistDetailTrackSearch(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                ) : null}
                {selectedSpotifyId && tracks.length > 0 ? (
                  <>
                    {spotifyFilteredTrackEntries.length > 0 ? (
                      <ol className="track-list">
                        {spotifyFilteredTrackEntries.map(({ row, indexInPlaylist }) => {
                          const t = row.track ?? row.item
                          return (
                            <li key={`${t?.uri ?? t?.id ?? indexInPlaylist}`}>
                              <button
                                type="button"
                                className="track-list__row"
                                onClick={() => void handlePlayTrack(row)}
                              >
                                <span className="track-list__idx">{indexInPlaylist + 1}</span>
                                <span className="track-list__main">
                                  <span className="track-list__title">{trackRowTitle(row)}</span>
                                  <span className="track-list__artists">{trackRowArtists(row)}</span>
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ol>
                    ) : tracks.some(spotifyRowIsPlayableTrack) && playlistDetailTrackSearch.trim() ? (
                      <p className="muted playlist-search-empty">No tracks match your search.</p>
                    ) : null}
                  </>
                ) : null}
                {selectedSpotifyId && tracksNote ? <p className="muted">{tracksNote}</p> : null}
                {selectedTidal && tidalDetailTracks.length > 0 ? (
                  <>
                    {tidalFilteredTrackEntries.length > 0 ? (
                      <ol className="track-list">
                        {tidalFilteredTrackEntries.map(({ row, indexInPlaylist }) => (
                          <li key={`${row.id}:${indexInPlaylist}`}>
                            <button
                              type="button"
                              className="track-list__row"
                              onClick={() => {
                                setTidalNowPlaying({
                                  playlistName: selectedTidal.name,
                                  playlistId: selectedTidal.id,
                                })
                                openTidalTrack(row.id)
                              }}
                            >
                              <span className="track-list__idx">{indexInPlaylist + 1}</span>
                              <span className="track-list__main">
                                <span className="track-list__title">{row.name}</span>
                                <span className="track-list__artists">{row.artistLine}</span>
                              </span>
                              {row.durationSec != null ? (
                                <span className="track-list__dur">
                                  {formatTidalTrackDuration(row.durationSec)}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : playlistDetailTrackSearch.trim() ? (
                      <p className="muted playlist-search-empty">No tracks match your search.</p>
                    ) : null}
                  </>
                ) : null}
                {selectedTidal && tidalTracksNote ? <p className="muted">{tidalTracksNote}</p> : null}
                {selectedSoundcloud && soundcloudDetailTracks.length > 0 ? (
                  <>
                    {soundcloudFilteredTrackEntries.length > 0 ? (
                      <ol className="track-list">
                        {soundcloudFilteredTrackEntries.map(({ row, indexInPlaylist }) => (
                          <li key={`${row.id}:${indexInPlaylist}`}>
                            <button
                              type="button"
                              className="track-list__row"
                              onClick={() => void loadAndPlaySoundcloudAtIndex(soundcloudDetailTracks, indexInPlaylist)}
                            >
                              <span className="track-list__idx">{indexInPlaylist + 1}</span>
                              <span className="track-list__main">
                                <span className="track-list__title">{row.title}</span>
                                <span className="track-list__artists">{row.artistLine}</span>
                              </span>
                              {row.durationMs != null ? (
                                <span className="track-list__dur">
                                  {formatSoundcloudDuration(row.durationMs)}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : playlistDetailTrackSearch.trim() ? (
                      <p className="muted playlist-search-empty">No tracks match your search.</p>
                    ) : null}
                  </>
                ) : null}
                {selectedSoundcloud && soundcloudTracksNote ? (
                  <p className="muted">{soundcloudTracksNote}</p>
                ) : null}
              </section>
            </>
          ) : (
            <>
              {spotifyLibraryLinked || tidalLibraryLinked ? (
                <div className="library-tabs">
                  {showLibraryAllTab ? (
                    <button
                      type="button"
                      data-active={libraryTab === "all"}
                      onClick={() => setLibraryTab("all")}
                    >
                      All
                    </button>
                  ) : null}
                  {spotifyLibraryLinked ? (
                    <button
                      type="button"
                      data-active={libraryTab === "spotify"}
                      onClick={() => setLibraryTab("spotify")}
                    >
                      Spotify
                    </button>
                  ) : null}
                  {tidalLibraryLinked ? (
                    <button
                      type="button"
                      data-active={libraryTab === "tidal"}
                      onClick={() => setLibraryTab("tidal")}
                    >
                      TIDAL
                    </button>
                  ) : null}
                  {soundcloudLibraryLinked ? (
                    <button
                      type="button"
                      data-active={libraryTab === "soundcloud"}
                      onClick={() => setLibraryTab("soundcloud")}
                    >
                      SoundCloud
                    </button>
                  ) : null}
                </div>
              ) : null}

              {playlistListNote && (libraryTab === "spotify" || libraryTab === "all") ? (
                <p className="muted" style={{ marginBottom: "1rem" }}>
                  {playlistListNote}
                </p>
              ) : null}
              {tidalListNote && (libraryTab === "tidal" || libraryTab === "all") ? (
                <p className="muted" style={{ marginBottom: "1rem" }}>
                  {tidalListNote}
                </p>
              ) : null}
              {soundcloudListNote && (libraryTab === "soundcloud" || libraryTab === "all") ? (
                <p className="muted" style={{ marginBottom: "1rem" }}>
                  {soundcloudListNote}
                </p>
              ) : null}

              {!showLibrary &&
              ((libraryTab === "spotify" && signedIn) ||
                (libraryTab === "tidal" && tidalSignedIn) ||
                (libraryTab === "soundcloud" && soundcloudSignedIn) ||
                (libraryTab === "all" &&
                  (signedIn || tidalSignedIn || soundcloudSignedIn))) ? (
                <p className="empty-state">
                  {libraryTab === "spotify" && signedIn
                    ? "No Spotify playlists yet. They load automatically when you connect — use the sidebar refresh if this stays empty."
                    : libraryTab === "tidal" && tidalSignedIn
                      ? "No TIDAL playlists yet. They load automatically when you connect — use the sidebar refresh if this stays empty."
                      : libraryTab === "soundcloud" && soundcloudSignedIn
                        ? "No SoundCloud playlists yet. They load when you connect — use the sidebar refresh if this stays empty."
                        : "No playlists yet. Each library loads when you sign in — use the sidebar refresh if needed."}
                </p>
              ) : null}

              {unifiedGrid.length > 0 ? (
                <>
                  <div className="playlist-library-toolbar">
                    <h2 className="section-title playlist-library-toolbar__title">Playlists</h2>
                    <div className="playlist-library-toolbar__search">
                      <label className="playlist-search-label" htmlFor="playlist-library-search">
                        Search playlists
                      </label>
                      <input
                        id="playlist-library-search"
                        type="search"
                        className="playlist-search-input"
                        placeholder="Search by name…"
                        value={playlistLibrarySearch}
                        onChange={(e) => setPlaylistLibrarySearch(e.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                  {filteredUnifiedGrid.length > 0 ? (
                    <div className="playlist-grid">
                      {filteredUnifiedGrid.map((p) => (
                        <button
                          key={`${p.service}:${p.id}`}
                          type="button"
                          className="playlist-card"
                          data-service={p.service}
                          onClick={() => {
                            if (p.service === "spotify") void handleSpotifyPlaylistActivate(p.id)
                            else if (p.service === "soundcloud") {
                              const full = soundcloudPlaylists.find((t) => t.id === p.id)
                              if (full) void handleSoundcloudPlaylistActivate(full)
                            } else {
                              const full = tidalPlaylists.find((t) => t.id === p.id)
                              if (full) void handleTidalPlaylistActivate(full)
                            }
                          }}
                        >
                          <div className="playlist-card__cover">
                            {p.service === "spotify" && p.cover ? (
                              <img src={p.cover} alt="" />
                            ) : null}
                            {p.service === "soundcloud" && p.cover ? (
                              <img src={p.cover} alt="" />
                            ) : null}
                            <span
                              className={
                                p.service === "spotify"
                                  ? "playlist-card__badge playlist-card__badge--spotify"
                                  : p.service === "soundcloud"
                                    ? "playlist-card__badge playlist-card__badge--soundcloud"
                                    : "playlist-card__badge playlist-card__badge--tidal"
                              }
                            >
                              {p.service === "spotify"
                                ? "Spotify"
                                : p.service === "soundcloud"
                                  ? "SoundCloud"
                                  : "TIDAL"}
                            </span>
                          </div>
                          <div className="playlist-card__body">
                            <div className="playlist-card__name">{p.name}</div>
                            {p.service === "tidal" ? (
                              <div className="playlist-card__meta">{p.owner}</div>
                            ) : null}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted playlist-search-empty">
                      No playlists match &quot;{playlistLibrarySearch.trim()}&quot;.
                    </p>
                  )}
                </>
              ) : null}
            </>
          )
        ) : null}
        </div>
      </div>

      {createPortal(
        <NowPlayingBar
          model={nowPlayingBarModel}
          busy={busy}
          onSpotifyPlayPause={() => void handlePlayPauseBar()}
          onSpotifyPrevious={() => void handleSpotifySkipPrevious()}
          onSpotifyNext={() => void handleSpotifySkipNext()}
          onSpotifyShuffle={() => void handleSpotifyShuffleBar()}
          onSpotifyRepeatCycle={() => void handleSpotifyRepeatCycleBar()}
          onSpotifySeek={(ms) => void handleSpotifySeekBar(ms)}
          onSoundcloudPlayPause={() => void handleSoundcloudPlayPauseBar()}
          onSoundcloudPrevious={() => handleSoundcloudPreviousBar()}
          onSoundcloudNext={() => handleSoundcloudNextBar()}
          onSoundcloudSeek={(ms) => handleSoundcloudSeekBar(ms)}
        />,
        document.body,
      )}
    </div>
  )
}
