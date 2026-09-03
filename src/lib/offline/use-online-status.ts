import { useSyncExternalStore } from "react"
import { useConvexConnectionState } from "convex/react"
import { isOffline } from "./online"

function subscribeNavigator(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** True when a write can reach the server. Needs the Convex provider above it. */
export function useOnlineStatus(): boolean {
  const state = useConvexConnectionState()
  const navigatorOnline = useSyncExternalStore(
    subscribeNavigator,
    () => navigator.onLine,
    () => true
  )
  return !isOffline(state, navigatorOnline)
}
