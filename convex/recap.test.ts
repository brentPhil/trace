/// <reference types="vite/client" />
// The recap as a Convex query: selection, the timezone boundary, and the two
// stored fields. The document ASSEMBLY is tested exhaustively as a pure
// function in convex/lib/recap.test.ts — these tests only cover what the
// database layer adds.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"
const HOUR = 3_600_000

type Harness = ReturnType<typeof setup>

/** London is UTC+1 in August, so a local day runs 23:00 UTC to 23:00 UTC. */
const TZ = "Europe/London"
const DAY = "2026-08-06"
const DAY_START_UTC = Date.UTC(2026, 7, 5, 23, 0, 0)

async function useLondon(t: Harness, userId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("userSettings", {
      userId,
      timezone: TZ,
      weekStartDay: 1,
      durationDisplay: "hms",
      timeFormat: "24",
      runawayThresholdMs: 8 * HOUR,
      tabTitleClock: true,
      recapMinuteLocal: 1050,
      updatedAt: 0,
    })
  })
}

async function add(
  t: Harness,
  userId: string,
  over: {
    startedAt: number
    durationMs?: number
    title?: string
    note?: string
    endedAt?: number | null
    deletedAt?: number | null
  }
) {
  const durationMs = over.durationMs ?? HOUR
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("timeEntries", {
        userId,
        clientKey: `k${over.startedAt}-${Math.random()}`,
        title: over.title ?? "Work",
        note: over.note,
        startedAt: over.startedAt,
        endedAt: over.endedAt === undefined ? over.startedAt + durationMs : over.endedAt,
        durationMs: over.endedAt === null ? null : durationMs,
        tagIds: [],
        billable: false,
        source: "web",
        updatedAt: over.startedAt,
        deletedAt: over.deletedAt ?? null,
      })
  )
}

const build = async (t: Harness, userId = ALICE, day = DAY) =>
  await t.query(internal.recap.getAs, { userId, day })

// ---------------------------------------------------------------------------

describe("authorization", () => {
  it("rejects anonymous callers", async () => {
    const t = setup()
    try {
      await t.query(api.recap.get, { day: DAY })
      throw new Error("expected rejection")
    } catch (error) {
      expect(traceErrorCode(error)).toBe("UNAUTHENTICATED")
    }
  })

  it("does not leak another user's day", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, { startedAt: DAY_START_UTC + 9 * HOUR, note: "secret work" })

    const bobs = await build(t, BOB)
    expect(bobs.totalMs).toBe(0)
    expect(JSON.stringify(bobs)).not.toContain("secret work")
  })
})

// ---------------------------------------------------------------------------

