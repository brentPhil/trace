import { describe, expect, it } from "vitest"
import { joinNotes, tagUnion, toLogItems } from "@/lib/group-sittings"
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

const TAG_A = "jd7taga" as unknown as Id<"tags">
const TAG_B = "jd7tagb" as unknown as Id<"tags">
const TAG_C = "jd7tagc" as unknown as Id<"tags">

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
  const item = items.at(at)
  if (item === undefined) throw new Error(`no item at index ${at}`)
  if (item.kind !== "sitting") throw new Error(`items[${at}] is a row, not a sitting`)
  return item
}

function rowAt(items: Array<LogItem>, at: number) {
  const item = items.at(at)
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

  it("sums the total and spans first start to last end", () => {
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
    expect(group.fromMs).toBe(NOW)
    expect(group.toMs).toBe(NOW + 5 * HOUR)
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

describe("joinNotes", () => {
  it("returns one note unchanged when every member wrote the same thing", () => {
    // The case that prompted this whole design: one ticket, two sittings, one
    // account of what got done, typed twice by hand.
    const same = "Fixed the 12-hour clock hours field."
    expect(
      joinNotes([
        makeEntry({ startedAt: 200, note: same }),
        makeEntry({ startedAt: 100, note: same }),
      ])
    ).toBe(same)
  })

  it("joins distinct notes oldest-first, so nothing is resolved unseen", () => {
    expect(
      joinNotes([
        makeEntry({ startedAt: 200, note: "Then the tests." }),
        makeEntry({ startedAt: 100, note: "First the parser." }),
      ])
    ).toBe("First the parser.\n\nThen the tests.")
  })

  it("skips members with no note rather than leaving blank paragraphs", () => {
    expect(
      joinNotes([
        makeEntry({ startedAt: 300, note: "Second." }),
        makeEntry({ startedAt: 200, note: "   " }),
        makeEntry({ startedAt: 100, note: "First." }),
      ])
    ).toBe("First.\n\nSecond.")
  })

  it("is empty when nobody wrote anything, which is what renders + add note", () => {
    expect(joinNotes([makeEntry({ note: undefined }), makeEntry({ note: "" })])).toBe("")
  })

  it("counts a repeated note once however many members carry it", () => {
    // Otherwise opening a three-sitting group would offer the same paragraph
    // three times and ask the user to delete two of them.
    const same = "Same account."
    expect(
      joinNotes([
        makeEntry({ startedAt: 300, note: same }),
        makeEntry({ startedAt: 200, note: same }),
        makeEntry({ startedAt: 100, note: same }),
      ])
    ).toBe(same)
  })
})

describe("tagUnion", () => {
  it("is every tag any member carries, without duplicates", () => {
    // A SET CLAIM, deliberately order-independent: this test is about coverage
    // and dedup. Order is pinned once, in the sitting-level test below, where
    // it is a stated decision rather than a by-product of the loop direction.
    const union = tagUnion([
      makeEntry({ tagIds: [TAG_A, TAG_B] }),
      makeEntry({ tagIds: [TAG_B, TAG_C] }),
    ])
    expect([...union].sort()).toEqual([TAG_A, TAG_B, TAG_C].sort())
  })

  it("is empty for members that carry none", () => {
    expect(tagUnion([makeEntry({ tagIds: [] }), makeEntry({ tagIds: [] })])).toEqual([])
  })
})

describe("a sitting's derived classification", () => {
  const sittingOf = (items: Array<LogItem>) => {
    const found = items.find((item) => item.kind === "sitting")
    if (found === undefined) throw new Error("no sitting")
    return found
  }

  it("is billable only when every member is", () => {
    // A mark meaning "some of these" means nothing, so mixed reads unlit and
    // one click on the parent makes it uniform.
    const mixed = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, billable: true }),
        makeEntry({ title: "Retainer", startedAt: 100, billable: false }),
      ])
    )
    expect(mixed.allBillable).toBe(false)

    const both = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, billable: true }),
        makeEntry({ title: "Retainer", startedAt: 100, billable: true }),
      ])
    )
    expect(both.allBillable).toBe(true)
  })

  it("carries the tag union so the parent's picker opens on it", () => {
    const parent = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, tagIds: [TAG_A] }),
        makeEntry({ title: "Retainer", startedAt: 100, tagIds: [TAG_B] }),
      ])
    )
    expect(parent.tagIds).toEqual([TAG_B, TAG_A])
  })
})
