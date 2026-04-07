/**
 * Real media CDNs only — not `api.soundcloud.com`. API stream URLs need OAuth via `/__soundcloud-api`
 * and a 302 to these hosts; sending them through `/__soundcloud-media` causes 401.
 */
export function isSoundcloudPlaybackCdnHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return (
    h === "sndcdn.com" ||
    h.endsWith(".sndcdn.com") ||
    h === "scdn.co" ||
    h.endsWith(".scdn.co") ||
    h.endsWith(".soundcloud.cloud")
  )
}
