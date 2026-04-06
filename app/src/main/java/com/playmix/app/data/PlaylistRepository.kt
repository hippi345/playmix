package com.playmix.app.data

import com.playmix.app.domain.MusicService
import com.playmix.app.domain.PlaylistSummary
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

interface PlaylistRepository {
    fun observePlaylists(): Flow<List<PlaylistSummary>>
    suspend fun refresh()
}

/**
 * Phase 1 placeholder: replace with Spotify + TIDAL API calls and token-aware sources.
 */
class MockPlaylistRepository : PlaylistRepository {

    private val flow = MutableStateFlow<List<PlaylistSummary>>(emptyList())

    override fun observePlaylists(): Flow<List<PlaylistSummary>> = flow.asStateFlow()

    override suspend fun refresh() {
        delay(450)
        flow.update { current ->
            if (current.isEmpty()) mockSeed() else current
        }
    }

    private fun mockSeed(): List<PlaylistSummary> = listOf(
        PlaylistSummary(
            id = "sp_release_radar",
            name = "Release Radar",
            service = MusicService.Spotify,
            trackCount = 30,
            ownerLabel = "Spotify",
        ),
        PlaylistSummary(
            id = "sp_discover_weekly",
            name = "Discover Weekly",
            service = MusicService.Spotify,
            trackCount = 30,
            ownerLabel = "Spotify",
        ),
        PlaylistSummary(
            id = "sp_on_repeat",
            name = "On Repeat",
            service = MusicService.Spotify,
            trackCount = 50,
            ownerLabel = "You",
        ),
        PlaylistSummary(
            id = "tidal_myx",
            name = "My Mix",
            service = MusicService.Tidal,
            trackCount = 128,
            ownerLabel = "TIDAL",
        ),
        PlaylistSummary(
            id = "tidal_faves",
            name = "Favorites",
            service = MusicService.Tidal,
            trackCount = 24,
            ownerLabel = "You",
        ),
        PlaylistSummary(
            id = "tidal_focus",
            name = "Deep work",
            service = MusicService.Tidal,
            trackCount = 67,
            ownerLabel = "You",
        ),
    )
}
