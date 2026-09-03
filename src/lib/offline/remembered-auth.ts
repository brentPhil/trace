const KEY = "chroneli.rememberedAuth.v1"

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The root route asks the server for a token on every navigation. Offline,
 * that call throws, and the only honest answer is the last one the server
 * gave — which is what this remembers. It is a UX guard, not a security
 * boundary: every Convex function still checks the session itself.
 */
export function readRememberedAuth(): boolean {
  try {
    return storage()?.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function writeRememberedAuth(signedIn: boolean): void {
  try {
    if (signedIn) storage()?.setItem(KEY, "1")
    else storage()?.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function clearRememberedAuth(): void {
  writeRememberedAuth(false)
}
