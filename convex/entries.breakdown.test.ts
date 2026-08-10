/// <reference types="vite/client" />
// `entries.rangeBreakdown` — the aggregate Reports' Summary tab draws.
//
// Separate from entries.test.ts, which covers the tracking loop, and from
// entries.edit.test.ts, which covers the write surface. The split is by what
// breaks: these tests are about an answer being EXACT and being the same answer
// the sentence above the charts gives. A chart cannot say "still loading" in a
// way anyone believes — half a period's bars look exactly like a period with
// less work in it — so everything here is about a total nobody has to qualify.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const HOUR = 3_600_000

/*
 * 2026-08-03 is a Monday. Every instant below is UTC and the queries ask for
 * UTC buckets, so any assertion here can be checked by eye without zone
 * arithmetic — the DST and zone behaviour belongs to convex/lib/day.ts and is
 * tested there.
 */
const MON = Date.parse("2026-08-03T00:00:00Z")
const TUE = MON + 24 * HOUR
const WED = TUE + 24 * HOUR
const RANGE = { fromMs: MON, toMs: MON + 7 * 24 * HOUR, timeZone: "UTC" }

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

type EntryOver = {
  startedAt: number
  /** null is a RUNNING entry, which every total here excludes. */
  durationMs?: number | null
  projectId?: Id<"projects">
  billable?: boolean
  title?: string
  note?: string
}

/*
 * Inserted directly rather than through `entries.create`.
 *
 * The public path enforces the one-running invariant and refuses a start in the
 * past beyond a tolerance, neither of which this file is about — and both of
 * which would make "three entries on three different days" a fight rather than
 * a fixture.
 */
async function entry(t: ReturnType<typeof setup>, over: EntryOver) {
  const durationMs = over.durationMs === undefined ? HOUR : over.durationMs
  await t.run(async (ctx) => {
    await ctx.db.insert("timeEntries", {
      userId: ALICE,
      clientKey: `bd-${over.startedAt}-${Math.random()}`,
      title: over.title ?? "Work",
      note: over.note,
      startedAt: over.startedAt,
      endedAt: durationMs === null ? null : over.startedAt + durationMs,
      durationMs,
      projectId: over.projectId,
      tagIds: [],
      billable: over.billable ?? false,
      source: "web",
      updatedAt: MON,
      deletedAt: null,
    })
  })
}

async function breakdown(
  t: ReturnType<typeof setup>,
  args: Record<string, unknown> = {}
) {
  return await t.query(internal.entries.rangeBreakdownAs, {
    userId: ALICE,
    ...RANGE,
    ...args,
  })
}

describe("rangeBreakdown — the shape", () => {
  it("refuses a timezone it cannot resolve, rather than bucketing by a guess", async () => {
    const t = setup()
    await expectCode(breakdown(t, { timeZone: "Mars/Olympus" }), "INVALID_TIMEZONE")
  })

  it("returns only the days that hold entries, ascending", async () => {
    const t = setup()
    await entry(t, { startedAt: WED + 9 * HOUR })
    await entry(t, { startedAt: MON + 9 * HOUR })

    // Sparse on purpose. The client fills the gaps, because what an empty day
    // LOOKS like is a design decision (see the Hatch Rule) and a year-long
    // range would otherwise ship 365 rows of zeroes to draw the same picture.
    expect((await breakdown(t)).days.map((d) => d.day)).toEqual([
      "2026-08-03",
      "2026-08-05",
    ])
  })

  it("agrees with rangeSummary on every headline figure", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100,
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })
    await entry(t, { startedAt: TUE + 9 * HOUR, durationMs: 2 * HOUR })
    await entry(t, { startedAt: WED + 9 * HOUR, durationMs: null })

    const summary = await t.query(internal.entries.rangeSummaryAs, {
      userId: ALICE,
      fromMs: RANGE.fromMs,
      toMs: RANGE.toMs,
    })
    const result = await breakdown(t)

    // The Summary tab prints that sentence above charts drawn from THIS query.
    // Two definitions of "the total" is how the two come to disagree with
    // nothing on screen saying which one is right.
    expect({
      totalMs: result.totalMs,
      billableMs: result.billableMs,
      count: result.count,
      runningCount: result.runningCount,
      truncated: result.truncated,
      billableCents: result.billableCents,
      unratedBillableMs: result.unratedBillableMs,
    }).toEqual(summary)
  })

  it("attributes an overnight entry wholly to the day it started in", async () => {
    const t = setup()
    // 23:00 Monday to 01:00 Tuesday — the same rule the log follows, kept
    // because the alternative silently divides one piece of work across two
    // invoices.
    await entry(t, { startedAt: MON + 23 * HOUR, durationMs: 2 * HOUR })

    const result = await breakdown(t)
    expect(result.days).toHaveLength(1)
    expect(result.days[0]).toMatchObject({ day: "2026-08-03", totalMs: 2 * HOUR })
  })

  it("excludes a soft-deleted entry from every cut", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR })
    await t.run(async (ctx) => {
      const row = await ctx.db.query("timeEntries").first()
      await ctx.db.patch(row!._id, { deletedAt: MON })
    })

    const result = await breakdown(t)
    expect(result.count).toBe(0)
    expect(result.days).toEqual([])
    expect(result.projects).toEqual([])
    expect(result.hours.every((ms) => ms === 0)).toBe(true)
  })
})

