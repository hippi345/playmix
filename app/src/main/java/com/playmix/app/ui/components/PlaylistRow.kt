package com.playmix.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.playmix.app.domain.MusicService
import com.playmix.app.domain.PlaylistSummary

data class ServiceBadgeColors(
    val container: Color,
    val label: Color,
)

object ServiceBadgeDefaults {
    @Composable
    fun colors(service: MusicService): ServiceBadgeColors = when (service) {
        MusicService.Spotify -> ServiceBadgeColors(
            container = Color(0xFF1DB954).copy(alpha = 0.2f),
            label = Color(0xFF1ED760),
        )
        MusicService.Tidal -> ServiceBadgeColors(
            container = Color(0xFF00FFF0).copy(alpha = 0.12f),
            label = Color(0xFF5CF9F4),
        )
    }
}

@Composable
fun PlaylistRow(
    playlist: PlaylistSummary,
    badgeColors: ServiceBadgeColors,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable { onClick.invoke() } else Modifier),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val art = playlist.artworkUrl?.takeIf {
                it.startsWith("http://") || it.startsWith("https://")
            }
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHighest),
            ) {
                if (art != null) {
                    AsyncImage(
                        model = art,
                        contentDescription = playlist.artworkContentDescription ?: playlist.name,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Crop,
                    )
                }
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = playlist.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = playlist.ownerLabel,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            AssistChip(
                onClick = {},
                enabled = false,
                label = {
                    Text(
                        text = playlist.service.displayName,
                        style = MaterialTheme.typography.labelMedium,
                    )
                },
                modifier = Modifier.padding(start = 4.dp),
                colors = AssistChipDefaults.assistChipColors(
                    containerColor = badgeColors.container,
                    labelColor = badgeColors.label,
                    disabledContainerColor = badgeColors.container,
                    disabledLabelColor = badgeColors.label,
                ),
            )
        }
    }
}
