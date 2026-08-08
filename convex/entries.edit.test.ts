/// <reference types="vite/client" />
// Phase 4's write surface: the note, the field edits, the anchored time rule,
// soft delete with undo, and manual create.
//
// Separate from entries.test.ts, which covers the tracking loop (start / stop /
// discard). The split is by what breaks: those tests are about the one-running
// invariant, these are about not corrupting a row that already exists.
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

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 24 * HOUR

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

type Harness = ReturnType<typeof setup>

/** A completed entry owned by `userId`, inserted directly so the times are exact. */
async function seedEntry(
  t: Harness,
  userId: string,
  over: Partial<{
    startedAt: number
    endedAt: number | null
    title: string
    note: string
    billable: boolean
    deletedAt: number | null
  }> = {}
): Promise<Id<"timeEntries">> {
  const startedAt = over.startedAt ?? Date.now() - 2 * HOUR
  const endedAt = over.endedAt === undefined ? startedAt + HOUR : over.endedAt
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("timeEntries", {
        userId,
        clientKey: `seed-${Math.abs(startedAt)}-${endedAt ?? "run"}`,
        title: over.title ?? "Seeded",
        note: over.note,
        startedAt,
        endedAt,
        durationMs: endedAt === null ? null : endedAt - startedAt,
        tagIds: [],
        billable: over.billable ?? false,
        source: "web",
        updatedAt: startedAt,
        deletedAt: over.deletedAt ?? null,
      })
  )
}

const read = async (t: Harness, id: Id<"timeEntries">) =>
  await t.run(async (ctx) => await ctx.db.get(id))

// ---------------------------------------------------------------------------

