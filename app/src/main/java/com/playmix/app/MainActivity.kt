package com.playmix.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.playmix.app.auth.OAuthLauncher
import com.playmix.app.ui.PlaymixApp
import com.playmix.app.ui.theme.PlaymixTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        val holdSplash = AtomicBoolean(true)
        installSplashScreen().setKeepOnScreenCondition { holdSplash.get() }
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val app = application as PlaymixApplication
        setContent {
            PlaymixTheme(darkTheme = true, dynamicColor = false) {
                var tokenReady by remember { mutableStateOf(false) }
                LaunchedEffect(Unit) {
                    try {
                        withContext(Dispatchers.IO) {
                            app.awaitTokenStore()
                        }
                        tokenReady = true
                    } finally {
                        holdSplash.set(false)
                    }
                }
                Surface(modifier = Modifier.fillMaxSize()) {
                    if (tokenReady) {
                        PlaymixApp(
                            onConnectSpotify = {
                                OAuthLauncher.openSpotifyLogin(this@MainActivity, app.tokenStore)
                            },
                            onConnectTidal = {
                                OAuthLauncher.openTidalLogin(this@MainActivity, app.tokenStore)
                            },
                        )
                    } else {
                        Box(Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}
