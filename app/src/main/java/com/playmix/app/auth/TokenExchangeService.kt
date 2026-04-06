package com.playmix.app.auth

import com.playmix.app.BuildConfig
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class TokenExchangeService(
    private val client: OkHttpClient = defaultClient(),
) {

    fun exchangeSpotifyCode(code: String, codeVerifier: String): TokenResult {
        val body = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("code", code)
            .add("redirect_uri", OAuthConstants.SPOTIFY_REDIRECT)
            .add("client_id", BuildConfig.SPOTIFY_CLIENT_ID)
            .add("code_verifier", codeVerifier)
            .build()
        val request = Request.Builder()
            .url(OAuthConstants.SPOTIFY_TOKEN_URL)
            .post(body)
            .build()
        return client.newCall(request).execute().use { resp ->
            executeTokenResponse(resp.body?.string(), resp.code)
        }
    }

    fun refreshSpotify(refreshToken: String): TokenResult {
        val body = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", refreshToken)
            .add("client_id", BuildConfig.SPOTIFY_CLIENT_ID)
            .build()
        val request = Request.Builder()
            .url(OAuthConstants.SPOTIFY_TOKEN_URL)
            .post(body)
            .build()
        return client.newCall(request).execute().use { resp ->
            executeTokenResponse(resp.body?.string(), resp.code)
        }
    }

    fun exchangeTidalCode(code: String, codeVerifier: String): TokenResult {
        val body = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("client_id", BuildConfig.TIDAL_CLIENT_ID)
            .add("redirect_uri", OAuthConstants.TIDAL_REDIRECT)
            .add("scope", OAuthConstants.TIDAL_SCOPES)
            .add("code_verifier", codeVerifier)
            .add("code", code)
            .build()
        val request = Request.Builder()
            .url(OAuthConstants.TIDAL_TOKEN_URL)
            .post(body)
            .build()
        return client.newCall(request).execute().use { resp ->
            executeTokenResponse(resp.body?.string(), resp.code)
        }
    }

    fun refreshTidal(refreshToken: String): TokenResult {
        val body = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", refreshToken)
            .add("client_id", BuildConfig.TIDAL_CLIENT_ID)
            .build()
        val request = Request.Builder()
            .url(OAuthConstants.TIDAL_TOKEN_URL)
            .post(body)
            .build()
        return client.newCall(request).execute().use { resp ->
            executeTokenResponse(resp.body?.string(), resp.code)
        }
    }

    private fun executeTokenResponse(raw: String?, httpCode: Int): TokenResult {
        if (httpCode !in 200..299 || raw.isNullOrBlank()) {
            return TokenResult.Failure("HTTP $httpCode ${raw ?: ""}")
        }
        return try {
            val json = JSONObject(raw)
            if (json.has("error")) {
                return TokenResult.Failure(json.optString("error_description", json.optString("error")))
            }
            val newRefresh = when {
                json.has("refresh_token") && !json.isNull("refresh_token") -> json.getString("refresh_token")
                else -> null
            }
            TokenResult.Success(
                accessToken = json.getString("access_token"),
                refreshToken = newRefresh,
                expiresInSeconds = json.optLong("expires_in", 3600L),
            )
        } catch (e: Exception) {
            TokenResult.Failure(e.message ?: "parse error")
        }
    }

    private companion object {
        fun defaultClient() = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}

sealed class TokenResult {
    data class Success(
        val accessToken: String,
        val refreshToken: String?,
        val expiresInSeconds: Long,
    ) : TokenResult()

    data class Failure(val message: String) : TokenResult()
}
