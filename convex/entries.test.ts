/// <reference types="vite/client" />
// `import.meta.glob` is a Vite feature, and convex/tsconfig.json targets the
// Convex runtime rather than a bundler, so the type has to be pulled in here.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import { SUMMARY_SCAN_LIMIT } from "./lib/scan"
import type { Id } from "./_generated/dataModel"

// convex-test discovers function modules by globbing from the file that calls
// it, so this has to live here rather than in a helper.
const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

const HOUR = 3_600_000

/** Asserts a promise rejects with a specific Trace error code. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    const actual = traceErrorCode(error)
    expect(actual ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

const key = (n: number) => `key-${n}`

describe("authorization", () => {
  /**
   * The route guard in src/routes/_authed.tsx only decides what renders. This
   * is the layer that actually protects data, so it is the one worth testing.
   */
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    // A REAL id belonging to a real user. A made-up string fails argument
    // validation before the handler runs, so the call never reaches the auth
    // check and the test would pass without proving anything about it.
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(99) })
    const running = await t.query(internal.entries.getRunningAs, { userId: ALICE })
    const nowhere = running!._id

    // Named "every", and it means every. An earlier version of this test
    // covered four of them, which read as a complete sweep to anyone auditing
    // coverage by test name — the most expensive kind of gap, because it looks
    // closed.
    await expectCode(t.query(api.entries.getRunning, {}), "UNAUTHENTICATED")
    await expectCode(
      t.query(api.entries.listRange, { fromMs: 0, toMs: 1 }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.query(api.entries.listPage, {
        fromMs: 0,
        toMs: 1,
        paginationOpts: { numItems: 5, cursor: null },
      }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.query(api.entries.rangeSummary, { fromMs: 0, toMs: 1 }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.query(api.entries.titleSuggestions, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.entries.start, { clientKey: key(1) }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.mutation(api.entries.stop, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.entries.discardRunning, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.entries.setTitle, { entryId: nowhere, title: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.setNote, { entryId: nowhere, note: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.remove, { entryId: nowhere }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.restore, { entryId: nowhere }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.update, { entryId: nowhere, title: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.editTime, { entryId: nowhere, field: "start", value: 1 }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.create, { clientKey: key(2), startedAt: 0, endedAt: 1 }),
      "UNAUTHENTICATED"
    )
  })

  it("keeps one user's running entry invisible to another", async () => {
    const t = setup()
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(1) })

    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).not.toBeNull()
    expect(await t.query(internal.entries.getRunningAs, { userId: BOB })).toBeNull()
  })

  it("does not let one user's start stop another user's timer", async () => {
    const t = setup()
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(1) })
    const bob = await t.mutation(internal.entries.startAs, {
      userId: BOB,
      clientKey: key(2),
    })

    expect(bob.stoppedEntryIds).toEqual([])
    const alice = await t.query(internal.entries.getRunningAs, { userId: ALICE })
    expect(alice?.endedAt).toBeNull()
  })

  it("refuses a project belonging to another user", async () => {
    const t = setup()
    const bobsProject = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: BOB,
          name: "Bob's work",
          color: "slate",
          archived: false,
          billableByDefault: true,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )

    await expectCode(
      t.mutation(internal.entries.startAs, {
        userId: ALICE,
        clientKey: key(1),
        projectId: bobsProject,
      }),
      "NOT_FOUND"
    )
  })

  it("refuses a tag belonging to another user", async () => {
    const t = setup()
    const bobsTag = await t.run(
      async (ctx) =>
        await ctx.db.insert("tags", {
          userId: BOB,
          name: "deep work",
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )

    await expectCode(
      t.mutation(internal.entries.startAs, {
        userId: ALICE,
        clientKey: key(1),
        tagIds: [bobsTag],
      }),
      "NOT_FOUND"
    )
  })
})

