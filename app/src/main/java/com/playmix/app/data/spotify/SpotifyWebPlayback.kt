package com.playmix.app.data.spotify

import org.json.JSONObject
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class SpotifyConnectDevice(
    val id: String,
    val name: String,
    val isActive: Boolean,
)

data class SpotifyConnectPlayerSnapshot(
    val title: String?,
    val artist: String?,
    val artUrl: String?,
    val playingTrackUri: String?,
    val isPaused: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val deviceId: String?,
    val deviceName: String?,
    val shuffleEnabled: Boolean = false,
    /** Spotify Web API: "off" | "context" | "track". */
    val repeatState: String = "off",
)

/**
 * Spotify Web API playback (Connect): targets the user's active or first available device
 * (phone, computer, Web Player, etc.) — does not require Spotify on this Android process.
 */
class SpotifyWebPlayback(
    private val access: SpotifyAccess,
) {

    fun listDevices(): List<SpotifyConnectDevice> {
        val json = access.getJson("https://api.spotify.com/v1/me/player/devices")
            ?: return emptyList()
        val arr = json.optJSONArray("devices") ?: return emptyList()
        val out = mutableListOf<SpotifyConnectDevice>()
        for (i in 0 until arr.length()) {
            val d = arr.optJSONObject(i) ?: continue
            if (d.optBoolean("is_restricted", false)) continue
            val id = d.optString("id", "")
            if (id.isBlank()) continue
            out.add(
                SpotifyConnectDevice(
                    id = id,
                    name = d.optString("name", "Spotify"),
                    isActive = d.optBoolean("is_active", false),
                ),
            )
        }
        return out
    }

    fun resolveDeviceId(): String? {
        val devices = listDevices()
        return devices.firstOrNull { it.isActive }?.id
            ?: devices.firstOrNull()?.id
    }

    fun resolveDeviceLabel(): String? {
        val devices = listDevices()
        val d = devices.firstOrNull { it.isActive } ?: devices.firstOrNull() ?: return null
        return d.name
    }

    fun transferToDevice(deviceId: String, play: Boolean = false): Pair<Int, String?> {
        val body = JSONObject().apply {
            put("device_ids", org.json.JSONArray().put(deviceId))
            put("play", play)
        }
        return access.httpPutJson("https://api.spotify.com/v1/me/player", body)
    }

    fun playContextUri(deviceId: String?, contextUri: String): Pair<Int, String?> {
        val url = buildPlayUrl(deviceId)
        val body = JSONObject().apply {
            put("context_uri", contextUri)
        }
        return access.httpPutJson(url, body)
    }

    /**
     * Start this playlist on [trackUri] so Next/Previous stay in the playlist context.
     */
    fun playPlaylistFromTrack(deviceId: String?, playlistUri: String, trackUri: String): Pair<Int, String?> {
        val url = buildPlayUrl(deviceId)
        val body = JSONObject().apply {
            put("context_uri", playlistUri)
            put("offset", JSONObject().apply { put("uri", trackUri) })
        }
        return access.httpPutJson(url, body)
    }

    fun playTrackUris(deviceId: String?, uris: List<String>): Pair<Int, String?> {
        val url = buildPlayUrl(deviceId)
        val arr = org.json.JSONArray()
        uris.forEach { arr.put(it) }
        val body = JSONObject().apply { put("uris", arr) }
        return access.httpPutJson(url, body)
    }

    fun getPlayer(): SpotifyConnectPlayerSnapshot? {
        val (code, body) = access.httpGetRaw("https://api.spotify.com/v1/me/player")
        if (code != 200 || body.isNullOrBlank()) return null
        return try {
            parsePlayer(JSONObject(body))
        } catch (_: Exception) {
            null
        }
    }

    fun pause(deviceId: String?): Pair<Int, String?> {
        val q = deviceQuery(deviceId)
        return access.httpPutEmpty("https://api.spotify.com/v1/me/player/pause$q")
    }

    fun resume(deviceId: String?): Pair<Int, String?> {
        val q = deviceQuery(deviceId)
        return access.httpPutJson(
            "https://api.spotify.com/v1/me/player/play$q",
            JSONObject(),
        )
    }

    fun skipNext(deviceId: String?): Pair<Int, String?> {
        val q = deviceQuery(deviceId)
        return access.httpPostEmpty("https://api.spotify.com/v1/me/player/next$q")
    }

    fun skipPrevious(deviceId: String?): Pair<Int, String?> {
        val q = deviceQuery(deviceId)
        return access.httpPostEmpty("https://api.spotify.com/v1/me/player/previous$q")
    }

    fun seek(deviceId: String?, positionMs: Long): Pair<Int, String?> {
        val q = deviceQuery(deviceId, extra = "position_ms=$positionMs")
        return access.httpPutEmpty("https://api.spotify.com/v1/me/player/seek$q")
    }

    fun setShuffle(deviceId: String?, enabled: Boolean): Pair<Int, String?> {
        val q = deviceQuery(deviceId, extra = "state=$enabled")
        return access.httpPutEmpty("https://api.spotify.com/v1/me/player/shuffle$q")
    }

    /** [state] is `off`, `context` (repeat playlist), or `track` (repeat one). */
    fun setRepeat(deviceId: String?, state: String): Pair<Int, String?> {
        val enc = URLEncoder.encode(state, StandardCharsets.UTF_8.name())
        val q = deviceQuery(deviceId, extra = "state=$enc")
        return access.httpPutEmpty("https://api.spotify.com/v1/me/player/repeat$q")
    }

    fun apiErrorMessage(code: Int, body: String?): String? {
        if (code in 200..299) return null
        val fromJson = try {
            if (!body.isNullOrBlank()) JSONObject(body).optJSONObject("error")?.optString("message") else null
        } catch (_: Exception) {
            null
        }
        return fromJson?.takeIf { it.isNotBlank() }
            ?: when (code) {
                401 -> "Session expired. Connect Spotify again from the Library screen."
                403 -> "Spotify blocked this action (Premium or permissions may be required)."
                404 -> "No Spotify device available. Open Spotify on your phone or computer, then try again."
                429 -> "Too many requests. Wait a moment and retry."
                else -> "Spotify request failed ($code)."
            }
    }

    private fun buildPlayUrl(deviceId: String?): String {
        return "https://api.spotify.com/v1/me/player/play${deviceQuery(deviceId)}"
    }

    private fun deviceQuery(deviceId: String?, extra: String? = null): String {
        val parts = mutableListOf<String>()
        if (!deviceId.isNullOrBlank()) {
            parts.add("device_id=${URLEncoder.encode(deviceId, StandardCharsets.UTF_8.name())}")
        }
        if (!extra.isNullOrBlank()) parts.add(extra)
        return if (parts.isEmpty()) "" else "?" + parts.joinToString("&")
    }

    private fun parsePlayer(json: JSONObject): SpotifyConnectPlayerSnapshot {
        val item = json.optJSONObject("item")
        val title = item?.optString("name", "")?.takeIf { it.isNotBlank() }
        val artists = item?.optJSONArray("artists")
        val artistLine = buildString {
            if (artists != null) {
                for (j in 0 until artists.length()) {
                    val n = artists.optJSONObject(j)?.optString("name") ?: continue
                    if (isNotEmpty()) append(", ")
                    append(n)
                }
            }
        }.ifBlank { null }
        val album = item?.optJSONObject("album")
        val artUrl = album?.optJSONArray("images")?.let { imgs ->
            when {
                imgs.length() >= 2 -> imgs.optJSONObject(1)?.optString("url")
                imgs.length() == 1 -> imgs.optJSONObject(0)?.optString("url")
                else -> null
            }
        }
        val duration = item?.optLong("duration_ms", 0L) ?: 0L
        val playingUri = item?.optString("uri", "")?.takeIf { it.isNotBlank() }
        val progress = json.optLong("progress_ms", 0L)
        val playing = json.optBoolean("is_playing", false)
        val dev = json.optJSONObject("device")
        val shuffle = json.optBoolean("shuffle_state", false)
        val repeatRaw = json.optString("repeat_state", "off").lowercase()
        val repeatNorm = when (repeatRaw) {
            "track" -> "track"
            "context" -> "context"
            else -> "off"
        }
        return SpotifyConnectPlayerSnapshot(
            title = title,
            artist = artistLine,
            artUrl = artUrl,
            playingTrackUri = playingUri,
            isPaused = !playing,
            positionMs = progress,
            durationMs = duration,
            deviceId = dev?.optString("id", null),
            deviceName = dev?.optString("name", null),
            shuffleEnabled = shuffle,
            repeatState = repeatNorm,
        )
    }
}
