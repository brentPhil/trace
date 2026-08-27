import { describe, expect, it } from "vitest"
import { Route } from "@/routes/desktop-login"

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
