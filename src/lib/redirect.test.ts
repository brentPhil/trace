import { describe, expect, it } from "vitest"
import { safeRedirect } from "./redirect"

// Built via char codes so no invisible control byte ever lands in this file.
const NUL = String.fromCharCode(0x00)
const DEL = String.fromCharCode(0x7f)

describe("safeRedirect", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeRedirect("/timer")).toBe("/timer")
    expect(safeRedirect("/")).toBe("/")
    expect(safeRedirect("/a/b/c?x=1#frag")).toBe("/a/b/c?x=1#frag")
  })

  it("falls back when there is nothing usable", () => {
    expect(safeRedirect(undefined)).toBe("/")
    expect(safeRedirect(null)).toBe("/")
    expect(safeRedirect("")).toBe("/")
    expect(safeRedirect(42)).toBe("/")
    expect(safeRedirect({ toString: () => "/timer" })).toBe("/")
  })

  it("rejects absolute URLs to another origin", () => {
    expect(safeRedirect("https://evil.example")).toBe("/")
    expect(safeRedirect("http://evil.example/path")).toBe("/")
    expect(safeRedirect("//evil.example")).toBe("/")
  })

  it("rejects backslash forms browsers normalise to //", () => {
    expect(safeRedirect("/\\evil.example")).toBe("/")
    expect(safeRedirect("\\\\evil.example")).toBe("/")
  })

  it("rejects non-http schemes", () => {
    expect(safeRedirect("javascript:alert(1)")).toBe("/")
    expect(safeRedirect("data:text/html,<script>")).toBe("/")
  })

  // Escapes are written explicitly rather than as literal bytes: a raw NUL or
  // DEL in source is invisible in every editor and diff, which makes the test
  // unreadable and easy to break by accident.
  it("rejects control characters and whitespace used to smuggle values", () => {
    expect(safeRedirect("/timer\nSet-Cookie: x=1")).toBe("/")
    expect(safeRedirect("/timer\tmore")).toBe("/")
    expect(safeRedirect("/ /evil.example")).toBe("/")
    expect(safeRedirect(" /timer")).toBe("/")
    expect(safeRedirect(NUL + "/timer")).toBe("/")
    expect(safeRedirect("/timer" + DEL)).toBe("/")
  })

  it("honours a custom fallback", () => {
    expect(safeRedirect("https://evil.example", "/login")).toBe("/login")
    expect(safeRedirect(undefined, "/login")).toBe("/login")
  })
})