describe("start", () => {
  it("starts with nothing supplied — no title, no project, no tags", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })

    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry?.title).toBe("")
    expect(entry?.endedAt).toBeNull()
    expect(entry?.durationMs).toBeNull()
    expect(entry?.tagIds).toEqual([])
    expect(entry?.billable).toBe(false)
    expect(entry?.deletedAt).toBeNull()
  })

  /**
   * The whole reason start and stop are one mutation. If this ever regresses,
   * a handoff either double-counts or loses the seam between two entries.
   */
  it("stops the running entry at exactly the new start — no gap, no overlap", async () => {
    const t = setup()
    const first = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const second = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(2),
    })

    expect(second.stoppedEntryIds).toEqual([first.entryId])

    const [a, b] = await t.run(async (ctx) => [
      await ctx.db.get(first.entryId),
      await ctx.db.get(second.entryId),
    ])
    expect(a?.endedAt).toBe(b?.startedAt)
    expect(a?.durationMs).toBe(a!.endedAt! - a!.startedAt)
  })

  it("leaves exactly one entry running", async () => {
    const t = setup()
    for (let i = 1; i <= 5; i++) {
      await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(i) })
    }
    const stillRunning = await t.run(
      async (ctx) =>
        await ctx.db
          .query("timeEntries")
          .withIndex("by_user_ended", (q) => q.eq("userId", ALICE).eq("endedAt", null))
          .collect()
    )
    expect(stillRunning).toHaveLength(1)
  })

  /** A lost response followed by a retry must not duplicate the entry. */
  it("is idempotent on clientKey", async () => {
    const t = setup()
    const first = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      title: "Checkout",
    })
    const replay = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      title: "Checkout",
    })

    expect(replay.replayed).toBe(true)
    expect(replay.entryId).toBe(first.entryId)
    expect(replay.stoppedEntryIds).toEqual([])

    const count = await t.run(
      async (ctx) => (await ctx.db.query("timeEntries").collect()).length
    )
    expect(count).toBe(1)
  })

  it("scopes idempotency per user, so two users may reuse a key", async () => {
    const t = setup()
    const a = await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: "k" })
    const b = await t.mutation(internal.entries.startAs, { userId: BOB, clientKey: "k" })
    expect(b.replayed).toBe(false)
    expect(b.entryId).not.toBe(a.entryId)
  })

  /**
   * The rule that must never break: start is not refusable. A device with a
   * slightly wrong clock gets clamped, not an error telling it to go stop a
   * timer somewhere else.
   */
  it("clamps a start that lands before the running entry rather than refusing", async () => {
    const t = setup()
    const first = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const firstEntry = await t.run(async (ctx) => await ctx.db.get(first.entryId))

    const second = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(2),
      startedAt: firstEntry!.startedAt - 40_000, // a clock 40s behind
    })

    const secondEntry = await t.run(async (ctx) => await ctx.db.get(second.entryId))
    expect(secondEntry!.startedAt).toBe(firstEntry!.startedAt + 1)

    const closed = await t.run(async (ctx) => await ctx.db.get(first.entryId))
    expect(closed!.endedAt).toBe(secondEntry!.startedAt)
    expect(closed!.durationMs).toBeGreaterThan(0)
  })

  it("treats a start far in the future as a wrong clock", async () => {
    const t = setup()
    const before = Date.now()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      startedAt: before + 30 * HOUR,
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.startedAt).toBeLessThanOrEqual(Date.now())
  })

  it("accepts a backdated start when nothing is running", async () => {
    const t = setup()
    const backdated = Date.now() - 2 * HOUR
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      startedAt: backdated,
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.startedAt).toBe(backdated)
  })

  it("inherits billable from the project unless told otherwise", async () => {
    const t = setup()
    const projectId = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: ALICE,
          name: "Acme redesign",
          color: "brass",
          archived: false,
          billableByDefault: true,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )

    const inherited = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      projectId,
    })
    expect((await t.run(async (ctx) => await ctx.db.get(inherited.entryId)))!.billable).toBe(
      true
    )

    const overridden = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(2),
      projectId,
      billable: false,
    })
    expect(
      (await t.run(async (ctx) => await ctx.db.get(overridden.entryId)))!.billable
    ).toBe(false)
  })

  it("dedupes and sorts tag ids, and caps them", async () => {
    const t = setup()
    const tagIds = await t.run(async (ctx) => {
      const ids: Array<Id<"tags">> = []
      for (let i = 0; i < 11; i++) {
        ids.push(
          await ctx.db.insert("tags", {
            userId: ALICE,
            name: `tag-${i}`,
            updatedAt: Date.now(),
            deletedAt: null,
          })
        )
      }
      return ids
    })

    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      tagIds: [tagIds[2]!, tagIds[0]!, tagIds[2]!, tagIds[1]!],
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.tagIds).toHaveLength(3)
    expect([...entry!.tagIds].sort()).toEqual(entry!.tagIds)

    await expectCode(
      t.mutation(internal.entries.startAs, {
        userId: ALICE,
        clientKey: key(2),
        tagIds,
      }),
      "TOO_MANY_TAGS"
    )
  })
})

