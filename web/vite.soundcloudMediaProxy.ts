import type { Connect } from "vite"
import type { ServerResponse } from "node:http"
import { Readable } from "node:stream"
import { isSoundcloudPlaybackCdnHost } from "./src/soundcloud/mediaHosts"

const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function forwardHeaders(fr: Response, res: ServerResponse) {
  fr.headers.forEach((value, key) => {
    if (hopByHop.has(key.toLowerCase())) return
    try {
      res.setHeader(key, value)
    } catch {
      /* ignore invalid header names */
    }
  })
}

export function soundcloudMediaProxyMiddleware(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const raw = req.url ?? ""
    if ((raw.split("?")[0] ?? "") !== "/__soundcloud-media") {
      next()
      return
    }

    void (async () => {
      let targetStr: string
      try {
        const q = new URL(raw, "http://vite.local").searchParams.get("url")
        if (!q) {
          res.statusCode = 400
          res.end("missing url")
          return
        }
        targetStr = q
      } catch {
        res.statusCode = 400
        res.end("bad query")
        return
      }

      let target: URL
      try {
        target = new URL(targetStr)
      } catch {
        res.statusCode = 400
        res.end("bad url")
        return
      }
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        res.statusCode = 400
        res.end("unsupported scheme")
        return
      }
      if (!isSoundcloudPlaybackCdnHost(target.hostname)) {
        res.statusCode = 403
        res.end("host not allowed")
        return
      }

      const method = req.method === "HEAD" ? "HEAD" : "GET"
      const headers: Record<string, string> = {
        Accept: "*/*",
        "User-Agent": (req.headers["user-agent"] as string) || "PlaymixDev/1",
        /** Some SoundCloud CDNs reject requests without a SoundCloud referer. */
        Referer: "https://soundcloud.com/",
        Origin: "https://soundcloud.com",
      }
      const proxyAuth = req.headers["x-soundcloud-proxy-authorization"]
      if (typeof proxyAuth === "string" && /^(OAuth|Bearer)\s+\S+/i.test(proxyAuth)) {
        headers.Authorization = proxyAuth
      }
      const range = req.headers.range
      if (typeof range === "string") headers.Range = range
      const inm = req.headers["if-none-match"]
      if (typeof inm === "string") headers["If-None-Match"] = inm
      const ims = req.headers["if-modified-since"]
      if (typeof ims === "string") headers["If-Modified-Since"] = ims

      let fr: Response
      try {
        fr = await fetch(targetStr, { method, headers, redirect: "follow" })
      } catch (e) {
        res.statusCode = 502
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.end(e instanceof Error ? e.message : "upstream fetch failed")
        return
      }

      res.statusCode = fr.status
      forwardHeaders(fr, res)
      if (method === "HEAD" || fr.status === 204 || fr.status === 304) {
        res.end()
        return
      }
      if (!fr.body) {
        res.end()
        return
      }
      try {
        const stream = Readable.fromWeb(fr.body as import("stream/web").ReadableStream)
        stream.on("error", () => {
          if (!res.writableEnded) res.destroy()
        })
        res.on("close", () => stream.destroy())
        stream.pipe(res)
      } catch {
        res.statusCode = 502
        res.end("stream error")
      }
    })()
  }
}
