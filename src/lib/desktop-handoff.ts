/**
 * The two pieces of the desktop handoff that must not be got wrong by hand.
 *
 * The loopback URL is BUILT here rather than read from the query string. A
 * page that accepted a whole redirect target from its own URL and then
 * appended a session-granting token to it would be an open redirect with the
 * session attached — the one mistake in this flow that hands an account to
 * somebody else. This is a different problem from the one `safeRedirect` in
 * src/lib/redirect.ts solves, which is why it does not reuse it.
 */

/**
 * The literal loopback address. NEVER `localhost` — RFC 8252 §8.3 warns that
 * the name can resolve to a non-loopback interface, which would put a session
 * token on the network.
 */
const LOOPBACK_HOST = "127.0.0.1"

/**
 * A port the shell may legitimately have bound, or `null`.
 *
 * Deliberately strict: only an unsigned decimal integer in the unprivileged
 * range. `Number()` alone would accept "0x1234", " 52341 " and "52341.0".
 */
export function parsePort(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null
  const text = String(raw)
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
}

/** Where the browser sends the token so the shell can pick it up. */
export function loopbackCallbackUrl(
  port: number,
  token: string,
  state: string
): string {
  const query = new URLSearchParams({ token, state })
  return `http://${LOOPBACK_HOST}:${port}/callback?${query.toString()}`
}
