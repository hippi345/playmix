package com.playmix.app.auth

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import com.playmix.app.BuildConfig
import com.playmix.app.R
import java.util.UUID

object OAuthLauncher {

    /** Prefer full Chrome; order matches typical Play-device installs. */
    private val tidalBrowserPackages = listOf(
        "com.android.chrome",
        "com.chrome.beta",
        "com.google.android.apps.chrome",
    )

    fun openSpotifyLogin(activity: Activity, tokenStore: TokenStore) {
        val clientId = BuildConfig.SPOTIFY_CLIENT_ID
        if (clientId.isBlank()) return
        // Each tap must own a single browser flow; leftover pending + an old tab causes state mismatch.
        if (tokenStore.pendingSpotifyVerifier() != null) {
            tokenStore.clearSpotifyPending()
            Toast.makeText(activity, R.string.oauth_restarted_flow, Toast.LENGTH_LONG).show()
        }
        val verifier = Pkce.newVerifier()
        val challenge = Pkce.challenge(verifier)
        val state = UUID.randomUUID().toString()
        if (!tokenStore.beginSpotifyAuth(verifier, state)) {
            Toast.makeText(activity, R.string.oauth_pending_save_failed, Toast.LENGTH_SHORT).show()
            return
        }
        val uri = Uri.parse(OAuthConstants.SPOTIFY_AUTH_BASE).buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", OAuthConstants.SPOTIFY_REDIRECT)
            .appendQueryParameter("scope", OAuthConstants.SPOTIFY_SCOPES)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("state", state)
            // Forces Spotify’s consent screen and avoids stale browser-session edge cases.
            .appendQueryParameter("show_dialog", "true")
            .build()
        Toast.makeText(activity, R.string.oauth_use_browser_window_hint, Toast.LENGTH_LONG).show()
        // Custom Tabs often fail to hand off custom-scheme redirects; the default browser works reliably.
        launchAuthInExternalBrowser(activity, uri)
    }

    fun openTidalLogin(activity: Activity, tokenStore: TokenStore) {
        val clientId = BuildConfig.TIDAL_CLIENT_ID
        if (clientId.isBlank()) return
        if (tokenStore.pendingTidalVerifier() != null) {
            tokenStore.clearTidalPending()
            Toast.makeText(activity, R.string.oauth_restarted_flow, Toast.LENGTH_LONG).show()
        }
        val verifier = Pkce.newVerifier()
        val challenge = Pkce.challenge(verifier)
        val state = UUID.randomUUID().toString()
        if (!tokenStore.beginTidalAuth(verifier, state)) {
            Toast.makeText(activity, R.string.oauth_pending_save_failed, Toast.LENGTH_SHORT).show()
            return
        }
        val uri = Uri.parse(OAuthConstants.TIDAL_AUTH_BASE).buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", OAuthConstants.TIDAL_REDIRECT)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", OAuthConstants.TIDAL_SCOPES)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("state", state)
            .build()
        Toast.makeText(activity, R.string.oauth_use_browser_window_hint_tidal, Toast.LENGTH_LONG).show()
        // System chooser lets the user open a real browser tab (Chrome, Firefox, …). Emulator Chrome is
        // often flagged; a physical device + user-picked browser matches how the web demo works.
        launchTidalAuthWithBrowserChooser(activity, uri)
    }

    private fun launchTidalAuthWithBrowserChooser(activity: Activity, uri: Uri) {
        val view = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        val chooser = Intent.createChooser(view, activity.getString(R.string.oauth_tidal_chooser_title))
        try {
            activity.startActivity(chooser)
            return
        } catch (_: ActivityNotFoundException) {
            /* fall through */
        }
        val pm = activity.packageManager
        for (pkg in tidalBrowserPackages) {
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
                setPackage(pkg)
            }
            if (intent.resolveActivity(pm) == null) continue
            try {
                activity.startActivity(intent)
                return
            } catch (_: ActivityNotFoundException) {
                /* try next */
            }
        }
        Toast.makeText(activity, R.string.oauth_tidal_browser_fallback, Toast.LENGTH_LONG).show()
        launchAuthInExternalBrowser(activity, uri)
    }

    private fun launchAuthInExternalBrowser(activity: Activity, uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(activity, R.string.oauth_no_browser, Toast.LENGTH_LONG).show()
        }
    }
}
