/// <reference types="vite/client" />
// Projects and tags: the classification layer.
//
// The load-bearing tests here are the REFUSALS. A project or tag that cannot
// vanish while an entry references it is what lets entries store a plain id
// with no denormalised copy of the name — which in turn is what makes renaming
// a project fix every historical row and keep an old invoice reproducible. If
// these refusals ever stop holding, the data model quietly becomes wrong
// everywhere at once, and nothing else would notice.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { isTraceError, traceErrorCode } from "./lib/codes"
import type { TraceErrorData } from "./lib/codes"
import { PROJECT_COLORS } from "./lib/palette"
import { ENTRY_SCAN_LIMIT } from "./lib/scan"
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
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

/** The same, but hands back the payload so a test can assert on the sentence. */
async function expectFailure(promise: Promise<unknown>): Promise<TraceErrorData> {
  try {
    await promise
  } catch (error) {
    if (isTraceError(error)) return error.data
    throw error
  }
  throw new Error("expected a rejection, but it resolved")
}

type Harness = ReturnType<typeof setup>

async function project(t: Harness, userId: string, name: string, over = {}) {
  const { projectId } = await t.mutation(internal.projects.createAs, {
    userId,
    name,
    ...over,
  })
  return projectId
}

/**
 * An entry, through the REAL mutation rather than a raw insert.
 *
 * It used to insert straight into the table, which was harmless while the only
 * thing linking an entry to a tag was the `tagIds` array on the row itself.
 * With the `entryTags` join table it is not harmless: a raw insert writes no
 * join row, so every "REFUSES to delete a tag in use" test below would have
 * been asserting a refusal against a tag the server could see no use of —
 * passing for the wrong reason today and passing vacuously forever after.
 *
 * `deleted` goes through `entries.remove` for the same reason: that is the path
 * that drops the join rows, and a test wanting a trashed entry wants the one
 * the product produces.
 */
async function entryOn(
  t: Harness,
  userId: string,
  over: Partial<{
    projectId: Id<"projects">
    tagIds: Array<Id<"tags">>
    title: string
    clientKey: string
    deleted: boolean
  }> = {}
) {
  const startedAt = Date.now() - 2 * HOUR
  const { entryId } = await t.mutation(internal.entries.createAs, {
    userId,
    clientKey: over.clientKey ?? `k-${Math.random()}`,
    title: over.title ?? "Work",
    startedAt,
    endedAt: startedAt + HOUR,
    projectId: over.projectId,
    tagIds: over.tagIds,
  })
  if (over.deleted === true) {
    await t.mutation(internal.entries.removeAs, { userId, entryId })
  }
  return entryId
}

// ---------------------------------------------------------------------------

describe("authorization", () => {
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    // Real ids, owned by a real user: a fabricated string fails argument
    // validation before the handler runs, so the call would never reach the
    // auth check the test is meant to be about.
    const projectId = await project(t, ALICE, "Acme")
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })

    await expectCode(t.query(api.projects.list, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.projects.create, { name: "X" }), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.projects.update, { projectId, name: "X" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.projects.setArchived, { projectId, archived: true }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.projects.remove, { projectId }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.query(api.tags.list, {}), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.tags.ensure, { name: "x" }), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.tags.rename, { tagId, name: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.mutation(api.tags.remove, { tagId }), "UNAUTHENTICATED")
    await expectCode(t.query(api.entries.titleSuggestions, {}), "UNAUTHENTICATED")
  })

  it("will not let one user rename or delete another's tag", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "alices",
    })

    await expectCode(
      t.mutation(internal.tags.renameAs, { userId: BOB, tagId, name: "mine" }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: BOB, tagId }),
      "NOT_FOUND"
    )

    // And Alice's tag is untouched by either attempt.
    const tags = await t.query(internal.tags.listAs, { userId: ALICE })
    expect(tags.map((row) => row.name)).toEqual(["alices"])
  })

  it("keeps one user's projects and tags invisible to another", async () => {
    const t = setup()
    await project(t, ALICE, "Acme")
    await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "urgent" })

    expect(await t.query(internal.projects.listAs, { userId: BOB })).toHaveLength(0)
    expect(await t.query(internal.tags.listAs, { userId: BOB })).toHaveLength(0)
  })

  it("will not let one user edit or delete another's project", async () => {
    const t = setup()
    const alices = await project(t, ALICE, "Acme")

    await expectCode(
      t.mutation(internal.projects.updateAs, {
        userId: BOB,
        projectId: alices,
        name: "Mine",
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.projects.removeAs, { userId: BOB, projectId: alices }),
      "NOT_FOUND"
    )
  })
})

