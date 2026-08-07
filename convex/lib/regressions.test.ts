/**
 * Regressions found by adversarially attacking the pure time domain.
 *
 * Every case below was a real defect that shipped in the first cut of these
 * modules and was reproduced before being fixed. They live in one file, named
 * for what breaks rather than for the function, because the value of each is
 * the concrete consequence — and because a test whose name is a symptom is one
 * a future reader will not delete for looking redundant.
 */
import { describe, expect, it } from "vitest"
import { dayOf, dayWindow, addDays, parseDayString, weekWindow } from "./day"
import {
  formatClock,
  formatCompactDuration,
  formatDecimalHours,
  msToIsoDuration,
  parseDuration,
} from "./duration"
import { formatTimeOfDay, parseTimeOfDay, resolveEndAfterStart } from "./timeOfDay"
import { applyTimeEdit, crossesMidnight, elapsedMs, entryTimes } from "./entryTimes"

const MINUTE = 60_000
const HOUR = 3_600_000
const at = (iso: string) => Date.parse(iso)

describe("wrong money", () => {
  /**
   * `Math.floor(0.29 * 100)` is 28, because 0.29 * 100 is 28.999999999999996.
   * 144 of 2401 exact centihours came out 0.01 low — always low, never high —
   * on the number that goes onto an invoice.
   */
  it("formatDecimalHours does not understate an exact centihour", () => {
    expect(formatDecimalHours(1_044_000)).toBe("0.29") // was "0.28"
    expect(formatDecimalHours(2_052_000)).toBe("0.57") // was "0.56"
    expect(formatDecimalHours(4_068_000)).toBe("1.13") // was "1.12"
    expect(formatDecimalHours(29_520_000)).toBe("8.20") // was "8.19"
    expect(formatDecimalHours(7_236_000)).toBe("2.01") // was "2.00"
  })

  it("formatDecimalHours is exact across every centihour in a day", () => {
    for (let centihours = 0; centihours <= 2400; centihours++) {
      const ms = centihours * 36_000
      expect(formatDecimalHours(ms), `${centihours}`).toBe(
        (centihours / 100).toFixed(2)
      )
    }
  })

  it("formatDecimalHours never overstates, for any duration", () => {
    for (let ms = 0; ms < 24 * HOUR; ms += 7_919) {
      expect(Number(formatDecimalHours(ms))).toBeLessThanOrEqual(ms / HOUR)
    }
  })

  /**
   * "09" at 16:00 resolved to 21:00 via the nearest-reading rule, so
   * backfilling a 9-to-5 day committed twenty hours instead of eight — while
   * "0900" at the same moment gave 09:00.
   */
  it("a leading zero is an explicit hour, not a nearest-reading candidate", () => {
    const fourPm = 16 * 60
    for (const [input, expected] of [
      ["09", 9 * 60],
      ["08", 8 * 60],
      ["01", 1 * 60],
      ["00", 0],
    ] as const) {
      const r = parseTimeOfDay(input, fourPm)
      expect(r.ok && r.time.minutes, input).toBe(expected)
    }
    // Two spellings of one intention now agree.
    const compact = parseTimeOfDay("0900", fourPm)
    const short = parseTimeOfDay("09", fourPm)
    expect(compact.ok && compact.time).toEqual(short.ok && short.time)
  })

  /**
   * A mistyped year in the start field wrote a 584-day entry with no refusal.
   * The ceiling had been applied only to the field literally named "duration".
   */
  it("the 24-hour ceiling covers every edited field, not just duration", () => {
    const entry = entryTimes(at("2026-08-06T09:00:00Z"), at("2026-08-06T17:00:00Z"))
    if (!entry.ok) throw new Error("fixture")

    expect(
      applyTimeEdit(entry.times, { field: "start", value: at("2025-08-06T09:00:00Z") }, 0)
    ).toEqual({ ok: false, code: "DURATION_TOO_LONG" })

    expect(
      applyTimeEdit(entry.times, { field: "end", value: at("2027-08-06T17:00:00Z") }, 0)
    ).toEqual({ ok: false, code: "DURATION_TOO_LONG" })

    // A legitimate edit inside the ceiling still works.
    expect(
      applyTimeEdit(entry.times, { field: "end", value: at("2026-08-06T18:00:00Z") }, 0).ok
    ).toBe(true)
  })

  /**
   * "1,440" is a thousands-separated minute count pasted from a spreadsheet.
   * Reading it as 1.44 hours was a 16x under-record with a plausible echo.
   */
  it("a comma is only a decimal separator in the shape that cannot be a thousands group", () => {
    expect(parseDuration("1,5")).toEqual({ ok: true, ms: 90 * MINUTE })
    expect(parseDuration("0,25")).toEqual({ ok: true, ms: 15 * MINUTE })
    expect(parseDuration("1,440").ok).toBe(false) // was 1h 26m
    expect(parseDuration("2,000").ok).toBe(false)
    expect(parseDuration("1,234,567").ok).toBe(false)
  })

  /**
   * dayWindow("2026-02-31") was byte-identical to dayWindow("2026-03-03"), so
   * two day keys billed the same entries under a date that does not exist.
   */
  it("parseDayString rejects impossible calendar dates", () => {
    for (const bad of [
      "2026-02-31",
      "2025-02-29", // not a leap year
      "2026-04-31",
      "2026-06-31",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
    ]) {
      expect(() => parseDayString(bad), bad).toThrow()
    }
    expect(parseDayString("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 })
  })

  it("distinct day strings never produce identical windows", () => {
    const seen = new Map<string, string>()
    let day = "2026-01-01"
    for (let i = 0; i < 400; i++) {
      const w = dayWindow(day, "America/New_York")
      const fingerprint = `${w.fromMs}:${w.toMs}`
      expect(seen.has(fingerprint), `${day} collides with ${seen.get(fingerprint)}`).toBe(
        false
      )
      seen.set(fingerprint, day)
      day = addDays(day, 1)
    }
  })

  /** "1h99" committed 2h39m while "1:99" was refused — same fumble, two spellings. */
  it("rejects out-of-range minutes in the hours-then-minutes form", () => {
    expect(parseDuration("1h99").ok).toBe(false)
    expect(parseDuration("1h60").ok).toBe(false)
    expect(parseDuration("1h59")).toEqual({ ok: true, ms: HOUR + 59 * MINUTE })
    expect(parseDuration("1h09")).toEqual({ ok: true, ms: HOUR + 9 * MINUTE })
  })

  /** "4.1h30" produced 16559999.999999998 and displayed a minute short. */
  it("every parse branch returns an integer millisecond count", () => {
    for (const input of ["4.1h30", "2.3h15", "8.2h15", "1.5h", "0.1", "0.25h", "1,5"]) {
      const r = parseDuration(input)
      expect(r.ok, input).toBe(true)
      if (r.ok) expect(Number.isInteger(r.ms), `${input} -> ${r.ms}`).toBe(true)
    }
    // Two spellings of one duration agree.
    expect(parseDuration("4.1h30")).toEqual(parseDuration("4.1h 30m"))
  })
})

describe("wrong on screen", () => {
  /** One NaN clock put "NaN:NaN:NaN" where the elapsed time belongs. */
  it("no formatter ever emits NaN or Infinity", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatClock(bad)).toBe("0:00:00")
      expect(formatCompactDuration(bad)).toBe("<1m")
      expect(formatDecimalHours(bad)).toBe("0.00")
      expect(msToIsoDuration(bad)).toBe("PT0H0M0S")
    }
  })

  it("elapsedMs survives a non-finite clock", () => {
    const running = { startedAt: 0, endedAt: null, durationMs: null }
    expect(elapsedMs(running, Number.NaN)).toBe(0)
    expect(Number.isFinite(elapsedMs(running, Number.POSITIVE_INFINITY))).toBe(true)
  })

  /**
   * The row and the day header must not disagree. durationMs is what every
   * total sums, so it is also what the row reports.
   */
  it("elapsedMs reports the stored duration for a completed entry", () => {
    const drifted = { startedAt: 0, endedAt: 10 * MINUTE, durationMs: 7 * MINUTE }
    expect(elapsedMs(drifted, Date.now())).toBe(7 * MINUTE)
  })

  /**
   * The echo is the product's stated defence against a mis-parse, and it
   * rendered "12:00 AM -> 12:00 AM" for both a rejected zero-length entry and
   * an accepted 24-hour one.
   */
  it("a next-day time is marked in the echo", () => {
    expect(formatTimeOfDay({ minutes: 0, dayOffset: 1 }, true)).toBe("12:00 AM +1d")
    expect(formatTimeOfDay({ minutes: 0, dayOffset: 1 }, false)).toBe("00:00 +1d")
    expect(formatTimeOfDay({ minutes: 0, dayOffset: 0 }, true)).toBe("12:00 AM")
  })

  /** dayOffset 2 is outside the type's documented domain and meant >24h. */
  it("resolveEndAfterStart stays inside its 0 | 1 domain", () => {
    for (const startOffset of [0, 1]) {
      for (let s = 0; s < 1440; s += 37) {
        for (let e = 0; e < 1440; e += 41) {
          const start = { minutes: s, dayOffset: startOffset }
          const end = resolveEndAfterStart({ minutes: e, dayOffset: 0 }, start)
          const startAbs = startOffset * 1440 + s
          const endAbs = end.dayOffset * 1440 + end.minutes
          expect(endAbs, `${startOffset}/${s} -> ${e}`).toBeGreaterThan(startAbs)
          expect(endAbs - startAbs).toBeLessThanOrEqual(1440)
        }
      }
    }
  })

  /** Days are half-open: an entry ending at exactly midnight did not cross it. */
  it("crossesMidnight is false for an entry ending exactly at local midnight", () => {
    const inUtc = (ms: number) => dayOf(ms, "UTC")
    const upToMidnight = entryTimes(at("2026-08-06T22:00:00Z"), at("2026-08-07T00:00:00Z"))
    if (!upToMidnight.ok) throw new Error("fixture")
    expect(crossesMidnight(upToMidnight.times, inUtc)).toBe(false)

    const oneMsPast = entryTimes(at("2026-08-06T22:00:00Z"), at("2026-08-07T00:00:00.001Z"))
    if (!oneMsPast.ok) throw new Error("fixture")
    expect(crossesMidnight(oneMsPast.times, inUtc)).toBe(true)
  })

  /**
   * The inline hint enabled the confirm control and the save then threw from a
   * layer that had never seen the input.
   */
  it("zero durations are refused by the parser, not by the mutation", () => {
    for (const zero of ["0", "0m", "0h", "0:00", "0:00:00", "0s", "0.0", "0,0", "00"]) {
      expect(parseDuration(zero), zero).toEqual({ ok: false, reason: "zero" })
    }
  })
})

describe("silent coercion", () => {
  /** An ISO weekday (1-7) silently aliased 7 to Sunday, shifting every total. */
  it("weekWindow refuses a weekStartDay outside 0-6", () => {
    for (const bad of [7, 8, -1, 1.5, Number.NaN]) {
      expect(() => weekWindow("2026-08-06", "UTC", bad), String(bad)).toThrow(
        /weekStartDay/
      )
    }
    expect(weekWindow("2026-08-06", "UTC", 1).firstDay).toBe("2026-08-03")
  })

  /** DayString must be closed under addDays, or its own parser rejects it. */
  it("addDays emits strings parseDayString accepts", () => {
    for (const [day, delta] of [
      ["1000-01-01", -1],
      ["0100-01-01", -1],
      ["2026-12-31", 1],
      ["2024-02-28", 1],
    ] as const) {
      const next = addDays(day, delta)
      expect(() => parseDayString(next), `${day}${delta}`).not.toThrow()
      expect(next).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  /** The Date constructor maps years 0-99 to 1900+; "0050-06-15" is not 1950. */
  it("a two-digit year is not silently moved to the twentieth century", () => {
    expect(dayOf(dayWindow("0050-06-15", "UTC").fromMs, "UTC")).toBe("0050-06-15")
  })
})
