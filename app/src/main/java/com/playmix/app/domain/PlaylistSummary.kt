package com.playmix.app.domain

data class PlaylistSummary(
    val id: String,
    val name: String,
    val service: MusicService,
    val trackCount: Int,
    val ownerLabel: String,
    /** https URL for grid / row artwork (Spotify `images`, TIDAL links when present). */
    val artworkUrl: String? = null,
    val artworkContentDescription: String? = null,
)