// ---------------------------------------------------------------------------

describe("projects", () => {
  it("assigns a different colour to each of the first twelve projects", async () => {
    // Not cosmetic: a user who never opens the colour picker should still be
    // able to tell their clients apart at a glance.
    const t = setup()
    for (let i = 0; i < PROJECT_COLORS.length; i++) {
      await project(t, ALICE, `Project ${i}`)
    }
    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(new Set(rows.map((r) => r.color)).size).toBe(PROJECT_COLORS.length)
  })

  it("refuses a colour outside the palette", async () => {
    // A stored colour with no style renders as an invisible swatch forever.
    const t = setup()
    await expectCode(
      t.mutation(internal.projects.createAs, {
        userId: ALICE,
        name: "Acme",
        color: "#ff0000",
      }),
      "TOO_LONG"
    )
  })

  it("allows two projects with the same name", async () => {
    // Two clients really can both call it "Website redesign". Refusing forces
    // the user to invent a fake distinguishing suffix.
    const t = setup()
    await project(t, ALICE, "Website redesign")
    await project(t, ALICE, "Website redesign")
    expect(await t.query(internal.projects.listAs, { userId: ALICE })).toHaveLength(2)
  })

  it("refuses an empty name", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.projects.createAs, { userId: ALICE, name: "   " }),
      "TOO_LONG"
    )
  })

  it("REFUSES to delete a project a live entry references", async () => {
    const t = setup()
    const projectId = await project(t, ALICE, "Acme")
    await entryOn(t, ALICE, { projectId })

    await expectCode(
      t.mutation(internal.projects.removeAs, { userId: ALICE, projectId }),
      "IN_USE"
    )
    // Refused, not partially applied.
    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(rows).toHaveLength(1)
  })

  it("allows the delete once only soft-deleted entries reference it", async () => {
    const t = setup()
    const projectId = await project(t, ALICE, "Acme")
    await entryOn(t, ALICE, { projectId, deleted: true })

    await t.mutation(internal.projects.removeAs, { userId: ALICE, projectId })
    expect(await t.query(internal.projects.listAs, { userId: ALICE })).toHaveLength(0)
  })

  it("keeps archived projects in the list so old entries can still name them", async () => {
    // The pickers filter archived ones for themselves. The LOG cannot: last
    // year's entry still has to render its project's name and colour, and
    // there is no other source for them.
    const t = setup()
    const projectId = await project(t, ALICE, "Finished client")
    await t.mutation(internal.projects.setArchivedAs, {
      userId: ALICE,
      projectId,
      archived: true,
    })

    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].archived).toBe(true)
  })

  it("does not rewrite existing entries when billableByDefault changes", async () => {
    // Inheritance happens once, at creation. Re-applying it here would silently
    // change the billable flag on work that has already been invoiced.
    const t = setup()
    const projectId = await project(t, ALICE, "Acme", { billableByDefault: false })
    const entryId = await entryOn(t, ALICE, { projectId })

    await t.mutation(internal.projects.updateAs, {
      userId: ALICE,
      projectId,
      billableByDefault: true,
    })

    const row = await t.run(async (ctx) => await ctx.db.get(entryId))
    expect(row?.billable).toBe(false)
  })

  it("renames without touching entries, so history reads the new name", async () => {
    // The property the refusal above buys: entries hold an id, not a copy.
    const t = setup()
    const projectId = await project(t, ALICE, "Acme")
    await entryOn(t, ALICE, { projectId })

    await t.mutation(internal.projects.updateAs, {
      userId: ALICE,
      projectId,
      name: "Acme Corp",
    })

    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(rows[0].name).toBe("Acme Corp")
  })
})

// ---------------------------------------------------------------------------

