/** Service a row was chosen from (drives playback). */
export type PlaymixService = "spotify" | "soundcloud" | "tidal"

/** One track in a user-built Playmix playlist (cross-service). */
export type PlaymixTrackEntry = {
  key: string
  service: PlaymixService
  title: string
  artistLine: string
  durationMs: number | null
  artworkUrl: string | null
  spotifyUri?: string
  soundcloudTrackId?: string
  soundcloudPermalinkUrl?: string
  tidalTrackId?: string
}

export type PlaymixPlaylist = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tracks: PlaymixTrackEntry[]
}

/** Runtime: which playmix is driving transport / auto-advance. */
export type PlaymixSession = {
  playmixId: string
  playmixName: string
  tracks: PlaymixTrackEntry[]
  index: number
}
