package com.playmix.app.auth

data class ServiceLinkState(
    val spotifyLinked: Boolean = false,
    val tidalLinked: Boolean = false,
    val spotifyClientConfigured: Boolean = false,
    val tidalClientConfigured: Boolean = false,
)
