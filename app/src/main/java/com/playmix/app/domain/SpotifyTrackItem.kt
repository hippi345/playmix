package com.playmix.app.domain

data class SpotifyTrackItem(
    val id: String,
    val uri: String,
    val name: String,
    val artistLine: String,
    val albumName: String,
    val artworkUrl: String?,
    val durationMs: Long,
)

data class SpotifyPlaylistDetail(
    val id: String,
    val name: String,
    val imageUrl: String?,
    val tracks: List<SpotifyTrackItem>,
    /** Set when the playlist loads but track pages fail or return no playable rows. */
    val tracksLoadError: String? = null,
    /** Set when GET /playlists/{id} fails (auth, 403 policy, network). */
    val playlistMetaError: String? = null,
)
