/// <reference types="vite/client" />
// Bulk import.
//
// The load-bearing tests here are IDEMPOTENCY and REVERSIBILITY. An import is
// the one operation in this product that writes a fortnight of someone's work
// in a single gesture, and both failure modes are unrecoverable by hand: a
// retried batch that duplicates sixty rows, and a batch that cannot be told
// apart from typed entries afterwards. Everything else in this file is
// ordinary; those two are the reason it exists.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"
const HOUR = 3_600_000
const DAY_ONE = Date.parse("2026-07-27T01:00:00Z")

const entry = (n: number, title = `Ticket ${n}`) => ({
  clientKey: `toggl:range:${n}`,
  title,
  startedAt: DAY_ONE + n * HOUR,
  endedAt: DAY_ONE + (n + 1) * HOUR,
})

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

describe("importEntries", () => {
  it("inserts a batch and reports what it did", async () => {
    const t = setup()
    const result = await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0), entry(1), entry(2)].map((x) => ({ ...x, projectName: "Sealogs" })),
    })

    expect(result.inserted).toBe(3)
    expect(result.replayed).toBe(0)
    expect(result.projects).toEqual(["sealogs"])
  })

  /**
   * The property that makes a half-failed import safe to retry. Without it the
   * only recovery from a batch that errored partway is to find and delete the
   * rows that did land, by hand, from a UI that has no bulk delete.
   */
  it("is idempotent on clientKey, so re-sending a batch inserts nothing", async () => {
    const t = setup()
    const batch = {
      userId: ALICE,
      entries: [entry(0), entry(1), entry(2)].map((x) => ({ ...x, projectName: "Sealogs" })),
    }

    await t.mutation(internal.import.importEntries, batch)
    const again = await t.mutation(internal.import.importEntries, batch)

    expect(again.inserted).toBe(0)
    expect(again.replayed).toBe(3)

    const rows = await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())
    expect(rows).toHaveLength(3)
  })

  /** The tag that makes the batch findable again. */
  it("marks every imported row `source: \"import\"`", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0), entry(1)],
    })

    const rows = await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())
    expect(rows.every((r) => r.source === "import")).toBe(true)
  })

  /** Typed entries must NOT be swept up by an undo. */
  it("leaves a hand-typed entry as `manual`", async () => {
    const t = setup()
    await t.mutation(internal.entries.createAs, {
      userId: ALICE,
      clientKey: "typed",
      title: "Typed by hand",
      startedAt: DAY_ONE,
      endedAt: DAY_ONE + HOUR,
    })

    const row = await t.run(async (ctx) => await ctx.db.query("timeEntries").first())
    expect(row?.source).toBe("manual")
  })

  it("reuses a project the user already has, whatever the casing", async () => {
    const t = setup()
    const existing = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Sealogs",
    })

    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0)].map((x) => ({ ...x, projectName: "SeaLogs" })), // as spelled in the export
    })

    const row = await t.run(async (ctx) => await ctx.db.query("timeEntries").first())
    expect(row?.projectId).toBe(existing.projectId)
    const projects = await t.run(async (ctx) => await ctx.db.query("projects").collect())
    expect(projects).toHaveLength(1)
  })

  it("creates the project when there isn't one", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0)].map((x) => ({ ...x, projectName: "Sealogs" })),
    })

    const projects = await t.run(async (ctx) => await ctx.db.query("projects").collect())
    expect(projects).toHaveLength(1)
    expect(projects[0]?.name).toBe("Sealogs")
  })

  /**
   * The export knows which rows were billed. The project default is a guess
   * about rows nobody has decided about yet, so it must NOT win here — letting
   * it through re-priced imported history: a first import of this data marked
   * all 41 entries billable against a project defaulting to billable, when
   * Toggl said only 10 of them were.
   */
  it("takes billable from the entry, not the project default", async () => {
    const t = setup()
    await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Sealogs",
      billableByDefault: true,
    })

    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [
        { ...entry(0), projectName: "Sealogs", billable: false },
        { ...entry(1), projectName: "Sealogs", billable: true },
      ],
    })

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).sort((a, b) => a.startedAt - b.startedAt)
    )
    expect(rows.map((r) => r.billable)).toEqual([false, true])
  })

  /** "No project" is normal — standups and admin belong to no client. */
  it("leaves an entry with no project unattached", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [
        { ...entry(0), projectName: "Sealogs" },
        { ...entry(1) }, // a standup
      ],
    })

    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).sort((a, b) => a.startedAt - b.startedAt)
    )
    expect(rows[0]?.projectId).not.toBeUndefined()
    expect(rows[1]?.projectId).toBeUndefined()
  })

  /** Reporting "imported 0" as success is how a broken parser ships. */
  it("refuses an empty batch rather than succeeding at nothing", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.import.importEntries, { userId: ALICE, entries: [] }),
      "EMPTY_IMPORT"
    )
  })

  it("refuses a blank project name", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.import.importEntries, {
        userId: ALICE,
        entries: [{ ...entry(0), projectName: "   " }],
      }),
      "INVALID_PROJECT_NAME"
    )
  })

  /** Same validation as a typed entry — the import is not a side door. */
  it("refuses an entry whose end is not after its start", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.import.importEntries, {
        userId: ALICE,
        entries: [{ clientKey: "k", title: "x", startedAt: DAY_ONE, endedAt: DAY_ONE }],
      }),
      "END_NOT_AFTER_START"
    )
  })

  it("keeps one user's clientKeys from colliding with another's", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0)],
    })
    const bob = await t.mutation(internal.import.importEntries, {
      userId: BOB,
      entries: [entry(0)],
    })

    expect(bob.inserted).toBe(1)
    const rows = await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())
    expect(rows).toHaveLength(2)
  })
})