describe("tags", () => {
  it("gets-or-creates, so typing the same word twice is one tag", async () => {
    const t = setup()
    const first = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "urgent" })
    const second = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "urgent" })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.tagId).toBe(first.tagId)
  })

  it("matches case-insensitively but keeps the original spelling", async () => {
    // "OKRs" and "okrs" are the same word to a human. Rewriting someone's
    // capitalisation because they typed it lowercase once is not a thing they
    // asked for.
    const t = setup()
    const first = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "OKRs" })
    const second = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "okrs" })

    expect(second.tagId).toBe(first.tagId)
    const rows = await t.query(internal.tags.listAs, { userId: ALICE })
    expect(rows[0].name).toBe("OKRs")
  })

  it("strips a leading # so the picker's own trigger character is not stored", async () => {
    const t = setup()
    const withHash = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "#urgent",
    })
    const without = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    expect(without.tagId).toBe(withHash.tagId)
  })

  it("REFUSES to delete a tag a live entry carries", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await entryOn(t, ALICE, { tagIds: [tagId] })
    await runBackfill(t)

    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId }),
      "IN_USE"
    )
  })

  it("refuses a rename that collides with an existing tag", async () => {
    // Merging many entries onto one tag is destructive, and it must not happen
    // behind a rename box.
    const t = setup()
    await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "urgent" })
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "later",
    })

    await expectCode(
      t.mutation(internal.tags.renameAs, { userId: ALICE, tagId, name: "Urgent" }),
      "IN_USE"
    )
  })

  it("scopes names per user, so two people can both have 'urgent'", async () => {
    const t = setup()
    const alices = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const bobs = await t.mutation(internal.tags.ensureAs, { userId: BOB, name: "urgent" })
    expect(bobs.tagId).not.toBe(alices.tagId)
    expect(bobs.created).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe("title autocomplete", () => {
  it("offers project, tags and billable — and never the note", async () => {
    // The single most important assertion in this file. A note describes one
    // specific interval; copying it forward would put a false account of work
    // nobody has done yet into the user's own voice.
    const t = setup()
    const projectId = await project(t, ALICE, "Acme")
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const startedAt = Date.now() - HOUR
    await t.run(
      async (ctx) =>
        await ctx.db.insert("timeEntries", {
          userId: ALICE,
          clientKey: "k1",
          title: "Checkout form",
          note: "Rebuilt the validation",
          startedAt,
          endedAt: startedAt + 1000,
          durationMs: 1000,
          projectId,
          tagIds: [tagId],
          billable: true,
          source: "web",
          updatedAt: startedAt,
          deletedAt: null,
        })
    )

    const suggestions = await t.query(internal.entries.titleSuggestionsAs, {
      userId: ALICE,
      prefix: "check",
    })

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].projectId).toBe(projectId)
    expect(suggestions[0].tagIds).toEqual([tagId])
    expect(suggestions[0].billable).toBe(true)
    expect(suggestions[0]).not.toHaveProperty("note")
    expect(JSON.stringify(suggestions)).not.toContain("Rebuilt the validation")
  })

  it("collapses repeats and ranks the most recent first", async () => {
    const t = setup()
    const base = Date.now() - 10 * HOUR
    const add = async (title: string, offset: number) =>
      await t.run(
        async (ctx) =>
          await ctx.db.insert("timeEntries", {
            userId: ALICE,
            clientKey: `k${offset}`,
            title,
            startedAt: base + offset,
            endedAt: base + offset + 1000,
            durationMs: 1000,
            tagIds: [],
            billable: false,
            source: "web",
            updatedAt: base + offset,
            deletedAt: null,
          })
      )

    await add("Standup", 0)
    await add("Standup", HOUR)
    await add("Invoicing", 2 * HOUR)

    const suggestions = await t.query(internal.entries.titleSuggestionsAs, {
      userId: ALICE,
    })
    expect(suggestions.map((s) => s.title)).toEqual(["Invoicing", "Standup"])
    expect(suggestions[1].count).toBe(2)
  })

  it("skips untitled and soft-deleted entries", async () => {
    const t = setup()
    await entryOn(t, ALICE, { title: "" })
    await entryOn(t, ALICE, { title: "Deleted work", deleted: true })

    const suggestions = await t.query(internal.entries.titleSuggestionsAs, {
      userId: ALICE,
    })
    expect(suggestions).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Deleting, and the bounded scans behind it
// ---------------------------------------------------------------------------

describe("removing a classifier that is genuinely unused", () => {
  it("soft-deletes a tag nothing carries", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "throwaway",
    })
    await runBackfill(t)

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })

    // The refusal path had tests; the success path did not, so nothing asserted
    // the row is actually marked deleted rather than merely left alone.
    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
    const row = await t.run(async (ctx) => await ctx.db.get(tagId))
    expect(row?.deletedAt).not.toBeNull()
  })

  it("soft-deletes a project nothing references", async () => {
    const t = setup()
    const projectId = await project(t, ALICE, "Abandoned")

    await t.mutation(internal.projects.removeAs, { userId: ALICE, projectId })

    expect(await t.query(internal.projects.listAs, { userId: ALICE })).toHaveLength(0)
    const row = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(row?.deletedAt).not.toBeNull()
  })

  it("still allows deletion when only a SOFT-DELETED entry carries the tag", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "gone",
    })
    await entryOn(t, ALICE, { tagIds: [tagId], deleted: true })
    await runBackfill(t)

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })
    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  })

  it("follows the tags an entry actually carries when they are changed", async () => {
    // The refusal has to track edits, in both directions. A tag taken off the
    // last entry carrying it becomes deletable; the tag put on in its place
    // becomes protected. Getting only the first half right is the failure that
    // leaves a tag undeletable forever on the strength of an entry that has not
    // carried it for a year.
    const t = setup()
    const before = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "before",
    })
    const after = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "after",
    })
    const entryId = await entryOn(t, ALICE, { tagIds: [before.tagId] })
    await runBackfill(t)

    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId,
      tagIds: [after.tagId],
    })

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId: before.tagId })
    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId: after.tagId }),
      "IN_USE"
    )
  })

  it("re-protects a tag when the entry carrying it comes back from the trash", async () => {
    // Delete an entry, and its tags are released. Undo, and they must be held
    // again — otherwise the window between the two is a window in which a tag
    // can be deleted out from under an entry that is about to exist again.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const entryId = await entryOn(t, ALICE, { tagIds: [tagId] })
    await runBackfill(t)
    await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId })

    await t.mutation(internal.entries.restoreAs, { userId: ALICE, entryId })

    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId }),
      "IN_USE"
    )
  })

  it("does not let one user's entry protect another user's tag", async () => {
    // by_user_tag leads with userId, so this should be structural rather than
    // lucky — but "structural" is what everyone says before the leak.
    const t = setup()
    const alices = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const bobs = await t.mutation(internal.tags.ensureAs, { userId: BOB, name: "urgent" })
    await entryOn(t, BOB, { tagIds: [bobs.tagId] })
    await runBackfill(t)

    // Bob's entry blocks Bob's tag and says nothing about Alice's.
    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId: alices.tagId })
    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: BOB, tagId: bobs.tagId }),
      "IN_USE"
    )
  })
})

