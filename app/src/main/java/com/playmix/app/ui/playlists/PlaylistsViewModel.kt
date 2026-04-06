package com.playmix.app.ui.playlists

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.playmix.app.PlaymixApplication
import com.playmix.app.auth.ServiceLinkState
import com.playmix.app.auth.TokenStore
import com.playmix.app.data.LinkedPlaylistRepository
import com.playmix.app.data.PlaylistRepository
import com.playmix.app.domain.PlaylistSummary
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PlaylistsUiState(
    val section: PlaylistLibrarySection = PlaylistLibrarySection.All,
    val allPlaylists: List<PlaylistSummary> = emptyList(),
    val isLoading: Boolean = false,
    val links: ServiceLinkState = ServiceLinkState(),
) {

    val visiblePlaylists: List<PlaylistSummary>
        get() = allPlaylists.filter { section.matches(it.service) }
}

class PlaylistsViewModel(
    application: Application,
    private val repository: PlaylistRepository,
    private val tokenStore: TokenStore,
) : AndroidViewModel(application) {

    private val app = application as PlaymixApplication

    private val section = MutableStateFlow(PlaylistLibrarySection.All)
    private val loading = MutableStateFlow(true)

    val uiState: StateFlow<PlaylistsUiState> = combine(
        section,
        repository.observePlaylists(),
        loading,
        tokenStore.linkState,
    ) { s, playlists, isLoading, links ->
        PlaylistsUiState(
            section = s,
            allPlaylists = playlists.sortedWith(
                compareBy({ it.service.ordinal }, { it.name.lowercase() }),
            ),
            isLoading = isLoading,
            links = links,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PlaylistsUiState(isLoading = true),
    )

    init {
        viewModelScope.launch {
            try {
                repository.refresh()
            } finally {
                loading.update { false }
            }
        }
        viewModelScope.launch {
            app.authCompletedEvents.collect {
                refresh()
            }
        }
    }

    fun selectSection(next: PlaylistLibrarySection) {
        section.value = next
    }

    fun refresh() {
        viewModelScope.launch {
            loading.update { true }
            try {
                repository.refresh()
            } finally {
                loading.update { false }
            }
        }
    }

    /** Clears stored tokens so the next browser sign-in can request updated scopes (e.g. after an app update). */
    fun clearSpotifyLink() {
        tokenStore.clearSpotify()
        viewModelScope.launch {
            repository.refresh()
        }
    }

    fun clearTidalLink() {
        tokenStore.clearTidal()
        viewModelScope.launch {
            repository.refresh()
        }
    }
}
