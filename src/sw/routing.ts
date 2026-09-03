export type Decision = "bypass" | "navigation" | "asset" | "public"

const BYPASS_PREFIXES = ["/api/", "/_serverFn/"]

/**
 * What the service worker does with one request. Pure, so it is testable
 * without a worker: the worker in ./index.ts only carries these out.
 */
export function decide(
  request: { url: string; method: string; mode: string },
  origin: string
): Decision {
  if (request.method !== "GET") return "bypass"
  const url = new URL(request.url)
  if (url.origin !== origin) return "bypass"
  if (url.pathname === "/sw.js") return "bypass"
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return "bypass"
  if (request.mode === "navigate") return "navigation"
  if (url.pathname.startsWith("/assets/")) return "asset"
  return "public"
}
