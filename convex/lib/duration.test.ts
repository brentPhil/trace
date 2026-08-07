import { describe, expect, it } from "vitest"
import {
  MAX_DURATION_MS,
  formatClock,
  formatCompactDuration,
  formatDecimalHours,
  msToIsoDuration,
  parseDuration,
  spokenDuration,
} from "./duration"

const ms = (input: string) => {
  const r = parseDuration(input)
  if (!r.ok) throw new Error(`expected "${input}" to parse, got ${r.reason}`)
  return r.ms
}
const MINUTE = 60_000
const HOUR = 3_600_000

describe("parseDuration — the documented table", () => {
  it("reads a bare integer as MINUTES", () => {
    expect(ms("90")).toBe(90 * MINUTE)
    expect(ms("5")).toBe(5 * MINUTE)
    expect(ms("1")).toBe(1 * MINUTE)
    expect(ms("480")).toBe(8 * HOUR)
  })

  it("reads a decimal as HOURS", () => {
    expect(ms("1.5")).toBe(90 * MINUTE)
    expect(ms("0.25")).toBe(15 * MINUTE)
    expect(ms("2.0")).toBe(2 * HOUR)
  })

  it("accepts a comma as the decimal separator", () => {
    expect(ms("1,5")).toBe(90 * MINUTE)
    expect(ms("0,25")).toBe(15 * MINUTE)
  })

  it("reads h:mm and h:mm:ss", () => {
    expect(ms("1:30")).toBe(90 * MINUTE)
    expect(ms("0:45")).toBe(45 * MINUTE)
    expect(ms("1:30:45")).toBe(HOUR + 30 * MINUTE + 45_000)
    expect(ms("12:00")).toBe(12 * HOUR)
  })

  it("lets explicit units win", () => {
    expect(ms("90m")).toBe(90 * MINUTE)
    expect(ms("1h")).toBe(HOUR)
    expect(ms("1h30")).toBe(90 * MINUTE)
    expect(ms("1h30m")).toBe(90 * MINUTE)
    expect(ms("1.5h")).toBe(90 * MINUTE)
    expect(ms("0.25h")).toBe(15 * MINUTE)
    expect(ms("45s")).toBe(45_000)
    expect(ms("1h 30m")).toBe(90 * MINUTE)
    expect(ms("1h30m15s")).toBe(HOUR + 30 * MINUTE + 15_000)
    expect(ms("90min")).toBe(90 * MINUTE)
    expect(ms("45sec")).toBe(45_000)
  })

  it("is whitespace and case insensitive", () => {
    expect(ms("  1H 30M  ")).toBe(90 * MINUTE)
    expect(ms(" 1:30 ")).toBe(90 * MINUTE)
  })

  /**
   * The asymmetric-risk choice, pinned as a test so it cannot drift: `8` must
   * be eight minutes. If this ever flips, every user who types a bare number
   * into a manual entry over-bills by 60x and may not notice.
   */
  it("never reads a bare integer as hours", () => {
    expect(ms("8")).toBe(8 * MINUTE)
    expect(ms("8")).not.toBe(8 * HOUR)
  })
})

describe("parseDuration — refusals", () => {
  it("refuses empty input", () => {
    expect(parseDuration("")).toEqual({ ok: false, reason: "empty" })
    expect(parseDuration("   ")).toEqual({ ok: false, reason: "empty" })
  })

  it("refuses anything it cannot read, rather than guessing", () => {
    for (const junk of ["abc", "1h2h", "--", "1:", ":30", "1:2:3:4", "1..5", "h", "1:99", "-5"]) {
      expect(parseDuration(junk).ok, junk).toBe(false)
    }
  })

  it("refuses more than 24 hours with a distinguishable reason", () => {
    // The caller offers "longer than a day — split it?" rather than an error.
    expect(parseDuration("25h")).toEqual({ ok: false, reason: "too-long" })
    expect(parseDuration("1500")).toEqual({ ok: false, reason: "too-long" })
    expect(parseDuration("24:00:01")).toEqual({ ok: false, reason: "too-long" })
  })

  it("accepts exactly 24 hours", () => {
    expect(ms("24h")).toBe(MAX_DURATION_MS)
  })
})

