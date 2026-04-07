export function openSoundcloudPermalink(permalinkUrl: string): void {
  const u = permalinkUrl.trim()
  if (!u) return
  window.open(u, "_blank", "noopener,noreferrer")
}
