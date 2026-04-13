import { useEffect, useMemo, useState } from "react"
import type { SpotifySearchTrackHit } from "../spotify/api"
import type { SoundcloudTrackRow } from "../soundcloud/api"
import type { TidalTrackRow } from "../tidal/api"
import type { PlaymixPlaylist, PlaymixService, PlaymixTrackEntry } from "../playmixes/types"
import { newPlaymixId, newTrackKey } from "../playmixes/storage"

export type PlaymixSearchResults = {
  spotify: { status: "skip" } | { status: "ok"; track: SpotifySearchTrackHit } | { status: "err"; msg: string }
  soundcloud:
    | { status: "skip" }
    | { status: "ok"; track: SoundcloudTrackRow }
    | { status: "err"; msg: string }
  tidal:
    | { status: "skip" }
    | { status: "ok"; track: TidalTrackRow; artworkUrl: string | null }
    | { status: "err"; msg: string }
}

type PlaymixListTab = "all" | PlaymixService
type PlaymixDetailTab = "listen" | "edit"

type Props = {
  spotifyLinked: boolean
  tidalLinked: boolean
  soundcloudLinked: boolean
  playlists: PlaymixPlaylist[]
  onPersist: (next: PlaymixPlaylist[]) => void
  onSearchQuery: (q: string) => Promise<PlaymixSearchResults>
  onPlay: (playlist: PlaymixPlaylist, startIndex: number) => void
  playing: { playmixId: string; index: number } | null
  /** Matches Spotify Web API / now bar so the list dot tracks real playback. */
  spotifyNowPlayingUri: string | null
  soundcloudNowPlayingTrackId: string | null
  busy: boolean
  setErr: (msg: string | null) => void
}

