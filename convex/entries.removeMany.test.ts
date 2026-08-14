/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)
const ALICE = "user_alice"
const BOB = "user_bob"

async function insertEntry(
  t: ReturnType<typeof setup>,
  userId: string,
  key: string,
  running = false
) {
  const startedAt = Date.parse("2026-08-14T09:00:00Z")
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("timeEntries", {
        userId,
        clientKey: key,
        title: key,
        startedAt,
        endedAt: running ? null : startedAt + 3_600_000,
        durationMs: running ? null : 3_600_000,
        tagIds: [],
        billable: false,
        source: "web",
        updatedAt: startedAt,
        deletedAt: null,
      })
  )
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe("entries.removeMany / restoreMany", () => {
  it("soft-deletes and restores the complete owned set", async () => {
    const t = setup()
    const ids = [
      await insertEntry(t, ALICE, "a"),
      await insertEntry(t, ALICE, "b"),
    ]
    const removed = await t.mutation(internal.entries.removeManyAs, {
      userId: ALICE,
      entryIds: ids,
    })
    expect(removed.removedEntryIds).toEqual(ids)
    for (const entryId of ids) {
      expect(
        (await t.run((ctx) => ctx.db.get(entryId)))?.deletedAt
      ).not.toBeNull()
    }

    const restored = await t.mutation(internal.entries.restoreManyAs, {
      userId: ALICE,
      entryIds: ids,
    })
    expect(restored.restoredEntryIds).toEqual(ids)
    for (const entryId of ids) {
      expect((await t.run((ctx) => ctx.db.get(entryId)))?.deletedAt).toBeNull()
    }
  })

  it("deduplicates ids and remains idempotent", async () => {
    const t = setup()
    const entryId = await insertEntry(t, ALICE, "a")
    expect(
      await t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [entryId, entryId],
      })
    ).toEqual({ removedEntryIds: [entryId] })
    expect(
      await t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [entryId],
      })
    ).toEqual({ removedEntryIds: [] })
  })

  it("rolls the whole delete back when one id is foreign", async () => {
    const t = setup()
    const mine = await insertEntry(t, ALICE, "mine")
    const theirs = await insertEntry(t, BOB, "theirs")
    await expectCode(
      t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [mine, theirs],
      }),
      "NOT_FOUND"
    )
    expect((await t.run((ctx) => ctx.db.get(mine)))?.deletedAt).toBeNull()
  })

  it("rolls the whole restore back when one id is foreign", async () => {
    const t = setup()
    const mine = await insertEntry(t, ALICE, "mine")
    const theirs = await insertEntry(t, BOB, "theirs")
    await t.mutation(internal.entries.removeManyAs, {
      userId: ALICE,
      entryIds: [mine],
    })
    await t.mutation(internal.entries.removeManyAs, {
      userId: BOB,
      entryIds: [theirs],
    })

    await expectCode(
      t.mutation(internal.entries.restoreManyAs, {
        userId: ALICE,
        entryIds: [mine, theirs],
      }),
      "NOT_FOUND"
    )
    expect((await t.run((ctx) => ctx.db.get(mine)))?.deletedAt).not.toBeNull()
  })

  it("closes a running entry before deleting it", async () => {
    const t = setup()
    const entryId = await insertEntry(t, ALICE, "running", true)
    await t.mutation(internal.entries.removeManyAs, {
      userId: ALICE,
      entryIds: [entryId],
    })
    const row = await t.run((ctx) => ctx.db.get(entryId))
    expect(row?.endedAt).not.toBeNull()
    expect(row?.durationMs).not.toBeNull()
    expect(row?.deletedAt).not.toBeNull()
  })

  it("rejects empty and unauthenticated selections", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [],
      }),
      "EMPTY_SELECTION"
    )
    await expectCode(
      t.mutation(internal.entries.restoreManyAs, {
        userId: ALICE,
        entryIds: [],
      }),
      "EMPTY_SELECTION"
    )
    await expectCode(
      t.mutation(api.entries.removeMany, { entryIds: [] }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.restoreMany, { entryIds: [] }),
      "UNAUTHENTICATED"
    )
  })
})
