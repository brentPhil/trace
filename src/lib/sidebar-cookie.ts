import { createIsomorphicFn } from "@tanstack/react-start"
import { getCookie } from "@tanstack/react-start/server"

const COOKIE_NAME = "sidebar_state"

/**
 * Whether the sidebar should render expanded, given a raw Cookie header.
 *
 * Split out from the read below so it can be tested without a request or a
 * document. The regex anchors on a cookie boundary at the front and a value
 * boundary at the back, because a substring test would match `my_sidebar_state`
 * and `falsey` — both of which are legal cookies that mean nothing to us.
 *
 * Absent means OPEN. A first-time visitor has no cookie and must not be shown
 * four unlabelled icons.
 */
export function parseSidebarOpen(cookieHeader: string | undefined): boolean {
  if (cookieHeader === undefined || cookieHeader === "") return true
  return !new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=false(?:\\s*;|\\s*$)`).test(
    cookieHeader
  )
}

/**
 * Reads the persisted state on either side of the wire.
 *
 * `createIsomorphicFn` splits the bundle, so the `/server` import never reaches
 * the browser. Deliberately NOT a `createServerFn`: that is a network round trip
 * on every client navigation to read a cookie the browser already holds.
 *
 * Reading a cookie during SSR is safe in a way that reading a TIMEZONE is not
 * (see the implementation plan's section 5.9) — a cookie travels with the
 * request, so the server and the client observe the same value.
 */
export const readSidebarOpen = createIsomorphicFn()
  .server(() => getCookie(COOKIE_NAME) !== "false")
  .client(() => parseSidebarOpen(document.cookie))
