import { describe, expect, it } from "vitest"
import {
  applyTimeEdit,
  assertEnteredDuration,
  crossesMidnight,
  elapsedMs,
  entryTimes,
} from "./entryTimes"
import type { EntryTimes } from "./entryTimes"
import { dayOf } from "./day"

const at = (iso: string) => Date.parse(iso)
const MINUTE = 60_000
const HOUR = 3_600_000

const completed = (startIso: string, endIso: string): EntryTimes => {
  const r = entryTimes(at(startIso), at(endIso))
  if (!r.ok) throw new Error(`fixture is invalid: ${r.code}`)
  return r.times
}

const running = (startIso: string): EntryTimes => ({
  startedAt: at(startIso),
  endedAt: null,
  durationMs: null,
})

const times = (result: ReturnType<typeof entryTimes>) => {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`)
  return result.times
}

describe("entryTimes — the sole writer of the time fields", () => {
  it("derives durationMs from the timestamps", () => {
    const t = times(entryTimes(at("2026-08-06T09:00:00Z"), at("2026-08-06T10:30:00Z")))
    expect(t.durationMs).toBe(90 * MINUTE)
  })

  it("leaves duration null exactly when the entry is running", () => {
    const t = times(entryTimes(at("2026-08-06T09:00:00Z"), null))
    expect(t.endedAt).toBeNull()
    expect(t.durationMs).toBeNull()
  })

  it("refuses an end at or before the start", () => {
    expect(entryTimes(at("2026-08-06T10:00:00Z"), at("2026-08-06T09:00:00Z"))).toEqual({
      ok: false,
      code: "END_NOT_AFTER_START",
    })
    expect(entryTimes(at("2026-08-06T10:00:00Z"), at("2026-08-06T10:00:00Z"))).toEqual({
      ok: false,
      code: "END_NOT_AFTER_START",
    })
  })

  /**
   * The ceiling is policy, not consistency, and it deliberately does NOT live
   * here. A timer left running over a weekend is real recorded time; refusing
   * it in the sole time-writer would mean stop() fails, which means a timer
   * that can never be stopped — the worst outcome in the product.
   */
  it("accepts a runaway timer longer than a day, so stop can never fail", () => {
    const t = times(entryTimes(at("2026-08-06T09:00:00Z"), at("2026-08-09T09:00:00Z")))
    expect(t.durationMs).toBe(72 * HOUR)
  })

  it("applies the 24-hour ceiling to a duration the user TYPED", () => {
    expect(assertEnteredDuration(24 * HOUR)).toEqual({ ok: true })
    expect(assertEnteredDuration(24 * HOUR + 1)).toEqual({
      ok: false,
      code: "DURATION_TOO_LONG",
    })
    expect(assertEnteredDuration(0)).toEqual({ ok: false, code: "INVALID_DURATION" })
    expect(assertEnteredDuration(-1)).toEqual({ ok: false, code: "INVALID_DURATION" })
    expect(assertEnteredDuration(Number.NaN)).toEqual({
      ok: false,
      code: "INVALID_DURATION",
    })
  })

  it("refuses non-finite input rather than writing NaN into a total", () => {
    expect(entryTimes(Number.NaN, null).ok).toBe(false)
    expect(entryTimes(0, Number.POSITIVE_INFINITY).ok).toBe(false)
  })

  /** The invariant every total in the product depends on. */
  it("always produces durationMs === endedAt - startedAt", () => {
    for (const [s, e] of [
      ["2026-08-06T09:00:00Z", "2026-08-06T09:00:01Z"],
      ["2026-08-06T23:30:00Z", "2026-08-07T01:15:00Z"],
      ["2026-10-25T00:45:00Z", "2026-10-25T02:30:00Z"],
    ] as const) {
      const t = times(entryTimes(at(s), at(e)))
      expect(t.durationMs).toBe(t.endedAt! - t.startedAt)
    }
  })
})

describe("applyTimeEdit — timestamps are facts, duration is arithmetic", () => {
  const now = at("2026-08-06T12:00:00Z")
  const entry = completed("2026-08-06T09:00:00Z", "2026-08-06T10:30:00Z")

  it("editing START recomputes duration and does not move the end", () => {
    const t = times(
      applyTimeEdit(entry, { field: "start", value: at("2026-08-06T09:30:00Z") }, now)
    )
    expect(t.startedAt).toBe(at("2026-08-06T09:30:00Z"))
    expect(t.endedAt).toBe(entry.endedAt) // unmoved
    expect(t.durationMs).toBe(60 * MINUTE)
  })

  it("editing END recomputes duration and does not move the start", () => {
    const t = times(
      applyTimeEdit(entry, { field: "end", value: at("2026-08-06T11:00:00Z") }, now)
    )
    expect(t.startedAt).toBe(entry.startedAt) // unmoved
    expect(t.endedAt).toBe(at("2026-08-06T11:00:00Z"))
    expect(t.durationMs).toBe(2 * HOUR)
  })

  it("editing DURATION moves the END and anchors the start", () => {
    const t = times(applyTimeEdit(entry, { field: "duration", value: 2 * HOUR }, now))
    expect(t.startedAt).toBe(entry.startedAt) // anchored
    expect(t.endedAt).toBe(at("2026-08-06T11:00:00Z")) // moved
    expect(t.durationMs).toBe(2 * HOUR)
  })

  it("refuses an edit that would put the end at or before the start", () => {
    expect(
      applyTimeEdit(entry, { field: "end", value: at("2026-08-06T08:00:00Z") }, now)
    ).toEqual({ ok: false, code: "END_NOT_AFTER_START" })
    expect(
      applyTimeEdit(entry, { field: "start", value: at("2026-08-06T11:00:00Z") }, now)
    ).toEqual({ ok: false, code: "END_NOT_AFTER_START" })
  })

  it("refuses a zero or negative duration", () => {
    expect(applyTimeEdit(entry, { field: "duration", value: 0 }, now)).toEqual({
      ok: false,
      code: "INVALID_DURATION",
    })
    expect(applyTimeEdit(entry, { field: "duration", value: -HOUR }, now)).toEqual({
      ok: false,
      code: "INVALID_DURATION",
    })
  })
})

describe("applyTimeEdit — the running entry is the exception", () => {
  const now = at("2026-08-06T12:00:00Z")
  const entry = running("2026-08-06T09:00:00Z")

  it("editing DURATION moves the START, because there is no end to move", () => {
    // "this has been running for 30 minutes" -> it started at 11:30.
    const t = times(applyTimeEdit(entry, { field: "duration", value: 30 * MINUTE }, now))
    expect(t.startedAt).toBe(at("2026-08-06T11:30:00Z"))
    expect(t.endedAt).toBeNull()
    expect(t.durationMs).toBeNull()
    expect(elapsedMs(t, now)).toBe(30 * MINUTE)
  })

  it("editing START keeps it running", () => {
    const t = times(
      applyTimeEdit(entry, { field: "start", value: at("2026-08-06T08:00:00Z") }, now)
    )
    expect(t.endedAt).toBeNull()
    expect(elapsedMs(t, now)).toBe(4 * HOUR)
  })

  it("editing END stops it — the fix for forgetting to press stop", () => {
    const t = times(
      applyTimeEdit(entry, { field: "end", value: at("2026-08-06T11:40:00Z") }, now)
    )
    expect(t.endedAt).toBe(at("2026-08-06T11:40:00Z"))
    expect(t.durationMs).toBe(2 * HOUR + 40 * MINUTE)
  })
})

describe("elapsedMs", () => {
  it("derives from startedAt for a running entry, never from a counter", () => {
    const entry = running("2026-08-06T09:00:00Z")
    expect(elapsedMs(entry, at("2026-08-06T09:00:00Z"))).toBe(0)
    expect(elapsedMs(entry, at("2026-08-06T11:30:00Z"))).toBe(150 * MINUTE)
    // Nine hours of laptop sleep is not a special case; the number is simply
    // recomputed and is correct.
    expect(elapsedMs(entry, at("2026-08-06T18:00:00Z"))).toBe(9 * HOUR)
  })

  it("uses the stored duration once stopped, so it never drifts", () => {
    const entry = completed("2026-08-06T09:00:00Z", "2026-08-06T10:30:00Z")
    expect(elapsedMs(entry, at("2027-01-01T00:00:00Z"))).toBe(90 * MINUTE)
  })

  it("clamps a start in the future to zero rather than counting backwards", () => {
    const entry = running("2026-08-06T09:00:00Z")
    expect(elapsedMs(entry, at("2026-08-06T08:00:00Z"))).toBe(0)
  })
})

describe("crossesMidnight", () => {
  const inLondon = (ms: number) => dayOf(ms, "Europe/London")

  it("is true for an entry that ends on a later local day", () => {
    const entry = completed("2026-08-06T22:00:00Z", "2026-08-06T23:30:00Z")
    // 23:00 -> 00:30 local (BST). Different local days.
    expect(crossesMidnight(entry, inLondon)).toBe(true)
  })

  it("is false for an entry inside one local day", () => {
    const entry = completed("2026-08-06T09:00:00Z", "2026-08-06T10:30:00Z")
    expect(crossesMidnight(entry, inLondon)).toBe(false)
  })

  it("is false for a running entry — there is no end yet to compare", () => {
    expect(crossesMidnight(running("2026-08-06T22:00:00Z"), inLondon)).toBe(false)
  })
})
