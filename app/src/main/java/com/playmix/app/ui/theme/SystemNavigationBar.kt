package com.playmix.app.ui.theme

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.playmix.app.spotify.SpotifyPlaybackUiState

@Composable
fun HarmonizeNavigationBarWithPlayback(state: SpotifyPlaybackUiState) {
    val visible = state.nowPlayingTitle != null || !state.connectPlaybackError.isNullOrBlank()
    val color = if (visible) {
        MaterialTheme.colorScheme.surfaceContainerHigh
    } else {
        MaterialTheme.colorScheme.background
    }
    SystemNavigationBar(color)
}

@Composable
fun SystemNavigationBar(color: Color) {
    val view = LocalView.current
    SideEffect {
        val activity = findActivity(view.context) ?: return@SideEffect
        val window = activity.window
        window.navigationBarColor = color.toArgb()
        WindowCompat.getInsetsController(window, view).isAppearanceLightNavigationBars = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
    }
}

private tailrec fun findActivity(context: Context): Activity? = when (context) {
    is Activity -> context
    is ContextWrapper -> findActivity(context.baseContext)
    else -> null
}
