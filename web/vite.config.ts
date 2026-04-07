import type { IncomingMessage } from "node:http"
import path from "node:path"
import os from "node:os"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import { soundcloudMediaProxyMiddleware } from "./vite.soundcloudMediaProxy"

/**
 * Proxied 401/403 responses may include WWW-Authenticate. Browsers then show an HTTP Basic
 * login for the dev origin (127.0.0.1:5173). Strip these so OAuth/API failures surface in JS only.
 */
function stripBrowserAuthChallenges(proxyRes: IncomingMessage) {
  const h = proxyRes.headers
  delete h["www-authenticate"]
  delete h["proxy-authenticate"]
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(Buffer.from(c)))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

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
  const soundcloudProxyQuiet = env.VITE_SOUNDCLOUD_PROXY_LOG === "0"

  /** Never use VITE_ for secrets (exposed to the browser). Prefer SOUNDCLOUD_CLIENT_SECRET in web/.env */
  const soundcloudClientSecret =
    env.SOUNDCLOUD_CLIENT_SECRET?.trim() || env.VITE_SOUNDCLOUD_CLIENT_SECRET?.trim() || ""

  return {
    cacheDir: viteCacheDir,
    plugins: [
      react(),
      {
        name: "soundcloud-media-cors-proxy",
        configureServer(server) {
          server.middlewares.use(soundcloudMediaProxyMiddleware())
        },
        configurePreviewServer(server) {
          server.middlewares.use(soundcloudMediaProxyMiddleware())
        },
      },
      {
        name: "soundcloud-oauth-token-dev",
        configureServer(server) {
          if (env.VITE_SOUNDCLOUD_CLIENT_SECRET?.trim() && !env.SOUNDCLOUD_CLIENT_SECRET?.trim()) {
            server.config.logger.warn(
              "\n[!] Rename VITE_SOUNDCLOUD_CLIENT_SECRET → SOUNDCLOUD_CLIENT_SECRET in web/.env. " +
                "The VITE_ prefix can expose values to the browser; rotate the secret at soundcloud.com/you/apps if this was committed or shared.\n",
            )
          }
          server.middlewares.use(async (req, res, next) => {
            const pathOnly = req.url?.split("?")[0] ?? ""
            if (pathOnly !== "/__soundcloud-token" || req.method !== "POST") {
              next()
              return
            }
            try {
              const text = await readRequestBody(req)
              const params = new URLSearchParams(text || "")
              if (soundcloudClientSecret) params.set("client_secret", soundcloudClientSecret)
              const r = await fetch("https://secure.soundcloud.com/oauth/token", {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  Accept: "application/json; charset=utf-8",
                },
                body: params.toString(),
              })
              const out = await r.text()
              if (!soundcloudProxyQuiet) {
                console.log(`\n[soundcloud-token] POST /oauth/token → ${r.status}`)
              }
              res.statusCode = r.status
              res.setHeader(
                "Content-Type",
                r.headers.get("content-type") || "application/json; charset=utf-8",
              )
              res.end(out)
            } catch (e) {
              res.statusCode = 500
              res.setHeader("Content-Type", "application/json; charset=utf-8")
              res.end(
                JSON.stringify({
                  error: "token_proxy_failed",
                  error_description: e instanceof Error ? e.message : String(e),
                }),
              )
            }
          })
        },
      },
    ],
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
              stripBrowserAuthChallenges(proxyRes)
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
              stripBrowserAuthChallenges(proxyRes)
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
              stripBrowserAuthChallenges(proxyRes)
              if (tidalProxyQuiet) return
              const url = req.url ?? ""
              const code =
                proxyRes.statusCode != null ? String(proxyRes.statusCode) : "?"
              console.log(`\n[tidal-openapi-proxy] ${req.method} ${url} → ${code}`)
            })
          },
        },
        "/__soundcloud-api": {
          target: "https://api.soundcloud.com",
          changeOrigin: true,
          secure: true,
          /** Avoid cutting off large stream responses when buffered through the dev proxy. */
          timeout: 0,
          proxyTimeout: 0,
          rewrite: (path) => path.replace(/^\/__soundcloud-api/, ""),
          configure: (proxy) => {
            proxy.on("proxyRes", (proxyRes, req) => {
              stripBrowserAuthChallenges(proxyRes)
              if (soundcloudProxyQuiet) return
              const url = req.url ?? ""
              const code =
                proxyRes.statusCode != null ? String(proxyRes.statusCode) : "?"
              console.log(`\n[soundcloud-api-proxy] ${req.method} ${url} → ${code}`)
            })
          },
        },
      },
    },
  }
})
