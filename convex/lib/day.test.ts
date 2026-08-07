import { describe, expect, it } from "vitest"
import {
  addDays,
  dayOf,
  dayWindow,
  instantOfLocal,
  isValidTimeZone,
  localPartsOf,
  parseDayString,
  startOfDay,
  weekWindow,
  weekdayOf,
} from "./day"

/** Readability helper: these tests are about instants, and ISO is how you read one. */
const at = (iso: string) => Date.parse(iso)
const iso = (ms: number) => new Date(ms).toISOString()

const HOUR = 3_600_000

describe("instantOfLocal — unambiguous", () => {
  it("resolves a plain UTC time", () => {
    expect(instantOfLocal(2026, 8, 6, 9, 12, 0, "UTC")).toBe(
      at("2026-08-06T09:12:00Z")
    )
  })

  it("resolves a positive offset", () => {
    // Asia/Tokyo is UTC+9 year round.
    expect(instantOfLocal(2026, 8, 6, 9, 0, 0, "Asia/Tokyo")).toBe(
      at("2026-08-06T00:00:00Z")
    )
  })

  it("resolves a negative offset", () => {
    // Europe/London in August is BST, UTC+1.
    expect(instantOfLocal(2026, 8, 6, 9, 0, 0, "Europe/London")).toBe(
      at("2026-08-06T08:00:00Z")
    )
  })

  it("resolves a half-hour offset zone", () => {
    // Asia/Kolkata is UTC+5:30, no DST. The zone that breaks hourly crons.
    expect(instantOfLocal(2026, 8, 6, 17, 30, 0, "Asia/Kolkata")).toBe(
      at("2026-08-06T12:00:00Z")
    )
  })

  it("resolves a three-quarter-hour offset zone", () => {
    // Asia/Kathmandu is UTC+5:45.
    expect(instantOfLocal(2026, 8, 6, 5, 45, 0, "Asia/Kathmandu")).toBe(
      at("2026-08-06T00:00:00Z")
    )
  })
})

/**
 * The autumn fold. A local time occurs twice, and the policy is the FIRST.
 *
 * Both zones below are tested because the obvious two-pass implementation
 * satisfies the policy in one and inverts it in the other, depending on the
 * sign of the offset — and nothing in that code tells you which you are in.
 */
describe("instantOfLocal — ambiguous (DST fall-back) resolves to the first occurrence", () => {
  it("Europe/London, 25 Oct 2026 (02:00 BST -> 01:00 GMT)", () => {
    // 01:30 local happens at 00:30Z (BST) and again at 01:30Z (GMT).
    const result = instantOfLocal(2026, 10, 25, 1, 30, 0, "Europe/London")
    expect(iso(result)).toBe("2026-10-25T00:30:00.000Z")

    // Both candidates really are valid — proving this is a genuine fold and
    // not an accident of the implementation.
    expect(localPartsOf(at("2026-10-25T00:30:00Z"), "Europe/London").hour).toBe(1)
    expect(localPartsOf(at("2026-10-25T01:30:00Z"), "Europe/London").hour).toBe(1)
  })

  it("America/New_York, 1 Nov 2026 (02:00 EDT -> 01:00 EST)", () => {
    // 01:30 local happens at 05:30Z (EDT) and again at 06:30Z (EST).
    const result = instantOfLocal(2026, 11, 1, 1, 30, 0, "America/New_York")
    expect(iso(result)).toBe("2026-11-01T05:30:00.000Z")

    expect(localPartsOf(at("2026-11-01T05:30:00Z"), "America/New_York").hour).toBe(1)
    expect(localPartsOf(at("2026-11-01T06:30:00Z"), "America/New_York").hour).toBe(1)
  })

  it("Australia/Sydney, 5 Apr 2026 (03:00 AEDT -> 02:00 AEST) — southern hemisphere", () => {
    const result = instantOfLocal(2026, 4, 5, 2, 30, 0, "Australia/Sydney")
    expect(iso(result)).toBe("2026-04-04T15:30:00.000Z")
  })
})

/**
 * The spring gap. A local time never occurs, and the policy is to fall FORWARD
 * past the gap — matching `new Date(y, m, d, h, mi)` and Temporal's
 * "compatible" disambiguation. Falling backward would silently move work to
 * before it happened.
 */
