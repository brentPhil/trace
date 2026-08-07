import { afterEach, describe, expect, it, vi } from "vitest"
import { getSkewMs, recordServerNow, resetClockSkew } from "./clock"
import { newClientKey } from "./client-key"
import { PENDING_START_MAX_AGE_MS, shouldReplay } from "./pending-start"
import type { PendingStart } from "./pending-start"

afterEach(() => {
  resetClockSkew()
  vi.useRealTimers()
})

describe("clock skew", () => {
  it("records the offset between this device and the server", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    recordServerNow(1_000_000 + 4_000)
    expect(getSkewMs()).toBe(4_000)
  })

  it("records a negative offset when the device is ahead", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    recordServerNow(1_000_000 - 2_500)
    expect(getSkewMs()).toBe(-2_500)
  })

  /**
   * A device whose clock is set to next year would otherwise put a running
   * timer months out. Ignoring the reading leaves the display merely
   * device-accurate, which is the better of the two failures.
   */
  it("ignores an implausible skew rather than applying it", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    recordServerNow(1_000_000 + 6 * 60_000)
    expect(getSkewMs()).toBe(0)

    recordServerNow(1_000_000 - 365 * 24 * 3_600_000)
    expect(getSkewMs()).toBe(0)
  })
})

describe("newClientKey", () => {
  it("is a well-formed UUID with version 7 and the RFC 4122 variant", () => {
    const key = newClientKey()
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })

  it("encodes the timestamp in the leading 48 bits, so keys sort by time", () => {
    const early = newClientKey(1_000_000_000_000)
    const late = newClientKey(1_700_000_000_000)
    expect(early < late).toBe(true)
  })

  it("does not collide across a tight loop", () => {
    const keys = new Set(Array.from({ length: 5_000 }, () => newClientKey()))
    expect(keys.size).toBe(5_000)
  })
})

describe("shouldReplay", () => {
  const pending: PendingStart = {
    clientKey: "k",
    title: "Checkout",
    startedAt: 1_000,
    recordedAt: 1_000,
  }

  it("replays an unconfirmed start when the server has nothing running", () => {
    expect(shouldReplay(pending, false, 2_000)).toBe(true)
  })

  /**
   * The case that matters: a timer IS running, so either the start landed after
   * all or the user has since started something else. Replaying would insert a
   * second entry — a duplicate on the invoice.
   */
  it("never replays while something is already running", () => {
    expect(shouldReplay(pending, true, 2_000)).toBe(false)
  })

  it("does not resurrect a stale intent unasked", () => {
    expect(shouldReplay(pending, false, 1_000 + PENDING_START_MAX_AGE_MS)).toBe(true)
    expect(shouldReplay(pending, false, 1_000 + PENDING_START_MAX_AGE_MS + 1)).toBe(false)
  })

  it("is safe with nothing recorded", () => {
    expect(shouldReplay(null, false, 2_000)).toBe(false)
  })
})
