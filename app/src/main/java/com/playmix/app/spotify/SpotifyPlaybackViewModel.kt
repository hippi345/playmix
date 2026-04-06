package com.playmix.app.spotify

import android.app.Activity
import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.playmix.app.BuildConfig
import com.playmix.app.PlaymixApplication
import com.playmix.app.R
import com.playmix.app.auth.OAuthConstants
import com.playmix.app.data.spotify.SpotifyAccess
import com.playmix.app.data.spotify.SpotifyConnectPlayerSnapshot
import com.playmix.app.data.spotify.SpotifyWebPlayback
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.PendingResult
import com.spotify.protocol.types.PlayerState
import com.spotify.protocol.types.Repeat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class SpotifyPlaybackUiState(
    val connectPlaybackError: String? = null,
    val activeSpotifyDeviceName: String? = null,
    val nowPlayingTitle: String? = null,
    val nowPlayingArtist: String? = null,
    val nowPlayingArtUrl: String? = null,
    val nowPlayingTrackUri: String? = null,
    val isPaused: Boolean = true,
    val positionMs: Long = 0L,
    val durationMs: Long = 0L,
    val shuffleEnabled: Boolean = false,
    val repeatState: String = "off",
    /** Main menu + global bar: expanded shows full transport; collapsed shows art + title + expand. */
    val playbackBarExpanded: Boolean = true,
)

/**
 * Activity-scoped Spotify Connect / App Remote playback so the now-playing bar works on every screen.
 */