describe("stop", () => {
  it("closes the running entry with a consistent duration", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const result = await t.mutation(internal.entries.stopAs, { userId: ALICE })

    expect(result.stoppedEntryIds).toEqual([entryId])
    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.endedAt).not.toBeNull()
    expect(entry!.durationMs).toBe(entry!.endedAt! - entry!.startedAt)
    expect(entry!.durationMs).toBeGreaterThan(0)
  })

  /** Two tabs pressing S within a second. The second must not error. */
  it("is a no-op when nothing is running", async () => {
    const t = setup()
    const result = await t.mutation(internal.entries.stopAs, { userId: ALICE })
    expect(result.stoppedEntryIds).toEqual([])
  })

  it("is a no-op the second time", async () => {
    const t = setup()
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(1) })
    const first = await t.mutation(internal.entries.stopAs, { userId: ALICE })
    const second = await t.mutation(internal.entries.stopAs, { userId: ALICE })

    expect(first.stoppedEntryIds).toHaveLength(1)
    expect(second.stoppedEntryIds).toEqual([])
  })

  it("never produces an end at or before the start, even with a backwards clock", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const started = (await t.run(async (ctx) => await ctx.db.get(entryId)))!.startedAt

    await t.mutation(internal.entries.stopAs, {
      userId: ALICE,
      endedAt: started - 10 * HOUR,
    })
    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.endedAt).toBeGreaterThan(entry!.startedAt)
  })

  /**
   * A timer left running over a weekend. The 24-hour ceiling is a policy for
   * durations the user TYPES; applying it here would make the timer
   * permanently unstoppable, which is the worst failure in the product.
   */
  it("stops a runaway timer longer than a day", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      startedAt: Date.now() - 72 * HOUR,
    })

    const result = await t.mutation(internal.entries.stopAs, { userId: ALICE })
    expect(result.stoppedEntryIds).toEqual([entryId])

    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.durationMs).toBeGreaterThan(71 * HOUR)
  })

  /**
   * If the at-most-one invariant is ever violated — an import, a restore bug —
   * stop must repair it rather than throw. Reading with .unique() here would
   * mean the user could never stop their timer again.
   */
  it("repairs a violated invariant by stopping every running entry", async () => {
    const t = setup()
    const now = Date.now()
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("timeEntries", {
          userId: ALICE,
          clientKey: `smuggled-${i}`,
          title: "",
          startedAt: now - (i + 1) * HOUR,
          endedAt: null,
          durationMs: null,
          tagIds: [],
          billable: false,
          source: "import",
          updatedAt: now,
          deletedAt: null,
        })
      }
    })

    const result = await t.mutation(internal.entries.stopAs, { userId: ALICE })
    expect(result.stoppedEntryIds).toHaveLength(3)

    const stillRunning = await t.run(
      async (ctx) =>
        await ctx.db
          .query("timeEntries")
          .withIndex("by_user_ended", (q) => q.eq("userId", ALICE).eq("endedAt", null))
          .collect()
    )
    expect(stillRunning).toEqual([])
  })
})

describe("discardRunning", () => {
  it("soft-deletes with a valid interval, so a restore is usable", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
      startedAt: Date.now() - HOUR,
    })

    const result = await t.mutation(internal.entries.discardRunningAs, { userId: ALICE })
    expect(result.discardedEntryIds).toEqual([entryId])

    const entry = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(entry!.deletedAt).not.toBeNull()
    // Not a zero-duration ghost: the interval it records is real.
    expect(entry!.durationMs).toBeGreaterThan(0)
    expect(entry!.durationMs).toBe(entry!.endedAt! - entry!.startedAt)
  })

  it("leaves nothing running afterwards", async () => {
    const t = setup()
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(1) })
    await t.mutation(internal.entries.discardRunningAs, { userId: ALICE })
    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
  })
})

