export const SOUNDCLOUD_AUTH = "https://secure.soundcloud.com/authorize"
export const SOUNDCLOUD_TOKEN = "https://secure.soundcloud.com/oauth/token"

/**
 * PKCE token exchange only (no client_secret). In dev, default is same-origin proxy to avoid CORS.
 */
export function soundcloudTokenEndpoint(): string {
  const fromEnv = import.meta.env.VITE_SOUNDCLOUD_TOKEN_URL?.trim()
  if (fromEnv) return fromEnv
  if (
    import.meta.env.DEV &&
    ((import.meta.env.VITE_SOUNDCLOUD_DIRECT_TOKEN ?? "") as string) !== "1"
  ) {
    return "/__soundcloud-token"
  }
  return SOUNDCLOUD_TOKEN
}

export const SOUNDCLOUD_API_BASE =
  import.meta.env.DEV && ((import.meta.env.VITE_SOUNDCLOUD_DIRECT_API ?? "") as string) !== "1"
    ? "/__soundcloud-api"
    : "https://api.soundcloud.com"