describe("formatClock", () => {
  it("pads minutes and seconds but not hours", () => {
    expect(formatClock(0)).toBe("0:00:00")
    expect(formatClock(45_000)).toBe("0:00:45")
    expect(formatClock(90 * MINUTE)).toBe("1:30:00")
    expect(formatClock(HOUR + 5 * MINUTE + 3_000)).toBe("1:05:03")
    expect(formatClock(12 * HOUR)).toBe("12:00:00")
  })

  it("never renders a negative clock", () => {
    expect(formatClock(-5000)).toBe("0:00:00")
  })
})

describe("formatCompactDuration", () => {
  it("matches the documented cases", () => {
    expect(formatCompactDuration(5 * HOUR + 44 * MINUTE)).toBe("5h 44m")
    expect(formatCompactDuration(2 * HOUR + 5 * MINUTE)).toBe("2h 05m")
    expect(formatCompactDuration(4 * HOUR)).toBe("4h")
    expect(formatCompactDuration(47 * MINUTE)).toBe("47m")
    expect(formatCompactDuration(45_000)).toBe("<1m")
    expect(formatCompactDuration(0)).toBe("<1m")
  })

  it("floors, never rounds", () => {
    // 59.9 seconds is not a minute. On a document beside an invoice,
    // over-statement is the failure that costs money.
    expect(formatCompactDuration(59_900)).toBe("<1m")
    expect(formatCompactDuration(119_900)).toBe("1m")
    expect(formatCompactDuration(HOUR - 1)).toBe("59m")
  })

  /**
   * The property the recap depends on: bullets in a block can never sum to
   * more than the block subtotal, because every part is floored and the whole
   * is floored from the true sum.
   */
  it("parts never exceed the whole", () => {
    const items = [1_234_567, 7_654_321, 999, 3_600_001, 59_999]
    const total = items.reduce((a, b) => a + b, 0)
    const partMinutes = items.reduce((a, b) => a + Math.floor(b / MINUTE), 0)
    expect(partMinutes).toBeLessThanOrEqual(Math.floor(total / MINUTE))
  })
})

describe("formatDecimalHours", () => {
  it("gives two decimal places, floored", () => {
    expect(formatDecimalHours(90 * MINUTE)).toBe("1.50")
    expect(formatDecimalHours(15 * MINUTE)).toBe("0.25")
    expect(formatDecimalHours(HOUR)).toBe("1.00")
    expect(formatDecimalHours(0)).toBe("0.00")
    // 47m13s = 0.78694... -> 0.78, not 0.79.
    expect(formatDecimalHours(47 * MINUTE + 13_000)).toBe("0.78")
  })

  it("never returns a negative", () => {
    expect(formatDecimalHours(-HOUR)).toBe("0.00")
  })
})

describe("spokenDuration", () => {
  it("reads as words, not as a clock time", () => {
    expect(spokenDuration(HOUR + 30 * MINUTE)).toBe("1 hour 30 minutes")
    expect(spokenDuration(2 * HOUR)).toBe("2 hours")
    expect(spokenDuration(MINUTE)).toBe("1 minute")
    expect(spokenDuration(45_000)).toBe("45 seconds")
    expect(spokenDuration(0)).toBe("0 seconds")
  })
})

describe("msToIsoDuration", () => {
  it("produces a valid ISO 8601 duration for the <time> element", () => {
    expect(msToIsoDuration(HOUR + 30 * MINUTE + 5_000)).toBe("PT1H30M5S")
    expect(msToIsoDuration(0)).toBe("PT0H0M0S")
  })
})

describe("round-trip", () => {
  it("every clock string this formats, it can also parse back", () => {
    // Zero is excluded: it formats to "0:00:00" and the parser refuses it, by
    // design — a zero-length entry is not a thing the user can commit.
    for (const value of [
      1_000,
      45_000,
      90 * MINUTE,
      HOUR + 5 * MINUTE + 3_000,
      12 * HOUR,
      24 * HOUR,
    ]) {
      expect(ms(formatClock(value)), formatClock(value)).toBe(value)
    }
  })

  it("refuses the one string it formats but cannot mean", () => {
    expect(formatClock(0)).toBe("0:00:00")
    expect(parseDuration("0:00:00")).toEqual({ ok: false, reason: "zero" })
  })
})
