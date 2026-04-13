import type { Connect } from "vite"

/**
 * Browser `fetch(__soundcloud-api/.../hls, { redirect: "manual" })` often cannot read `Location`
 * on the 302 (opaque / proxy behaviour), so stream resolution returns no CDN URL. Node here performs
 * the same signed GET with `redirect: "manual"` and returns `{ ok, url }` JSON.
 */
export function soundcloudStreamSignMiddleware(quiet: boolean): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathOnly = req.url?.split("?")[0] ?? ""
    if (pathOnly !== "/__soundcloud-sign-stream" || req.method !== "GET") {
      next()
      return
    }

    void (async () => {
      const sendJson = (code: number, body: Record<string, unknown>) => {
        if (!res.headersSent) {
          res.statusCode = code
          res.setHeader("Content-Type", "application/json; charset=utf-8")
          res.end(JSON.stringify(body))
        }
      }

      let rawUrl: string
      try {
        const q = new URL(req.url || "", "http://vite.local").searchParams.get("url")
        if (!q) {
          sendJson(400, { ok: false, error: "missing url" })
          return
        }
        rawUrl = q
      } catch {
        sendJson(400, { ok: false, error: "bad query" })
        return
      }

      let target: URL
      try {
        target = new URL(rawUrl)
      } catch {
        sendJson(400, { ok: false, error: "bad url" })
        return
      }
      if (target.hostname !== "api.soundcloud.com" || !target.pathname.includes("/streams/")) {
        sendJson(403, { ok: false, error: "url not allowed" })
        return
      }

      const auth = req.headers.authorization
      if (!auth || (!auth.startsWith("OAuth ") && !auth.startsWith("Bearer "))) {
        sendJson(401, { ok: false, error: "missing Authorization" })
        return
      }

      if (!quiet) {
        console.log(`\n[soundcloud-stream-sign] GET ${target.pathname.slice(0, 72)}…`)
      }

      let fr: Response
      try {
        fr = await fetch(rawUrl, {
          method: "GET",
          redirect: "manual",
          headers: { Authorization: auth, Accept: "*/*" },
        })
      } catch (e) {
        sendJson(502, { ok: false, error: e instanceof Error ? e.message : String(e) })
        return
      }

      if (fr.status >= 300 && fr.status < 400) {
        const loc = fr.headers.get("location")
        if (loc) {
          const absolute = loc.startsWith("http") ? loc : new URL(loc, target.origin).href
          if (!quiet) {
            console.log(`[soundcloud-stream-sign] → ${fr.status} Location ${absolute.slice(0, 80)}…`)
          }
          sendJson(200, { ok: true, url: absolute })
          return
        }
        sendJson(502, { ok: false, error: `redirect ${fr.status} without Location` })
        return
      }

      if (fr.ok) {
        const ct = (fr.headers.get("content-type") || "").toLowerCase()
        if (ct.includes("application/json")) {
          try {
            const j = (await fr.json()) as Record<string, unknown>
            const data = j.data && typeof j.data === "object" ? (j.data as Record<string, unknown>) : null
            const u =
              (typeof j.url === "string" && j.url) ||
              (typeof j.location === "string" && j.location) ||
              (data && typeof data.url === "string" && data.url) ||
              ""
            if (typeof u === "string" && u.startsWith("http")) {
              sendJson(200, { ok: true, url: u })
              return
            }
          } catch {
            /* fall through */
          }
        }
      }

      const text = (await fr.text().catch(() => "")).slice(0, 400)
      if (!quiet) {
        console.log(`[soundcloud-stream-sign] → ${fr.status} ${text.slice(0, 120)}`)
      }
      sendJson(fr.status >= 400 ? fr.status : 502, {
        ok: false,
        error: text || `HTTP ${fr.status}`,
      })
    })()
  }
}
