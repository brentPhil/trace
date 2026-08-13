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
import { MAX_LOGO_BYTES } from "./lib/logo"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
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
    await expectCode(
      t.mutation(api.settings.generateLogoUploadUrl, {}),
      "UNAUTHENTICATED"
    )
    const storageId = await storedBlob(t, "image/png", 1)
    await expectCode(
      t.action(api.settings.setLogo, { storageId }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.mutation(api.settings.clearLogo, {}), "UNAUTHENTICATED")
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
    expect(await t.query(internal.settings.getAs, { userId: ALICE })).toEqual({
      ...SETTINGS_DEFAULTS,
      logoUrl: null,
    })
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
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        weekStartDay: 7,
      }),
      "INVALID_WEEK_START"
    )
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        weekStartDay: -1,
      }),
      "INVALID_WEEK_START"
    )
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        weekStartDay: 1.5,
      }),
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
      await t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        weekStartDay: day,
      })
      const settings = await t.query(internal.settings.getAs, { userId: ALICE })
      expect(settings.weekStartDay).toBe(day)
    }
  })

  it("defaults currency to USD and lets it be changed", async () => {
    const t = setup()
    // A row that has never set a currency reads back the default rather than
    // `undefined` — the additive-column fallback in `getImpl`.
    const beforeAnyRow = await t.query(internal.settings.getAs, {
      userId: ALICE,
    })
    expect(beforeAnyRow.currency).toBe("USD")

    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      currency: "SGD",
    })
    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.currency).toBe("SGD")
  })

  it("refuses a currency the runtime does not recognise, leaving the stored one untouched", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      currency: "SGD",
    })

    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        currency: "NOTREAL",
      }),
      "INVALID_CURRENCY"
    )

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.currency).toBe("SGD")
  })

  /*
   * The three-letter cases are the ones the old guard let through. It built an
   * `Intl.NumberFormat` in a try/catch, which tests whether a code is
   * WELL-FORMED rather than whether it exists — so "ABC" stored fine and every
   * amount in the product then rendered as "ABC 10.50", under an error message
   * that claimed to know currencies.
   */
  it("refuses a well-formed three-letter code that is not a real currency", async () => {
    const t = setup()
    for (const currency of ["ABC", "XYZ", "QQQ"]) {
      await expectCode(
        t.mutation(internal.settings.updateAs, { userId: ALICE, currency }),
        "INVALID_CURRENCY"
      )
    }
    // Nothing was written by any of them.
    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.currency).toBe(SETTINGS_DEFAULTS.currency)
  })

  it("refuses a currency the /settings picker does not offer", async () => {
    // The guard and the dropdown read the same list (money.SUPPORTED_
    // CURRENCIES), so a code the picker will not show is one the server will
    // not store. JPY and KWD are excluded because their minor unit is not a
    // hundredth and `hourlyRateCents` is.
    const t = setup()
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        currency: "JPY",
      }),
      "INVALID_CURRENCY"
    )
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        currency: "KWD",
      }),
      "INVALID_CURRENCY"
    )
  })

  it("refuses a real code in the wrong case", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        currency: "usd",
      }),
      "INVALID_CURRENCY"
    )
  })
})

describe("groupEntries", () => {
  it("reads as true for a row written before the column existed", async () => {
    /*
     * The additive-column contract, and the reason `groupEntries` is
     * `v.optional` in the schema: every existing user has a settings row with
     * no opinion about this field, and that is an ordinary state rather than
     * one worth a backfill migration. Absence has to mean "the default", the
     * same way `currency` and `pdfIncludeNotes` already work.
     */
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("userSettings", {
        userId: ALICE,
        timezone: "UTC",
        weekStartDay: 1,
        durationDisplay: "hms",
        timeFormat: "24",
        runawayThresholdMs: 8 * 60 * 60 * 1000,
        tabTitleClock: true,
        updatedAt: Date.now(),
      })
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.groupEntries).toBe(true)
  })

  it("can be switched off and back on", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      groupEntries: false,
    })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).groupEntries
    ).toBe(false)

    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      groupEntries: true,
    })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).groupEntries
    ).toBe(true)
  })
})

describe("mergeInvoiceLines", () => {
  it("reads as true for a row written before the column existed", async () => {
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("userSettings", {
        userId: ALICE,
        timezone: "UTC",
        weekStartDay: 1,
        durationDisplay: "hms",
        timeFormat: "24",
        runawayThresholdMs: 8 * 60 * 60 * 1000,
        tabTitleClock: true,
        updatedAt: Date.now(),
      })
    })

    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE }))
        .mergeInvoiceLines
    ).toBe(true)
  })

  it("can be switched off and back on", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      mergeInvoiceLines: false,
    })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE }))
        .mergeInvoiceLines
    ).toBe(false)

    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      mergeInvoiceLines: true,
    })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE }))
        .mergeInvoiceLines
    ).toBe(true)
  })
})

async function storedBlob(
  t: ReturnType<typeof setup>,
  type: string,
  size: number
) {
  return await t.run(
    async (ctx) =>
      await ctx.storage.store(new Blob([new Uint8Array(size)], { type }))
  )
}

describe("invoice logo", () => {
  it("returns no logo for an account with no settings row", async () => {
    const t = setup()
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).logoUrl
    ).toBeNull()
  })

  it.each(["image/png", "image/jpeg"])(
    "accepts a %s file within the bound",
    async (type) => {
      const t = setup()
      const storageId = await storedBlob(t, type, 32)

      await t.action(internal.settings.setLogoAs, { userId: ALICE, storageId })

      const row = await t.run(
        async (ctx) =>
          await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", ALICE))
            .first()
      )
      expect(row?.logoStorageId).toBe(storageId)
      expect(
        (await t.query(internal.settings.getAs, { userId: ALICE })).logoUrl
      ).not.toBeNull()
    }
  )

  it("refuses and deletes an upload whose content type is not PNG or JPEG", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "image/gif", 32)

    await expectCode(
      t.action(internal.settings.setLogoAs, { userId: ALICE, storageId }),
      "INVALID_LOGO"
    )
    expect(
      await t.run(async (ctx) => await ctx.db.system.get("_storage", storageId))
    ).toBeNull()
  })

  it("refuses and deletes an upload larger than one MiB", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "image/png", MAX_LOGO_BYTES + 1)

    await expectCode(
      t.action(internal.settings.setLogoAs, { userId: ALICE, storageId }),
      "INVALID_LOGO"
    )
    expect(
      await t.run(async (ctx) => await ctx.db.system.get("_storage", storageId))
    ).toBeNull()
  })

  it("repoints and clears the setting without deleting accepted files", async () => {
    const t = setup()
    const first = await storedBlob(t, "image/png", 32)
    const second = await storedBlob(t, "image/jpeg", 32)
    await t.action(internal.settings.setLogoAs, {
      userId: ALICE,
      storageId: first,
    })
    await t.action(internal.settings.setLogoAs, {
      userId: ALICE,
      storageId: second,
    })

    expect(
      await t.run(async (ctx) => await ctx.db.system.get("_storage", first))
    ).not.toBeNull()
    await t.mutation(internal.settings.clearLogoAs, { userId: ALICE })
    expect(
      await t.run(async (ctx) => await ctx.db.system.get("_storage", second))
    ).not.toBeNull()
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).logoUrl
    ).toBeNull()
  })
})
