import { useEffect, useState } from "react"
import type { SpotifyPlaybackState, SpotifyRepeatState } from "../spotify/player"

export type NowPlayingBarModel =
  | { source: "spotify"; state: SpotifyPlaybackState }
  | {
      source: "soundcloud"
      trackKey: string
      title: string
      subtitle: string
      artworkUrl: string | null
      durationMs: number
      positionMs: number
      isPlaying: boolean
      loading: boolean
      canNext: boolean
    }
  | { source: "tidal"; title: string; subtitle: string }

type Props = {
  model: NowPlayingBarModel | null
  busy: boolean
  onSpotifyPlayPause: () => void
  onSpotifyPrevious: () => void
  onSpotifyNext: () => void
  onSpotifyShuffle: () => void
  onSpotifyRepeatCycle: () => void
  onSpotifySeek: (positionMs: number) => void
  onSoundcloudPlayPause: () => void
  onSoundcloudPrevious: () => void
  onSoundcloudNext: () => void
  onSoundcloudSeek: (positionMs: number) => void
}

function IconShuffle() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      className="now-playing-bar__icon-svg"
      aria-hidden
    >
      <polyline
        points="16 3 21 3 21 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="4"
        y1="20"
        x2="21"
        y2="3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline
        points="21 16 21 21 16 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="15"
        y1="15"
        x2="21"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="4"
        y1="4"
        x2="9"
        y2="9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconSkipBack() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} className="now-playing-bar__icon-svg" aria-hidden>
      <path fill="currentColor" d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
    </svg>
  )
}

function IconSkipForward() {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} className="now-playing-bar__icon-svg" aria-hidden>
      <path fill="currentColor" d="M16 18h2V6h-2v12zM6 6l8.5 6L6 18V6z" />
    </svg>
  )
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} className="now-playing-bar__icon-svg" aria-hidden>
      <path fill="currentColor" d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width={26} height={26} className="now-playing-bar__icon-svg" aria-hidden>
      <path fill="currentColor" d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  )
}

function IconRepeat({ mode }: { mode: SpotifyRepeatState }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      className="now-playing-bar__icon-svg"
      aria-hidden
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17 2.5l3 3-3 3M3 12.5v-2A4 4 0 0 1 7 6.5h12.5M7 21.5l-3-3 3-3M21 11.5v2a4 4 0 0 1-4 4H4.5"
      />
      {mode === "context" ? (
        <circle cx="18.5" cy="5" r="1.75" fill="currentColor" stroke="none" />
      ) : null}
      {mode === "track" ? (
        <text
          x="12"
          y="20.5"
          textAnchor="middle"
          fontSize="8.5"
          fontWeight="800"
          fill="currentColor"
          stroke="none"
        >
          1
        </text>
      ) : null}
    </svg>
  )
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

function repeatLabel(state: SpotifyRepeatState): string {
  if (state === "context") return "Repeat playlist"
  if (state === "track") return "Repeat one"
  return "Repeat off"
}