describe("rangeBreakdown — hours of the day", () => {
  it("buckets by the local hour an entry started in", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR, durationMs: 90 * 60_000 })
    await entry(t, { startedAt: TUE + 9 * HOUR, durationMs: 30 * 60_000 })
    await entry(t, { startedAt: WED + 23 * HOUR, durationMs: 2 * HOUR })

    const result = await breakdown(t)
    expect(result.hours).toHaveLength(24)
    expect(result.hours[9]).toBe(2 * HOUR)
    // The whole two hours land in hour 23 — not one here and one at midnight.
    expect(result.hours[23]).toBe(2 * HOUR)
    expect(result.hours[0]).toBe(0)
  })

  it("buckets the same instants differently in a different zone", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR })

    // 09:00 UTC is 17:00 in Singapore. The caller sends the zone its log is
    // grouped by, so the bars and the rows cannot disagree about a day.
    expect((await breakdown(t)).hours[9]).toBe(HOUR)
    expect((await breakdown(t, { timeZone: "Asia/Singapore" })).hours[17]).toBe(HOUR)
  })

  it("counts a running entry in no hour at all", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR, durationMs: null })

    const result = await breakdown(t)
    expect(result.runningCount).toBe(1)
    expect(result.hours.every((ms) => ms === 0)).toBe(true)
  })
})

describe("rangeBreakdown — by project", () => {
  it("ranks longest first and keeps unassigned time as its own bucket", async () => {
    const t = setup()
    const { projectId: small } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Small Co",
    })
    const { projectId: big } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Big Co",
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId: small })
    await entry(t, { startedAt: TUE + 9 * HOUR, projectId: big, durationMs: 5 * HOUR })
    await entry(t, { startedAt: WED + 9 * HOUR, durationMs: 2 * HOUR })

    const result = await breakdown(t)
    expect(result.projects.map((p) => [p.name, p.totalMs])).toEqual([
      ["Big Co", 5 * HOUR],
      ["", 2 * HOUR],
      ["Small Co", HOUR],
    ])
    // Named by the UI, not here. "No project" is copy, and copy belongs on the
    // client; what the server owes is the fact that the bucket is unassigned.
    expect(result.projects[1].projectId).toBeNull()
  })

  it("carries each project's own colour, so the chart and the log paint alike", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      color: "teal",
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId })

    expect((await breakdown(t)).projects[0].color).toBe("teal")
  })

  it("prices each project on its own, so one client's amount is invoice-ready", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100, // $61/hr — one minute is 101.666… cents
    })
    await entry(t, { startedAt: MON + 9 * HOUR, durationMs: 60_000, projectId, billable: true })

    // 102, rounded once for this project. That is what goes on Acme's invoice,
    // whoever else was worked for that week.
    expect((await breakdown(t)).projects[0].billableCents).toBe(102)
  })

  it("reports unpriced billable time per project, so a zero can be told from a blank", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Unrated Co",
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })

    const result = await breakdown(t)
    expect(result.projects[0].billableCents).toBe(0)
    expect(result.projects[0].unratedBillableMs).toBe(HOUR)
  })
})

