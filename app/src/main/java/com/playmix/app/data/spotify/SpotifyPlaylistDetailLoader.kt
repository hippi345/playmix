package com.playmix.app.data.spotify

import com.playmix.app.domain.SpotifyPlaylistDetail
import com.playmix.app.domain.SpotifyTrackItem
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

class SpotifyPlaylistDetailLoader(
    private val spotifyAccess: SpotifyAccess,
) {
    fun load(rawPlaylistId: String): SpotifyPlaylistDetail? {
        val id = SpotifyPlaylistIds.normalize(rawPlaylistId)
        if (id.isEmpty()) return null

        val (metaCode, metaBody) = spotifyAccess.httpGetRaw(playlistMetaUrl(id))
        if (metaCode !in 200..299 || metaBody.isNullOrBlank()) {
            return SpotifyPlaylistDetail(
                id = id,
                name = "Playlist",
                imageUrl = null,
                tracks = emptyList(),
                playlistMetaError = spotifyMetaErrorMessage(metaCode, metaBody),
            )
        }
        val base = try {
            JSONObject(metaBody)
        } catch (_: Exception) {
            return SpotifyPlaylistDetail(
                id = id,
                name = "Playlist",
                imageUrl = null,
                tracks = emptyList(),
                playlistMetaError = "Invalid playlist response from Spotify.",
            )
        }
        base.optJSONObject("error")?.let { err ->
            val status = err.optInt("status", metaCode)
            val msg = err.optString("message").ifBlank { "Spotify error loading playlist." }
            return SpotifyPlaylistDetail(
                id = id,
                name = "Playlist",
                imageUrl = null,
                tracks = emptyList(),
                playlistMetaError = if (status == 403) playlistApi403Hint(msg) else msg,
            )
        }

        val name = base.optString("name", "Playlist")
        val imageUrl = base.optJSONArray("images")?.optJSONObject(0)?.optString("url")

        val accumulated = mutableListOf<SpotifyTrackItem>()
        var tracksLoadError: String? = null
        var maxTotalSeen = 0

        // Spotify Web API (2026+): list contents via GET /playlists/{id}/items — GET .../tracks is deprecated and returns 403.
        // Prefer ISO country from /me for market; fall back to from_token.
        val marketQuery = resolvePlaylistTracksMarket()
        var url: String? = playlistItemsFirstPageUrl(id, marketQuery)
        while (true) {
            val pageUrl = url ?: break
            val (code, body) = spotifyAccess.httpGetRaw(pageUrl)
            if (code !in 200..299 || body.isNullOrBlank()) {
                tracksLoadError = spotifyErrorMessage(code, body, use403PolicyHint = true)
                break
            }
            val page = try {
                JSONObject(body)
            } catch (_: Exception) {
                tracksLoadError = "Invalid track list response."
                break
            }
            val pageError = page.optJSONObject("error")
            if (pageError != null) {
                val status = pageError.optInt("status", 0)
                val msg = pageError.optString("message").ifBlank { "Spotify error loading tracks." }
                tracksLoadError =
                    if (status == 403) {
                        playlistApi403Hint(msg)
                    } else {
                        msg
                    }
                break
            }
            val pageTotal = page.optInt("total", 0)
            if (pageTotal > 0) maxTotalSeen = maxOf(maxTotalSeen, pageTotal)
            val items = page.optJSONArray("items")
            val batch = parseTrackItems(items)
            accumulated.addAll(batch)
            url =
                if (page.has("next") && !page.isNull("next")) {
                    withMarketOnPlaylistItemsNext(page.getString("next"), marketQuery)
                } else {
                    null
                }
        }

        if (accumulated.isNotEmpty()) {
            tracksLoadError = null
        } else if (tracksLoadError == null && maxTotalSeen > 0) {
            tracksLoadError =
                "Every track in this playlist is hidden or unavailable for your account or region."
        }

        return SpotifyPlaylistDetail(
            id = id,
            name = name,
            imageUrl = imageUrl,
            tracks = accumulated,
            tracksLoadError = tracksLoadError,
        )
    }

    private fun playlistMetaUrl(playlistId: String): String =
        "https://api.spotify.com/v1/".toHttpUrl().newBuilder()
            .addPathSegment("playlists")
            .addPathSegment(playlistId)
            .addQueryParameter("market", "from_token")
            .build()
            .toString()

    private fun resolvePlaylistTracksMarket(): String {
        val me = spotifyAccess.getJson("https://api.spotify.com/v1/me") ?: return "from_token"
        if (me.optJSONObject("error") != null) return "from_token"
        val country = me.optString("country", "").trim()
        return country.ifBlank { "from_token" }
    }

    /**
     * Spotify's paging `next` URLs sometimes omit `market`; replaying our market avoids errors on later pages.
     */
    private fun withMarketOnPlaylistItemsNext(nextUrl: String, marketQuery: String): String {
        val u = nextUrl.toHttpUrlOrNull() ?: return nextUrl
        val path = u.encodedPath
        if (!path.contains("/playlists/") || !path.endsWith("/items")) return nextUrl
        return u.newBuilder()
            .removeAllQueryParameters("market")
            .addQueryParameter("market", marketQuery)
            .build()
            .toString()
    }

    private fun playlistItemsFirstPageUrl(playlistId: String, marketQuery: String): String =
        "https://api.spotify.com/v1/".toHttpUrl().newBuilder()
            .addPathSegment("playlists")
            .addPathSegment(playlistId)
            .addPathSegment("items")
            .addQueryParameter("limit", "50")
            .addQueryParameter("market", marketQuery)
            .build()
            .toString()

    private fun playlistApi403Hint(message: String): String {
        val base = message.ifBlank { "Forbidden" }
        return "$base Spotify’s Web API only returns full playlist data for playlists you own or collaborate on (not for playlists you only follow)."
    }

    private fun spotifyMetaErrorMessage(code: Int, body: String?): String {
        if (code == -1) {
            return "Not signed in to Spotify. Connect or use Reconnect Spotify on the Library screen."
        }
        val parsed = try {
            if (!body.isNullOrBlank()) JSONObject(body) else null
        } catch (_: Exception) {
            null
        }
        val fromJson = parsed?.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
        val msg = fromJson ?: "Could not load playlist (HTTP $code)."
        return when (code) {
            401 -> "$msg Try Reconnect Spotify on the Library screen."
            403 -> playlistApi403Hint(msg)
            404 -> "Playlist not found. It may have been removed or the link is wrong."
            else -> msg
        }
    }

    private fun spotifyErrorMessage(code: Int, body: String?, use403PolicyHint: Boolean): String {
        val parsed = try {
            if (!body.isNullOrBlank()) JSONObject(body) else null
        } catch (_: Exception) {
            null
        }
        val fromJson = parsed?.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
        val msg = fromJson ?: "Could not load tracks (HTTP $code)."
        return if (use403PolicyHint && code == 403) {
            playlistApi403Hint(msg)
        } else {
            msg
        }
    }

    private fun parseTrackItems(items: JSONArray?): List<SpotifyTrackItem> {
        if (items == null) return emptyList()
        val out = mutableListOf<SpotifyTrackItem>()
        for (i in 0 until items.length()) {
            val row = items.optJSONObject(i) ?: continue
            // New playlist-items API uses `item`; older responses used `track`.
            val track = row.optJSONObject("track") ?: row.optJSONObject("item") ?: continue

            val objType = track.optString("type", "track").ifBlank { "track" }
            if (objType != "track") continue

            var tid = track.optString("id", "")
            if (tid.isBlank()) {
                val uri = track.optString("uri", "")
                val parts = uri.split(":")
                if (parts.size >= 3 && parts[1] == "track") tid = parts[2]
            }
            if (tid.isBlank()) {
                tid = extractTrackIdFromHref(track.optString("href", "")) ?: ""
            }
            if (tid.isBlank()) continue

            val uri = track.optString("uri", "spotify:track:$tid")
            val trackName = track.optString("name", "")
            val artists = track.optJSONArray("artists")
            val artistLine = buildString {
                if (artists != null) {
                    for (j in 0 until artists.length()) {
                        val a = artists.optJSONObject(j)?.optString("name")
                        if (!a.isNullOrBlank()) {
                            if (isNotEmpty()) append(", ")
                            append(a)
                        }
                    }
                }
            }
            val album = track.optJSONObject("album")
            val albumName = album?.optString("name") ?: ""
            val artUrl = album?.optJSONArray("images")?.let { imgs ->
                when {
                    imgs.length() >= 2 -> imgs.optJSONObject(1)?.optString("url")
                    imgs.length() == 1 -> imgs.optJSONObject(0)?.optString("url")
                    else -> null
                }
            }
            val duration = track.optLong("duration_ms", 0L)
            out.add(
                SpotifyTrackItem(
                    id = tid,
                    uri = uri,
                    name = trackName,
                    artistLine = artistLine,
                    albumName = albumName,
                    artworkUrl = artUrl,
                    durationMs = duration,
                ),
            )
        }
        return out
    }

    private fun extractTrackIdFromHref(href: String): String? {
        if (href.isBlank()) return null
        val m = Regex("/tracks/([a-zA-Z0-9]+)").find(href) ?: return null
        return m.groupValues[1].takeIf { it.isNotBlank() }
    }
}
