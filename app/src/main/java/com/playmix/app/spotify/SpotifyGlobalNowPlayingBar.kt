package com.playmix.app.spotify

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.playmix.app.R

@Composable
fun SpotifyGlobalNowPlayingBar(
    state: SpotifyPlaybackUiState,
    onToggleShuffle: () -> Unit,
    onCycleRepeat: () -> Unit,
    onPlayPause: () -> Unit,
    onSkipNext: () -> Unit,
    onSkipPrev: () -> Unit,
    onSeek: (Long) -> Unit,
    onSetExpanded: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = state.nowPlayingTitle
    val err = state.connectPlaybackError
    if (title == null && err.isNullOrBlank()) return

    val bg = MaterialTheme.colorScheme.surfaceContainerHigh
    val muted = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.45f)
    val active = MaterialTheme.colorScheme.primary

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(bg),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            if (!err.isNullOrBlank()) {
                Text(
                    text = err,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(bottom = if (title != null) 6.dp else 0.dp),
                )
            }
            when {
                title == null -> { }
                !state.playbackBarExpanded -> {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        val model = state.nowPlayingArtUrl?.takeIf {
                            it.startsWith("http://") || it.startsWith("https://")
                        }
                        AsyncImage(
                            model = model,
                            contentDescription = null,
                            modifier = Modifier
                                .size(52.dp)
                                .clip(MaterialTheme.shapes.small),
                            contentScale = ContentScale.Crop,
                        )
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = { onSetExpanded(true) }) {
                            Icon(
                                imageVector = Icons.Filled.KeyboardArrowUp,
                                contentDescription = stringResource(R.string.playback_expand_bar),
                            )
                        }
                    }
                }
                else -> {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val model = state.nowPlayingArtUrl?.takeIf {
                        it.startsWith("http://") || it.startsWith("https://")
                    }
                    AsyncImage(
                        model = model,
                        contentDescription = null,
                        modifier = Modifier
                            .size(52.dp)
                            .clip(MaterialTheme.shapes.small),
                        contentScale = ContentScale.Crop,
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = title,
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = state.nowPlayingArtist.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    IconButton(onClick = { onSetExpanded(false) }) {
                        Icon(
                            imageVector = Icons.Filled.KeyboardArrowDown,
                            contentDescription = stringResource(R.string.playback_collapse_bar),
                        )
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    IconButton(onClick = onToggleShuffle) {
                        Icon(
                            imageVector = Icons.Filled.Shuffle,
                            contentDescription = stringResource(R.string.playback_shuffle),
                            tint = if (state.shuffleEnabled) active else muted,
                        )
                    }
                    IconButton(onClick = onSkipPrev) {
                        Icon(Icons.Filled.SkipPrevious, stringResource(R.string.skip_previous))
                    }
                    IconButton(onClick = onPlayPause) {
                        Icon(
                            imageVector = if (state.isPaused) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                            contentDescription = stringResource(R.string.play_pause),
                        )
                    }
                    IconButton(onClick = onSkipNext) {
                        Icon(Icons.Filled.SkipNext, stringResource(R.string.skip_next))
                    }
                    IconButton(onClick = onCycleRepeat) {
                        when (state.repeatState) {
                            "track" -> Icon(
                                imageVector = Icons.Filled.RepeatOne,
                                contentDescription = stringResource(R.string.playback_repeat_cycle),
                                tint = active,
                            )
                            "context" -> Icon(
                                imageVector = Icons.Filled.Repeat,
                                contentDescription = stringResource(R.string.playback_repeat_cycle),
                                tint = active,
                            )
                            else -> Icon(
                                imageVector = Icons.Filled.Repeat,
                                contentDescription = stringResource(R.string.playback_repeat_cycle),
                                tint = muted,
                            )
                        }
                    }
                }
                if (state.durationMs > 0L) {
                    val progress =
                        (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
                    var seeking by remember { mutableStateOf(false) }
                    var seekFraction by remember { mutableFloatStateOf(progress) }
                    Slider(
                        value = if (seeking) seekFraction else progress,
                        onValueChange = {
                            seeking = true
                            seekFraction = it
                        },
                        onValueChangeFinished = {
                            onSeek((seekFraction * state.durationMs).toLong())
                            seeking = false
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.primary,
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                        ),
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(
                            text = formatPlaybackDuration(state.positionMs),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = formatPlaybackDuration(state.durationMs),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    LinearProgressIndicator(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp, bottom = 4.dp),
                    )
                }
                }
            }
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}

private fun formatPlaybackDuration(ms: Long): String {
    if (ms <= 0L) return "0:00"
    val totalSec = ms / 1000
    val s = totalSec % 60
    val m = (totalSec / 60) % 60
    val h = totalSec / 3600
    return if (h > 0) {
        String.format("%d:%02d:%02d", h, m, s)
    } else {
        String.format("%d:%02d", m, s)
    }
}
