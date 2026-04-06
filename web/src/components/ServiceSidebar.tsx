type Props = {
  spotifyConfigured: boolean
  tidalConfigured: boolean
  spotifyLinked: boolean
  tidalLinked: boolean
  busy: boolean
  refreshingLibraries: boolean
  onRefreshAll: () => void
  onToggleSpotify: () => void
  onToggleTidal: () => void
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

export function ServiceSidebar({
  spotifyConfigured,
  tidalConfigured,
  spotifyLinked,
  tidalLinked,
  busy,
  refreshingLibraries,
  onRefreshAll,
  onToggleSpotify,
  onToggleTidal,
}: Props) {
  const canRefresh =
    (spotifyConfigured && spotifyLinked) || (tidalConfigured && tidalLinked)

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
      </div>
    </aside>
  )
}