function formatMs(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ""
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

function formatSec(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return ""
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

function playmixMatchesTab(p: PlaymixPlaylist, tab: PlaymixListTab): boolean {
  if (tab === "all") return true
  return p.tracks.some((t) => t.service === tab)
}

function playmixRowNowPlaying(
  entry: PlaymixTrackEntry,
  indexInPlaylist: number,
  selectedId: string,
  playing: { playmixId: string; index: number } | null,
  spotifyNowPlayingUri: string | null,
  soundcloudNowPlayingTrackId: string | null,
): boolean {
  // While this playmix is the active session, only highlight the session index so stale
  // Spotify API state (e.g. paused 90210) does not also light up another row during SoundCloud playback.
  if (playing?.playmixId === selectedId) return playing.index === indexInPlaylist
  const su = spotifyNowPlayingUri?.trim() || null
  if (entry.service === "spotify" && su && entry.spotifyUri?.trim() === su) return true
  const sc = soundcloudNowPlayingTrackId?.trim() || null
  if (entry.service === "soundcloud" && sc && entry.soundcloudTrackId === sc) return true
  return false
}

function playmixListenDurationLabel(t: PlaymixTrackEntry): string | null {
  if (t.durationMs == null || !Number.isFinite(t.durationMs) || t.durationMs < 0) return null
  if (t.service === "tidal") return formatSec(Math.floor(t.durationMs / 1000))
  return formatMs(t.durationMs)
}

export function PlaymixesPanel({
  spotifyLinked,
  tidalLinked,
  soundcloudLinked,
  playlists,
  onPersist,
  onSearchQuery,
  onPlay,
  playing,
  spotifyNowPlayingUri,
  soundcloudNowPlayingTrackId,
  busy,
  setErr,
}: Props) {
  const [listTab, setListTab] = useState<PlaymixListTab>("all")
  const [listSearch, setListSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<PlaymixDetailTab>("listen")
  const [listenFilter, setListenFilter] = useState("")
  const [newNameDraft, setNewNameDraft] = useState("")
  const [trackSearch, setTrackSearch] = useState("")
  const [searchResults, setSearchResults] = useState<PlaymixSearchResults | null>(null)
  const [searching, setSearching] = useState(false)

  const selected = useMemo(
    () => playlists.find((p) => p.id === selectedId) ?? null,
    [playlists, selectedId],
  )

  useEffect(() => {
    if (!selectedId) return
    setDetailTab("listen")
    setListenFilter("")
  }, [selectedId])

  const listenFilteredEntries = useMemo(() => {
    if (!selected) return []
    const q = listenFilter.trim().toLowerCase()
    return selected.tracks
      .map((row, indexInPlaylist) => ({ row, indexInPlaylist }))
      .filter(({ row }) => {
        if (!q) return true
        return `${row.title} ${row.artistLine}`.toLowerCase().includes(q)
      })
  }, [selected, listenFilter])

  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    return playlists
      .filter((p) => playmixMatchesTab(p, listTab))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [playlists, listTab, listSearch])

  const persist = (next: PlaymixPlaylist[]) => {
    onPersist(next)
  }

  const createPlaymix = () => {
    const name = newNameDraft.trim() || "New playmix"
    const now = Date.now()
    const pl: PlaymixPlaylist = {
      id: newPlaymixId(),
      name,
      createdAt: now,
      updatedAt: now,
      tracks: [],
    }
    persist([pl, ...playlists])
    setNewNameDraft("")
    setSelectedId(pl.id)
    setErr(null)
  }

  const updatePlaymix = (id: string, fn: (p: PlaymixPlaylist) => PlaymixPlaylist) => {
    persist(playlists.map((p) => (p.id === id ? fn({ ...p, updatedAt: Date.now() }) : p)))
  }

  const removeTrack = (playmixId: string, key: string) => {
    updatePlaymix(playmixId, (p) => ({
      ...p,
      tracks: p.tracks.filter((t) => t.key !== key),
    }))
  }

  const addEntry = (playmixId: string, entry: PlaymixTrackEntry) => {
    updatePlaymix(playmixId, (p) => ({
      ...p,
      tracks: [...p.tracks, entry],
    }))
  }

  const runSearch = async () => {
    const q = trackSearch.trim()
    if (!q) {
      setErr("Enter a song or artist to search.")
      return
    }
    setSearching(true)
    setSearchResults(null)
    setErr(null)
    try {
      const r = await onSearchQuery(q)
      setSearchResults(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed.")
    } finally {
      setSearching(false)
    }
  }

  const hitToEntry = (service: PlaymixService, r: PlaymixSearchResults): PlaymixTrackEntry | null => {
    if (service === "spotify") {
      if (r.spotify.status !== "ok") return null
      const t = r.spotify.track
      return {
        key: newTrackKey(),
        service: "spotify",
        title: t.name,
        artistLine: t.artistLine,
        durationMs: t.durationMs,
        artworkUrl: t.image,
        spotifyUri: t.uri,
      }
    }
    if (service === "soundcloud") {
      if (r.soundcloud.status !== "ok") return null
      const t = r.soundcloud.track
      return {
        key: newTrackKey(),
        service: "soundcloud",
        title: t.title,
        artistLine: t.artistLine,
        durationMs: t.durationMs,
        artworkUrl: null,
        soundcloudTrackId: t.id,
        soundcloudPermalinkUrl: t.permalinkUrl,
      }
    }
    if (service === "tidal") {
      if (r.tidal.status !== "ok") return null
      const t = r.tidal.track
      return {
        key: newTrackKey(),
        service: "tidal",
        title: t.name,
        artistLine: t.artistLine,
        durationMs: t.durationSec != null ? t.durationSec * 1000 : null,
        artworkUrl: r.tidal.artworkUrl,
        tidalTrackId: t.id,
      }
    }
    return null
  }

  const showListTabs = spotifyLinked || tidalLinked || soundcloudLinked

  return (
    <div className="playmixes">
      <div className="playmixes__hero">
        <h2 className="section-title playmixes__title">Playmix</h2>
        <p className="muted playmixes__lede">
          Build playlists that mix Spotify and SoundCloud (TIDAL preview search only until playback is wired).
          Saved in this browser — swap in a backend later for sync across devices.
        </p>
      </div>

      {showListTabs ? (
        <div className="library-tabs playmixes__tabs" role="tablist" aria-label="Filter playmixes">
          <button
            type="button"
            data-active={listTab === "all"}
            onClick={() => setListTab("all")}
          >
            All
          </button>
          {spotifyLinked ? (
            <button
              type="button"
              data-active={listTab === "spotify"}
              onClick={() => setListTab("spotify")}
            >
              Spotify
            </button>
          ) : null}
          {tidalLinked ? (
            <button
              type="button"
              data-active={listTab === "tidal"}
              onClick={() => setListTab("tidal")}
            >
              TIDAL
            </button>
          ) : null}
          {soundcloudLinked ? (
            <button
              type="button"
              data-active={listTab === "soundcloud"}
              onClick={() => setListTab("soundcloud")}
            >
              SoundCloud
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="playmixes__toolbar">
        <div className="playlist-library-toolbar__search">
          <label className="playlist-search-label" htmlFor="playmix-list-search">
            Search playmixes
          </label>
          <input
            id="playmix-list-search"
            type="search"
            className="playlist-search-input"
            placeholder="By name…"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="playmixes__new-row">
          <input
            type="text"
            className="playlist-search-input playmixes__new-name"
            placeholder="New playmix name…"
            value={newNameDraft}
            onChange={(e) => setNewNameDraft(e.target.value)}
            maxLength={120}
          />
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => createPlaymix()}>
            Create playmix
          </button>
        </div>
      </div>

      {!selected ? (
        <div className="playmixes__grid-wrap">
          {filteredList.length === 0 ? (
            <p className="muted empty-state">No playmixes yet. Create one and add tracks from search.</p>
          ) : (
            <div className="playlist-grid">
              {filteredList.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="playlist-card"
                  data-service="playmix"
                  onClick={() => setSelectedId(p.id)}
                >
                  <div className="playlist-card__cover playlist-card__cover--playmix">
                    <span className="playlist-card__badge playlist-card__badge--playmix">Playmix</span>
                  </div>
                  <div className="playlist-card__body">
                    <div className="playlist-card__name">{p.name}</div>
                    <div className="playlist-card__meta">{p.tracks.length} tracks</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <section className="playmixes__editor">
          <nav className="playlist-view-nav" aria-label="Playmix">
            <button
              type="button"
              className="btn btn--ghost playlist-view-nav__back"
              disabled={busy}
              onClick={() => {
                setSelectedId(null)
                setSearchResults(null)
                setTrackSearch("")
              }}
            >
              ← Back to playmixes
            </button>
          </nav>

          <div className="playmixes__editor-head">
            {detailTab === "listen" ? (
              <h2 className="playmixes__editor-title playmixes__editor-title--readonly">{selected.name}</h2>
            ) : (
              <input
                type="text"
                className="playmixes__editor-title"
                value={selected.name}
                onChange={(e) => {
                  const name = e.target.value
                  updatePlaymix(selected.id, (p) => ({ ...p, name: name || "Untitled" }))
                }}
                aria-label="Playmix name"
              />
            )}
            <div className="playmixes__editor-actions">
              <button
                type="button"
                className="btn btn--playmix"
                disabled={busy || selected.tracks.length === 0}
                onClick={() => onPlay(selected, 0)}
              >
                Play playmix
              </button>
            </div>
          </div>

          <div className="library-tabs playmixes__detail-tabs" role="tablist" aria-label="Playmix view">
            <button type="button" data-active={detailTab === "listen"} onClick={() => setDetailTab("listen")}>
              Listen
            </button>
            <button type="button" data-active={detailTab === "edit"} onClick={() => setDetailTab("edit")}>
              Edit
            </button>
          </div>

          {detailTab === "listen" ? (
            <>
              {selected.tracks.length === 0 ? (
                <p className="muted">
                  No tracks yet. Switch to <strong>Edit</strong> to search and add songs from your services.
                </p>
              ) : (
                <>
                  <div className="playlist-library-toolbar__search playmixes__listen-filter">
                    <label className="playlist-search-label" htmlFor="playmix-listen-filter">
                      Filter tracks
                    </label>
                    <input
                      id="playmix-listen-filter"
                      type="search"
                      className="playlist-search-input"
                      placeholder="Filter by title or artist…"
                      value={listenFilter}
                      onChange={(e) => setListenFilter(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  {listenFilteredEntries.length === 0 ? (
                    <p className="muted playlist-search-empty">No tracks match your search.</p>
                  ) : (
                    <ol className="track-list">
                      {listenFilteredEntries.map(({ row: t, indexInPlaylist: i }) => {
                        const isNp = playmixRowNowPlaying(
                          t,
                          i,
                          selected.id,
                          playing,
                          spotifyNowPlayingUri,
                          soundcloudNowPlayingTrackId,
                        )
                        const dur = playmixListenDurationLabel(t)
                        const tidal = t.service === "tidal"
                        return (
                          <li key={t.key}>
                            <button
                              type="button"
                              className="track-list__row"
                              disabled={busy || tidal}
                              aria-disabled={busy || tidal ? true : undefined}
                              aria-current={isNp ? "true" : undefined}
                              title={tidal ? "TIDAL playback not supported in-app yet" : undefined}
                              onClick={() => {
                                if (!tidal) onPlay(selected, i)
                              }}
                            >
                              <span className="track-list__idx">
                                {isNp ? (
                                  <span
                                    className={`track-list__playing-dot track-list__playing-dot--${t.service}`}
                                    title="Now playing"
                                    aria-hidden
                                  />
                                ) : null}
                                {i + 1}
                              </span>
                              <span className="track-list__main">
                                <span className="track-list__title">{t.title}</span>
                                <span className="track-list__artists">{t.artistLine}</span>
                              </span>
                              <span className="playmixes__listen-svc" data-svc={t.service}>
                                {t.service === "spotify"
                                  ? "Spotify"
                                  : t.service === "soundcloud"
                                    ? "SoundCloud"
                                    : "TIDAL"}
                              </span>
                              {dur ? <span className="track-list__dur">{dur}</span> : null}
                            </button>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </>
              )}
            </>
          ) : (
            <>
          <div className="playmixes__add">
            <h3 className="playmixes__subhead">Add tracks</h3>
            <p className="muted">
              Search signed-in services; we store which service each row came from for playback.
            </p>
            <div className="playmixes__search-row">
              <input
                type="search"
                className="playlist-search-input"
                placeholder="Song or artist…"
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch()
                }}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy || searching}
                onClick={() => void runSearch()}
              >
                {searching ? "Searching…" : "Search"}
              </button>
            </div>

            {searchResults ? (
              <div className="playmixes__hits">
                <div className="playmixes__hit-col" data-svc="spotify">
                  <div className="playmixes__hit-label">Spotify</div>
                  {searchResults.spotify.status === "skip" ? (
                    <p className="muted">Sign in to Spotify in the sidebar.</p>
                  ) : searchResults.spotify.status === "err" ? (
                    <p className="muted">{searchResults.spotify.msg}</p>
                  ) : (
                    <div className="playmixes__hit-card">
                      {searchResults.spotify.track.image ? (
                        <img src={searchResults.spotify.track.image} alt="" className="playmixes__hit-art" />
                      ) : (
                        <div className="playmixes__hit-art playmixes__hit-art--ph" />
                      )}
                      <div className="playmixes__hit-meta">
                        <div className="playmixes__hit-title">{searchResults.spotify.track.name}</div>
                        <div className="playmixes__hit-sub">{searchResults.spotify.track.artistLine}</div>
                        <div className="playmixes__hit-dur">
                          {formatMs(searchResults.spotify.track.durationMs)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--sm btn--spotify"
                        disabled={busy}
                        onClick={() => {
                          const e = hitToEntry("spotify", searchResults)
                          if (e) addEntry(selected.id, e)
                        }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>

                <div className="playmixes__hit-col" data-svc="soundcloud">
                  <div className="playmixes__hit-label">SoundCloud</div>
                  {searchResults.soundcloud.status === "skip" ? (
                    <p className="muted">Sign in to SoundCloud in the sidebar.</p>
                  ) : searchResults.soundcloud.status === "err" ? (
                    <p className="muted">{searchResults.soundcloud.msg}</p>
                  ) : (
                    <div className="playmixes__hit-card">
                      <div className="playmixes__hit-art playmixes__hit-art--ph playmixes__hit-art--sc" />
                      <div className="playmixes__hit-meta">
                        <div className="playmixes__hit-title">{searchResults.soundcloud.track.title}</div>
                        <div className="playmixes__hit-sub">{searchResults.soundcloud.track.artistLine}</div>
                        <div className="playmixes__hit-dur">
                          {formatMs(searchResults.soundcloud.track.durationMs)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--sm"
                        style={{ borderColor: "rgba(255,85,0,0.5)", color: "#ff5500" }}
                        disabled={busy}
                        onClick={() => {
                          const e = hitToEntry("soundcloud", searchResults)
                          if (e) addEntry(selected.id, e)
                        }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                </div>

                <div className="playmixes__hit-col" data-svc="tidal">
                  <div className="playmixes__hit-label">TIDAL</div>
                  {searchResults.tidal.status === "skip" ? (
                    <p className="muted">Sign in to TIDAL in the sidebar.</p>
                  ) : searchResults.tidal.status === "err" ? (
                    <p className="muted">{searchResults.tidal.msg}</p>
                  ) : (
                    <div className="playmixes__hit-card">
                      {searchResults.tidal.artworkUrl ? (
                        <img src={searchResults.tidal.artworkUrl} alt="" className="playmixes__hit-art" />
                      ) : (
                        <div className="playmixes__hit-art playmixes__hit-art--ph" />
                      )}
                      <div className="playmixes__hit-meta">
                        <div className="playmixes__hit-title">{searchResults.tidal.track.name}</div>
                        <div className="playmixes__hit-sub">{searchResults.tidal.track.artistLine}</div>
                        <div className="playmixes__hit-dur">
                          {formatSec(searchResults.tidal.track.durationSec)}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        disabled
                        title="TIDAL playback isn’t in Playmix yet — can’t add to queue."
                      >
                        Preview only
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <h3 className="playmixes__subhead">Tracks</h3>
          {selected.tracks.length === 0 ? (
            <p className="muted">No tracks yet. Search above to add Spotify or SoundCloud rows.</p>
          ) : (
            <ol className="track-list playmixes__track-list">
              {selected.tracks.map((t, i) => {
                const isNp = playmixRowNowPlaying(
                  t,
                  i,
                  selected.id,
                  playing,
                  spotifyNowPlayingUri,
                  soundcloudNowPlayingTrackId,
                )
                return (
                <li key={t.key}>
                  <div
                    className={
                      "track-list__row playmixes__track-row" +
                      (isNp ? " playmixes__track-row--active" : "")
                    }
                  >
                    <button
                      type="button"
                      className="playmixes__track-play"
                      disabled={busy || t.service === "tidal"}
                      title={t.service === "tidal" ? "TIDAL playback not supported in-app yet" : "Play from here"}
                      onClick={() => onPlay(selected, i)}
                    >
                      <span className="track-list__idx">
                        {isNp ? (
                          <span
                            className={`track-list__playing-dot track-list__playing-dot--${t.service}`}
                            title="Now playing"
                            aria-hidden
                          />
                        ) : null}
                        {i + 1}
                      </span>
                      <span className="track-list__main">
                        <span className="track-list__title">{t.title}</span>
                        <span className="track-list__artists">{t.artistLine}</span>
                      </span>
                    </button>
                    <span
                      className={
                        "playmixes__svc-badge" +
                        (t.service === "spotify"
                          ? " playmixes__svc-badge--spotify"
                          : t.service === "soundcloud"
                            ? " playmixes__svc-badge--soundcloud"
                            : " playmixes__svc-badge--tidal")
                      }
                    >
                      {t.service === "spotify"
                        ? "Spotify"
                        : t.service === "soundcloud"
                          ? "SoundCloud"
                          : "TIDAL"}
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm playmixes__remove"
                      disabled={busy}
                      onClick={() => removeTrack(selected.id, t.key)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
                )
              })}
            </ol>
          )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
