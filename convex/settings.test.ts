/// <reference types="vite/client" />
// User settings.
//
// This module had NO test coverage at all, which was the most expensive gap in
// the suite: `timezone` is the value every day boundary in the product derives
// from, and `ensure` is idempotent — so the FIRST write is the only one that
// ever counts. Get it wrong once and every day boundary is wrong permanently,
// with nothing on screen to say so.
//
// The seeding call was originally specified in the authed layout's `beforeLoad`,
// which runs on the SERVER during SSR, where the resolved timezone is the
// deployment region's rather than the user's. The tests below pin the two
// properties that make the current arrangement safe: the suggestion is honoured
// exactly once, and a wrong-looking one is refused rather than stored.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { SETTINGS_DEFAULTS } from "./settings"
import { traceErrorCode } from "./lib/codes"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

describe("authorization", () => {
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    await expectCode(t.query(api.settings.get, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.settings.ensure, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.settings.update, { weekStartDay: 0 }),
      "UNAUTHENTICATED"
    )
  })

  it("keeps one user's settings invisible to another", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      timezone: "Asia/Kathmandu",
    })

    const bob = await t.query(internal.settings.getAs, { userId: BOB })
    expect(bob.timezone).toBe(SETTINGS_DEFAULTS.timezone)
  })

  it("does not let one user's update touch another's row", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      timezone: "Europe/Lisbon",
    })
    await t.mutation(internal.settings.updateAs, {
      userId: BOB,
      timezone: "Asia/Tokyo",
    })

    const alice = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(alice.timezone).toBe("Europe/Lisbon")
  })
})

describe("defaults", () => {
  it("returns the defaults for a user who has never opened settings", async () => {
    const t = setup()
    expect(await t.query(internal.settings.getAs, { userId: ALICE })).toEqual(
      SETTINGS_DEFAULTS
    )
  })

  /**
   * UTC is deliberately provisional. Guessing a zone would be worse: a wrong
   * guess is indistinguishable from a right one at read time, whereas UTC is
   * visibly a placeholder that `ensure` is expected to replace.
   */
  it("defaults the timezone to UTC and the week to Monday", async () => {
    expect(SETTINGS_DEFAULTS.timezone).toBe("UTC")
    expect(SETTINGS_DEFAULTS.weekStartDay).toBe(1)
  })
})

describe("ensure", () => {
  it("seeds the suggested timezone on the first call", async () => {
    const t = setup()
    await t.mutation(internal.settings.ensureAs, {
      userId: ALICE,
      suggestedTimezone: "Asia/Kolkata",
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe("Asia/Kolkata")
  })

  /**
   * The property the whole design rests on. `useEnsureSettings` fires on every
   * mount, so this runs constantly — and a laptop opened in another country
   * must not silently re-file last month's invoice under a new day boundary.
   */
  it("never overwrites a zone the user already has", async () => {
    const t = setup()
    await t.mutation(internal.settings.ensureAs, {
      userId: ALICE,
      suggestedTimezone: "Europe/London",
    })
    // Same user, later, on a laptop that has travelled.
    await t.mutation(internal.settings.ensureAs, {
      userId: ALICE,
      suggestedTimezone: "America/New_York",
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe("Europe/London")
  })

  it("does not overwrite a zone the user chose in settings", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      timezone: "Pacific/Chatham",
    })
    await t.mutation(internal.settings.ensureAs, {
      userId: ALICE,
      suggestedTimezone: "UTC",
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe("Pacific/Chatham")
  })

  /**
   * A suggestion is untrusted input — it comes from whatever the browser
   * reports. Storing an unrecognised string would make every subsequent
   * `dayWindow` call throw on a value the user cannot see or edit.
   */
  it("falls back to the default when the suggestion is not a real timezone", async () => {
    const t = setup()
    await t.mutation(internal.settings.ensureAs, {
      userId: ALICE,
      suggestedTimezone: "Middle/Earth",
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe(SETTINGS_DEFAULTS.timezone)
  })

  it("falls back to the default when no suggestion is offered at all", async () => {
    const t = setup()
    await t.mutation(internal.settings.ensureAs, { userId: ALICE })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe(SETTINGS_DEFAULTS.timezone)
  })

  it("creates exactly one row however many times it is called", async () => {
    const t = setup()
    await t.mutation(internal.settings.ensureAs, { userId: ALICE })
    await t.mutation(internal.settings.ensureAs, { userId: ALICE })
    await t.mutation(internal.settings.ensureAs, { userId: ALICE })

    const rows = await t.run(
      async (ctx) =>
        await ctx.db
          .query("userSettings")
          .withIndex("by_user", (q) => q.eq("userId", ALICE))
          .collect()
    )
    expect(rows).toHaveLength(1)
  })
})

describe("update", () => {
  it("writes a settings row for a user who has none", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      durationDisplay: "decimal",
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.durationDisplay).toBe("decimal")
    // Everything untouched keeps its default rather than becoming undefined.
    expect(settings.timeFormat).toBe(SETTINGS_DEFAULTS.timeFormat)
  })

  it("patches only the fields supplied", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      timezone: "Asia/Tokyo",
      weekStartDay: 0,
    })
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      tabTitleClock: false,
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe("Asia/Tokyo")
    expect(settings.weekStartDay).toBe(0)
    expect(settings.tabTitleClock).toBe(false)
  })

  it("refuses a timezone it does not recognise", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        timezone: "Not/AZone",
      }),
      "INVALID_TIMEZONE"
    )
  })

  it("refuses a week start day outside 0-6", async () => {
    // INVALID_WEEK_START, not INVALID_TIMEZONE. Both refusals come from the
    // same settings form, so a caller branching on the code would otherwise
    // send someone to fix a timezone that is perfectly fine.
    const t = setup()
    await expectCode(
      t.mutation(internal.settings.updateAs, { userId: ALICE, weekStartDay: 7 }),
      "INVALID_WEEK_START"
    )
    await expectCode(
      t.mutation(internal.settings.updateAs, { userId: ALICE, weekStartDay: -1 }),
      "INVALID_WEEK_START"
    )
    await expectCode(
      t.mutation(internal.settings.updateAs, { userId: ALICE, weekStartDay: 1.5 }),
      "INVALID_WEEK_START"
    )
  })

  it("leaves the stored row untouched when it refuses", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      timezone: "Europe/Berlin",
    })
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        timezone: "Not/AZone",
      }),
      "INVALID_TIMEZONE"
    )

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.timezone).toBe("Europe/Berlin")
  })

  it("accepts every weekStartDay the UI can produce", async () => {
    const t = setup()
    for (let day = 0; day <= 6; day += 1) {
      await t.mutation(internal.settings.updateAs, { userId: ALICE, weekStartDay: day })
      const settings = await t.query(internal.settings.getAs, { userId: ALICE })
      expect(settings.weekStartDay).toBe(day)
    }
  })
})
