import { describe, expect, it } from "vitest"
import {
  formatTimeOfDay,
  parseTimeOfDay,
  resolveEndAfterStart,
} from "./timeOfDay"

const at = (h: number, m = 0) => h * 60 + m

const parse = (input: string, now: number) => {
  const r = parseTimeOfDay(input, now)
  if (!r.ok) throw new Error(`expected "${input}" to parse, got ${r.reason}`)
  return r.time
}

describe("parseTimeOfDay — bare 1-11 picks the nearer reading", () => {
  it("picks AM when the clock is nearer to AM", () => {
    // 10:00 now. "9" is 09:00 (1h away), not 21:00 (11h away).
    expect(parse("9", at(10)).minutes).toBe(at(9))
  })

  it("picks PM when the clock is nearer to PM", () => {
    // 16:00 now. "5" is 17:00 (1h away), not 05:00 (11h away).
    expect(parse("5", at(16)).minutes).toBe(at(17))
  })

  it("wraps around midnight rather than measuring the long way", () => {
    // 00:30 now. "11" is 23:00 (1.5h away on the clock face), not 11:00.
    expect(parse("11", at(0, 30)).minutes).toBe(at(23))
  })

  it("resolves the mid-afternoon case a freelancer actually hits", () => {
    // 15:00 now, backfilling this morning: "9" must be 09:00.
    expect(parse("9", at(15)).minutes).toBe(at(9))
    // ...and "2" must be 14:00.
    expect(parse("2", at(15)).minutes).toBe(at(14))
  })
})

describe("parseTimeOfDay — the special hours", () => {
  it("reads 0 as midnight", () => {
    expect(parse("0", at(14))).toEqual({ minutes: 0, dayOffset: 0 })
  })

  it("resolves 12 by context, not by nearness", () => {
    // Both readings are exactly 12 hours apart, so nearness says nothing.
    expect(parse("12", at(6))).toEqual({ minutes: 0, dayOffset: 0 })
    expect(parse("12", at(10))).toEqual({ minutes: at(12), dayOffset: 0 })
    expect(parse("12", at(14))).toEqual({ minutes: at(12), dayOffset: 0 })
    expect(parse("12", at(22))).toEqual({ minutes: 0, dayOffset: 1 })
  })

  it("reads 13-23 as 24-hour", () => {
    expect(parse("13", at(9)).minutes).toBe(at(13))
    expect(parse("23", at(9)).minutes).toBe(at(23))
  })
})

describe("parseTimeOfDay — explicit forms always win", () => {
  it("honours a meridiem suffix regardless of now", () => {
    expect(parse("9a", at(16)).minutes).toBe(at(9))
    expect(parse("9am", at(16)).minutes).toBe(at(9))
    expect(parse("4p", at(3)).minutes).toBe(at(16))
    expect(parse("4pm", at(3)).minutes).toBe(at(16))
    expect(parse("9:30pm", at(3)).minutes).toBe(at(21, 30))
  })

  it("gets the 12am / 12pm inversion right", () => {
    expect(parse("12am", at(14)).minutes).toBe(0)
    expect(parse("12pm", at(2)).minutes).toBe(at(12))
    expect(parse("12:30am", at(14)).minutes).toBe(at(0, 30))
  })

  it("reads separated forms as written", () => {
    expect(parse("9:30", at(20)).minutes).toBe(at(9, 30))
    expect(parse("14:45", at(2)).minutes).toBe(at(14, 45))
    expect(parse("9.30", at(20)).minutes).toBe(at(9, 30))
  })

  it("reads compact three- and four-digit forms", () => {
    expect(parse("930", at(20)).minutes).toBe(at(9, 30))
    expect(parse("1430", at(2)).minutes).toBe(at(14, 30))
    expect(parse("0915", at(20)).minutes).toBe(at(9, 15))
  })

  it("is whitespace and case insensitive", () => {
    expect(parse("  4 PM ", at(3)).minutes).toBe(at(16))
  })
})

describe("parseTimeOfDay — refusals", () => {
  it("refuses empty input", () => {
    expect(parseTimeOfDay("", at(9))).toEqual({ ok: false, reason: "empty" })
  })

  it("refuses impossible and unreadable input", () => {
    for (const junk of ["24", "25", "9:60", "99:00", "abc", "13pm", "0pm", "2560", "-1"]) {
      expect(parseTimeOfDay(junk, at(9)).ok, junk).toBe(false)
    }
  })
})

describe("resolveEndAfterStart", () => {
  it("leaves an end that is already after the start alone", () => {
    const start = { minutes: at(9), dayOffset: 0 }
    const end = { minutes: at(17), dayOffset: 0 }
    expect(resolveEndAfterStart(end, start)).toEqual(end)
  })

  it("pushes an earlier end to the next day", () => {
    // "9" then "5" means 09:00 to 17:00 — but "22" then "2" means overnight.
    const start = { minutes: at(22), dayOffset: 0 }
    const end = { minutes: at(2), dayOffset: 0 }
    expect(resolveEndAfterStart(end, start)).toEqual({ minutes: at(2), dayOffset: 1 })
  })

  it("pushes an equal end forward, so a zero-length entry is impossible", () => {
    const start = { minutes: at(9), dayOffset: 0 }
    expect(resolveEndAfterStart({ minutes: at(9), dayOffset: 0 }, start)).toEqual({
      minutes: at(9),
      dayOffset: 1,
    })
  })

  it("makes a negative duration structurally impossible for any input pair", () => {
    for (const s of [0, at(9), at(22), 1439]) {
      for (const e of [0, at(2), at(9), at(17), 1439]) {
        const start = { minutes: s, dayOffset: 0 }
        const end = resolveEndAfterStart({ minutes: e, dayOffset: 0 }, start)
        const startAbs = start.dayOffset * 1440 + start.minutes
        const endAbs = end.dayOffset * 1440 + end.minutes
        expect(endAbs, `${s} -> ${e}`).toBeGreaterThan(startAbs)
      }
    }
  })
})

describe("formatTimeOfDay", () => {
  it("renders 24-hour with a padded hour", () => {
    expect(formatTimeOfDay({ minutes: at(9, 5), dayOffset: 0 }, false)).toBe("09:05")
    expect(formatTimeOfDay({ minutes: at(17, 30), dayOffset: 0 }, false)).toBe("17:30")
    expect(formatTimeOfDay({ minutes: 0, dayOffset: 0 }, false)).toBe("00:00")
  })

  it("renders 12-hour with the right meridiem at the boundaries", () => {
    expect(formatTimeOfDay({ minutes: at(9, 5), dayOffset: 0 }, true)).toBe("9:05 AM")
    expect(formatTimeOfDay({ minutes: at(17, 30), dayOffset: 0 }, true)).toBe("5:30 PM")
    expect(formatTimeOfDay({ minutes: 0, dayOffset: 0 }, true)).toBe("12:00 AM")
    expect(formatTimeOfDay({ minutes: at(12), dayOffset: 0 }, true)).toBe("12:00 PM")
  })
})
