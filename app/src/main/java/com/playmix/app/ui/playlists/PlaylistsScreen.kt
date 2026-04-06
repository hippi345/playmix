package com.playmix.app.ui.playlists

import android.app.Application
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.playmix.app.R
import com.playmix.app.auth.ServiceLinkState
import com.playmix.app.domain.MusicService
import com.playmix.app.domain.PlaylistSummary
import com.playmix.app.ui.components.PlaylistRow
import com.playmix.app.ui.components.ServiceBadgeDefaults

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylistsScreen(
    onConnectSpotify: () -> Unit,
    onConnectTidal: () -> Unit,
    onOpenSpotifyPlaylist: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val app = context.applicationContext as Application
    val viewModel: PlaylistsViewModel = viewModel(
        factory = remember(app) { PlaylistsViewModelFactory(app) },
    )
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        modifier = modifier,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        text = "Playlists",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                },
                actions = {
                    IconButton(
                        onClick = viewModel::refresh,
                        enabled = !state.isLoading,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Refresh,
                            contentDescription = stringResource(R.string.refresh_content_description),
                        )
                    }
                },
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            AccountConnectRow(
                links = state.links,
                onConnectSpotify = {
                    if (!state.links.spotifyClientConfigured) {
                        Toast.makeText(
                            context,
                            context.getString(R.string.sign_in_not_available),
                            Toast.LENGTH_SHORT,
                        ).show()
                    } else {
                        if (state.links.spotifyLinked) {
                            viewModel.clearSpotifyLink()
                        }
                        onConnectSpotify()
                    }
                },
                onConnectTidal = {
                    if (!state.links.tidalClientConfigured) {
                        Toast.makeText(
                            context,
                            context.getString(R.string.sign_in_not_available),
                            Toast.LENGTH_SHORT,
                        ).show()
                    } else {
                        if (state.links.tidalLinked) {
                            viewModel.clearTidalLink()
                        }
                        onConnectTidal()
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            PrimaryTabRow(
                selectedTabIndex = state.section.ordinal,
            ) {
                PlaylistLibrarySection.entries.forEach { section ->
                    Tab(
                        selected = state.section == section,
                        onClick = { viewModel.selectSection(section) },
                        text = {
                            Text(
                                text = when (section) {
                                    PlaylistLibrarySection.All -> "All"
                                    PlaylistLibrarySection.Spotify -> "Spotify"
                                    PlaylistLibrarySection.Tidal -> "TIDAL"
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                    )
                }
            }

            when {
                state.isLoading && state.allPlaylists.isEmpty() -> {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center,
                    ) {
                        CircularProgressIndicator()
                    }
                }

                state.visiblePlaylists.isEmpty() -> {
                    EmptyLibraryState(section = state.section)
                }

                else -> {
                    PlaylistList(
                        playlists = state.visiblePlaylists,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                        onOpenSpotifyPlaylist = onOpenSpotifyPlaylist,
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountConnectRow(
    links: ServiceLinkState,
    onConnectSpotify: () -> Unit,
    onConnectTidal: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilledTonalButton(
                onClick = onConnectSpotify,
                enabled = links.spotifyClientConfigured,
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = if (links.spotifyLinked) {
                        stringResource(R.string.reconnect_spotify)
                    } else {
                        stringResource(R.string.connect_spotify)
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            FilledTonalButton(
                onClick = onConnectTidal,
                enabled = links.tidalClientConfigured,
                modifier = Modifier.weight(1f),
            ) {
                Text(
                    text = if (links.tidalLinked) {
                        stringResource(R.string.reconnect_tidal)
                    } else {
                        stringResource(R.string.connect_tidal)
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (links.tidalClientConfigured) {
            Text(
                text = stringResource(R.string.tidal_oauth_setup_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun PlaylistList(
    playlists: List<PlaylistSummary>,
    contentPadding: PaddingValues,
    onOpenSpotifyPlaylist: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(
            items = playlists,
            key = { "${it.service.name}:${it.id}" },
        ) { playlist ->
            PlaylistRow(
                playlist = playlist,
                badgeColors = ServiceBadgeDefaults.colors(playlist.service),
                onClick = if (playlist.service == MusicService.Spotify) {
                    { onOpenSpotifyPlaylist(playlist.id) }
                } else {
                    null
                },
            )
        }
    }
}

@Composable
private fun EmptyLibraryState(section: PlaylistLibrarySection) {
    val subtitle = when (section) {
        PlaylistLibrarySection.All ->
            "Connect Spotify and TIDAL above, then pull playlists with the refresh action."
        PlaylistLibrarySection.Spotify ->
            "Connect Spotify above to load your playlists."
        PlaylistLibrarySection.Tidal ->
            "Connect TIDAL above to load your playlists."
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            imageVector = Icons.Filled.MusicNote,
            contentDescription = null,
            modifier = Modifier.padding(bottom = 12.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = "No playlists loaded",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
