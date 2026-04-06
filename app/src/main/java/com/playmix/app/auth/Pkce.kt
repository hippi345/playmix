package com.playmix.app.auth

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

object Pkce {
    fun newVerifier(): String {
        val random = SecureRandom()
        val bytes = ByteArray(32)
        random.nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }

    fun challenge(verifier: String): String {
        val digester = MessageDigest.getInstance("SHA-256")
        val hash = digester.digest(verifier.toByteArray(Charsets.US_ASCII))
        return Base64.encodeToString(hash, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    }
}
