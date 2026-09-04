/** Production only: in dev a worker would serve stale modules over HMR. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
}

export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === "undefined") return
  for (const name of await caches.keys()) await caches.delete(name)
}
