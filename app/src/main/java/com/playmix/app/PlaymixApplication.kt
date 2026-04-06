package com.playmix.app

import android.app.Application
import android.util.Log
import com.playmix.app.BuildConfig
import com.playmix.app.auth.TokenExchangeService
import com.playmix.app.auth.TokenStore
import kotlinx.coroutines.flow.MutableSharedFlow
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

class PlaymixApplication : Application() {

    @Volatile
    private var tokenStoreInstance: TokenStore? = null

    private val tokenStoreLock = java.lang.Object()

    /** Only valid after [awaitTokenStore] (or once prefs have finished loading on the background thread). */
    val tokenStore: TokenStore
        get() = checkNotNull(tokenStoreInstance) {
            "TokenStore not ready — await on a worker thread via awaitTokenStore()"
        }

    val httpClient: OkHttpClient by lazy {
        val builder = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
        if (BuildConfig.DEBUG) {
            val logging = HttpLoggingInterceptor { message ->
                Log.d(HTTP_LOG_TAG, message)
            }.apply {
                level = HttpLoggingInterceptor.Level.BODY
            }
            builder.addInterceptor(logging)
        }
        builder.build()
    }

    val tokenExchange: TokenExchangeService by lazy { TokenExchangeService(httpClient) }

    /** Buffered so OAuth callback does not drop refresh signals if the collector is briefly inactive. */
    val authCompletedEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 64)

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            // Debug uses plain SharedPreferences — safe to init on the main thread (no keystore wait).
            synchronized(tokenStoreLock) {
                tokenStoreInstance = TokenStore(this)
                tokenStoreLock.notifyAll()
            }
        } else {
            // Release: encrypted prefs can jank startup; init off the main thread.
            Thread({ initTokenStoreInBackground() }, "PlaymixTokenStore").start()
        }
        if (BuildConfig.DEBUG) {
            @Suppress("UNUSED_VARIABLE")
            val _warmOkHttp = httpClient
            Log.i(
                NET_DIAG_TAG,
                "Debug HTTP logging enabled (filter Logcat by \"$HTTP_LOG_TAG\"). Open Playlists and tap Refresh to see requests.",
            )
        }
    }

    private fun initTokenStoreInBackground() {
        val store = TokenStore(this)
        synchronized(tokenStoreLock) {
            tokenStoreInstance = store
            tokenStoreLock.notifyAll()
        }
    }

    /**
     * Blocks the calling thread until encrypted prefs are ready. Call from [Dispatchers.IO], never
     * from the UI thread.
     */
    fun awaitTokenStore(): TokenStore {
        tokenStoreInstance?.let { return it }
        synchronized(tokenStoreLock) {
            while (tokenStoreInstance == null) {
                try {
                    tokenStoreLock.wait()
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    throw IllegalStateException("Interrupted while waiting for TokenStore", e)
                }
            }
            return tokenStoreInstance!!
        }
    }

    private companion object {
        const val HTTP_LOG_TAG = "OkHttp"
        const val NET_DIAG_TAG = "PlaymixNet"
    }
}
