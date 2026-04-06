package com.playmix.app.data

import com.playmix.app.auth.TokenExchangeService
import com.playmix.app.auth.TokenResult
import com.playmix.app.auth.TokenStore
import com.playmix.app.domain.MusicService
import com.playmix.app.domain.PlaylistSummary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlin.math.abs

class LinkedPlaylistRepository(
    private val tokenStore: TokenStore,
    private val tokenExchange: TokenExchangeService,
    httpClient: OkHttpClient? = null,
) : PlaylistRepository {

    private val client = httpClient ?: defaultHttp()
    private val playlistsFlow = MutableStateFlow<List<PlaylistSummary>>(emptyList())

    override fun observePlaylists(): Flow<List<PlaylistSummary>> = playlistsFlow.asStateFlow()

    override suspend fun refresh() = withContext(Dispatchers.IO) {
        val merged = mutableListOf<PlaylistSummary>()
        spotifyAccessToken()?.let { token ->
            val (list, _) = fetchSpotifyPlaylists(token)
            merged.addAll(list)
        }
        tidalAccessToken()?.let { token ->
            try {
                val (list, _) = fetchTidalPlaylists(token)
                merged.addAll(list)
            } catch (e: Exception) {
                Log.e("Playmix", "TIDAL playlist fetch failed", e)
            }
        }
        playlistsFlow.value = merged
    }

    private fun spotifyAccessToken(): String? {
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

    private fun tidalAccessToken(): String? {
        tokenStore.tidalAccessTokenIfValid()?.let { return it }
        val refresh = tokenStore.tidalRefreshToken() ?: return null
        return when (val result = tokenExchange.refreshTidal(refresh)) {
            is TokenResult.Success -> {
                val nextRefresh = result.refreshToken ?: refresh
                tokenStore.saveTidalTokens(
                    accessToken = result.accessToken,
                    refreshToken = nextRefresh,
                    expiresInSeconds = result.expiresInSeconds,
                )
                result.accessToken
            }
            is TokenResult.Failure -> null
        }
    }

    /** Parse a non-negative integer JSON field (Spotify sometimes types totals unexpectedly). */
    private fun jsonObjectNonNegativeInt(obj: JSONObject, key: String): Int {
        if (!obj.has(key) || obj.isNull(key)) return 0
        return when (val v = obj.opt(key)) {
            is Int -> v.coerceAtLeast(0)
            is Long -> v.coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()
            is Double -> v.toInt().coerceAtLeast(0)
            is Float -> v.toInt().coerceAtLeast(0)
            is String -> v.toIntOrNull()?.coerceAtLeast(0) ?: 0
            is Number -> v.toInt().coerceAtLeast(0)
            else -> obj.optInt(key, 0).coerceAtLeast(0)
        }
    }

    /** `tracks.total` on each item from [GET /v1/me/playlists] — often present, sometimes absent or zero incorrectly. */
    private fun spotifyPlaylistTrackTotalFromRef(pl: JSONObject): Int {
        val ref = pl.optJSONObject("tracks") ?: return 0
        return jsonObjectNonNegativeInt(ref, "total")
    }

    private data class SpotifyMe(val userId: String, val accessToken: String)

    /** [GET /v1/me] → current user id + access token to use for playlist paging (may differ after refresh). */
    private fun fetchSpotifyMe(initialAccess: String): Pair<SpotifyMe?, String?> {
        var token = initialAccess
        while (true) {
            val response = client.newCall(
                Request.Builder()
                    .url("https://api.spotify.com/v1/me")
                    .header("Authorization", "Bearer $token")
                    .header("Accept", "application/json")
                    .build(),
            ).execute()
            val body = response.body?.string()
            if (response.code == 401) {
                val refresh = tokenStore.spotifyRefreshToken()
                    ?: return null to "Spotify session expired (HTTP 401)."
                val tr = tokenExchange.refreshSpotify(refresh)
                if (tr is TokenResult.Success) {
                    val nr = tr.refreshToken ?: refresh
                    tokenStore.saveSpotifyTokens(tr.accessToken, nr, tr.expiresInSeconds)
                    token = tr.accessToken
                    continue
                }
                return null to "Spotify token refresh failed (HTTP 401)."
            }
            if (response.code == 429) {
                return null to "Spotify rate limited (429). Wait several minutes and refresh again."
            }
            if (!response.isSuccessful || body.isNullOrBlank()) {
                val msg = spotifyErrorMessage(body) ?: body?.take(180)?.trim().orEmpty().ifBlank { "(no body)" }
                return null to "Spotify profile HTTP ${response.code}: $msg"
            }
            val json = try {
                JSONObject(body)
            } catch (_: Exception) {
                return null to "Spotify returned invalid JSON."
            }
            val err = json.optJSONObject("error")
            if (err != null) {
                val msg = err.optString("message", err.toString())
                return null to msg.ifBlank { "Spotify API error" }
            }
            val id = json.optString("id", "").takeIf { it.isNotBlank() }
                ?: return null to "Spotify /me response missing id."
            return SpotifyMe(id, token) to null
        }
    }

    /** Playlists the user owns ([owner.id] == current user), not followed/third-party lists from [/me/playlists]. */
    private fun fetchSpotifyPlaylists(initialAccess: String): Pair<List<PlaylistSummary>, String?> {
        val (me, profileErr) = fetchSpotifyMe(initialAccess)
        if (me == null) return emptyList<PlaylistSummary>() to profileErr
        val userId = me.userId
        val out = mutableListOf<PlaylistSummary>()
        var url: String? = "https://api.spotify.com/v1/me/playlists?limit=50"
        var access = me.accessToken
        while (url != null) {
            val request = Request.Builder()
                .url(url!!)
                .header("Authorization", "Bearer $access")
                .header("Accept", "application/json")
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string()
            if (response.code == 401) {
                val refresh = tokenStore.spotifyRefreshToken()
                    ?: return out to "Spotify session expired (HTTP 401)."
                val tr = tokenExchange.refreshSpotify(refresh)
                if (tr is TokenResult.Success) {
                    val nr = tr.refreshToken ?: refresh
                    tokenStore.saveSpotifyTokens(tr.accessToken, nr, tr.expiresInSeconds)
                    access = tr.accessToken
                    continue
                }
                return out to "Spotify token refresh failed (HTTP 401)."
            }
            if (response.code == 429) {
                return out to "Spotify rate limited (429). Wait several minutes and refresh again."
            }
            if (!response.isSuccessful || body.isNullOrBlank()) {
                val snippet = body?.take(180)?.trim() ?: ""
                val msg = spotifyErrorMessage(body) ?: snippet.ifBlank { "(no body)" }
                return out to "Spotify playlists HTTP ${response.code}: $msg"
            }
            val json = try {
                JSONObject(body)
            } catch (_: Exception) {
                return out to "Spotify returned invalid JSON."
            }
            val err = json.optJSONObject("error")
            if (err != null) {
                val msg = err.optString("message", err.toString())
                return out to msg.ifBlank { "Spotify API error" }
            }
            val items = json.optJSONArray("items")
                ?: return out to "Spotify response missing items array."
            for (i in 0 until items.length()) {
                val pl = items.getJSONObject(i)
                val owner = pl.optJSONObject("owner")
                val ownerId = owner?.optString("id")?.takeIf { it.isNotBlank() } ?: continue
                if (ownerId != userId) continue
                val total = spotifyPlaylistTrackTotalFromRef(pl)
                val ownerName = owner.optString("display_name")
                    .takeIf { it.isNotBlank() }
                    ?: ownerId
                val artUrl = spotifyPlaylistImageUrl(pl.optJSONArray("images"))
                out.add(
                    PlaylistSummary(
                        id = pl.getString("id"),
                        name = pl.getString("name"),
                        service = MusicService.Spotify,
                        trackCount = total,
                        ownerLabel = ownerName,
                        artworkUrl = artUrl,
                        artworkContentDescription = pl.getString("name"),
                    ),
                )
            }
            url = if (json.has("next") && !json.isNull("next")) json.getString("next") else null
        }
        return out to null
    }

    /** Pick a reasonable cover size from Spotify's `images` array (playlist objects). */
    private fun spotifyPlaylistImageUrl(images: JSONArray?): String? {
        if (images == null || images.length() == 0) return null
        var bestUrl: String? = null
        var bestDelta = Int.MAX_VALUE
        for (i in 0 until images.length()) {
            val im = images.optJSONObject(i) ?: continue
            val u = im.optString("url", "").takeIf { it.isNotBlank() } ?: continue
            val w = im.optInt("width", 0)
            val delta = abs(w - 240)
            if (delta < bestDelta) {
                bestDelta = delta
                bestUrl = u
            }
        }
        return bestUrl
            ?: images.optJSONObject(0)?.optString("url")?.takeIf { it.isNotBlank() }
    }

    private fun spotifyErrorMessage(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val j = JSONObject(body)
            j.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * TIDAL Open API (JSON:API): user playlist collection items.
     * @see [openapi.tidal.com userCollectionPlaylists items relationship](https://openapi.tidal.com/v2)
     */
    private fun fetchTidalPlaylists(initialAccess: String): Pair<List<PlaylistSummary>, String?> {
        val out = mutableListOf<PlaylistSummary>()
        var nextUrl: String? = null
        var access = initialAccess
        var tidal401Retries = 0
        var pagesFetched = 0
        val country = Locale.getDefault().country.takeIf { it.length == 2 } ?: "US"
        val base =
            "https://openapi.tidal.com/v2/userCollectionPlaylists/me/relationships/items" +
                "?countryCode=${URLEncoder.encode(country, StandardCharsets.UTF_8)}" +
                "&include=items&sort=-addedAt"
        while (pagesFetched < TIDAL_MAX_PAGES) {
            val url = nextUrl ?: base
            pagesFetched++
            val request = Request.Builder()
                .url(url)
                .header("Authorization", "Bearer $access")
                .header("Accept", "application/vnd.api+json")
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string()
            if (response.code == 401) {
                tidal401Retries++
                if (tidal401Retries > TIDAL_MAX_AUTH_RETRIES) {
                    return out to "TIDAL authentication failed repeatedly (HTTP 401)."
                }
                val refresh = tokenStore.tidalRefreshToken()
                    ?: return out to "TIDAL session expired (HTTP 401)."
                val tr = tokenExchange.refreshTidal(refresh)
                if (tr is TokenResult.Success) {
                    val nr = tr.refreshToken ?: refresh
                    tokenStore.saveTidalTokens(tr.accessToken, nr, tr.expiresInSeconds)
                    access = tr.accessToken
                    pagesFetched--
                    continue
                }
                return out to "TIDAL token refresh failed (HTTP 401)."
            }
            tidal401Retries = 0
            if (!response.isSuccessful || body.isNullOrBlank()) {
                val snippet = tidalErrorSnippet(body)
                    ?: body?.take(220)?.trim().orEmpty()
                return out to "TIDAL playlists HTTP ${response.code}: ${snippet.ifBlank { "(no body)" }}"
            }
            val json = JSONObject(body)
            val includedMap = buildIncludedMap(json.optJSONArray("included"))
            val dataArr = json.optJSONArray("data")
            if (dataArr != null) {
                for (i in 0 until dataArr.length()) {
                    val ref = dataArr.optJSONObject(i) ?: continue
                    val refType = ref.optString("type")
                    val id = ref.optString("id")
                    if (id.isBlank()) continue
                    val pl = includedMap["$refType:$id"]
                        ?: includedMap["playlists:$id"]
                    if (pl != null) {
                        out.add(parseTidalPlaylist(pl))
                    } else {
                        out.add(
                            PlaylistSummary(
                                id = id,
                                name = "Playlist",
                                service = MusicService.Tidal,
                                trackCount = 0,
                                ownerLabel = "TIDAL",
                            ),
                        )
                    }
                }
            }
            val links = json.optJSONObject("links")
            val nextRaw = links?.optString("next")?.takeIf { it.isNotBlank() } ?: break
            val resolved = resolveTidalNextPageUrl(url, nextRaw) ?: break
            if (resolved == url) break
            nextUrl = resolved
        }
        return out to null
    }

    private fun resolveTidalNextPageUrl(currentRequestUrl: String, next: String): String? =
        try {
            when {
                next.startsWith("http://", ignoreCase = true) ||
                    next.startsWith("https://", ignoreCase = true) -> next
                else -> URI(currentRequestUrl).resolve(next).toASCIIString()
            }
        } catch (_: Exception) {
            null
        }

    private fun buildIncludedMap(included: JSONArray?): Map<String, JSONObject> {
        if (included == null) return emptyMap()
        val map = HashMap<String, JSONObject>()
        for (i in 0 until included.length()) {
            val o = included.optJSONObject(i) ?: continue
            val t = o.optString("type")
            val id = o.optString("id")
            if (t.isNotBlank() && id.isNotBlank()) {
                map["$t:$id"] = o
            }
        }
        return map
    }

    private fun parseTidalPlaylist(obj: JSONObject): PlaylistSummary {
        val id = obj.optString("id", "unknown")
        val attrs = obj.optJSONObject("attributes")
        val name = attrs?.optString("name", "")?.takeIf { it.isNotBlank() } ?: "Playlist"
        val trackCount = attrs?.optInt("numberOfItems", 0) ?: 0
        val owner = tidalOwnerLabel(obj.optJSONObject("relationships"))
        val artUrl = tidalPlaylistArtUrl(attrs)
        return PlaylistSummary(
            id = id,
            name = name,
            service = MusicService.Tidal,
            trackCount = trackCount,
            ownerLabel = owner,
            artworkUrl = artUrl,
            artworkContentDescription = name,
        )
    }

    private fun tidalOwnerLabel(relationships: JSONObject?): String {
        val owners = relationships?.optJSONObject("owners") ?: return "TIDAL"
        val data = owners.optJSONArray("data") ?: return "TIDAL"
        if (data.length() == 0) return "TIDAL"
        val first = data.optJSONObject(0) ?: return "TIDAL"
        return first.optString("id").takeIf { it.isNotBlank() } ?: "TIDAL"
    }

    private fun tidalPlaylistArtUrl(attrs: JSONObject?): String? {
        if (attrs == null) return null
        val links = attrs.optJSONArray("externalLinks") ?: return null
        for (i in 0 until links.length()) {
            val link = links.optJSONObject(i) ?: continue
            val href = link.optString("href", "").takeIf { it.startsWith("http") } ?: continue
            val meta = link.optJSONObject("meta")
            val type = meta?.optString("type") ?: ""
            if (type == "TIDAL_SHARING" || type == "TIDAL_USER_SHARING") return href
        }
        return null
    }

    private fun tidalErrorSnippet(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return try {
            val j = JSONObject(body)
            val errors = j.optJSONArray("errors")
            if (errors != null && errors.length() > 0) {
                val e = errors.optJSONObject(0)
                e?.optString("detail")?.takeIf { it.isNotBlank() }
                    ?: e?.optString("title")?.takeIf { it.isNotBlank() }
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }

    private companion object {
        const val TIDAL_MAX_PAGES = 50
        const val TIDAL_MAX_AUTH_RETRIES = 3

        fun defaultHttp() = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }
}