// ---------------------------------------------------------------------------
// The entryTags join table
// ---------------------------------------------------------------------------

/** Every join row in the deployment, so the invariant can be asserted directly. */
async function joinRows(t: Harness) {
  return await t.run(async (ctx) => await ctx.db.query("entryTags").collect())
}

describe("the entryTags join table", () => {
  it("writes a row per tag when an entry is created", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })

    const entryId = await entryOn(t, ALICE, { tagIds: [tagId] })

    expect(await joinRows(t)).toEqual([
      expect.objectContaining({ userId: ALICE, entryId, tagId }),
    ])
  })

  it("writes rows when a timer is STARTED with tags", async () => {
    // start and create are separate inserts, so each needs its own proof. A
    // missing call on one of them would leave the table right for manual
    // entries and silently wrong for everything the timer produces.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })

    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: "s1",
      tagIds: [tagId],
    })

    expect(await joinRows(t)).toEqual([
      expect.objectContaining({ userId: ALICE, entryId, tagId }),
    ])
  })

  it("reconciles to exactly the new set when an entry's tags change", async () => {
    // Not "adds the new ones": the OLD row has to go, or the tag it points at
    // is protected from deletion forever by an entry that no longer carries it.
    const t = setup()
    const a = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "a" })
    const b = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "b" })
    const c = await t.mutation(internal.tags.ensureAs, { userId: ALICE, name: "c" })
    const entryId = await entryOn(t, ALICE, { tagIds: [a.tagId, b.tagId] })

    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId,
      tagIds: [b.tagId, c.tagId],
    })

    const rows = await joinRows(t)
    expect(rows.map((row) => row.tagId).sort()).toEqual([b.tagId, c.tagId].sort())
    expect(rows.every((row) => row.entryId === entryId)).toBe(true)
  })

  it("drops an entry's rows when it is soft-deleted", async () => {
    // This is what keeps "a tag carried only by trashed entries is deletable"
    // true without putting a liveness column on the join row.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const entryId = await entryOn(t, ALICE, { tagIds: [tagId] })

    await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId })

    expect(await joinRows(t)).toEqual([])
  })

  it("puts the rows back when a deleted entry is restored", async () => {
    // The undo toast. Without this, deleting an entry would permanently release
    // its tags, and restoring it would produce a live entry carrying a tag that
    // nothing protects — the dangling reference the whole model forbids.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const entryId = await entryOn(t, ALICE, { tagIds: [tagId] })
    await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId })

    await t.mutation(internal.entries.restoreAs, { userId: ALICE, entryId })

    expect(await joinRows(t)).toEqual([
      expect.objectContaining({ userId: ALICE, entryId, tagId }),
    ])
  })

  it("drops the rows of a discarded running entry", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: "s1",
      tagIds: [tagId],
    })

    await t.mutation(internal.entries.discardRunningAs, { userId: ALICE })

    expect(await joinRows(t)).toEqual([])
  })

  it("does not duplicate rows when a create is replayed", async () => {
    // start and create are idempotent on clientKey. Note this passes even
    // WITHOUT the early return, because syncEntryTags reconciles — it is an
    // invariant check, not a defence of that branch. The test below is.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await entryOn(t, ALICE, { tagIds: [tagId], clientKey: "same" })
    await entryOn(t, ALICE, { tagIds: [tagId], clientKey: "same" })

    expect(await joinRows(t)).toHaveLength(1)
  })

  it("does not resurrect rows when a create is replayed after the entry was trashed", async () => {
    // What makes the early return in createImpl load-bearing, and the case a
    // "simplification" that synced on the replay path too would break: the
    // rows would come back for a soft-deleted entry, protecting the tag
    // forever on the strength of something in the bin. That is exactly the
    // refusal-nobody-can-act-on that this table exists to prevent, and it
    // would be reached by a retry the user never knew happened.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const entryId = await entryOn(t, ALICE, { tagIds: [tagId], clientKey: "same" })
    await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId })

    await entryOn(t, ALICE, { tagIds: [tagId], clientKey: "same" })

    expect(await joinRows(t)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The backfill, and the gate that makes it safe to deploy
// ---------------------------------------------------------------------------

/**
 * An entry inserted the way rows existed BEFORE the join table — straight into
 * the table, with no join rows. Simulates a deployment's history at the moment
 * the schema change lands.
 */
async function legacyEntry(
  t: Harness,
  userId: string,
  over: Partial<{ tagIds: Array<Id<"tags">>; deletedAt: number | null }> = {}
) {
  const startedAt = Date.now() - 2 * HOUR
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("timeEntries", {
        userId,
        clientKey: `legacy-${Math.random()}`,
        title: "Work",
        startedAt,
        endedAt: startedAt + HOUR,
        durationMs: HOUR,
        tagIds: over.tagIds ?? [],
        billable: false,
        source: "web",
        updatedAt: startedAt,
        deletedAt: over.deletedAt ?? null,
      })
  )
}