describe("instantOfLocal — nonexistent (DST spring-forward) falls forward", () => {
  it("America/New_York, 8 Mar 2026 (02:00 EST -> 03:00 EDT)", () => {
    // 02:30 does not exist. Resolves to 03:30 EDT.
    const result = instantOfLocal(2026, 3, 8, 2, 30, 0, "America/New_York")
    expect(iso(result)).toBe("2026-03-08T07:30:00.000Z")
    expect(localPartsOf(result, "America/New_York").hour).toBe(3)
    expect(localPartsOf(result, "America/New_York").minute).toBe(30)
  })

  it("Europe/London, 29 Mar 2026 (01:00 GMT -> 02:00 BST)", () => {
    // 01:30 does not exist. Resolves to 02:30 BST.
    const result = instantOfLocal(2026, 3, 29, 1, 30, 0, "Europe/London")
    expect(iso(result)).toBe("2026-03-29T01:30:00.000Z")
    expect(localPartsOf(result, "Europe/London").hour).toBe(2)
  })

  it("Australia/Sydney, 4 Oct 2026 (02:00 AEST -> 03:00 AEDT)", () => {
    const result = instantOfLocal(2026, 10, 4, 2, 30, 0, "Australia/Sydney")
    expect(localPartsOf(result, "Australia/Sydney").hour).toBe(3)
    expect(localPartsOf(result, "Australia/Sydney").minute).toBe(30)
  })
})

/**
 * The scenario this whole file exists to prevent: an hour of phantom billable
 * time, produced twice a year, in every zone that observes DST.
 */
describe("the fall-back billing scenario", () => {
  it("a 45-minute entry across the London fold stays 45 minutes", () => {
    const startedAt = instantOfLocal(2026, 10, 25, 0, 45, 0, "Europe/London")
    const endedAt = instantOfLocal(2026, 10, 25, 1, 30, 0, "Europe/London")

    expect(endedAt - startedAt).toBe(45 * 60_000)
    // Not 1h45m, which is what picking the second occurrence of 01:30 gives.
    expect(endedAt - startedAt).not.toBe(105 * 60_000)
  })
})

describe("dayOf", () => {
  it("uses the zone, not the runtime's locale or offset", () => {
    const instant = at("2026-08-06T23:30:00Z")
    expect(dayOf(instant, "UTC")).toBe("2026-08-06")
    expect(dayOf(instant, "Asia/Tokyo")).toBe("2026-08-07") // +9 -> next day
    expect(dayOf(instant, "America/Los_Angeles")).toBe("2026-08-06") // -7
  })

  it("zero-pads months and days", () => {
    expect(dayOf(at("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05")
  })

  it("holds at the extreme offsets", () => {
    // Pacific/Kiritimati is UTC+14, the furthest ahead zone there is.
    expect(dayOf(at("2026-08-06T10:00:00Z"), "Pacific/Kiritimati")).toBe("2026-08-07")
    // Pacific/Niue is UTC-11, the furthest behind.
    expect(dayOf(at("2026-08-06T10:00:00Z"), "Pacific/Niue")).toBe("2026-08-05")
  })

  it("does not report hour 24 at local midnight", () => {
    // Some ICU builds emit "24" under a 24-hour cycle. If that leaked through,
    // an entry at midnight would land on the wrong day.
    const midnight = instantOfLocal(2026, 8, 6, 0, 0, 0, "Europe/London")
    expect(localPartsOf(midnight, "Europe/London").hour).toBe(0)
    expect(dayOf(midnight, "Europe/London")).toBe("2026-08-06")
  })
})

describe("round-trip", () => {
  const zones = [
    "UTC",
    "Europe/London",
    "America/New_York",
    "Asia/Tokyo",
    "Asia/Kolkata",
    "Australia/Sydney",
    "Pacific/Kiritimati",
    "America/Sao_Paulo",
  ]

  it("startOfDay lands on the day it was asked for, in every zone", () => {
    for (const zone of zones) {
      for (const day of ["2026-01-01", "2026-03-08", "2026-06-15", "2026-10-25", "2026-12-31"]) {
        expect(dayOf(startOfDay(day, zone), zone), `${zone} ${day}`).toBe(day)
      }
    }
  })
})

describe("dayWindow", () => {
  it("is half-open — midnight belongs to the day beginning", () => {
    const { fromMs, toMs } = dayWindow("2026-08-06", "UTC")
    expect(iso(fromMs)).toBe("2026-08-06T00:00:00.000Z")
    expect(iso(toMs)).toBe("2026-08-07T00:00:00.000Z")
    expect(dayOf(fromMs, "UTC")).toBe("2026-08-06")
    expect(dayOf(toMs, "UTC")).toBe("2026-08-07")
  })

  it("is 24 hours on an ordinary day", () => {
    const { fromMs, toMs } = dayWindow("2026-08-06", "Europe/London")
    expect(toMs - fromMs).toBe(24 * HOUR)
  })

  it("is 23 hours on a spring-forward day", () => {
    const { fromMs, toMs } = dayWindow("2026-03-29", "Europe/London")
    expect(toMs - fromMs).toBe(23 * HOUR)
  })

  it("is 25 hours on a fall-back day", () => {
    const { fromMs, toMs } = dayWindow("2026-10-25", "Europe/London")
    expect(toMs - fromMs).toBe(25 * HOUR)
  })

  it("consecutive days abut exactly, with no gap and no overlap", () => {
    // If these ever drift apart, an entry falls into no day or into two.
    for (const zone of ["Europe/London", "America/New_York", "Australia/Sydney"]) {
      let day = "2026-03-27"
      for (let i = 0; i < 6; i++) {
        const next = addDays(day, 1)
        expect(dayWindow(day, zone).toMs, `${zone} ${day}`).toBe(
          dayWindow(next, zone).fromMs
        )
        day = next
      }
    }
  })
})

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-08-06", 1)).toBe("2026-08-07")
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29") // leap year
  })
})

