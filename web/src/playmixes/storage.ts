import type { PlaymixPlaylist } from "./types"

/**
 * Persisted locally in the browser. Replace with a small API + MySQL (or similar) when you want
 * multi-device sync, sharing, or backup — keep the same `PlaymixPlaylist` shape server-side.
 */
const STORAGE_KEY = "playmix.playmixes.v1"

function safeParse(raw: string | null): PlaymixPlaylist[] {
  if (!raw?.trim()) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(isPlaymixPlaylist)
  } catch {
    return []
  }
}

function isPlaymixPlaylist(x: unknown): x is PlaymixPlaylist {
  if (!x || typeof x !== "object") return false
  const p = x as PlaymixPlaylist
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.createdAt === "number" &&
    typeof p.updatedAt === "number" &&
    Array.isArray(p.tracks)
  )
}

export function loadPlaymixPlaylists(): PlaymixPlaylist[] {
  return safeParse(typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null)
}

export function savePlaymixPlaylists(playlists: PlaymixPlaylist[]): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists))
}

export function newPlaymixId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `pm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function newTrackKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `tr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
