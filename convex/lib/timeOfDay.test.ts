import { describe, expect, it } from "vitest"
import {
  TIME_HELP,
  formatTimeOfDay,
  parseTimeOfDay,
  parseEndTime,
  parseStartTime,
  resolveEndAfterStart,
  resolveInterval,
  timeFieldHelp,
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

describe("parseEndTime", () => {
  /*
   * The whole point of this function, and the case `resolveEndAfterStart`'s
   * docstring has always claimed while nothing asserted it: a 9-to-5 day.
   *
   * Parsing an end with the plain nearest-reading rule got this wrong, because
   * "nearest to 09:00" picks 05:00 over 17:00 (4 hours away versus 8), and
   * pushing THAT past the start lands at 05:00 the following day — a 20-hour
   * entry from two keystrokes. An end is not a free-floating time of day; it
   * is bounded below by its start, and that bound has to be applied while the
   * reading is chosen, not after.
   */
  it("reads a bare end hour as the first one at or after the start", () => {
    const start = { minutes: at(9), dayOffset: 0 }
    const result = parseEndTime("5", start)
    expect(result.ok && result.time).toEqual({ minutes: at(17), dayOffset: 0 })
  })

  it("still reads a genuine overnight end as the next day", () => {
    const start = { minutes: at(22), dayOffset: 0 }
    const result = parseEndTime("2", start)
    expect(result.ok && result.time).toEqual({ minutes: at(2), dayOffset: 1 })
  })

  it("resolves a bare 12 by the start, not by a working-day guess", () => {
    // Lunch after a 09:00 start is noon...
    expect(parseEndTime("12", { minutes: at(9), dayOffset: 0 })).toEqual({
      ok: true,
      time: { minutes: at(12), dayOffset: 0 },
    })
    // ...but after a 13:00 start the only 12 still ahead is midnight.
    expect(parseEndTime("12", { minutes: at(13), dayOffset: 0 })).toEqual({
      ok: true,
      time: { minutes: 0, dayOffset: 1 },
    })
  })

  it("leaves an unambiguous end exactly as typed", () => {
    const start = { minutes: at(9), dayOffset: 0 }
    // Explicit meridiem, 24-hour, and compact h:mm are not guesses.
    expect(parseEndTime("5pm", start)).toEqual({
      ok: true,
      time: { minutes: at(17), dayOffset: 0 },
    })
    expect(parseEndTime("17", start)).toEqual({
      ok: true,
      time: { minutes: at(17), dayOffset: 0 },
    })
    expect(parseEndTime("1730", start)).toEqual({
      ok: true,
      time: { minutes: at(17) + 30, dayOffset: 0 },
    })
    // An explicit 05:00 after a 09:00 start really is overnight.
    expect(parseEndTime("5am", start)).toEqual({
      ok: true,
      time: { minutes: at(5), dayOffset: 1 },
    })
  })

  it("never produces an end at or before the start, for any pair", () => {
    const inputs = ["1", "5", "9", "11", "12", "0", "17", "23", "930", "5pm", "5am"]
    for (const s of [0, at(9), at(13), at(22), 1439]) {
      for (const input of inputs) {
        const start = { minutes: s, dayOffset: 0 }
        const result = parseEndTime(input, start)
        if (!result.ok) continue
        const endAbs = result.time.dayOffset * 1440 + result.time.minutes
        expect(endAbs, `${s} -> ${input}`).toBeGreaterThan(s)
        // And never so far ahead that the backend's 24-hour ceiling refuses it.
        expect(endAbs - s, `${s} -> ${input}`).toBeLessThanOrEqual(1440)
      }
    }
  })

  it("rejects what parseTimeOfDay rejects", () => {
    const start = { minutes: at(9), dayOffset: 0 }
    for (const junk of ["24", "9:60", "abc", "13pm", ""]) {
      expect(parseEndTime(junk, start).ok, junk).toBe(false)
    }
  })
})

describe("parseStartTime", () => {
  it("reads exactly what parseTimeOfDay reads, for anything already on day 0", () => {
    for (const input of ["9", "09", "930", "1430", "5pm", "0", "23"]) {
      const clamped = parseStartTime(input, at(16))
      const plain = parseTimeOfDay(input, at(16))
      expect(clamped, input).toEqual(plain)
    }
  })

  /*
   * A start belongs to the day it is filed under; the calendar is what moves
   * an entry. A bare `12` late in the evening is the one input `parseTimeOfDay`
   * pushes to the following day, and over a START field that would silently
   * file the entry a day later than the one on screen.
   */
  it("pins the reading to the chosen day, which parseTimeOfDay does not", () => {
    expect(parseTimeOfDay("12", at(21))).toEqual({
      ok: true,
      time: { minutes: 0, dayOffset: 1 },
    })
    expect(parseStartTime("12", at(21))).toEqual({
      ok: true,
      time: { minutes: 0, dayOffset: 0 },
    })
  })

  it("passes a refusal straight through", () => {
    expect(parseStartTime("", at(9))).toEqual({ ok: false, reason: "empty" })
    expect(parseStartTime("nope", at(9))).toEqual({ ok: false, reason: "unparseable" })
  })
})

describe("resolveInterval", () => {
  /*
   * The composition three components used to write longhand: parse the start
   * against the wall clock, pin it to the chosen day, read the end against
   * THAT start. "9" then "5" is the case the whole `parseEndTime` rule exists
   * for — it committed twenty hours once.
   */
  it("reads a terse 9-to-5 as eight hours", () => {
    // `at(9)`: the wall clock is the start field's reference, so a bare "9"
    // typed at nine in the morning is 09:00 rather than 21:00.
    expect(resolveInterval("9", "5", at(9))).toEqual({
      ok: true,
      start: { minutes: at(9), dayOffset: 0 },
      end: { minutes: at(17), dayOffset: 0 },
    })
  })

  it("still reads a genuine overnight shift as overnight", () => {
    expect(resolveInterval("23:40", "1:15", at(23, 40))).toEqual({
      ok: true,
      start: { minutes: at(23, 40), dayOffset: 0 },
      end: { minutes: at(1, 15), dayOffset: 1 },
    })
  })

  it("pins the start to the chosen day even when the hour is ambiguous", () => {
    // `12` typed over Start at 9pm means midnight of the day on screen, not
    // midnight of the next one — the calendar is what moves an entry.
    const resolved = resolveInterval("12", "2", at(21))
    expect(resolved.ok && resolved.start).toEqual({ minutes: 0, dayOffset: 0 })
  })

  it("names which field was refused, so the message lands on it", () => {
    expect(resolveInterval("nope", "17:00", at(9))).toEqual({ ok: false, field: "start" })
    expect(resolveInterval("9:00", "nope", at(9))).toEqual({ ok: false, field: "end" })
    // An empty field is a refusal too — neither half may be guessed.
    expect(resolveInterval("", "17:00", at(9))).toEqual({ ok: false, field: "start" })
    expect(resolveInterval("9:00", "", at(9))).toEqual({ ok: false, field: "end" })
  })

  /*
   * `resolveInterval` and `parseEndTime` must not be able to disagree — the
   * whole reason the sequence lives in one place. The echo a popover shows and
   * the interval it commits are both read from here.
   */
  it("agrees with parseStartTime and parseEndTime called by hand", () => {
    for (const start of ["9", "09", "1430", "12", "5pm"]) {
      for (const end of ["5", "17:30", "2", "0", "930"]) {
        const combined = resolveInterval(start, end, at(16))
        const startParsed = parseStartTime(start, at(16))
        if (!startParsed.ok) throw new Error(start)
        const endParsed = parseEndTime(end, startParsed.time)
        if (!endParsed.ok) throw new Error(end)
        expect(combined, `${start} -> ${end}`).toEqual({
          ok: true,
          start: startParsed.time,
          end: endParsed.time,
        })
      }
    }
  })
})

describe("timeFieldHelp", () => {
  /*
   * The end field is "End time" everywhere, matching the `aria-label`
   * `TimePopoverFields` puts on the input. One popover used to say "Stop
   * time", naming a field that, to a screen-reader user, does not exist.
   */
  it("names the two fields the way the inputs are labelled", () => {
    expect(timeFieldHelp("start")).toBe(`Start time — ${TIME_HELP}`)
    expect(timeFieldHelp("end")).toBe(`End time — ${TIME_HELP}`)
  })

  it("enumerates the forms the parser actually accepts", () => {
    for (const form of ["9:15", "0915", "2pm"]) {
      expect(parseTimeOfDay(form, at(16)).ok, form).toBe(true)
      expect(TIME_HELP).toContain(form)
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