/**
 * Runs the backfill to completion, the way the operator's action does.
 *
 * Note there is no cursor to thread. Where the next page starts is the
 * migration's own business, held in the database — see the resume test below
 * for why it must not be an argument.
 */
async function runBackfill(t: Harness, numItems = 50) {
  for (;;) {
    const result: { isDone: boolean } = await t.mutation(
      internal.migrations.backfillEntryTags,
      { numItems }
    )
    if (result.isDone) return
  }
}

describe("the entryTags backfill", () => {
  it("writes rows for entries that predate the join table", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    const entryId = await legacyEntry(t, ALICE, { tagIds: [tagId] })

    await runBackfill(t)

    expect(await joinRows(t)).toEqual([
      expect.objectContaining({ userId: ALICE, entryId, tagId }),
    ])
  })

  it("writes nothing for a soft-deleted legacy entry", async () => {
    // A trashed entry does not hold its tags, so backfilling one would resurrect
    // a refusal the live rules say should not exist.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "gone",
    })
    await legacyEntry(t, ALICE, { tagIds: [tagId], deletedAt: Date.now() })

    await runBackfill(t)

    expect(await joinRows(t)).toEqual([])
  })

  it("produces the same table when run twice", async () => {
    // It will be run twice — a timed-out loop, a nervous operator, a redeploy.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await legacyEntry(t, ALICE, { tagIds: [tagId] })

    await runBackfill(t)
    await runBackfill(t)

    expect(await joinRows(t)).toHaveLength(1)
  })

  it("crosses page boundaries rather than stopping at the first one", async () => {
    // The bug this pins is a backfill that reports done after one page and
    // leaves most of the history uncovered — which would then read as "no tag
    // is in use anywhere" and let every tag be deleted.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    for (let i = 0; i < 12; i += 1) await legacyEntry(t, ALICE, { tagIds: [tagId] })

    await runBackfill(t, 5)

    expect(await joinRows(t)).toHaveLength(12)
  })

  it("refuses every tag delete until the backfill has finished", async () => {
    // The window this closes: between the schema landing and the backfill
    // finishing, entryTags is empty — and an empty index reads exactly like
    // "nothing carries this tag". Deleting on that reading destroys tags a
    // whole history references.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "throwaway",
    })
    // History the backfill has not covered yet. Without this the deployment
    // has nothing to index and is not gated at all — see the test below.
    await legacyEntry(t, BOB, { tagIds: [] })

    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId }),
      "NOT_READY"
    )
  })

  it("does not gate a deployment that has no entries at all", async () => {
    // A fresh deployment — a new dev instance, a preview branch, a first
    // install — has no history, so entryTags is complete by virtue of there
    // being nothing to cover. The gate's whole argument is that an empty index
    // cannot be distinguished from an unindexed one; with an empty timeEntries
    // there is nothing to distinguish, and refusing here would wedge every new
    // environment behind a migration over zero rows.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "throwaway",
    })

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })

    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  })

  it("stays open once opened, rather than re-gating on the first entry", async () => {
    // The trap in the rule above: if emptiness were re-checked on every call,
    // a deployment would work, then silently stop the moment its user tracked
    // anything. Recognising an empty deployment RECORDS completion, so the
    // answer does not flap.
    const t = setup()
    const first = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "one",
    })
    const second = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "two",
    })
    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId: first.tagId })

    // Now there is history, and it was written through the live path.
    await entryOn(t, ALICE, {})

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId: second.tagId })
    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  })

  it("stays closed while the backfill is only PARTLY done", async () => {
    // The flag has to be set by the last page, not the first. A backfill that
    // announced itself complete after one page would open the gate on a table
    // covering a fraction of history.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    for (let i = 0; i < 12; i += 1) await legacyEntry(t, ALICE, { tagIds: [tagId] })

    const first = await t.mutation(internal.migrations.backfillEntryTags, {
      numItems: 5,
    })
    expect(first.isDone).toBe(false)

    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId }),
      "NOT_READY"
    )
  })

  it("resumes from its own stored checkpoint, so coverage cannot be skipped", async () => {
    // Where the next page starts is held in the database and advanced in the
    // SAME transaction as the page it describes. It used to be an argument,
    // which was a hole rather than a convenience: a caller handing in a cursor
    // from the middle would leave every earlier entry unreconciled, and the run
    // would still reach the end and record itself COMPLETE. The gate would then
    // vouch for an index covering a fraction of history, and tags a live entry
    // carries would delete cleanly.
    //
    // Three pages of five over twelve rows. If each call restarted, the third
    // would never report done and only five would ever be covered.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    for (let i = 0; i < 12; i += 1) await legacyEntry(t, ALICE, { tagIds: [tagId] })

    const first = await t.mutation(internal.migrations.backfillEntryTags, { numItems: 5 })
    const second = await t.mutation(internal.migrations.backfillEntryTags, { numItems: 5 })
    const third = await t.mutation(internal.migrations.backfillEntryTags, { numItems: 5 })

    expect([first.isDone, second.isDone, third.isDone]).toEqual([false, false, true])
    expect(await joinRows(t)).toHaveLength(12)
  })

  it("is a no-op once it has already finished", async () => {
    // A re-run after completion must not walk the table again, and must not
    // reopen a checkpoint that has been closed.
    const t = setup()
    await legacyEntry(t, ALICE, { tagIds: [] })
    await runBackfill(t)

    const again = await t.mutation(internal.migrations.backfillEntryTags, { numItems: 5 })

    expect(again.isDone).toBe(true)
    expect(again.scanned).toBe(0)
  })

  it("takes the join rows with it when a user is purged", async () => {
    // purgeUser is the account-deletion cascade. A join table it does not know
    // about leaves rows pointing at entries and tags that no longer exist.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await entryOn(t, ALICE, { tagIds: [tagId] })
    expect(await joinRows(t)).toHaveLength(1)

    await t.mutation(internal.maintenance.purgeUser, { userId: ALICE })

    expect(await joinRows(t)).toEqual([])
  })

  it("does not gate RENAMING, which never needed the index", async () => {
    // Renaming reaches every entry through the id the entry already stores. It
    // has no reason to wait for a migration, and telling someone their tags are
    // frozen when only one verb is would be a lie.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })

    await t.mutation(internal.tags.renameAs, { userId: ALICE, tagId, name: "critical" })

    const rows = await t.query(internal.tags.listAs, { userId: ALICE })
    expect(rows[0].name).toBe("critical")
  })
})

