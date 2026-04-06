package com.playmix.app.spotify

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.playmix.app.PlaymixApplication
import com.playmix.app.data.spotify.SpotifyAccess
import com.playmix.app.data.spotify.SpotifyPlaylistDetailLoader
import com.playmix.app.data.spotify.SpotifyPlaylistIds
import com.playmix.app.domain.SpotifyTrackItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

data class SpotifyPlaylistPlayerUiState(
    val playlistId: String,
    val playlistName: String = "",
    val playlistImageUrl: String? = null,
    val tracks: List<SpotifyTrackItem> = emptyList(),
    val tracksLoadError: String? = null,
    val isLoadingPlaylist: Boolean = true,
    val playlistLoadError: String? = null,
)

class SpotifyPlaylistDetailViewModel(
    application: Application,
    rawPlaylistId: String,
    private val playback: SpotifyPlaybackViewModel,
) : AndroidViewModel(application) {

    private val playlistId = SpotifyPlaylistIds.normalize(rawPlaylistId)

    private val app = application as PlaymixApplication
    private val access = SpotifyAccess(app.tokenStore, app.tokenExchange, app.httpClient)
    private val loader = SpotifyPlaylistDetailLoader(access)

    private val _state = MutableStateFlow(
        SpotifyPlaylistPlayerUiState(playlistId = playlistId),
    )
    val state: StateFlow<SpotifyPlaylistPlayerUiState> = _state.asStateFlow()

    fun loadPlaylist() {
        viewModelScope.launch {
            _state.update {
                it.copy(
                    isLoadingPlaylist = true,
                    playlistLoadError = null,
                    tracksLoadError = null,
                )
            }
            val detail = withContext(Dispatchers.IO) {
                loader.load(playlistId)
            }
            if (detail == null) {
                _state.update {
                    it.copy(
                        isLoadingPlaylist = false,
                        tracksLoadError = null,
                        playlistLoadError = "Could not load playlist. Check your connection and Spotify login.",
                    )
                }
            } else {
                val metaErr = detail.playlistMetaError
                _state.update {
                    it.copy(
                        isLoadingPlaylist = false,
                        playlistId = detail.id,
                        playlistName = detail.name,
                        playlistImageUrl = detail.imageUrl,
                        tracks = if (metaErr.isNullOrBlank()) detail.tracks else emptyList(),
                        tracksLoadError = if (metaErr.isNullOrBlank()) detail.tracksLoadError else null,
                        playlistLoadError = metaErr?.takeIf { it.isNotBlank() },
                    )
                }
            }
        }
    }

    fun playPlaylist() {
        playback.playPlaylist(playlistId)
    }

    fun playTrack(track: SpotifyTrackItem) {
        playback.playTrackInPlaylist(playlistId, track.uri)
    }
}

class SpotifyPlaylistDetailViewModelFactory(
    private val application: Application,
    private val playlistId: String,
    private val playback: SpotifyPlaybackViewModel,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass == SpotifyPlaylistDetailViewModel::class.java)
        return SpotifyPlaylistDetailViewModel(application, playlistId, playback) as T
    }
}