describe("day selection", () => {
  it("uses the STORED timezone, not UTC", async () => {
    // 23:30 UTC on 5 Aug is 00:30 on 6 Aug in London. Selecting in UTC would
    // file this under the previous day and leave the recap empty.
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: Date.UTC(2026, 7, 5, 23, 30),
      title: "Late night",
      note: "Finished the migration",
    })

    const doc = await build(t)
    expect(doc.totalMs).toBe(HOUR)
    expect(doc.dayLabel).toBe("Thu 6 Aug")
  })

  it("excludes an entry that starts after the local day ends", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    // 23:00 UTC on 6 Aug is already 7 Aug in London.
    await add(t, ALICE, { startedAt: Date.UTC(2026, 7, 6, 23, 0), title: "Tomorrow" })

    expect((await build(t)).totalMs).toBe(0)
  })

  it("excludes a running entry until it is stopped", async () => {
    // A recap line reading "(0m)" for work in progress is worse than absence.
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: DAY_START_UTC + 9 * HOUR,
      endedAt: null,
      title: "In progress",
    })

    expect((await build(t)).entryCount).toBe(0)
  })

  it("excludes soft-deleted entries", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: DAY_START_UTC + 9 * HOUR,
      title: "Deleted",
      deletedAt: 1,
    })

    expect((await build(t)).entryCount).toBe(0)
  })

  it("refuses a malformed day rather than reporting an empty one", async () => {
    // Returning an empty recap would read as "you did nothing today".
    const t = setup()
    await useLondon(t, ALICE)
    await expect(build(t, ALICE, "2026-13-99")).rejects.toThrow()
  })

  it("counts noted entries for the panel's own pressure line", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, { startedAt: DAY_START_UTC + 9 * HOUR, note: "did a thing" })
    await add(t, ALICE, { startedAt: DAY_START_UTC + 11 * HOUR })

    const doc = await build(t)
    expect(doc.entryCount).toBe(2)
    expect(doc.notedCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------

describe("Next and Blocked", () => {
  it("stores and returns both", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await t.mutation(internal.recap.setFieldsAs, {
      userId: ALICE,
      day: DAY,
      next: "  ship the fix  ",
      blocked: "waiting on Dana",
    })

    const doc = await build(t)
    expect(doc.next).toBe("ship the fix")
    expect(doc.blocked).toBe("waiting on Dana")
  })

  it("distinguishes clearing a field from not mentioning it", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await t.mutation(internal.recap.setFieldsAs, {
      userId: ALICE,
      day: DAY,
      next: "ship it",
      blocked: "waiting",
    })

    // Absent: untouched.
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, next: "ship it now" })
    expect((await build(t)).blocked).toBe("waiting")

    // Explicit null: removed.
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, blocked: null })
    const doc = await build(t)
    expect(doc.next).toBe("ship it now")
    // Falls back to the prefill, which is undefined here — no notes mention one.
    expect(doc.blocked).toBeUndefined()
  })

  it("treats an emptied field as cleared", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, next: "x" })
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, next: "   " })
    expect((await build(t)).next).toBeUndefined()
  })

  it("prefills Blocked from the day's last noted entry", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: DAY_START_UTC + 9 * HOUR,
      note: "Shipped the parser. Waiting on Dana for the legal wording.",
    })

    const doc = await build(t)
    expect(doc.blocked).toBe("Waiting on Dana for the legal wording.")
    expect(doc.blockedIsSuggestion).toBe(true)
  })

  it("does not call the user's own words a suggestion", async () => {
    // The panel prints "suggested from your last note" beside this field. Doing
    // that over a sentence someone typed makes the whole prefill feel like the
    // app editing them.
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: DAY_START_UTC + 9 * HOUR,
      note: "Waiting on something.",
    })
    await t.mutation(internal.recap.setFieldsAs, {
      userId: ALICE,
      day: DAY,
      blocked: "my own words",
    })

    const doc = await build(t)
    expect(doc.blocked).toBe("my own words")
    expect(doc.blockedIsSuggestion).toBe(false)
  })

  it("NEVER overwrites what the user typed with the prefill", async () => {
    // The single most alarming thing this product could do is replace a
    // sentence someone wrote with a guess drawn from their own notes.
    const t = setup()
    await useLondon(t, ALICE)
    await add(t, ALICE, {
      startedAt: DAY_START_UTC + 9 * HOUR,
      note: "Waiting on the wrong thing entirely.",
    })
    await t.mutation(internal.recap.setFieldsAs, {
      userId: ALICE,
      day: DAY,
      blocked: "what I actually meant",
    })

    expect((await build(t)).blocked).toBe("what I actually meant")
  })

  it("scopes fields per user and per day", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await useLondon(t, BOB)
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, next: "alice" })

    expect((await build(t, BOB)).next).toBeUndefined()
    expect((await build(t, ALICE, "2026-08-07")).next).toBeUndefined()
  })

  it("does not create a row for a day with nothing to store", async () => {
    const t = setup()
    await useLondon(t, ALICE)
    await t.mutation(internal.recap.setFieldsAs, { userId: ALICE, day: DAY, next: "  " })
    const rows = await t.run(async (ctx) => await ctx.db.query("recapDays").collect())
    expect(rows).toHaveLength(0)
  })
})
