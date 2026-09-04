/// <reference lib="webworker" />
import { decide } from "./routing"

declare const self: ServiceWorkerGlobalScope

const CACHE = "chroneli-v1"

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chroneli · Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:#fafafa;color:#0a0a0a}main{max-width:32rem;padding:2rem;text-align:center}p{color:#52525b}@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#fafafa}p{color:#a1a1aa}}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online. The timer page usually has.</p><p><a href="/timer" style="color:inherit">Go to the timer</a></p></main></body></html>`

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })()
  )
})

/** Cache-Control the response asked us to respect. The Cache API does not
 *  honour these on its own — a worker that stores a `no-store` document has
 *  simply ignored the server. This app dehydrates real entries, titles and
 *  notes into its SSR HTML, so that is not a technicality. */
function mayStore(response: Response): boolean {
  const control = response.headers.get("cache-control") ?? ""
  return !/no-store|private/i.test(control)
}

/**
 * NO SHARED SHELL.
 *
 * An earlier version kept the last good page under one key and served it for
 * any navigation with no entry of its own. That paints the previous route's
 * fully-dehydrated payload at the wrong URL — `/reports` hydrating against
 * data dehydrated for `/timer` — and it fires BEFORE the app can render the
 * pending screen, so the honest "not opened on this device yet" message was
 * preempted by another page's data. It also made `OFFLINE_HTML` unreachable
 * once any navigation had succeeded, since the shell always matched first.
 *
 * A URL that was never visited gets the offline page instead. It carries no
 * user data, says what it does not know, and offers the one route that is
 * almost certainly cached.
 */
async function networkFirstNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    const isHtml = (response.headers.get("content-type") ?? "").includes("text/html")
    if (response.ok && isHtml && mayStore(response)) {
      await cache.put(request, response.clone())
    }
    return response
  } catch {
    return (
      (await cache.match(request)) ??
      new Response(OFFLINE_HTML, {
        // 503, not 200: this is not the page that was asked for, and saying
        // 200 would tell the browser and any crawler that it was.
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    )
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit !== undefined) return hit
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
    return response
  } catch {
    // An uncached hashed asset while offline — a chunk for a route never
    // visited. Answering 504 lets the app show its own failure; letting the
    // promise reject puts a console error there instead and nothing else.
    return new Response("", { status: 504 })
  }
}

async function staleWhileRevalidate(request: Request, event: FetchEvent): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  if (hit !== undefined) {
    // Handed to the event so the browser does not terminate the worker
    // before the refreshed copy lands.
    event.waitUntil(refresh)
    return hit
  }
  const fresh = await refresh
  if (fresh !== undefined) return fresh
  return new Response("", { status: 504 })
}

self.addEventListener("fetch", (event) => {
  const decision = decide(event.request, self.location.origin)
  if (decision === "bypass") return
  if (decision === "navigation") event.respondWith(networkFirstNavigation(event.request))
  else if (decision === "asset") event.respondWith(cacheFirst(event.request))
  else event.respondWith(staleWhileRevalidate(event.request, event))
})