describe("getRunning", () => {
  it("ignores a soft-deleted row even if its endedAt is still null", async () => {
    const t = setup()
    const now = Date.now()
    await t.run(async (ctx) => {
      await ctx.db.insert("timeEntries", {
        userId: ALICE,
        clientKey: "ghost",
        title: "ghost",
        startedAt: now - HOUR,
        endedAt: null,
        durationMs: null,
        tagIds: [],
        billable: false,
        source: "import",
        updatedAt: now,
        deletedAt: now,
      })
    })
    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listPage
// ---------------------------------------------------------------------------

/**
 * `listPage` shipped with no tests at all — a public paginated query whose
 * range bounds, soft-delete filtering and cross-user isolation nothing checked.
 * It is the read path behind the whole history view.
 */
describe("listPage", () => {
  const DAY = 24 * HOUR
  const T0 = 1_700_000_000_000

  /** `n` completed one-hour entries, one per day, oldest first. */
  async function days(t: ReturnType<typeof setup>, userId: string, n: number) {
    const ids: Array<Id<"timeEntries">> = []
    for (let i = 0; i < n; i += 1) {
      const startedAt = T0 + i * DAY
      ids.push(
        await t.run(
          async (ctx) =>
            await ctx.db.insert("timeEntries", {
              userId,
              clientKey: `lp-${userId}-${i}`,
              title: `Day ${i}`,
              startedAt,
              endedAt: startedAt + HOUR,
              durationMs: HOUR,
              tagIds: [],
              billable: false,
              source: "web",
              updatedAt: startedAt,
              deletedAt: null,
            })
        )
      )
    }
    return ids
  }

  const opts = (numItems: number, cursor: string | null = null) => ({
    numItems,
    cursor,
  })

  it("rejects anonymous callers", async () => {
    const t = setup()
    await expectCode(
      t.query(api.entries.listPage, {
        fromMs: 0,
        toMs: T0 + 100 * DAY,
        paginationOpts: opts(10),
      }),
      "UNAUTHENTICATED"
    )
  })

  it("returns newest first", async () => {
    const t = setup()
    await days(t, ALICE, 5)

    const result = await t.query(internal.entries.listPageAs, {
      userId: ALICE,
      fromMs: T0,
      toMs: T0 + 5 * DAY,
      paginationOpts: opts(10),
    })

    expect(result.page.map((row) => row.title)).toEqual([
      "Day 4",
      "Day 3",
      "Day 2",
      "Day 1",
      "Day 0",
    ])
  })

  it("honours the half-open range on startedAt", async () => {
    const t = setup()
    await days(t, ALICE, 5)

    // [Day 1, Day 3) — so Day 1 and Day 2, and neither boundary neighbour.
    const result = await t.query(internal.entries.listPageAs, {
      userId: ALICE,
      fromMs: T0 + 1 * DAY,
      toMs: T0 + 3 * DAY,
      paginationOpts: opts(10),
    })

    expect(result.page.map((row) => row.title)).toEqual(["Day 2", "Day 1"])
  })

  it("walks the whole range across pages without repeating or dropping a row", async () => {
    const t = setup()
    await days(t, ALICE, 7)

    const seen: Array<string> = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard += 1) {
      const result: Awaited<
        ReturnType<typeof t.query<typeof internal.entries.listPageAs>>
      > = await t.query(internal.entries.listPageAs, {
        userId: ALICE,
        fromMs: T0,
        toMs: T0 + 7 * DAY,
        paginationOpts: opts(3, cursor),
      })
      seen.push(...result.page.map((row) => row.title))
      if (result.isDone) break
      cursor = result.continueCursor
    }

    expect(seen).toEqual([
      "Day 6",
      "Day 5",
      "Day 4",
      "Day 3",
      "Day 2",
      "Day 1",
      "Day 0",
    ])
  })

  it("omits soft-deleted rows", async () => {
    const t = setup()
    const ids = await days(t, ALICE, 4)
    await t.run(async (ctx) => await ctx.db.patch(ids[2], { deletedAt: Date.now() }))

    const result = await t.query(internal.entries.listPageAs, {
      userId: ALICE,
      fromMs: T0,
      toMs: T0 + 4 * DAY,
      paginationOpts: opts(10),
    })

    expect(result.page.map((row) => row.title)).toEqual(["Day 3", "Day 1", "Day 0"])
  })

  /**
   * The documented consequence of filtering AFTER the page is taken: a page can
   * come back shorter than `numItems` while more rows remain. A client that
   * treats a short page as the end would silently truncate history, so this
   * pins that `isDone` — not the page length — is the thing to trust.
   */
  it("can return a short page that is not the last page", async () => {
    const t = setup()
    const ids = await days(t, ALICE, 6)
    await t.run(async (ctx) => await ctx.db.patch(ids[5], { deletedAt: Date.now() }))

    const result = await t.query(internal.entries.listPageAs, {
      userId: ALICE,
      fromMs: T0,
      toMs: T0 + 6 * DAY,
      paginationOpts: opts(2),
    })

    expect(result.page).toHaveLength(1)
    expect(result.isDone).toBe(false)
  })

  it("never returns another user's entries", async () => {
    const t = setup()
    await days(t, ALICE, 3)
    await days(t, BOB, 3)

    const result = await t.query(internal.entries.listPageAs, {
      userId: BOB,
      fromMs: T0,
      toMs: T0 + 3 * DAY,
      paginationOpts: opts(50),
    })

    expect(result.page).toHaveLength(3)
    expect(result.page.every((row) => row.userId === BOB)).toBe(true)
  })

  it("returns an empty page for a range with nothing in it", async () => {
    const t = setup()
    await days(t, ALICE, 3)

    const result = await t.query(internal.entries.listPageAs, {
      userId: ALICE,
      fromMs: T0 + 50 * DAY,
      toMs: T0 + 60 * DAY,
      paginationOpts: opts(10),
    })

    expect(result.page).toEqual([])
    expect(result.isDone).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// rangeSummary — the truncation boundary
// ---------------------------------------------------------------------------

/**
 * `truncated` was shipped untested, which meant the flag, the slice boundary
 * and the whole partial-total contract rested on inspection alone. It is the
 * mechanism that stops the history view putting an understated figure on screen
 * with nothing to reveal it, so it is worth the cost of building the rows.
 */
describe("rangeSummary truncation", () => {
  const T0 = 1_700_000_000_000

  async function bulk(t: ReturnType<typeof setup>, userId: string, n: number) {
    const BATCH = 500
    for (let offset = 0; offset < n; offset += BATCH) {
      await t.run(async (ctx) => {
        for (let i = offset; i < Math.min(offset + BATCH, n); i += 1) {
          await ctx.db.insert("timeEntries", {
            userId,
            clientKey: `sum-${i}`,
            title: "Work",
            startedAt: T0 + i * 60_000,
            endedAt: T0 + i * 60_000 + 60_000,
            durationMs: 60_000,
            tagIds: [],
            billable: false,
            source: "web",
            updatedAt: T0,
            deletedAt: null,
          })
        }
      })
    }
  }

  const range = { fromMs: T0 - 1, toMs: T0 + 10_000 * 60_000 }

  it("reports an exact total, unflagged, at exactly the scan limit", async () => {
    const t = setup()
    await bulk(t, ALICE, SUMMARY_SCAN_LIMIT)

    const summary = await t.query(internal.entries.rangeSummaryAs, {
      userId: ALICE,
      ...range,
    })

    expect(summary.truncated).toBe(false)
    expect(summary.count).toBe(SUMMARY_SCAN_LIMIT)
    expect(summary.totalMs).toBe(SUMMARY_SCAN_LIMIT * 60_000)
  }, 60_000)

  it("flags the total as truncated one row above the limit", async () => {
    const t = setup()
    await bulk(t, ALICE, SUMMARY_SCAN_LIMIT + 1)

    const summary = await t.query(internal.entries.rangeSummaryAs, {
      userId: ALICE,
      ...range,
    })

    expect(summary.truncated).toBe(true)
    // The extra row is NOT counted: the scan slices to the limit, so the number
    // returned is a floor rather than a wrong total.
    expect(summary.count).toBe(SUMMARY_SCAN_LIMIT)
  }, 60_000)

  it("is exact and unflagged for an ordinary range", async () => {
    const t = setup()
    await bulk(t, ALICE, 12)

    const summary = await t.query(internal.entries.rangeSummaryAs, {
      userId: ALICE,
      ...range,
    })

    expect(summary.truncated).toBe(false)
    expect(summary.count).toBe(12)
    expect(summary.totalMs).toBe(12 * 60_000)
  })
})