/**
 * Past the old boundary, where tag deletion used to stop working.
 *
 * These are slow — they build ENTRY_SCAN_LIMIT + 1 rows — and they are the
 * point of the whole join table, so they stay. The first one INVERTS a test
 * that used to assert the opposite: it pinned the known limitation, which was
 * that once an account passed 2,000 entries no tag could ever be deleted again,
 * including one created that morning and used on nothing. That is now fixed
 * rather than documented, and this is what says so.
 */
describe("tag deletion past the old scan limit", () => {
  async function bulkEntries(
    t: Harness,
    userId: string,
    n: number,
    tagIds: Array<Id<"tags">> = []
  ) {
    const start = Date.now() - 400 * 24 * HOUR
    // Inserted raw and batched: raw because these stand in for history written
    // before the join table existed, batched because one t.run per row is what
    // makes this take minutes.
    const BATCH = 500
    for (let offset = 0; offset < n; offset += BATCH) {
      await t.run(async (ctx) => {
        for (let i = offset; i < Math.min(offset + BATCH, n); i += 1) {
          await ctx.db.insert("timeEntries", {
            userId,
            clientKey: `bulk-${i}`,
            title: "Work",
            startedAt: start + i * 60_000,
            endedAt: start + i * 60_000 + 60_000,
            durationMs: 60_000,
            tagIds,
            billable: false,
            source: "web",
            updatedAt: start,
            deletedAt: null,
          })
        }
      })
    }
  }

  it("DELETES an unused tag in an account well past the old limit", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "brand-new",
    })
    await bulkEntries(t, ALICE, ENTRY_SCAN_LIMIT + 1)
    await runBackfill(t, 500)

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })

    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  }, 60_000)

  it("still refuses when the only entry carrying it sits beyond the old window", async () => {
    // The sharpest proof that the index is doing real work. The old scan read
    // the first 2,000 entries by start time; an entry at position 2,001 was
    // never looked at. Reached now because the lookup is keyed by TAG, not by
    // position in history.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "urgent",
    })
    await bulkEntries(t, ALICE, ENTRY_SCAN_LIMIT + 1)
    // Newest, so it falls outside a window that starts at the oldest row.
    await entryOn(t, ALICE, { tagIds: [tagId] })
    await runBackfill(t, 500)

    const failure = await expectFailure(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })
    )
    expect(failure.code).toBe("IN_USE")
    expect(failure.meta?.count).toBe(1)
  }, 60_000)

  it("says 'At least' rather than an exact number it cannot stand behind", async () => {
    // Matches projects.remove. A precise-looking count that is really a floor
    // is worse than a vaguer one that is true.
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "everywhere",
    })
    await bulkEntries(t, ALICE, ENTRY_SCAN_LIMIT + 1, [tagId])
    await runBackfill(t, 500)

    const failure = await expectFailure(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })
    )
    expect(failure.code).toBe("IN_USE")
    expect(failure.message).toContain("At least")
  }, 60_000)
})
