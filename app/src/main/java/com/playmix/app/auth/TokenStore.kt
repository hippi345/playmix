package com.playmix.app.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import com.playmix.app.BuildConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class TokenStore(context: Context) {

    private val prefs: SharedPreferences = createPrefs(context.applicationContext)

    private val _linkState = MutableStateFlow(readLinkState())
    val linkState: StateFlow<ServiceLinkState> = _linkState.asStateFlow()

    private fun readLinkState(): ServiceLinkState = ServiceLinkState(
        spotifyLinked = prefs.getString(KEY_SPOTIFY_REFRESH, null) != null,
        tidalLinked = prefs.getString(KEY_TIDAL_REFRESH, null) != null,
        spotifyClientConfigured = BuildConfig.SPOTIFY_CLIENT_ID.isNotBlank(),
        tidalClientConfigured = BuildConfig.TIDAL_CLIENT_ID.isNotBlank(),
    )

    private fun publishLinks() {
        _linkState.value = readLinkState()
    }

    fun pendingSpotifyVerifier(): String? = prefs.getString(KEY_SPOTIFY_PENDING_VERIFIER, null)
    fun pendingSpotifyState(): String? = prefs.getString(KEY_SPOTIFY_PENDING_STATE, null)

    /** Persists PKCE verifier + state synchronously before opening the browser (avoid async apply() races). */
    fun beginSpotifyAuth(verifier: String, state: String): Boolean =
        prefs.edit()
            .putString(KEY_SPOTIFY_PENDING_VERIFIER, verifier)
            .putString(KEY_SPOTIFY_PENDING_STATE, state)
            .commit()

    fun clearSpotifyPending() {
        prefs.edit()
            .remove(KEY_SPOTIFY_PENDING_VERIFIER)
            .remove(KEY_SPOTIFY_PENDING_STATE)
            .apply()
    }

    /**
     * Uses [SharedPreferences.Editor.commit] so tokens are visible to the next read immediately.
     * Playlist refresh runs right after sign-in (`authCompletedEvents`); with [apply], another
     * thread could read prefs before the write finished, yielding no Spotify token and an empty list.
     */
    fun saveSpotifyTokens(accessToken: String, refreshToken: String, expiresInSeconds: Long) {
        val expAt = System.currentTimeMillis() + expiresInSeconds * 1000L
        prefs.edit()
            .putString(KEY_SPOTIFY_ACCESS, accessToken)
            .putString(KEY_SPOTIFY_REFRESH, refreshToken)
            .putLong(KEY_SPOTIFY_ACCESS_EXPIRES_AT, expAt)
            .remove(KEY_SPOTIFY_PENDING_VERIFIER)
            .remove(KEY_SPOTIFY_PENDING_STATE)
            .commit()
        publishLinks()
    }

    fun spotifyRefreshToken(): String? = prefs.getString(KEY_SPOTIFY_REFRESH, null)

    fun spotifyAccessTokenIfValid(): String? {
        val token = prefs.getString(KEY_SPOTIFY_ACCESS, null) ?: return null
        val exp = prefs.getLong(KEY_SPOTIFY_ACCESS_EXPIRES_AT, 0L)
        if (exp < System.currentTimeMillis() + 60_000L) return null
        return token
    }

    fun updateSpotifyAccessToken(accessToken: String, expiresInSeconds: Long) {
        val expAt = System.currentTimeMillis() + expiresInSeconds * 1000L
        prefs.edit()
            .putString(KEY_SPOTIFY_ACCESS, accessToken)
            .putLong(KEY_SPOTIFY_ACCESS_EXPIRES_AT, expAt)
            .apply()
    }

    fun clearSpotify() {
        prefs.edit()
            .remove(KEY_SPOTIFY_ACCESS)
            .remove(KEY_SPOTIFY_REFRESH)
            .remove(KEY_SPOTIFY_ACCESS_EXPIRES_AT)
            .remove(KEY_SPOTIFY_PENDING_VERIFIER)
            .remove(KEY_SPOTIFY_PENDING_STATE)
            .apply()
        publishLinks()
    }

    fun pendingTidalVerifier(): String? = prefs.getString(KEY_TIDAL_PENDING_VERIFIER, null)
    fun pendingTidalState(): String? = prefs.getString(KEY_TIDAL_PENDING_STATE, null)

    fun beginTidalAuth(verifier: String, state: String): Boolean =
        prefs.edit()
            .putString(KEY_TIDAL_PENDING_VERIFIER, verifier)
            .putString(KEY_TIDAL_PENDING_STATE, state)
            .commit()

    fun clearTidalPending() {
        prefs.edit()
            .remove(KEY_TIDAL_PENDING_VERIFIER)
            .remove(KEY_TIDAL_PENDING_STATE)
            .apply()
    }

    fun saveTidalTokens(accessToken: String, refreshToken: String?, expiresInSeconds: Long) {
        val expAt = System.currentTimeMillis() + expiresInSeconds * 1000L
        val editor = prefs.edit()
            .putString(KEY_TIDAL_ACCESS, accessToken)
            .putLong(KEY_TIDAL_ACCESS_EXPIRES_AT, expAt)
            .remove(KEY_TIDAL_PENDING_VERIFIER)
            .remove(KEY_TIDAL_PENDING_STATE)
        if (refreshToken != null) editor.putString(KEY_TIDAL_REFRESH, refreshToken)
        editor.commit()
        publishLinks()
    }

    fun tidalRefreshToken(): String? = prefs.getString(KEY_TIDAL_REFRESH, null)

    fun tidalAccessTokenIfValid(): String? {
        val token = prefs.getString(KEY_TIDAL_ACCESS, null) ?: return null
        val exp = prefs.getLong(KEY_TIDAL_ACCESS_EXPIRES_AT, 0L)
        if (exp < System.currentTimeMillis() + 60_000L) return null
        return token
    }

    fun updateTidalAccessToken(accessToken: String, expiresInSeconds: Long) {
        val expAt = System.currentTimeMillis() + expiresInSeconds * 1000L
        prefs.edit()
            .putString(KEY_TIDAL_ACCESS, accessToken)
            .putLong(KEY_TIDAL_ACCESS_EXPIRES_AT, expAt)
            .apply()
    }

    fun clearTidal() {
        prefs.edit()
            .remove(KEY_TIDAL_ACCESS)
            .remove(KEY_TIDAL_REFRESH)
            .remove(KEY_TIDAL_ACCESS_EXPIRES_AT)
            .apply()
        publishLinks()
    }

    companion object {
        private const val PREFS_NAME = "playmix_auth"
        private const val KEY_SPOTIFY_ACCESS = "spotify_access"
        private const val KEY_SPOTIFY_REFRESH = "spotify_refresh"
        private const val KEY_SPOTIFY_ACCESS_EXPIRES_AT = "spotify_access_exp"
        private const val KEY_SPOTIFY_PENDING_VERIFIER = "spotify_pending_verifier"
        private const val KEY_SPOTIFY_PENDING_STATE = "spotify_pending_state"

        private const val KEY_TIDAL_ACCESS = "tidal_access"
        private const val KEY_TIDAL_REFRESH = "tidal_refresh"
        private const val KEY_TIDAL_ACCESS_EXPIRES_AT = "tidal_access_exp"
        private const val KEY_TIDAL_PENDING_VERIFIER = "tidal_pending_verifier"
        private const val KEY_TIDAL_PENDING_STATE = "tidal_pending_state"

        /** Debug uses plain prefs so emulator keystore / MasterKeys cannot wedge startup. */
        private fun createPrefs(appContext: Context): SharedPreferences =
            if (BuildConfig.DEBUG) {
                appContext.getSharedPreferences("${PREFS_NAME}_debug_plain", Context.MODE_PRIVATE)
            } else {
                EncryptedSharedPreferences.create(
                    PREFS_NAME,
                    MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
                    appContext,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
                )
            }
    }
}
