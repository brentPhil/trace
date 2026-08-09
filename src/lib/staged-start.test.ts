import { describe, expect, it } from "vitest"
import {
  MAX_STAGED_AGE_MS,
  describeStagedStart,
  resolveStagedStart,
} from "./staged-start"

/*
 * The staged start is the one piece of state in the app that can silently
 * backdate a real, billable entry, and every one of its rules is a date
 * calculation. It used to live inside `timer-bar.tsx` reaching for
 * `Date.now()`, so it could only be reached through the DOM — which is how it
 * shipped with a staleness rule that never fired and no lower bound at all.
 */

const LONDON = "Europe/London"

/** 7 August 2026, 21:00 London (BST, so 20:00Z). */
const now = Date.parse("2026-08-07T20:00:00Z")

describe("resolveStagedStart", () => {
  it("honours a value staged earlier today", () => {
    const staged = Date.parse("2026-08-07T03:06:00Z") // 4:06 AM BST
    expect(resolveStagedStart(staged, now - 60_000, LONDON, now)).toBe(staged)
  })

  it("is null when nothing was staged", () => {
    expect(resolveStagedStart(null, null, LONDON, now)).toBeNull()
    expect(resolveStagedStart(now, null, LONDON, now)).toBeNull()
    expect(resolveStagedStart(null, now, LONDON, now)).toBeNull()
  })

  it("drops a value staged on a day that has since ended", () => {
    // A tab left open past local midnight. The instant it targets is beside
    // the point; what has gone stale is the intent behind it.
    const staged = Date.parse("2026-08-07T20:30:00Z")
    const setAt = Date.parse("2026-08-06T22:00:00Z") // yesterday evening
    expect(resolveStagedStart(staged, setAt, LONDON, now)).toBeNull()
  })

  it("refuses a start older than the longest entry the backend will keep", () => {
    // Staged five minutes ago, but the calendar was paged back a month. The
    // day-of-staging rule cannot see this: it only checks WHEN the value was
    // set, never what it targets.
    const staged = now - MAX_STAGED_AGE_MS - 60_000
    expect(resolveStagedStart(staged, now - 300_000, LONDON, now)).toBeNull()
  })

  it("allows a start exactly at the limit", () => {
    const staged = now - MAX_STAGED_AGE_MS
    // Still same-day-staged, so only the age rule is in play here.
    expect(resolveStagedStart(staged, now - 300_000, LONDON, now)).toBe(staged)
  })
})

describe("describeStagedStart", () => {
  it("gives the bare time when the staged day is today", () => {
    const staged = Date.parse("2026-08-07T03:06:00Z")
    expect(describeStagedStart(staged, LONDON, true, now)).toBe("4:06 AM")
  })

  it("names the date AND the distance when it is not today", () => {
    // "9:00 AM on 6 Aug" reads as a time you might have meant. The magnitude
    // is what makes an accidental backdate legible at a glance.
    const staged = Date.parse("2026-08-06T08:00:00Z") // 9:00 AM BST, the 6th
    expect(describeStagedStart(staged, LONDON, true, now)).toBe(
      "9:00 AM on 6 Aug (yesterday)"
    )
  })

  it("counts whole days in either direction", () => {
    const past = Date.parse("2026-08-04T08:00:00Z")
    expect(describeStagedStart(past, LONDON, true, now)).toBe(
      "9:00 AM on 4 Aug (3 days ago)"
    )

    const future = Date.parse("2026-08-12T08:00:00Z")
    expect(describeStagedStart(future, LONDON, true, now)).toBe(
      "9:00 AM on 12 Aug (in 5 days)"
    )

    const tomorrow = Date.parse("2026-08-08T08:00:00Z")
    expect(describeStagedStart(tomorrow, LONDON, true, now)).toBe(
      "9:00 AM on 8 Aug (tomorrow)"
    )
  })

  it("counts days in the user's zone, not UTC", () => {
    // 23:30 on the 7th in Kolkata is 18:00Z — still the 7th there, already
    // "today", while a UTC reading of the same pair would disagree.
    const kolkata = "Asia/Kolkata"
    const nowThere = Date.parse("2026-08-07T18:00:00Z") // 23:30 IST, the 7th
    const staged = Date.parse("2026-08-07T18:20:00Z") // 23:50 IST, the 7th
    expect(describeStagedStart(staged, kolkata, false, nowThere)).toBe("23:50")
  })
})