export function NowPlayingBar({
  model,
  busy,
  onSpotifyPlayPause,
  onSpotifyPrevious,
  onSpotifyNext,
  onSpotifyShuffle,
  onSpotifyRepeatCycle,
  onSpotifySeek,
  onSoundcloudPlayPause,
  onSoundcloudPrevious,
  onSoundcloudNext,
  onSoundcloudSeek,
}: Props) {
  const [smoothProgressMs, setSmoothProgressMs] = useState(0)

  const spState = model?.source === "spotify" ? model.state : null
  const scState = model?.source === "soundcloud" ? model : null

  useEffect(() => {
    if (!spState) return
    const p0 = spState.progressMs
    const dur = spState.durationMs
    if (!spState.isPlaying) {
      setSmoothProgressMs(dur != null ? Math.min(p0, dur) : p0)
      return
    }
    const t0 = Date.now()
    const id = window.setInterval(() => {
      const next = p0 + (Date.now() - t0)
      setSmoothProgressMs(dur != null ? Math.min(dur, next) : next)
    }, 450)
    return () => window.clearInterval(id)
  }, [
    spState?.isPlaying,
    spState?.progressMs,
    spState?.durationMs,
    spState?.item?.uri,
  ])

  useEffect(() => {
    if (!scState) return
    const p0 = scState.positionMs
    const dur = scState.durationMs
    if (!scState.isPlaying || scState.loading) {
      setSmoothProgressMs(Math.min(p0, dur))
      return
    }
    const t0 = Date.now()
    const id = window.setInterval(() => {
      const next = p0 + (Date.now() - t0)
      setSmoothProgressMs(Math.min(dur, next))
    }, 450)
    return () => window.clearInterval(id)
  }, [
    scState?.isPlaying,
    scState?.positionMs,
    scState?.durationMs,
    scState?.trackKey,
    scState?.loading,
  ])

  if (!model) return null

  return (
    <div className="now-playing-bar">
      <div className="now-playing-bar__inner" data-source={model.source}>
        {model.source === "spotify" ? (
          <>
            <div className="now-playing-bar__art">
              {model.state.item?.image ? (
                <img src={model.state.item.image} alt="" />
              ) : (
                <div className="now-playing-bar__art-placeholder now-playing-bar__art-placeholder--spotify" />
              )}
            </div>
            <div className="now-playing-bar__center">
              <div className="now-playing-bar__meta">
                <div className="now-playing-bar__service">Spotify</div>
                <div className="now-playing-bar__title">{model.state.item!.name}</div>
                <div className="now-playing-bar__sub">
                  {model.state.item!.artists || "Spotify"}
                  {model.state.deviceName ? ` · ${model.state.deviceName}` : ""}
                </div>
              </div>
              <div className="now-playing-bar__progress-row">
                <span className="now-playing-bar__time">{formatTime(smoothProgressMs)}</span>
                <input
                  type="range"
                  className="now-playing-bar__scrub"
                  min={0}
                  max={model.state.durationMs != null ? model.state.durationMs : Math.max(1, smoothProgressMs)}
                  value={Math.min(
                    model.state.durationMs ?? smoothProgressMs,
                    smoothProgressMs,
                  )}
                  disabled={busy || model.state.durationMs == null}
                  aria-label="Playback position"
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setSmoothProgressMs(v)
                  }}
                  onPointerUp={(e) => {
                    const t = e.currentTarget as HTMLInputElement
                    onSpotifySeek(Number(t.value))
                  }}
                  onKeyUp={(e) => {
                    if (e.key === "Enter") {
                      const t = e.currentTarget as HTMLInputElement
                      onSpotifySeek(Number(t.value))
                    }
                  }}
                />
                <span className="now-playing-bar__time">
                  {model.state.durationMs != null ? formatTime(model.state.durationMs) : "—:—"}
                </span>
              </div>
              <div className="now-playing-bar__transports">
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy}
                  aria-pressed={model.state.shuffle}
                  aria-label={model.state.shuffle ? "Shuffle on" : "Shuffle off"}
                  title="Shuffle"
                  onClick={onSpotifyShuffle}
                >
                  <IconShuffle />
                </button>
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy}
                  aria-label="Previous track"
                  title="Previous"
                  onClick={onSpotifyPrevious}
                >
                  <IconSkipBack />
                </button>
                <button
                  type="button"
                  className="now-playing-bar__play"
                  disabled={busy}
                  aria-label={model.state.isPlaying ? "Pause" : "Play"}
                  onClick={onSpotifyPlayPause}
                >
                  {model.state.isPlaying ? <IconPause /> : <IconPlay />}
                </button>
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy}
                  aria-label="Next track"
                  title="Next"
                  onClick={onSpotifyNext}
                >
                  <IconSkipForward />
                </button>
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy}
                  aria-label={repeatLabel(model.state.repeatState)}
                  title={repeatLabel(model.state.repeatState)}
                  onClick={onSpotifyRepeatCycle}
                >
                  <IconRepeat mode={model.state.repeatState} />
                </button>
              </div>
            </div>
          </>
        ) : model.source === "soundcloud" ? (
          <>
            <div className="now-playing-bar__art">
              {model.artworkUrl ? (
                <img src={model.artworkUrl} alt="" />
              ) : (
                <div className="now-playing-bar__art-placeholder now-playing-bar__art-placeholder--soundcloud" />
              )}
            </div>
            <div className="now-playing-bar__center">
              <div className="now-playing-bar__meta">
                <div className="now-playing-bar__service">SoundCloud</div>
                <div className="now-playing-bar__title">{model.title}</div>
                <div className="now-playing-bar__sub">{model.subtitle || "SoundCloud"}</div>
              </div>
              <div className="now-playing-bar__progress-row">
                <span className="now-playing-bar__time">{formatTime(smoothProgressMs)}</span>
                <input
                  type="range"
                  className="now-playing-bar__scrub"
                  min={0}
                  max={Math.max(1, model.durationMs)}
                  value={Math.min(model.durationMs, smoothProgressMs)}
                  disabled={busy || model.loading || model.durationMs <= 1}
                  aria-label="Playback position"
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    if (Number.isFinite(v)) setSmoothProgressMs(v)
                  }}
                  onPointerUp={(e) => {
                    const t = e.currentTarget as HTMLInputElement
                    onSoundcloudSeek(Number(t.value))
                  }}
                  onKeyUp={(e) => {
                    if (e.key === "Enter") {
                      const t = e.currentTarget as HTMLInputElement
                      onSoundcloudSeek(Number(t.value))
                    }
                  }}
                />
                <span className="now-playing-bar__time">{formatTime(model.durationMs)}</span>
              </div>
              <div className="now-playing-bar__transports now-playing-bar__transports--soundcloud">
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy || model.loading}
                  aria-label="Previous track"
                  title="Previous"
                  onClick={onSoundcloudPrevious}
                >
                  <IconSkipBack />
                </button>
                <button
                  type="button"
                  className="now-playing-bar__play"
                  disabled={busy || model.loading}
                  aria-label={model.isPlaying ? "Pause" : "Play"}
                  onClick={onSoundcloudPlayPause}
                >
                  {model.isPlaying ? <IconPause /> : <IconPlay />}
                </button>
                <button
                  type="button"
                  className="now-playing-bar__tbtn"
                  disabled={busy || model.loading || !model.canNext}
                  aria-label="Next track"
                  title="Next"
                  onClick={onSoundcloudNext}
                >
                  <IconSkipForward />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="now-playing-bar__art">
              <div className="now-playing-bar__art-placeholder now-playing-bar__art-placeholder--tidal" />
            </div>
            <div className="now-playing-bar__meta now-playing-bar__meta--wide">
              <div className="now-playing-bar__service">TIDAL</div>
              <div className="now-playing-bar__title">{model.title}</div>
              <div className="now-playing-bar__sub">{model.subtitle}</div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
