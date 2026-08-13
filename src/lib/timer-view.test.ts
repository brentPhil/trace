/**
 * `localStorage` is a browser object, and the `unit` project runs in Node —
 * so this one file asks for jsdom, the way Vitest's per-file docblock allows.
 * Renaming it `.test.tsx` to fall into the `dom` project would be a lie: there
 * is no component here and no JSX.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TIMER_NOTES_KEY,
  TIMER_VIEW_KEY,
  readStoredNotes,
  readStoredView,
  writeStoredNotes,
  writeStoredView,
} from "@/lib/timer-view"

/*
 * The stored view.
 *
 * What is worth asserting is not the round trip — it is the two failures that
 * would otherwise take the page down with them: a value nobody wrote, and a
 * `localStorage` that throws. Safari's private mode throws on `setItem`, and a
 * browser set to block site data throws on touching the object at all.
 */

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe("the remembered view", () => {
  it("round-trips a view", () => {
    writeStoredView("calendar")
    expect(window.localStorage.getItem(TIMER_VIEW_KEY)).toBe("calendar")
    expect(readStoredView()).toBe("calendar")
  })

  it("has no opinion when nothing is stored", () => {
    expect(readStoredView()).toBeNull()
  })

  it("refuses a value that is not one of the two views", () => {
    // Anything can write to this key — an older build, another tab, a user with
    // devtools open. `"summary"` is not a view this page has, and adopting it
    // would leave the page rendering neither branch.
    window.localStorage.setItem(TIMER_VIEW_KEY, "summary")
    expect(readStoredView()).toBeNull()
  })

  it("survives a localStorage that throws on read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("The operation is insecure.")
    })
    expect(readStoredView()).toBeNull()
  })

  it("survives a localStorage that throws on write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(() => writeStoredView("list")).not.toThrow()
  })
})

/*
 * The stored note mode, which is the same three failures again — plus one this
 * preference has and the view does not: it is a BOOLEAN, and the obvious
 * spelling of a stored boolean is the string `"false"`, which is truthy. The
 * named values exist so that a value nobody wrote can be refused rather than
 * coerced into pinning every note open.
 */
describe("the remembered note mode", () => {
  it("round-trips both directions", () => {
    writeStoredNotes(true)
    expect(window.localStorage.getItem(TIMER_NOTES_KEY)).toBe("full")
    expect(readStoredNotes()).toBe(true)

    writeStoredNotes(false)
    expect(window.localStorage.getItem(TIMER_NOTES_KEY)).toBe("clipped")
    expect(readStoredNotes()).toBe(false)
  })

  it("has no opinion when nothing is stored", () => {
    expect(readStoredNotes()).toBeNull()
  })

  it("refuses a value that is not one of the two modes", () => {
    // `"false"` in particular: a stored boolean written the obvious way is a
    // truthy string, and coercing it would turn "clipped" into "full" for
    // everyone whose key came from an older build or another tab.
    window.localStorage.setItem(TIMER_NOTES_KEY, "false")
    expect(readStoredNotes()).toBeNull()
  })

  it("survives a localStorage that throws on read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("The operation is insecure.")
    })
    expect(readStoredNotes()).toBeNull()
  })

  it("survives a localStorage that throws on write", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(() => writeStoredNotes(true)).not.toThrow()
  })
})
