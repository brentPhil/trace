/// <reference types="vite/client" />
// The bulk edit behind a sitting's parent row.
//
// Separate from entries.edit.test.ts, which is deliberately untouched by this
// feature: that file guards the invariant that an entry which already exists
// never re-inherits its project's billable default, and this mutation must not
// be able to break it. Keeping the new tests out of that file keeps the
// tripwire honest.
//
// Exercised through `updateManyAs`, not `t.withIdentity`, matching every other
// test in this codebase (see entries.edit.test.ts and the Structure note atop
// entries.ts): the internal `*As` variants are what let this logic be tested
// for real without wiring the better-auth component into the test harness.
// The one exception is the unauthenticated case below, which is what proves
// the public `updateMany` wrapper still gates on a signed-in user.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"
const HOUR = 3_600_000

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

type Harness = ReturnType<typeof setup>

/** Two completed entries on one title, oldest first in wall-clock terms. */
async function twoSittings(t: Harness, userId: string): Promise<Array<Id<"timeEntries">>> {
  const base = Date.parse("2026-08-13T09:00:00Z")
  const ids: Array<Id<"timeEntries">> = []
  for (const offset of [0, 3 * HOUR]) {
    ids.push(
      await t.run(async (ctx) =>
        await ctx.db.insert("timeEntries", {
          userId,
          clientKey: `sitting-${userId}-${offset}`,
          title: "[B-CB-343] Fixing the clock input",
          startedAt: base + offset,
          endedAt: base + offset + HOUR,
          durationMs: HOUR,
          tagIds: [],
          billable: false,
          source: "web",
          updatedAt: 0,
          deletedAt: null,
        })
      )
    )
  }
  return ids
}

const read = async (t: Harness, id: Id<"timeEntries">) =>
  await t.run(async (ctx) => await ctx.db.get(id))

describe("entries.updateMany", () => {
  it("writes one note to every member", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)

    await t.mutation(internal.entries.updateManyAs, {
      userId: ALICE,
      entryIds: ids,
      note: "Fixed the 12-hour clock hours field.",
    })

    for (const id of ids) {
      expect((await read(t, id))?.note).toBe("Fixed the 12-hour clock hours field.")
    }
  })

  it("writes project, tags and billable together in one call", async () => {
    // The parent sends them together when a billable-by-default project is
    // picked, so they have to land together.
    const t = setup()
    const ids = await twoSittings(t, ALICE)
    const projectId = await t.run(async (ctx) =>
      await ctx.db.insert("projects", {
        userId: ALICE,
        name: "Sealogs",
        color: "amber",
        billableByDefault: true,
        archived: false,
        updatedAt: 0,
        deletedAt: null,
      })
    )

    await t.mutation(internal.entries.updateManyAs, {
      userId: ALICE,
      entryIds: ids,
      projectId,
      billable: true,
    })

    for (const id of ids) {
      const row = await read(t, id)
      expect(row?.projectId).toBe(projectId)
      expect(row?.billable).toBe(true)
    }
  })

  it("refuses the whole call when one id belongs to someone else", async () => {
    /*
     * THE REASON THIS IS ONE MUTATION RATHER THAN A CLIENT LOOP. A partial
     * write leaves a sitting whose members disagree, which is the exact state
     * this feature exists to eliminate — and there would be no single undo to
     * get back from it. Convex mutations are transactions, so the guard is
     * structural rather than a convention this handler has to remember.
     */
    const t = setup()
    const mine = await twoSittings(t, ALICE)
    const theirs = await twoSittings(t, BOB)

    await expectCode(
      t.mutation(internal.entries.updateManyAs, {
        userId: ALICE,
        entryIds: [...mine, theirs[0]],
        note: "Should not land anywhere.",
      }),
      "NOT_FOUND"
    )

    // Not "most of them" — none of them.
    for (const id of mine) {
      expect((await read(t, id))?.note).toBeUndefined()
    }
  })

  it("refuses an unauthenticated call", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)

    await expectCode(
      t.mutation(api.entries.updateMany, { entryIds: ids, note: "No." }),
      "UNAUTHENTICATED"
    )
  })

  it("accepts a single id, so a lone entry needs no second path", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)

    await t.mutation(internal.entries.updateManyAs, {
      userId: ALICE,
      entryIds: [ids[0]],
      note: "Just this one.",
    })

    expect((await read(t, ids[0]))?.note).toBe("Just this one.")
    expect((await read(t, ids[1]))?.note).toBeUndefined()
  })

  it("rejects an empty id list rather than succeeding at nothing", async () => {
    // A no-op that reports success is how a broken caller stays broken.
    const t = setup()

    await expectCode(
      t.mutation(internal.entries.updateManyAs, {
        userId: ALICE,
        entryIds: [],
        note: "Nowhere.",
      }),
      "EMPTY_SELECTION"
    )
  })
})