describe("authorization", () => {
  it("rejects anonymous callers on every new public function", async () => {
    const t = setup()
    const id = await seedEntry(t, ALICE)

    await expectCode(
      t.mutation(api.entries.setNote, { entryId: id, note: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.update, { entryId: id, title: "x" }),
      "UNAUTHENTICATED"
    )
    await expectCode(
      t.mutation(api.entries.editTime, { entryId: id, field: "duration", value: HOUR }),
      "UNAUTHENTICATED"
    )
    await expectCode(t.mutation(api.entries.remove, { entryId: id }), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.entries.restore, { entryId: id }), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.entries.create, {
        clientKey: key(1),
        startedAt: Date.now() - HOUR,
        endedAt: Date.now(),
      }),
      "UNAUTHENTICATED"
    )
  })

  it("will not let one user edit, delete, or restore another user's entry", async () => {
    const t = setup()
    const alices = await seedEntry(t, ALICE, { title: "Alice's work" })

    await expectCode(
      t.mutation(internal.entries.setNoteAs, {
        userId: BOB,
        entryId: alices,
        note: "mine now",
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.entries.updateAs, {
        userId: BOB,
        entryId: alices,
        title: "mine now",
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.entries.editTimeAs, {
        userId: BOB,
        entryId: alices,
        field: "duration",
        value: 5 * HOUR,
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.entries.removeAs, { userId: BOB, entryId: alices }),
      "NOT_FOUND"
    )

    // Not merely refused — untouched.
    const row = await read(t, alices)
    expect(row?.title).toBe("Alice's work")
    expect(row?.deletedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe("setNote", () => {
  it("writes and trims the note", async () => {
    const t = setup()
    const id = await seedEntry(t, ALICE)

    await t.mutation(internal.entries.setNoteAs, {
      userId: ALICE,
      entryId: id,
      note: "  Fixed the redirect loop  ",
    })

    expect((await read(t, id))?.note).toBe("Fixed the redirect loop")
  })

  it("treats an emptied note as ABSENT, not as an empty string", async () => {
    // "Has a note" is what the day header counts and Reports filters on. Two
    // representations of nothing would eventually disagree with each other.
    const t = setup()
    const id = await seedEntry(t, ALICE, { note: "something" })

    await t.mutation(internal.entries.setNoteAs, { userId: ALICE, entryId: id, note: "" })
    expect((await read(t, id))?.note).toBeUndefined()

    await t.mutation(internal.entries.setNoteAs, {
      userId: ALICE,
      entryId: id,
      note: "   \n  ",
    })
    expect((await read(t, id))?.note).toBeUndefined()
  })

  it("annotates a RUNNING entry", async () => {
    // The note describes the work, not the interval. Waiting until stop would
    // lose the thought that prompted writing it.
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })

    await t.mutation(internal.entries.setNoteAs, {
      userId: ALICE,
      entryId: started.entryId,
      note: "halfway through the migration",
    })

    const row = await read(t, started.entryId)
    expect(row?.note).toBe("halfway through the migration")
    expect(row?.endedAt).toBeNull() // still running
  })

  it("refuses a note past the ceiling", async () => {
    const t = setup()
    const id = await seedEntry(t, ALICE)
    await expectCode(
      t.mutation(internal.entries.setNoteAs, {
        userId: ALICE,
        entryId: id,
        note: "x".repeat(2_001),
      }),
      "TOO_LONG"
    )
  })
})

// ---------------------------------------------------------------------------

describe("update", () => {
  it("leaves absent fields alone", async () => {
    // Absent means unchanged, so the inline editor sends only the field the
    // user touched and two edits to different fields cannot clobber each other.
    const t = setup()
    const id = await seedEntry(t, ALICE, {
      title: "Original",
      note: "Original note",
      billable: true,
    })

    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId: id,
      title: "Renamed",
    })

    const row = await read(t, id)
    expect(row?.title).toBe("Renamed")
    expect(row?.note).toBe("Original note")
    expect(row?.billable).toBe(true)
  })

  it("distinguishes clearing a project from not mentioning one", async () => {
    const t = setup()
    const projectId = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: ALICE,
          name: "Acme",
          color: "amber",
          billableByDefault: false,
          archived: false,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )
    const id = await seedEntry(t, ALICE)

    await t.mutation(internal.entries.updateAs, { userId: ALICE, entryId: id, projectId })
    expect((await read(t, id))?.projectId).toBe(projectId)

    // Absent: untouched.
    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId: id,
      title: "Still Acme",
    })
    expect((await read(t, id))?.projectId).toBe(projectId)

    // Explicit null: unassigned.
    await t.mutation(internal.entries.updateAs, {
      userId: ALICE,
      entryId: id,
      projectId: null,
    })
    expect((await read(t, id))?.projectId).toBeUndefined()
  })

  it("does not re-inherit billable when the project changes", async () => {
    // Inheritance is a convenience at creation. Re-applying it here would
    // silently reverse a decision the user made on this specific entry.
    const t = setup()
    const projectId = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: ALICE,
          name: "Pro bono",
          color: "slate",
          billableByDefault: false,
          archived: false,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )
    const id = await seedEntry(t, ALICE, { billable: true })

    await t.mutation(internal.entries.updateAs, { userId: ALICE, entryId: id, projectId })

    expect((await read(t, id))?.billable).toBe(true)
  })

  it("refuses another user's project and tags", async () => {
    const t = setup()
    const bobsProject = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: BOB,
          name: "Bob's",
          color: "rose",
          billableByDefault: false,
          archived: false,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )
    const bobsTag = await t.run(
      async (ctx) =>
        await ctx.db.insert("tags", {
          userId: BOB,
          name: "bob",
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )
    const id = await seedEntry(t, ALICE)

    await expectCode(
      t.mutation(internal.entries.updateAs, {
        userId: ALICE,
        entryId: id,
        projectId: bobsProject,
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.entries.updateAs, {
        userId: ALICE,
        entryId: id,
        tagIds: [bobsTag],
      }),
      "NOT_FOUND"
    )
  })
})

// ---------------------------------------------------------------------------

describe("editTime — the reconciliation rule", () => {
  it("edit START recomputes duration and does not move the end", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const endedAt = startedAt + 2 * HOUR
    const id = await seedEntry(t, ALICE, { startedAt, endedAt })

    const times = await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: id,
      field: "start",
      value: startedAt + 30 * MINUTE,
    })

    expect(times.endedAt).toBe(endedAt)
    expect(times.durationMs).toBe(90 * MINUTE)
  })

  it("edit END recomputes duration and does not move the start", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const id = await seedEntry(t, ALICE, { startedAt, endedAt: startedAt + 2 * HOUR })

    const times = await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: id,
      field: "end",
      value: startedAt + 3 * HOUR,
    })

    expect(times.startedAt).toBe(startedAt)
    expect(times.durationMs).toBe(3 * HOUR)
  })

  it("edit DURATION moves the end and anchors the start", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const id = await seedEntry(t, ALICE, { startedAt, endedAt: startedAt + 2 * HOUR })

    const times = await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: id,
      field: "duration",
      value: 45 * MINUTE,
    })

    expect(times.startedAt).toBe(startedAt)
    expect(times.endedAt).toBe(startedAt + 45 * MINUTE)
  })

  it("edit DURATION on a RUNNING entry moves the start instead", async () => {
    // There is no end to move. "It has been running for 45 minutes" can only be
    // honoured by moving the start, and the UI has to say so.
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const before = await read(t, started.entryId)

    const times = await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: started.entryId,
      field: "duration",
      value: 45 * MINUTE,
    })

    expect(times.endedAt).toBeNull()
    expect(times.startedAt).toBeLessThan(before!.startedAt)
    // now - 45m, within a second of the mutation's own clock.
    expect(Date.now() - times.startedAt).toBeGreaterThanOrEqual(45 * MINUTE)
    expect(Date.now() - times.startedAt).toBeLessThan(45 * MINUTE + 5_000)
  })

  it("giving a RUNNING entry an end time stops it", async () => {
    // The ordinary fix for "I finished twenty minutes ago and forgot to stop",
    // performed from the row rather than the timer bar.
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const row = await read(t, started.entryId)

    await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: started.entryId,
      field: "end",
      value: row!.startedAt + 20 * MINUTE,
    })

    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
    expect((await read(t, started.entryId))?.durationMs).toBe(20 * MINUTE)
  })

  it("refuses an end before the start", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const id = await seedEntry(t, ALICE, { startedAt, endedAt: startedAt + HOUR })

    await expectCode(
      t.mutation(internal.entries.editTimeAs, {
        userId: ALICE,
        entryId: id,
        field: "end",
        value: startedAt - HOUR,
      }),
      "END_NOT_AFTER_START"
    )
  })

  it("applies the 24-hour ceiling to a mistyped START, not only to duration", async () => {
    // A mistyped year in the start field used to write a 584-day entry with no
    // refusal at all — into every day header, week total and export.
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const id = await seedEntry(t, ALICE, { startedAt, endedAt: startedAt + HOUR })

    await expectCode(
      t.mutation(internal.entries.editTimeAs, {
        userId: ALICE,
        entryId: id,
        field: "start",
        value: Date.UTC(2025, 7, 6, 9, 0, 0),
      }),
      "DURATION_TOO_LONG"
    )
    // Refused, not partially applied.
    expect((await read(t, id))?.startedAt).toBe(startedAt)
  })

  it("clamps a RUNNING entry's start out of the future rather than freezing the clock", async () => {
    // A future start renders 0:00:00 and stays there — a stopped-looking clock
    // that is actually running. Ambiguity is a defect.
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })

    const times = await t.mutation(internal.entries.editTimeAs, {
      userId: ALICE,
      entryId: started.entryId,
      field: "start",
      value: Date.now() + 7 * DAY,
    })

    expect(times.startedAt).toBeLessThanOrEqual(Date.now())
    expect(times.endedAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe("remove and restore", () => {
  it("hides a removed entry from the log and brings it back on undo", async () => {
    const t = setup()
    const startedAt = Date.now() - 3 * HOUR
    const id = await seedEntry(t, ALICE, { startedAt, endedAt: startedAt + HOUR })
    const range = { fromMs: startedAt - DAY, toMs: startedAt + DAY }

    await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId: id })
    expect(
      await t.query(internal.entries.listRangeAs, { userId: ALICE, ...range })
    ).toHaveLength(0)

    await t.mutation(internal.entries.restoreAs, { userId: ALICE, entryId: id })
    expect(
      await t.query(internal.entries.listRangeAs, { userId: ALICE, ...range })
    ).toHaveLength(1)
  })

  it("is idempotent — a double-fired delete does not report two removals", async () => {
    const t = setup()
    const id = await seedEntry(t, ALICE)

    const first = await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId: id })
    const second = await t.mutation(internal.entries.removeAs, { userId: ALICE, entryId: id })

    expect(first.removedEntryIds).toHaveLength(1)
    expect(second.removedEntryIds).toHaveLength(0)
  })

  it("closes a RUNNING entry on the way out, so undo cannot resurrect a timer", async () => {
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })

    await t.mutation(internal.entries.removeAs, {
      userId: ALICE,
      entryId: started.entryId,
    })
    const removed = await read(t, started.entryId)
    expect(removed?.endedAt).not.toBeNull()
    expect(removed?.deletedAt).not.toBeNull()

    await t.mutation(internal.entries.restoreAs, {
      userId: ALICE,
      entryId: started.entryId,
    })
    // The whole point: hours later, undo must not hand back a live clock.
    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
  })

  it("restores an open-ended row as a completed one", async () => {
    // A row soft-deleted with endedAt still null (an import, an older bug).
    // Restoring it as-is would give the user a second running timer.
    const t = setup()
    const startedAt = Date.now() - 5 * HOUR
    const id = await t.run(
      async (ctx) =>
        await ctx.db.insert("timeEntries", {
          userId: ALICE,
          clientKey: "imported",
          title: "Imported",
          startedAt,
          endedAt: null,
          durationMs: null,
          tagIds: [],
          billable: false,
          source: "import",
          updatedAt: startedAt + 2 * HOUR,
          deletedAt: startedAt + 2 * HOUR,
        })
    )

    await t.mutation(internal.entries.restoreAs, { userId: ALICE, entryId: id })

    const row = await read(t, id)
    expect(row?.deletedAt).toBeNull()
    expect(row?.endedAt).toBe(startedAt + 2 * HOUR)
    expect(row?.durationMs).toBe(2 * HOUR)
    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
  })

  it("restoring a live entry is a no-op", async () => {
    const t = setup()
    const id = await seedEntry(t, ALICE)
    const result = await t.mutation(internal.entries.restoreAs, {
      userId: ALICE,
      entryId: id,
    })
    expect(result.restoredEntryIds).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------

describe("create — manual entry", () => {
  it("records a completed entry marked as manual", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)

    const { entryId, replayed } = await t.mutation(internal.entries.createAs, {
      userId: ALICE,
      clientKey: key(1),
      title: "Client call",
      note: "  Scoped the migration  ",
      startedAt,
      endedAt: startedAt + 90 * MINUTE,
    })

    expect(replayed).toBe(false)
    const row = await read(t, entryId)
    expect(row?.source).toBe("manual")
    expect(row?.durationMs).toBe(90 * MINUTE)
    expect(row?.note).toBe("Scoped the migration")
    expect(row?.endedAt).not.toBeNull()
  })

  it("is idempotent on clientKey, so a retried submit is not a duplicate day", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)
    const args = {
      userId: ALICE,
      clientKey: key(1),
      startedAt,
      endedAt: startedAt + HOUR,
    }

    const first = await t.mutation(internal.entries.createAs, args)
    const second = await t.mutation(internal.entries.createAs, args)

    expect(second.entryId).toBe(first.entryId)
    expect(second.replayed).toBe(true)
  })

  it("REFUSES a backwards interval rather than clamping it", async () => {
    // Unlike start, both timestamps here came from a keyboard. Clamping would
    // record a length the user did not mean, and they cannot see the wrong
    // value the way they can see a device clock they never set.
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)

    await expectCode(
      t.mutation(internal.entries.createAs, {
        userId: ALICE,
        clientKey: key(1),
        startedAt,
        endedAt: startedAt - HOUR,
      }),
      "END_NOT_AFTER_START"
    )
    await expectCode(
      t.mutation(internal.entries.createAs, {
        userId: ALICE,
        clientKey: key(2),
        startedAt,
        endedAt: startedAt,
      }),
      "END_NOT_AFTER_START"
    )
  })

  it("refuses a typed entry longer than a day", async () => {
    const t = setup()
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)

    await expectCode(
      t.mutation(internal.entries.createAs, {
        userId: ALICE,
        clientKey: key(1),
        startedAt,
        endedAt: startedAt + DAY + MINUTE,
      }),
      "DURATION_TOO_LONG"
    )
  })

  it("inherits billable from the project", async () => {
    const t = setup()
    const projectId = await t.run(
      async (ctx) =>
        await ctx.db.insert("projects", {
          userId: ALICE,
          name: "Acme",
          color: "amber",
          billableByDefault: true,
          archived: false,
          updatedAt: Date.now(),
          deletedAt: null,
        })
    )
    const startedAt = Date.UTC(2026, 7, 6, 9, 0, 0)

    const { entryId } = await t.mutation(internal.entries.createAs, {
      userId: ALICE,
      clientKey: key(1),
      startedAt,
      endedAt: startedAt + HOUR,
      projectId,
    })

    expect((await read(t, entryId))?.billable).toBe(true)
  })

  it("does not disturb a running timer", async () => {
    // Backfilling yesterday while today's clock runs is ordinary. Manual create
    // is not a start, so it must not trigger the atomic handoff.
    const t = setup()
    const started = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    const yesterday = Date.now() - DAY

    await t.mutation(internal.entries.createAs, {
      userId: ALICE,
      clientKey: key(2),
      startedAt: yesterday,
      endedAt: yesterday + HOUR,
    })

    const running = await t.query(internal.entries.getRunningAs, { userId: ALICE })
    expect(running?._id).toBe(started.entryId)
  })
})
