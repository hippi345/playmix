/** Open playlist in TIDAL’s web player (starts playback there if the user is logged in). */
export function tidalPlaylistUrl(playlistId: string): string {
  const id = playlistId.trim()
  return `https://tidal.com/browse/playlist/${encodeURIComponent(id)}`
}

export function openTidalPlaylist(playlistId: string): void {
  window.open(tidalPlaylistUrl(playlistId), "_blank", "noopener,noreferrer")
}

/** Track page — often hands off to the TIDAL desktop/mobile app if installed. */
export function tidalTrackUrl(trackId: string): string {
  const id = trackId.trim()
  return `https://tidal.com/browse/track/${encodeURIComponent(id)}`
}

export function openTidalTrack(trackId: string): void {
  window.open(tidalTrackUrl(trackId), "_blank", "noopener,noreferrer")
}
