package com.playmix.app.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.playmix.app.spotify.SpotifyGlobalNowPlayingBar
import com.playmix.app.spotify.SpotifyPlaybackViewModel
import com.playmix.app.spotify.SpotifyPlaylistDetailScreen
import com.playmix.app.ui.playlists.PlaylistsScreen
import com.playmix.app.ui.theme.HarmonizeNavigationBarWithPlayback

object PlaymixDestinations {
    const val Library = "library"
    const val SpotifyPlaylist = "spotify/playlist/{playlistId}"
    fun spotifyPlaylist(playlistId: String) = "spotify/playlist/$playlistId"
}

@Composable
fun PlaymixApp(
    onConnectSpotify: () -> Unit,
    onConnectTidal: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val activity = LocalContext.current as ComponentActivity
    val playbackVm: SpotifyPlaybackViewModel = viewModel(viewModelStoreOwner = activity)
    val playbackState by playbackVm.state.collectAsStateWithLifecycle()

    LaunchedEffect(activity) {
        playbackVm.startSessionIfNeeded(activity)
    }

    HarmonizeNavigationBarWithPlayback(playbackState)

    val navController = rememberNavController()

    Scaffold(
        modifier = modifier,
        bottomBar = {
            SpotifyGlobalNowPlayingBar(
                state = playbackState,
                onToggleShuffle = playbackVm::toggleShuffle,
                onCycleRepeat = playbackVm::cycleRepeatMode,
                onPlayPause = playbackVm::togglePlayPause,
                onSkipNext = playbackVm::skipNext,
                onSkipPrev = playbackVm::skipPrevious,
                onSeek = playbackVm::seekTo,
                onSetExpanded = playbackVm::setPlaybackBarExpanded,
            )
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = PlaymixDestinations.Library,
            modifier = Modifier.padding(padding),
        ) {
            composable(PlaymixDestinations.Library) {
                PlaylistsScreen(
                    onConnectSpotify = onConnectSpotify,
                    onConnectTidal = onConnectTidal,
                    onOpenSpotifyPlaylist = { playlistId ->
                        navController.navigate(PlaymixDestinations.spotifyPlaylist(playlistId))
                    },
                )
            }
            composable(
                route = PlaymixDestinations.SpotifyPlaylist,
                arguments = listOf(
                    navArgument("playlistId") { type = NavType.StringType },
                ),
            ) { entry ->
                val playlistId = entry.arguments?.getString("playlistId") ?: return@composable
                SpotifyPlaylistDetailScreen(
                    playlistId = playlistId,
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
