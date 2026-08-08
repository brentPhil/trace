import { describe, expect, it } from "vitest"
import { instantMovedToDay } from "./format-time"
import { dayOf } from "@shared/day"

/*
 * Moving an entry to another date, in instants.
 *
 * The composition is two lines, and both of the ways it can be wrong are
 * invisible until a particular week of the year: reading the local time in the
 * wrong zone, and resolving the new date without a DST policy.
 */

const LONDON = "Europe/London"
const KOLKATA = "Asia/Kolkata" // +05:30, no DST — catches a half-hour offset bug

describe("instantMovedToDay", () => {
  it("keeps the local time of day", () => {
    const at = Date.parse("2026-08-07T20:00:00Z") // 21:00 BST
    const moved = instantMovedToDay(at, "2026-08-05", LONDON)

    expect(dayOf(moved, LONDON)).toBe("2026-08-05")
    expect(moved).toBe(Date.parse("2026-08-05T20:00:00Z"))
  })

  it("is a no-op when the target is the day it is already on", () => {
    const at = Date.parse("2026-08-07T20:00:00Z")
    expect(instantMovedToDay(at, "2026-08-07", LONDON)).toBe(at)
  })

  it("re-resolves the offset rather than shifting by whole days", () => {
    // 09:00 GMT in January and 09:00 BST in August are different offsets from
    // UTC. Adding a multiple of 86,400,000 would land on 08:00 or 10:00.
    const august = Date.parse("2026-08-07T08:00:00Z") // 09:00 BST
    const moved = instantMovedToDay(august, "2026-01-15", LONDON)

    expect(dayOf(moved, LONDON)).toBe("2026-01-15")
    expect(moved).toBe(Date.parse("2026-01-15T09:00:00Z")) // 09:00 GMT
  })

  it("falls forward out of an hour that does not exist", () => {
    // Europe/London springs forward at 01:00 on 2026-03-29, so 01:30 never
    // happens. The entry has to land somewhere real rather than on a time the
    // clock skipped.
    const at = Date.parse("2026-08-07T00:30:00Z") // 01:30 BST
    const moved = instantMovedToDay(at, "2026-03-29", LONDON)

    expect(dayOf(moved, LONDON)).toBe("2026-03-29")
    expect(moved).toBe(Date.parse("2026-03-29T01:30:00Z")) // 02:30 BST
  })

  it("handles a half-hour zone", () => {
    const at = Date.parse("2026-08-07T03:30:00Z") // 09:00 IST
    const moved = instantMovedToDay(at, "2026-08-01", KOLKATA)

    expect(dayOf(moved, KOLKATA)).toBe("2026-08-01")
    expect(moved).toBe(Date.parse("2026-08-01T03:30:00Z"))
  })
})