class SpotifyPlaybackViewModel(
    application: Application,
) : AndroidViewModel(application) {

    private val app = application as PlaymixApplication
    private val access = SpotifyAccess(app.tokenStore, app.tokenExchange, app.httpClient)
    private val webPlayback = SpotifyWebPlayback(access)

    private val _state = MutableStateFlow(SpotifyPlaybackUiState())
    val state: StateFlow<SpotifyPlaybackUiState> = _state.asStateFlow()

    private var spotifyAppRemote: SpotifyAppRemote? = null
    private var playerStateSubscription: PendingResult<PlayerState>? = null
    private var positionTicker: Job? = null
    private var connectPollJob: Job? = null
    private var isAppRemoteActive: Boolean = false
    private var connectCommandDeviceId: String? = null
    private var sessionStarted: Boolean = false

    /**
     * Starts Spotify **Connect** polling only. We do **not** auto-open Spotify App Remote here:
     * [SpotifyAppRemote.connect] has blocked the UI thread for long periods on emulators and made
     * the system navigation unusable. Playback still works via Spotify Connect / Web API. Optional App
     * Remote can be wired later (e.g. lazy connect on explicit user action).
     */
    fun startSessionIfNeeded(@Suppress("UNUSED_PARAMETER") activity: Activity) {
        if (sessionStarted) return
        sessionStarted = true
        startConnectPolling()
    }

    fun setPlaybackBarExpanded(expanded: Boolean) {
        _state.update { it.copy(playbackBarExpanded = expanded) }
    }

    fun connectRemote(activity: Activity) {
        if (BuildConfig.SPOTIFY_CLIENT_ID.isBlank()) return
        val params = ConnectionParams.Builder(BuildConfig.SPOTIFY_CLIENT_ID)
            .setRedirectUri(OAuthConstants.SPOTIFY_REDIRECT)
            .showAuthView(true)
            .build()

        SpotifyAppRemote.connect(
            activity,
            params,
            object : Connector.ConnectionListener {
                override fun onConnected(remote: SpotifyAppRemote) {
                    viewModelScope.launch(Dispatchers.Main.immediate) {
                        spotifyAppRemote = remote
                        isAppRemoteActive = true
                        stopConnectPolling()
                        _state.update {
                            it.copy(
                                connectPlaybackError = null,
                                activeSpotifyDeviceName = getApplication<Application>().getString(
                                    R.string.spotify_playback_this_device_app,
                                ),
                            )
                        }
                        subscribePlayerState(remote)
                    }
                }

                override fun onFailure(@Suppress("UNUSED_PARAMETER") error: Throwable) {
                    viewModelScope.launch(Dispatchers.Main.immediate) {
                        spotifyAppRemote = null
                        isAppRemoteActive = false
                        startConnectPolling()
                    }
                }
            },
        )
    }

    private fun subscribePlayerState(remote: SpotifyAppRemote) {
        playerStateSubscription?.cancel()
        playerStateSubscription = remote.playerApi.subscribeToPlayerState()
            .setEventCallback { playerState: PlayerState ->
                viewModelScope.launch(Dispatchers.Main.immediate) {
                    applyAppRemotePlayerState(playerState)
                }
            }
            .setErrorCallback { /* ignore */ }
    }

    private fun applyAppRemotePlayerState(playerState: PlayerState) {
        val track = playerState.track
        val opts = playerState.playbackOptions
        val shuffle = opts?.isShuffling == true
        val repeatStr = when (opts?.repeatMode) {
            Repeat.ONE -> "track"
            Repeat.ALL -> "context"
            else -> "off"
        }
        if (track == null) {
            positionTicker?.cancel()
            positionTicker = null
            _state.update {
                it.copy(
                    nowPlayingTitle = null,
                    nowPlayingArtist = null,
                    nowPlayingArtUrl = null,
                    nowPlayingTrackUri = null,
                    isPaused = playerState.isPaused,
                    positionMs = playerState.playbackPosition,
                    durationMs = 0L,
                    shuffleEnabled = shuffle,
                    repeatState = repeatStr,
                )
            }
            return
        }
        _state.update {
            it.copy(
                nowPlayingTitle = track.name,
                nowPlayingArtist = track.artist?.name,
                nowPlayingArtUrl = track.imageUri?.raw,
                nowPlayingTrackUri = track.uri,
                isPaused = playerState.isPaused,
                positionMs = playerState.playbackPosition,
                durationMs = track.duration,
                shuffleEnabled = shuffle,
                repeatState = repeatStr,
            )
        }
        positionTicker?.cancel()
        if (playerState.isPaused || track.duration <= 0L) {
            positionTicker = null
        } else {
            startPositionTickerIfPlaying(track.duration, playerState.playbackPosition)
        }
    }

    private fun applyConnectSnapshot(snapshot: SpotifyConnectPlayerSnapshot?) {
        if (snapshot == null) {
            positionTicker?.cancel()
            positionTicker = null
            connectCommandDeviceId = null
            _state.update {
                it.copy(
                    nowPlayingTitle = null,
                    nowPlayingArtist = null,
                    nowPlayingArtUrl = null,
                    nowPlayingTrackUri = null,
                    isPaused = true,
                    positionMs = 0L,
                    durationMs = 0L,
                    activeSpotifyDeviceName = null,
                    shuffleEnabled = false,
                    repeatState = "off",
                )
            }
            return
        }
        snapshot.deviceId?.let { connectCommandDeviceId = it }
        _state.update {
            it.copy(
                activeSpotifyDeviceName = snapshot.deviceName,
                nowPlayingTitle = snapshot.title,
                nowPlayingArtist = snapshot.artist,
                nowPlayingArtUrl = snapshot.artUrl,
                nowPlayingTrackUri = snapshot.playingTrackUri,
                isPaused = snapshot.isPaused,
                positionMs = snapshot.positionMs,
                durationMs = snapshot.durationMs,
                shuffleEnabled = snapshot.shuffleEnabled,
                repeatState = snapshot.repeatState,
            )
        }
        positionTicker?.cancel()
        if (snapshot.isPaused || snapshot.durationMs <= 0L) {
            positionTicker = null
        } else {
            startPositionTickerIfPlaying(snapshot.durationMs, snapshot.positionMs)
        }
    }

    private fun startPositionTickerIfPlaying(durationMs: Long, basePosition: Long) {
        positionTicker = viewModelScope.launch {
            var pos = basePosition
            while (isActive) {
                delay(1000)
                pos += 1000
                if (pos > durationMs) pos = durationMs
                _state.update { it.copy(positionMs = pos.coerceAtMost(durationMs)) }
            }
        }
    }

    private fun startConnectPolling() {
        if (connectPollJob?.isActive == true || isAppRemoteActive) return
        connectPollJob = viewModelScope.launch {
            while (isActive) {
                if (!isAppRemoteActive) {
                    val snapshot = withContext(Dispatchers.IO) { webPlayback.getPlayer() }
                    if (!isAppRemoteActive) {
                        applyConnectSnapshot(snapshot)
                    }
                }
                delay(2000L)
            }
        }
    }

    private fun stopConnectPolling() {
        connectPollJob?.cancel()
        connectPollJob = null
    }

    fun playPlaylist(playlistId: String) {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.play("spotify:playlist:$playlistId")
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val deviceId = webPlayback.resolveDeviceId()
            if (deviceId == null) {
                val msg = webPlayback.apiErrorMessage(404, null)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
                return@launch
            }
            var (code, body) = webPlayback.playContextUri(deviceId, "spotify:playlist:$playlistId")
            if (code == 404) {
                webPlayback.transferToDevice(deviceId, play = false)
                val retry = webPlayback.playContextUri(deviceId, "spotify:playlist:$playlistId")
                code = retry.first
                body = retry.second
            }
            if (code !in 200..299) {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun playTrackInPlaylist(playlistId: String, trackUri: String) {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.play(trackUri)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val deviceId = webPlayback.resolveDeviceId()
            if (deviceId == null) {
                val msg = webPlayback.apiErrorMessage(404, null)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
                return@launch
            }
            val playlistUri = "spotify:playlist:$playlistId"
            var (code, body) = webPlayback.playPlaylistFromTrack(deviceId, playlistUri, trackUri)
            if (code == 404) {
                webPlayback.transferToDevice(deviceId, play = false)
                val retry = webPlayback.playPlaylistFromTrack(deviceId, playlistUri, trackUri)
                code = retry.first
                body = retry.second
            }
            if (code !in 200..299) {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun togglePlayPause() {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            val paused = _state.value.isPaused
            if (paused) remote.playerApi.resume() else remote.playerApi.pause()
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        val paused = _state.value.isPaused
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val (code, body) = if (paused) {
                webPlayback.resume(deviceId)
            } else {
                webPlayback.pause(deviceId)
            }
            if (code !in 200..299) {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun skipNext() {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.skipNext()
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val (code, body) = webPlayback.skipNext(deviceId)
            if (code !in 200..299) {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun skipPrevious() {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.skipPrevious()
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val (code, body) = webPlayback.skipPrevious(deviceId)
            if (code !in 200..299) {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun toggleShuffle() {
        val wantOn = !_state.value.shuffleEnabled
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.setShuffle(wantOn)
            _state.update { it.copy(shuffleEnabled = wantOn) }
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val (code, body) = webPlayback.setShuffle(deviceId, wantOn)
            if (code in 200..299) {
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(shuffleEnabled = wantOn) }
                }
            } else {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun cycleRepeatMode() {
        val next = when (_state.value.repeatState) {
            "off" -> "context"
            "context" -> "track"
            else -> "off"
        }
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            val mode = when (next) {
                "context" -> Repeat.ALL
                "track" -> Repeat.ONE
                else -> Repeat.OFF
            }
            remote.playerApi.setRepeat(mode)
            _state.update { it.copy(repeatState = next) }
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        viewModelScope.launch(Dispatchers.IO) {
            _state.update { it.copy(connectPlaybackError = null) }
            val (code, body) = webPlayback.setRepeat(deviceId, next)
            if (code in 200..299) {
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(repeatState = next) }
                }
            } else {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    fun seekTo(positionMs: Long) {
        val remote = spotifyAppRemote
        if (isAppRemoteActive && remote != null) {
            remote.playerApi.seekTo(positionMs)
            _state.update { it.copy(positionMs = positionMs) }
            return
        }
        val deviceId = connectCommandDeviceId ?: webPlayback.resolveDeviceId()
        viewModelScope.launch(Dispatchers.IO) {
            val (code, body) = webPlayback.seek(deviceId, positionMs)
            if (code in 200..299) {
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(positionMs = positionMs) }
                }
            } else {
                val msg = webPlayback.apiErrorMessage(code, body)
                withContext(Dispatchers.Main) {
                    _state.update { it.copy(connectPlaybackError = msg) }
                }
            }
        }
    }

    private fun disconnectAppRemote() {
        playerStateSubscription?.cancel()
        playerStateSubscription = null
        positionTicker?.cancel()
        positionTicker = null
        val remote = spotifyAppRemote
        if (remote != null) {
            SpotifyAppRemote.disconnect(remote)
        }
        spotifyAppRemote = null
        isAppRemoteActive = false
        _state.update {
            it.copy(activeSpotifyDeviceName = null)
        }
    }

    override fun onCleared() {
        stopConnectPolling()
        disconnectAppRemote()
        super.onCleared()
    }

}
