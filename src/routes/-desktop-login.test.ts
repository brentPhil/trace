import { describe, expect, it, vi } from "vitest"
import { Route } from "@/routes/desktop-login"

/*
 * The auth client is replaced wholesale so `beforeLoad` cannot reach a real
 * one. The mock is the assertion surface for the test at the bottom of this
 * file: `generate` must never be called during load, and a spy is the only way
 * to say that about code that is supposed to do nothing.
 *
 * `vi.hoisted` because `vi.mock` is hoisted above the imports; a plain `const`
 * declared here would not exist yet when the factory runs.
 */
const auth = vi.hoisted(() => ({
  generate: vi.fn(async () => ({ data: { token: "tok" }, error: null })),
}))
vi.mock("@/lib/auth-client", () => ({
  authClient: { oneTimeToken: { generate: auth.generate } },
}))

/**
 * The router hands `validateSearch` PARSED values, not raw strings.
 *
 * TanStack Router JSON-parses search params, so the shell's `?port=52341`
 * arrives as the NUMBER 52341. An earlier version tested `typeof === "string"`
 * here, which rejected every real port; `validateSearch` dropped the key and
 * the router then normalised it out of the URL entirely. Every sign-in died on
 * "this link is missing information from the desktop app" while the shell sat
 * waiting for a callback that could never arrive.
 *
 * `parsePort`'s own unit tests could not catch it — they call `parsePort`
 * directly and never cross the router. Only a live run did. This is the guard
 * that would have.
 */
describe("desktop-login validateSearch", () => {
  const validate = Route.options.validateSearch as (
    search: Record<string, unknown>
  ) => { port: unknown; state: string | undefined }

  it("keeps a port the router parsed into a number", () => {
    // The regression. A string-only check returns undefined here.
    expect(validate({ port: 52341, state: "abc" }).port).toBe(52341)
  })

  it("keeps a port that stayed a string", () => {
    expect(validate({ port: "52341", state: "abc" }).port).toBe("52341")
  })

  it("keeps the state alongside it", () => {
    expect(validate({ port: 52341, state: "abc" }).state).toBe("abc")
  })

  it("drops a port of a type no URL can produce", () => {
    expect(validate({ port: { nope: true }, state: "abc" }).port).toBeUndefined()
  })
})

/**
 * THE LAYER THE BLOCKER ACTUALLY HAPPENED ON.
 *
 * `-desktop-login-screen.test.tsx` pins the COMPONENT: no token is minted on
 * mount, only on the click. It cannot see this function at all — it renders
 * `DesktopLogin` directly and never crosses the route. So every version of the
 * bug that lived HERE leaves that file, and the whole dom project, green.
 *
 * Two distinct regressions want to come back to this spot, and both are the
 * "fast path" the design originally specified:
 *
 *   1. Minting in `beforeLoad`. It runs on the SERVER. Better Auth resolves
 *      its baseURL from `window`, so with no `window` it holds the bare string
 *      "/api/auth" and `oneTimeToken.generate()` throws
 *      `TypeError: Failed to parse URL` before reaching the network. That is
 *      not a `DesktopHandoffError`, so the route's error screen rethrows it and
 *      nothing above catches: a blank page for every signed-in handoff, and for
 *      the email/password path too, since submitting re-enters this route
 *      authenticated. An absolute baseURL would only have traded the crash for
 *      a 401 — an SSR fetch carries none of the browser's cookies.
 *   2. `throw redirect(...)` straight to the loopback URL. That is the silent
 *      session export: the URL landing here is authored by whoever opened the
 *      browser and names both the port and the state, so a zero-click path
 *      hands a live token to any local process that asks. The click is what
 *      stands in for the missing PKCE verifier.
 *
 * Hence all three assertions rather than one: a value returned, nothing thrown,
 * and nothing minted.
 */
describe("desktop-login beforeLoad", () => {
  const beforeLoad = Route.options.beforeLoad as (opts: {
    search: { port: number; state: string }
    context: { isAuthenticated: boolean }
  }) => { port: number; state: string }

  // `isAuthenticated: true` is the case both regressions were written for: the
  // browser that already holds a session is the one with something to export.
  const signedIn = {
    search: { port: 52341, state: "abc" },
    context: { isAuthenticated: true },
  }

  it("passes the handshake through to the component and does not throw", () => {
    expect(beforeLoad(signedIn)).toEqual({ port: 52341, state: "abc" })
  })

  it("mints nothing during load, session or no session", () => {
    beforeLoad(signedIn)
    expect(auth.generate).not.toHaveBeenCalled()
  })
})
