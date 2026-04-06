package com.playmix.app.auth

object OAuthConstants {
    const val SPOTIFY_AUTH_BASE = "https://accounts.spotify.com/authorize"
    const val SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
    const val SPOTIFY_REDIRECT = "com.playmix.app://oauth/spotify"

    const val TIDAL_AUTH_BASE = "https://login.tidal.com/authorize"
    const val TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token"
    const val TIDAL_REDIRECT = "com.playmix.app://oauth/tidal"

    /** Space-separated for Spotify authorize URL */
    const val SPOTIFY_SCOPES =
        "playlist-read-private playlist-read-collaborative " +
            "user-read-private " +
            "user-modify-playback-state user-read-playback-state"

    /** Space-separated for TIDAL authorize URL (Open API user collection + playlists) */
    const val TIDAL_SCOPES = "collection.read playlists.read user.read"
}
