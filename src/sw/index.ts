/// <reference lib="webworker" />
import { decide } from "./routing"

declare const self: ServiceWorkerGlobalScope

const CACHE = "chroneli-v1"
const SHELL_KEY = "/__shell"

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chroneli · Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:#0a0a0a;color:#fafafa}main{max-width:32rem;padding:2rem;text-align:center}p{color:#a1a1aa}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online. The timer page usually has.</p><p><a href="/timer" style="color:inherit">Go to the timer</a></p></main></body></html>`

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

async function networkFirstNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
      await cache.put(request, response.clone())
      // The last good page doubles as the shell for a URL never cached.
      await cache.put(SHELL_KEY, response.clone())
    }
    return response
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(SHELL_KEY)) ??
      new Response(OFFLINE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    )
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit !== undefined) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  if (hit !== undefined) return hit
  const fresh = await refresh
  if (fresh !== undefined) return fresh
  return new Response("", { status: 504 })
}

self.addEventListener("fetch", (event) => {
  const decision = decide(event.request, self.location.origin)
  if (decision === "bypass") return
  if (decision === "navigation") event.respondWith(networkFirstNavigation(event.request))
  else if (decision === "asset") event.respondWith(cacheFirst(event.request))
  else event.respondWith(staleWhileRevalidate(event.request))
})