describe("undoImport", () => {
  it("removes the imported rows and leaves the typed ones", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0), entry(1), entry(2)],
    })
    await t.mutation(internal.entries.createAs, {
      userId: ALICE,
      clientKey: "typed",
      title: "Typed by hand",
      startedAt: DAY_ONE + 10 * HOUR,
      endedAt: DAY_ONE + 11 * HOUR,
    })

    const result = await t.mutation(internal.import.undoImport, { userId: ALICE })
    expect(result).toEqual({ deleted: 3, remaining: 0 })

    const live = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).filter((r) => r.deletedAt === null)
    )
    expect(live).toHaveLength(1)
    expect(live[0]?.title).toBe("Typed by hand")
  })

  it("never touches another user's import", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, { userId: ALICE, entries: [entry(0)] })
    await t.mutation(internal.import.importEntries, { userId: BOB, entries: [entry(1)] })

    await t.mutation(internal.import.undoImport, { userId: ALICE })

    const live = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").collect()).filter((r) => r.deletedAt === null)
    )
    expect(live).toHaveLength(1)
    expect(live[0]?.userId).toBe(BOB)
  })

  /** Bounded, so a large import does not hit the transaction ceiling. */
  it("reports what is left so the caller can loop", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0), entry(1), entry(2), entry(3), entry(4)],
    })

    const first = await t.mutation(internal.import.undoImport, { userId: ALICE, limit: 2 })
    expect(first).toEqual({ deleted: 2, remaining: 3 })

    const second = await t.mutation(internal.import.undoImport, { userId: ALICE, limit: 2 })
    expect(second).toEqual({ deleted: 2, remaining: 1 })
  })

  /**
   * The property the undo exists for, and the one a soft delete silently broke.
   *
   * `createImpl` dedupes on `clientKey` without looking at `deletedAt`, so
   * soft-deleting left the keys claimed: the retry reported "replayed" for
   * every row and inserted nothing, and the user was left staring at an empty
   * log wondering why their re-import did nothing.
   */
  it("frees the clientKeys, so the same batch can be imported again", async () => {
    const t = setup()
    const batch = { userId: ALICE, entries: [entry(0), entry(1)] }

    await t.mutation(internal.import.importEntries, batch)
    await t.mutation(internal.import.undoImport, { userId: ALICE })
    const retry = await t.mutation(internal.import.importEntries, batch)

    expect(retry.inserted).toBe(2)
    expect(retry.replayed).toBe(0)
  })

  it("hard-deletes rather than leaving tombstones behind", async () => {
    const t = setup()
    await t.mutation(internal.import.importEntries, { userId: ALICE, entries: [entry(0)] })
    await t.mutation(internal.import.undoImport, { userId: ALICE })

    const rows = await t.run(async (ctx) => await ctx.db.query("timeEntries").collect())
    expect(rows).toHaveLength(0)
  })

  /** The project and its rate predate the import and must survive it. */
  it("leaves projects, and their rates, alone", async () => {
    const t = setup()
    await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Sealogs",
      hourlyRateCents: 1000,
    })
    await t.mutation(internal.import.importEntries, {
      userId: ALICE,
      entries: [entry(0)].map((x) => ({ ...x, projectName: "Sealogs" })),
    })

    await t.mutation(internal.import.undoImport, { userId: ALICE })

    const projects = await t.run(async (ctx) =>
      (await ctx.db.query("projects").collect()).filter((p) => p.deletedAt === null)
    )
    expect(projects).toHaveLength(1)
    expect(projects[0]?.hourlyRateCents).toBe(1000)
  })

  /** A half-finished undo must not leave the join index describing dead rows. */
  it("drops the entryTags join rows with the entries", async () => {
    const t = setup()
    const tag = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "meeting" })
    await t.mutation(internal.import.importEntries, { userId: ALICE, entries: [entry(0)] })
    const row = await t.run(async (ctx) => await ctx.db.query("timeEntries").first())
    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId: row!._id,
      tagIds: [tag.tagId],
    })
    expect(
      await t.run(async (ctx) => (await ctx.db.query("entryTags").collect()).length)
    ).toBe(1)

    await t.mutation(internal.import.undoImport, { userId: ALICE })

    const joins = await t.run(async (ctx) => await ctx.db.query("entryTags").collect())
    expect(joins).toHaveLength(0)
  })
})
