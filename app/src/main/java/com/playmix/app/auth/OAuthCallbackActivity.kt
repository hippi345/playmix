package com.playmix.app.auth

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.playmix.app.PlaymixApplication
import com.playmix.app.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Handles OAuth redirects for Spotify and TIDAL (custom scheme).
 */
class OAuthCallbackActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dispatchIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        dispatchIntent(intent)
    }

    private fun dispatchIntent(intent: Intent?) {
        val uri = intent?.data
        if (uri == null) {
            finish()
            return
        }
        val app = application as PlaymixApplication
        lifecycleScope.launch {
            val errorMessage: String? = withContext(Dispatchers.IO) {
                app.awaitTokenStore()
                try {
                    resolveOAuth(uri, app)
                } catch (e: Exception) {
                    e.message ?: e.javaClass.simpleName
                }
            }
            if (errorMessage == null) {
                app.authCompletedEvents.emit(Unit)
            }
            if (errorMessage != null) {
                Toast.makeText(this@OAuthCallbackActivity, errorMessage, Toast.LENGTH_LONG).show()
            }
            finish()
        }
    }

    private fun resolveOAuth(uri: Uri, app: PlaymixApplication): String? {
        return when {
            isSpotifyCallback(uri) -> handleSpotify(uri, app)
            isTidalCallback(uri) -> handleTidal(uri, app)
            else -> getString(R.string.oauth_unknown_path)
        }
    }

    private fun isSpotifyCallback(uri: Uri): Boolean =
        uri.scheme.equals("com.playmix.app", ignoreCase = true) &&
            uri.host.equals("oauth", ignoreCase = true) &&
            spotifyPathOk(uri)

    private fun spotifyPathOk(uri: Uri): Boolean {
        val p = uri.path?.trim('/') ?: ""
        return p.equals("spotify", ignoreCase = true) || p.endsWith("/spotify", ignoreCase = true)
    }

    private fun isTidalCallback(uri: Uri): Boolean =
        uri.scheme.equals("com.playmix.app", ignoreCase = true) &&
            uri.host.equals("oauth", ignoreCase = true) &&
            tidalPathOk(uri)

    private fun tidalPathOk(uri: Uri): Boolean {
        val p = uri.path?.trim('/') ?: ""
        return p.equals("tidal", ignoreCase = true) || p.endsWith("/tidal", ignoreCase = true)
    }

    private fun handleSpotify(uri: Uri, app: PlaymixApplication): String? {
        if (uri.getQueryParameter("error") != null) {
            app.tokenStore.clearSpotifyPending()
            return uri.getQueryParameter("error_description")
                ?: uri.getQueryParameter("error")
                ?: getString(R.string.oauth_cancelled)
        }
        val code = uri.getQueryParameter("code") ?: return getString(R.string.oauth_missing_code)
        val state = uri.getQueryParameter("state")?.trim()
        val expected = app.tokenStore.pendingSpotifyState()?.trim()
        if (state.isNullOrEmpty() || expected.isNullOrEmpty() || state != expected) {
            app.tokenStore.clearSpotifyPending()
            return getString(R.string.oauth_state_mismatch)
        }
        val verifier = app.tokenStore.pendingSpotifyVerifier()
            ?: return getString(R.string.oauth_missing_verifier)
        return when (val result = app.tokenExchange.exchangeSpotifyCode(code, verifier)) {
            is TokenResult.Success -> {
                val refresh = result.refreshToken ?: return getString(R.string.oauth_missing_refresh)
                app.tokenStore.saveSpotifyTokens(result.accessToken, refresh, result.expiresInSeconds)
                null
            }
            is TokenResult.Failure -> {
                app.tokenStore.clearSpotifyPending()
                result.message
            }
        }
    }

    private fun handleTidal(uri: Uri, app: PlaymixApplication): String? {
        if (uri.getQueryParameter("error") != null) {
            app.tokenStore.clearTidalPending()
            return uri.getQueryParameter("error_description")
                ?: uri.getQueryParameter("error")
                ?: getString(R.string.oauth_cancelled)
        }
        val code = uri.getQueryParameter("code") ?: return getString(R.string.oauth_missing_code)
        val state = uri.getQueryParameter("state")?.trim()
        val expected = app.tokenStore.pendingTidalState()?.trim()
        if (state.isNullOrEmpty() || expected.isNullOrEmpty() || state != expected) {
            app.tokenStore.clearTidalPending()
            return getString(R.string.oauth_state_mismatch)
        }
        val verifier = app.tokenStore.pendingTidalVerifier()
            ?: return getString(R.string.oauth_missing_verifier)
        return when (val result = app.tokenExchange.exchangeTidalCode(code, verifier)) {
            is TokenResult.Success -> {
                val refresh = result.refreshToken ?: return getString(R.string.oauth_missing_refresh)
                app.tokenStore.saveTidalTokens(
                    result.accessToken,
                    refresh,
                    result.expiresInSeconds,
                )
                null
            }
            is TokenResult.Failure -> {
                app.tokenStore.clearTidalPending()
                result.message
            }
        }
    }
}
