import path from "node:path"
import os from "node:os"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"

/** Outside OneDrive/Documents — avoids EPERM when Vite deletes `node_modules/.vite/deps` on Windows. */
const viteCacheDir = path.join(
  process.env.LOCALAPPDATA || os.tmpdir(),
  "PlaymixVite",
  "web-cache",
)

// Use a single origin so Spotify's redirect URI (must match exactly) stays consistent.
// Add http://127.0.0.1:5173/callback in the Spotify Dashboard.
//
// DEV: Browser calls go to /__spotify/... → forwarded to https://api.spotify.com/...
// so the Vite (npm) process can log status / headers. The body is not logged here
// (reading it would break the stream). Use VITE_SPOTIFY_LOG=1 for truncated JSON in
// the browser DevTools console, or Chrome Network → select request → Response.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const proxyQuiet = env.VITE_SPOTIFY_PROXY_LOG === "0"
  const tidalProxyQuiet = env.VITE_TIDAL_PROXY_LOG === "0"

  return {
    cacheDir: viteCacheDir,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/__spotify": {
          target: "https://api.spotify.com",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__spotify/, ""),
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, req) => {
              if (proxyQuiet) return
              const url = req.url ?? ""
              const code =
                proxyRes.statusCode != null ? String(proxyRes.statusCode) : "?"
              const ra = proxyRes.headers["retry-after"]
              const ct = proxyRes.headers["content-type"]
              const cl = proxyRes.headers["content-length"]
              console.log(
                `\n[spotify-proxy] ${req.method} ${url} → ${code}` +
                  (ra ? `  retry-after: ${ra}` : "") +
                  (ct ? `  content-type: ${ct}` : "") +
                  (cl ? `  length: ${cl}` : ""),
              )
            })
          },
        },
        "/__tidal-token": {
          target: "https://auth.tidal.com",
          changeOrigin: true,
          secure: true,
          rewrite: () => "/v1/oauth2/token",
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, req) => {
              if (tidalProxyQuiet) return
              const url = req.url ?? ""
              const code =
                proxyRes.statusCode != null ? String(proxyRes.statusCode) : "?"
              console.log(`\n[tidal-token-proxy] ${req.method} ${url} → ${code}`)
            })
          },
        },
        "/__tidal": {
          target: "https://openapi.tidal.com",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/__tidal/, ""),
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, req) => {
              if (tidalProxyQuiet) return
              const url = req.url ?? ""
              const code =
                proxyRes.statusCode != null ? String(proxyRes.statusCode) : "?"
              console.log(`\n[tidal-openapi-proxy] ${req.method} ${url} → ${code}`)
            })
          },
        },
      },
    },
  }
})