describe("rangeBreakdown — the earnings curve lands on the headline", () => {
  /*
   * THE LOAD-BEARING ROUNDING PROPERTY.
   *
   * The Summary tab draws a cumulative earnings line with the period total
   * printed directly above it. Rounding each day on its own makes the line end
   * a few cents away from that figure — two numbers on one screen describing
   * the same money and disagreeing. Taking deltas of a rounded running total
   * makes them equal by construction.
   */
  it("makes the per-day amounts sum EXACTLY to the period total", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100,
    })
    // Three one-minute blocks on three days. Rounded per day they are 102 each
    // and sum to 306; the period total is exactly 305.
    for (const start of [MON, TUE, WED]) {
      await entry(t, {
        startedAt: start + 9 * HOUR,
        durationMs: 60_000,
        projectId,
        billable: true,
      })
    }

    const result = await breakdown(t)
    expect(result.billableCents).toBe(305)
    expect(result.days.reduce((n, d) => n + d.billableCents, 0)).toBe(305)
  })

  it("gives an unearning day nothing, rather than smearing the total across days", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_000,
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })
    await entry(t, { startedAt: TUE + 9 * HOUR })

    const result = await breakdown(t)
    expect(result.days.map((d) => d.billableCents)).toEqual([6_000, 0])
  })
})

describe("rangeBreakdown — the FilterBar, applied server-side", () => {
  /*
   * The Detailed tab applies these on the client over loaded pages and says out
   * loud while it is still loading them. A chart has no honest way to say that,
   * so the same predicate (convex/lib/entryFilter.ts, shared with the client)
   * runs here over the whole range instead.
   */
  async function seed(t: ReturnType<typeof setup>) {
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
    })
    await entry(t, {
      startedAt: MON + HOUR,
      projectId,
      billable: true,
      title: "Acme billable, with a note",
      note: "shipped it",
    })
    await entry(t, { startedAt: MON + 3 * HOUR, title: "Unassigned, no note" })
    await entry(t, { startedAt: MON + 5 * HOUR, durationMs: 30_000, title: "A mis-start" })
    return projectId
  }

  it("counts everything when no filter is set", async () => {
    const t = setup()
    await seed(t)
    expect((await breakdown(t)).count).toBe(3)
  })

  it("narrows to one project", async () => {
    const t = setup()
    const projectId = await seed(t)
    const result = await breakdown(t, { projectId })
    expect(result.count).toBe(1)
    expect(result.totalMs).toBe(HOUR)
  })

  it("treats the empty string as the picker's no-project choice, not as no filter", async () => {
    const t = setup()
    await seed(t)
    const result = await breakdown(t, { projectId: "" })
    expect(result.count).toBe(2)
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].projectId).toBeNull()
  })

  it("narrows to billable", async () => {
    const t = setup()
    await seed(t)
    expect((await breakdown(t, { billableOnly: true })).count).toBe(1)
  })

  it("searches the title, the note and the project name alike", async () => {
    const t = setup()
    await seed(t)
    expect((await breakdown(t, { text: "shipped" })).count).toBe(1) // the note
    expect((await breakdown(t, { text: "acme" })).count).toBe(1) // the project
    expect((await breakdown(t, { text: "mis-start" })).count).toBe(1) // the title
  })

  it("applies the preset chips", async () => {
    const t = setup()
    await seed(t)
    expect((await breakdown(t, { presets: ["no-project"] })).count).toBe(2)
    expect((await breakdown(t, { presets: ["no-note"] })).count).toBe(2)
    expect((await breakdown(t, { presets: ["under-a-minute"] })).count).toBe(1)
  })

  it("composes filters rather than letting the last one win", async () => {
    const t = setup()
    await seed(t)
    expect((await breakdown(t, { presets: ["no-project"], billableOnly: true })).count).toBe(0)
  })

  it("filters the day, project and hour cuts too, not only the headline", async () => {
    const t = setup()
    const projectId = await seed(t)
    const result = await breakdown(t, { projectId })

    // The bug this guards: filtering the total but not the groupings leaves a
    // chart showing work the sentence above it says is not there.
    expect(result.days).toHaveLength(1)
    expect(result.projects).toHaveLength(1)
    expect(result.hours[1]).toBe(HOUR)
    expect(result.hours[3]).toBe(0)
  })
})
