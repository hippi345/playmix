package com.playmix.app.ui.playlists

import com.playmix.app.domain.MusicService

enum class PlaylistLibrarySection(val title: String) {
    All("All playlists"),
    Spotify("Spotify"),
    Tidal("TIDAL"),
    ;

    fun matches(service: MusicService): Boolean = when (this) {
        All -> true
        Spotify -> service == MusicService.Spotify
        Tidal -> service == MusicService.Tidal
    }
}