describe("weekdayOf", () => {
  it("returns 0 for Sunday", () => {
    expect(weekdayOf("2026-08-09")).toBe(0) // a Sunday
    expect(weekdayOf("2026-08-10")).toBe(1)
    expect(weekdayOf("2026-08-06")).toBe(4) // a Thursday
  })
})

describe("weekWindow", () => {
  it("honours a Monday week start", () => {
    const w = weekWindow("2026-08-06", "UTC", 1) // Thursday
    expect(w.firstDay).toBe("2026-08-03") // Monday
    expect(w.lastDay).toBe("2026-08-09") // Sunday
  })

  it("honours a Sunday week start", () => {
    const w = weekWindow("2026-08-06", "UTC", 0)
    expect(w.firstDay).toBe("2026-08-02")
    expect(w.lastDay).toBe("2026-08-08")
  })

  it("returns the same week when the day IS the first day", () => {
    const w = weekWindow("2026-08-03", "UTC", 1)
    expect(w.firstDay).toBe("2026-08-03")
  })

  it("spans exactly seven local days across a DST transition", () => {
    const w = weekWindow("2026-10-25", "Europe/London", 1)
    // 7 days, one of which is 25 hours long.
    expect(w.toMs - w.fromMs).toBe(7 * 24 * HOUR + HOUR)
  })
})

describe("parseDayString", () => {
  it("rejects anything that is not YYYY-MM-DD", () => {
    // Returning the wrong entries is worse than throwing.
    expect(() => parseDayString("2026-8-6")).toThrow()
    expect(() => parseDayString("06/08/2026")).toThrow()
    expect(() => parseDayString("")).toThrow()
    expect(() => parseDayString("2026-13-01")).toThrow()
    expect(() => parseDayString("2026-00-01")).toThrow()
    expect(() => parseDayString("2026-01-32")).toThrow()
  })

  it("accepts a valid date", () => {
    expect(parseDayString("2026-08-06")).toEqual({ year: 2026, month: 8, day: 6 })
  })
})

describe("isValidTimeZone", () => {
  it("accepts real IANA names and rejects junk", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true)
    expect(isValidTimeZone("UTC")).toBe(true)
    expect(isValidTimeZone("Not/AZone")).toBe(false)
    expect(isValidTimeZone("")).toBe(false)
  })
})
