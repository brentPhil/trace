/// <reference types="vite/client" />
// `import.meta.glob` is a Vite feature, and convex/tsconfig.json targets the
// Convex runtime rather than a bundler, so the type has to be pulled in here.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
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
    await expectCode(t.query(api.entries.getRunning, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.entries.start, { clientKey: key(1) }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.mutation(api.entries.stop, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.entries.discardRunning, {}), "UNAUTHENTICATED")
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
