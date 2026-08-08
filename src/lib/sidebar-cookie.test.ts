import { describe, expect, it } from "vitest"
import { parseSidebarOpen } from "./sidebar-cookie"

/*
 * SidebarProvider writes `sidebar_state` and never reads it back — the host app
 * is expected to. Without a server-side read, anyone who collapsed the rail is
 * served 16rem, hydrates at 3rem, and watches a 208px jump on every load.
 *
 * Open is the default: an absent cookie must mean expanded, so a first-time
 * visitor is not shown four unlabelled icons.
 */
describe("parseSidebarOpen", () => {
  it("defaults to open when there is no cookie header at all", () => {
    expect(parseSidebarOpen(undefined)).toBe(true)
  })

  it("defaults to open for an empty header", () => {
    expect(parseSidebarOpen("")).toBe(true)
  })

  it("is collapsed when the cookie says false", () => {
    expect(parseSidebarOpen("sidebar_state=false")).toBe(false)
  })

  it("is open when the cookie says true", () => {
    expect(parseSidebarOpen("sidebar_state=true")).toBe(true)
  })

  it("finds the cookie among others", () => {
    expect(parseSidebarOpen("theme=dark; sidebar_state=false; foo=1")).toBe(false)
  })

  /**
   * The reason this is a parser and not `cookie.includes("sidebar_state=false")`.
   * A different key ENDING in the same characters must not match.
   */
  it("does not match a different cookie whose name ends with the same text", () => {
    expect(parseSidebarOpen("my_sidebar_state=false")).toBe(true)
  })

  /** Nor a value that merely starts with "false". */
  it("does not match a value that only starts with false", () => {
    expect(parseSidebarOpen("sidebar_state=falsey")).toBe(true)
  })

  it("tolerates no space after the separator", () => {
    expect(parseSidebarOpen("a=1;sidebar_state=false")).toBe(false)
  })
})
