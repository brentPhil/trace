import { describe, expect, it } from "vitest"
import { toLogItems } from "@/lib/group-sittings"
import { makeEntry, NOW } from "@/test-utils/fixtures"
import type { LogItem } from "@/lib/group-sittings"
import type { Id } from "../../convex/_generated/dataModel"

/*
 * The unit under test is the whole of the grouping rule, and every case below
 * is a decision from the spec rather than a mechanism: which entries are "the
 * same", which are deliberately left alone, and what the parent row is allowed
 * to claim about its members.
 */

const id = (value: string) => value as unknown as Id<"timeEntries">
const project = (value: string) => value as unknown as Id<"projects">

/**
 * A completed entry whose three time fields AGREE.
 *
 * `makeEntry` defaults to a one-hour block at `NOW`, so overriding `startedAt`
 * alone leaves `endedAt` and `durationMs` describing a different block — which
 * would make the span assertions below pass against arithmetic nobody meant.
 * One helper, so that cannot happen in one case and not another.
 */
function sitting(over: {
  id: string
  title: string
  projectId?: string
  startAt: number
  ms: number
  note?: string
}) {
  return makeEntry({
    _id: id(over.id),
    title: over.title,
    ...(over.projectId === undefined ? {} : { projectId: project(over.projectId) }),
    startedAt: over.startAt,
    endedAt: over.startAt + over.ms,
    durationMs: over.ms,
    note: over.note,
  })
}

const HOUR = 3_600_000

/** Narrows, and names the file and index when it does not. */
function sittingAt(items: Array<LogItem>, at: number) {
  const item = items[at]
  if (item === undefined) throw new Error(`no item at index ${at}`)
  if (item.kind !== "sitting") throw new Error(`items[${at}] is a row, not a sitting`)
  return item
}

function rowAt(items: Array<LogItem>, at: number) {
  const item = items[at]
  if (item === undefined) throw new Error(`no item at index ${at}`)
  if (item.kind !== "row") throw new Error(`items[${at}] is a sitting, not a row`)
  return item
}

describe("toLogItems", () => {
  it("collapses two entries sharing a title and a project", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 4 * HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: 2 * HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("keeps the same title on two projects apart", () => {
    // The key includes the project because this product invoices per client:
    // one title billed to two clients is two different pieces of work.
    const items = toLogItems([
      sitting({ id: "b", title: "Standup", projectId: "p2", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Standup", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    expect(rowAt(items, 0).entry._id).toBe(id("b"))
    expect(rowAt(items, 1).entry._id).toBe(id("a"))
  })

  it("treats a difference of case as a different title", () => {
    // Case-folding is a guess about intent, and the user can see the two
    // titles differ. "Never guesses on the user's behalf", read literally.
    const items = toLogItems([
      sitting({ id: "b", title: "Fixing dropdowns", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "fixing dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
  })

  it("groups on the TRIMMED title, so stray whitespace does not split a sitting", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "  Crew dropdowns ", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("never wraps a lone entry", () => {
    // A badge beside a single row is a claim about a group that does not
    // exist, and a day of unique titles has to render exactly as it does today.
    const items = toLogItems([
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(rowAt(items, 0).entry._id).toBe(id("a"))
  })

  it("never groups untitled entries", () => {
    // Two blank-titled entries would collapse behind an empty label — two
    // separate pieces of unaccounted work hidden under nothing at all.
    const items = toLogItems([
      sitting({ id: "b", title: "   ", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    expect(rowAt(items, 0).entry._id).toBe(id("b"))
    expect(rowAt(items, 1).entry._id).toBe(id("a"))
  })

  it("groups entries that share a title and have NO project", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "Admin", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Admin", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("puts a sitting where its newest member sat, and keeps members newest first", () => {
    // Input arrives newest-first from `groupByDay`. A sitting takes the
    // position of its FIRST occurrence, so the log's ordering is unchanged for
    // every row that is not part of a group.
    const items = toLogItems([
      sitting({ id: "a2", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 4 * HOUR, ms: HOUR }),
      sitting({ id: "b1", title: "Email", projectId: "p1", startAt: NOW + 2 * HOUR, ms: HOUR }),
      sitting({ id: "a1", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    const group = sittingAt(items, 0)
    expect(group.entries.map((entry) => entry._id)).toEqual([id("a2"), id("a1")])
    expect(rowAt(items, 1).entry._id).toBe(id("b1"))
  })

  it("sums the total, counts the notes, and spans first start to last end", () => {
    const items = toLogItems([
      sitting({
        id: "b",
        title: "Crew dropdowns",
        projectId: "p1",
        startAt: NOW + 4 * HOUR,
        ms: HOUR,
        note: "Finished the assignment modal.",
      }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: 2 * HOUR }),
    ])

    const group = sittingAt(items, 0)
    expect(group.totalMs).toBe(3 * HOUR)
    expect(group.notedCount).toBe(1)
    expect(group.fromMs).toBe(NOW)
    expect(group.toMs).toBe(NOW + 5 * HOUR)
  })

  it("does not count a whitespace-only note as noted", () => {
    // The day header's "n of m noted" nudge means "carries prose", and a
    // spacebar is not prose. Same `.trim()` rule `groupByDay` applies.
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + HOUR, ms: HOUR, note: "   " }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(sittingAt(items, 0).notedCount).toBe(0)
  })

  it("lets the span exceed the total when the sittings do not abut", () => {
    /*
     * RECORDED AS A DECISION, not discovered as a bug. The parent's span is
     * earliest start to latest end, so a gap between sittings makes it wider
     * than the total — 3h of wall clock against 2h tracked, here. Toggl's
     * rendering was chosen knowing this, because the span answers "when in the
     * day was this" and the TOTAL is the only figure that reaches an invoice.
     */
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 2 * HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    const group = sittingAt(items, 0)
    expect(group.totalMs).toBe(2 * HOUR)
    expect(group.toMs - group.fromMs).toBe(3 * HOUR)
  })

  it("returns nothing for no entries", () => {
    expect(toLogItems([])).toEqual([])
  })
})
