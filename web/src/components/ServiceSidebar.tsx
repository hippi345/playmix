type Props = {
  spotifyConfigured: boolean
  tidalConfigured: boolean
  soundcloudConfigured: boolean
  spotifyLinked: boolean
  tidalLinked: boolean
  soundcloudLinked: boolean
  busy: boolean
  refreshingLibraries: boolean
  onRefreshAll: () => void
  onToggleSpotify: () => void
  onToggleTidal: () => void
  onToggleSoundcloud: () => void
}

function IconRefresh() {
  return (
    <svg className="service-sidebar__icon-svg" viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-15.36M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64M21 3v6h-6M3 21v-6h6"
      />
    </svg>
  )
}

function IconSpotify() {
  return (
    <svg className="service-sidebar__icon-svg" viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <circle cx="12" cy="12" r="10.25" fill="currentColor" opacity="0.12" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M17.4 16.9c-.5 0-.9-.2-1.6-.5-3.2-1.4-7.4-1.7-10.5-.9-.4.1-.8.2-1 .2-.7 0-1.2-.5-1.2-1.1 0-.7.4-1.2 1.3-1.5 3.6-1 8.5-.6 12.3 1 .7.3 1.1.8 1.1 1.3 0 .7-.5 1.2-1.4 1.2zm1.6-4.5c-.6 0-1-.2-1.6-.5-3.6-1.7-9.1-2.2-12.1-1.2-.5.2-.8.2-1.1.2-.8 0-1.4-.6-1.4-1.3s.5-1.2 1.3-1.5c3.6-1.2 9.9-.6 14 1.3.6.3 1 .8 1 1.4 0 .8-.6 1.4-1.5 1.4zM19.8 7.2c-.4 0-.7-.1-1.2-.3C14.9 5.2 8.9 4.8 5 6c-.5.2-.9.3-1.4.3-.9 0-1.6-.7-1.6-1.6 0-.9.5-1.5 1.5-1.9 4.5-1.4 11.3-.9 15.8 1.3.8.4 1.3 1 1.3 1.8 0 .9-.7 1.6-1.8 1.6z"
        clipRule="evenodd"
      />
    </svg>
  )
}

/** Simplified diamond / wave mark for TIDAL */
function IconTidal() {
  return (
    <svg className="service-sidebar__icon-svg" viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2.5L20 12l-8 9.5L4 12 12 2.5zm0 3.2L6.6 12 12 18.3 17.4 12 12 5.7z"
      />
    </svg>
  )
}

/** Stylized cloud for SoundCloud */
function IconSoundcloud() {
  return (
    <svg className="service-sidebar__icon-svg" viewBox="0 0 24 24" width={24} height={24} aria-hidden>
      <path
        fill="currentColor"
        d="M8.5 17.5c-.9 0-1.7-.25-2.4-.7A4.48 4.48 0 0 1 4 12.5C4 9.74 6.02 7.44 8.7 7.06a5.99 5.99 0 0 1 11.35 1.94A3.49 3.49 0 0 1 21 12.25c0 1.95-1.55 3.53-3.48 3.53-.12 0-.23 0-.35-.02H8.5zm2-3.9h.9v-5.1h-.9L9.2 10.7l.52.73.78-1.08v3.25zm2.4 0h.9V8.5h-.9v5.1zm2.1 0h.95V10h-.95v3.6zm2.15 0H18V9.2h-.85v4.4z"
      />
    </svg>
  )
}

export function ServiceSidebar({
  spotifyConfigured,
  tidalConfigured,
  soundcloudConfigured,
  spotifyLinked,
  tidalLinked,
  soundcloudLinked,
  busy,
  refreshingLibraries,
  onRefreshAll,
  onToggleSpotify,
  onToggleTidal,
  onToggleSoundcloud,
}: Props) {
  const canRefresh =
    (spotifyConfigured && spotifyLinked) ||
    (tidalConfigured && tidalLinked) ||
    (soundcloudConfigured && soundcloudLinked)

  return (
    <aside className="service-sidebar" aria-label="Music services">
      <div className="service-sidebar__inner">
        <button
          type="button"
          className={
            "service-sidebar__btn service-sidebar__btn--refresh" +
            (refreshingLibraries ? " service-sidebar__btn--spinning" : "")
          }
          disabled={busy || !canRefresh}
          title={canRefresh ? "Refresh all libraries" : "Sign in to a service to refresh"}
          aria-label="Refresh all libraries"
          onClick={() => onRefreshAll()}
        >
          <IconRefresh />
        </button>

        <div className="service-sidebar__divider" />

        {spotifyConfigured ? (
          <button
            type="button"
            className={
              "service-sidebar__btn service-sidebar__btn--spotify" +
              (spotifyLinked ? " service-sidebar__btn--linked" : "")
            }
            disabled={busy}
            title={spotifyLinked ? "Spotify — signed in (click to sign out)" : "Spotify — sign in"}
            aria-pressed={spotifyLinked}
            aria-label={spotifyLinked ? "Sign out of Spotify" : "Sign in to Spotify"}
            onClick={() => onToggleSpotify()}
          >
            <IconSpotify />
          </button>
        ) : null}

        {tidalConfigured ? (
          <button
            type="button"
            className={
              "service-sidebar__btn service-sidebar__btn--tidal" +
              (tidalLinked ? " service-sidebar__btn--linked" : "")
            }
            disabled={busy}
            title={tidalLinked ? "TIDAL — signed in (click to sign out)" : "TIDAL — sign in"}
            aria-pressed={tidalLinked}
            aria-label={tidalLinked ? "Sign out of TIDAL" : "Sign in to TIDAL"}
            onClick={() => onToggleTidal()}
          >
            <IconTidal />
          </button>
        ) : null}

        {soundcloudConfigured ? (
          <button
            type="button"
            className={
              "service-sidebar__btn service-sidebar__btn--soundcloud" +
              (soundcloudLinked ? " service-sidebar__btn--linked" : "")
            }
            disabled={busy}
            title={soundcloudLinked ? "SoundCloud — signed in (click to sign out)" : "SoundCloud — sign in"}
            aria-pressed={soundcloudLinked}
            aria-label={soundcloudLinked ? "Sign out of SoundCloud" : "Sign in to SoundCloud"}
            onClick={() => onToggleSoundcloud()}
          >
            <IconSoundcloud />
          </button>
        ) : null}
      </div>
    </aside>
  )
}
