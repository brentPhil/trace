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
import { traceErrorCode } from "./lib/codes"
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

type Harness = ReturnType<typeof setup>

async function project(t: Harness, userId: string, name: string, over = {}) {
  const { projectId } = await t.mutation(internal.projects.createAs, {
    userId,
    name,
    ...over,
  })
  return projectId
}

async function entryOn(
  t: Harness,
  userId: string,
  over: Partial<{
    projectId: Id<"projects">
    tagIds: Array<Id<"tags">>
    title: string
    deletedAt: number | null
  }> = {}
) {
  const startedAt = Date.now() - 2 * HOUR
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("timeEntries", {
        userId,
        clientKey: `k-${Math.random()}`,
        title: over.title ?? "Work",
        startedAt,
        endedAt: startedAt + HOUR,
        durationMs: HOUR,
        projectId: over.projectId,
        tagIds: over.tagIds ?? [],
        billable: false,
        source: "web",
        updatedAt: startedAt,
        deletedAt: over.deletedAt ?? null,
      })
  )
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
    await entryOn(t, ALICE, { projectId, deletedAt: Date.now() })

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
    const startedAt = Date.now() - HOUR
    await entryOn(t, ALICE, { title: "" })
    await entryOn(t, ALICE, { title: "Deleted work", deletedAt: startedAt })

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
    await entryOn(t, ALICE, { tagIds: [tagId], deletedAt: Date.now() })

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })
    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  })
})

/**
 * The bounded scans, exercised at their actual boundary.
 *
 * These are slow — they build ENTRY_SCAN_LIMIT + 1 rows — and they are worth
 * it, because the saturation branch is the one that was WRONG and untested: the
 * comment claimed a refusal a heavy user would meet "occasionally", while the
 * code refuses unconditionally for every tag once the account passes the limit,
 * since the scan is not filtered by tag. A test at the boundary is what makes
 * that behaviour a decision rather than a surprise.
 */
describe("the bounded scans at their boundary", () => {
  async function bulkEntries(t: Harness, userId: string, n: number) {
    const start = Date.now() - 400 * 24 * HOUR
    // Batched, because one t.run per row is what makes this take minutes.
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
            tagIds: [],
            billable: false,
            source: "web",
            updatedAt: start,
            deletedAt: null,
          })
        }
      })
    }
  }

  it("refuses to delete an unused tag once the account exceeds the scan limit", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "brand-new",
    })
    await bulkEntries(t, ALICE, ENTRY_SCAN_LIMIT + 1)

    // Nothing carries this tag. It still cannot be deleted, because proving
    // that would mean reading every entry — which is the known limitation
    // documented on tags.removeImpl, pinned here so it cannot change silently.
    await expectCode(
      t.mutation(internal.tags.removeAs, { userId: ALICE, tagId }),
      "IN_USE"
    )
  }, 60_000)

  it("still deletes an unused tag one row BELOW the limit", async () => {
    const t = setup()
    const { tagId } = await t.mutation(internal.tags.ensureAs, {
      userId: ALICE,
      name: "brand-new",
    })
    await bulkEntries(t, ALICE, ENTRY_SCAN_LIMIT)

    await t.mutation(internal.tags.removeAs, { userId: ALICE, tagId })
    expect(await t.query(internal.tags.listAs, { userId: ALICE })).toHaveLength(0)
  }, 60_000)
})
