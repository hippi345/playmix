package com.playmix.app.data.spotify

import com.playmix.app.auth.TokenExchangeService
import com.playmix.app.auth.TokenResult
import com.playmix.app.auth.TokenStore
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Shared Spotify user-token access + one 401 refresh retry for Web API calls.
 */
class SpotifyAccess(
    private val tokenStore: TokenStore,
    private val tokenExchange: TokenExchangeService,
    private val http: OkHttpClient,
) {

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    fun currentAccessToken(): String? {
        tokenStore.spotifyAccessTokenIfValid()?.let { return it }
        val refresh = tokenStore.spotifyRefreshToken() ?: return null
        return when (val result = tokenExchange.refreshSpotify(refresh)) {
            is TokenResult.Success -> {
                val nextRefresh = result.refreshToken ?: refresh
                tokenStore.saveSpotifyTokens(result.accessToken, nextRefresh, result.expiresInSeconds)
                result.accessToken
            }
            is TokenResult.Failure -> null
        }
    }

    fun <T> executeWithRetry(
        requestFactory: (accessToken: String) -> Request,
        parse: (body: String, httpCode: Int) -> T?,
    ): T? {
        var access = currentAccessToken() ?: return null
        repeat(2) { attempt ->
            val response = http.newCall(requestFactory(access)).execute()
            val body = response.body?.string() ?: ""
            when {
                response.code == 401 && attempt == 0 -> {
                    val refresh = tokenStore.spotifyRefreshToken() ?: return null
                    val tr = tokenExchange.refreshSpotify(refresh)
                    if (tr !is TokenResult.Success) return null
                    val nr = tr.refreshToken ?: refresh
                    tokenStore.saveSpotifyTokens(tr.accessToken, nr, tr.expiresInSeconds)
                    access = tr.accessToken
                }
                else -> return parse(body, response.code)
            }
        }
        return null
    }

    fun getJson(url: String): JSONObject? {
        return executeWithRetry(
            requestFactory = { access ->
                Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $access")
                    .header("Accept", "application/json")
                    .build()
            },
            parse = { body, code ->
                if (code !in 200..299 || body.isBlank()) null else JSONObject(body)
            },
        )
    }

    fun httpGetRaw(url: String): Pair<Int, String?> {
        return executeWithRetry(
            requestFactory = { access ->
                Request.Builder()
                    .url(url)
                    .header("Authorization", "Bearer $access")
                    .header("Accept", "application/json")
                    .get()
                    .build()
            },
            parse = { body, code -> code to body.ifBlank { null } },
        ) ?: (-1 to null)
    }

    fun httpPutJson(url: String, body: JSONObject): Pair<Int, String?> {
        return executeWithRetry(
            requestFactory = { access ->
                Request.Builder()
                    .url(url)
                    .put(body.toString().toRequestBody(jsonMediaType))
                    .header("Authorization", "Bearer $access")
                    .build()
            },
            parse = { respBody, code -> code to respBody.ifBlank { null } },
        ) ?: (-1 to null)
    }

    fun httpPostEmpty(url: String): Pair<Int, String?> {
        return executeWithRetry(
            requestFactory = { access ->
                Request.Builder()
                    .url(url)
                    .post(byteArrayOf().toRequestBody(null))
                    .header("Authorization", "Bearer $access")
                    .build()
            },
            parse = { body, code -> code to body.ifBlank { null } },
        ) ?: (-1 to null)
    }

    fun httpPutEmpty(url: String): Pair<Int, String?> {
        return executeWithRetry(
            requestFactory = { access ->
                Request.Builder()
                    .url(url)
                    .put(byteArrayOf().toRequestBody(null))
                    .header("Authorization", "Bearer $access")
                    .build()
            },
            parse = { body, code -> code to body.ifBlank { null } },
        ) ?: (-1 to null)
    }
}
