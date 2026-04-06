package com.playmix.app.ui.playlists

import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.playmix.app.PlaymixApplication
import com.playmix.app.data.LinkedPlaylistRepository

class PlaylistsViewModelFactory(
    private val application: Application,
) : ViewModelProvider.Factory {

    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass == PlaylistsViewModel::class.java)
        val app = application as PlaymixApplication
        val repository = LinkedPlaylistRepository(
            tokenStore = app.tokenStore,
            tokenExchange = app.tokenExchange,
            httpClient = app.httpClient,
        )
        return PlaylistsViewModel(application, repository, app.tokenStore) as T
    }
}
