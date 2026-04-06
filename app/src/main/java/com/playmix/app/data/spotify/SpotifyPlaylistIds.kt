package com.playmix.app.data.spotify

/**
 * Navigation and deep links may pass a raw playlist id, URI, or open.spotify.com URL.
 * Spotify Web API paths must use the bare playlist id only.
 */
object SpotifyPlaylistIds {
    fun normalize(raw: String): String {
        var s = raw.trim().removeSurrounding("\"")
        if (s.isEmpty()) return s

        val lower = s.lowercase()
        if (lower.startsWith("spotify:playlist:")) {
            return s.substring("spotify:playlist:".length).trim()
        }
        if (lower.startsWith("http://") || lower.startsWith("https://")) {
            val host = s.substringAfter("://").substringBefore("/")
            if (host.contains("spotify.com") || host.contains("spotify.link")) {
                val afterPlaylist = Regex("/playlist/([^/?#]+)", RegexOption.IGNORE_CASE).find(s)
                if (afterPlaylist != null) return afterPlaylist.groupValues[1]
                val seg = s.substringAfterLast("/").substringBefore("?").substringBefore("#")
                if (seg.isNotBlank() && seg != "playlist") return seg
            }
        }
        return s
    }
}
