/**
 * "Can a write reach the server right now?"
 *
 * Two witnesses, because each lies in its own way: `navigator.onLine` is
 * true on a Wi-Fi network with no internet, and the Convex socket is closed
 * for the first few hundred milliseconds of every boot. The browser saying
 * offline is final. Otherwise a socket that WAS connected and has dropped is
 * offline on its first failed retry, while a socket that has never connected
 * gets two tries before the status line says anything.
 */
export function isOffline(
  state: { isWebSocketConnected: boolean; hasEverConnected: boolean; connectionRetries: number },
  navigatorOnline: boolean
): boolean {
  if (!navigatorOnline) return true
  if (state.isWebSocketConnected) return false
  return state.hasEverConnected ? state.connectionRetries > 0 : state.connectionRetries >= 2
}
