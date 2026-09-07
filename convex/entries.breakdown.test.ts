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
import { NOTES_CHAR_BUDGET, NOTES_PER_ROW_LIMIT } from "./lib/scan"
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
// weekStartDay: 1 (Monday) so MON is itself a week start and every fixture
// entry below stays inside one week unless a test deliberately spans two.
const RANGE = { fromMs: MON, toMs: MON + 7 * 24 * HOUR, timeZone: "UTC", weekStartDay: 1 }

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

    // One minute is 0.01 hours on Acme's invoice line, and `0.01 × $61.00` is
    // 61 — not the exact 101.666… rounded to 102. This figure IS the invoice
    // line's figure, whoever else was worked for that week.
    expect((await breakdown(t)).projects[0].billableCents).toBe(61)
  })

  /**
   * The headline is the SUM OF THE PROJECT AMOUNTS — which is the subtotal of
   * the invoice `createFromRange` raises from this same breakdown, line for
   * line. Two projects of 30m 18s each at $10/hr are 50.5 centihours apiece,
   * floored to 50 each: $5.00 + $5.00. Flooring the range's 1h 0m 36s once
   * would give 101 centihours, $10.10, and an invoice whose two lines add up
   * to $10.00 under a report saying $10.10.
   */
  it("makes the headline the sum of the project amounts, which is the invoice's subtotal", async () => {
    const t = setup()
    const { projectId: acme } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 1_000,
    })
    const { projectId: bolt } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Bolt",
      hourlyRateCents: 1_000,
    })
    await entry(t, { startedAt: MON + 9 * HOUR, durationMs: 1_818_000, projectId: acme, billable: true })
    await entry(t, { startedAt: MON + 11 * HOUR, durationMs: 1_818_000, projectId: bolt, billable: true })

    const result = await breakdown(t)
    expect(result.projects.map((p) => p.billableCents)).toEqual([500, 500])
    expect(result.billableCents).toBe(1_000)
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
   * the same money and disagreeing. Taking deltas of a running total priced
   * by the same rule as the headline makes them equal by construction.
   */
  it("makes the per-day amounts sum EXACTLY to the period total", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100,
    })
    // Three one-minute blocks on three days. Floored per day they are one
    // centihour — 61 cents — each, and sum to 183; the period's three minutes
    // are FIVE centihours, 305. The deltas of the running floor are 61, 122,
    // 122, which is the only per-day series that lands on the headline.
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
    expect(result.days.map((d) => d.billableCents)).toEqual([61, 122, 122])
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

describe("the account's default hourly rate", () => {
  /*
   * THE FALLBACK, and the reason it exists.
   *
   * A rate used to live only on a project, so billable time with NO project
   * could never be priced however billable it was — a freelancer on one rate
   * had to file their own standups under a client to get paid for them, and
   * 2h24m of real work sat outside the total with a footnote to explain it.
   *
   * Resolution is most-granular-wins, the same order Toggl uses: the project's
   * own rate, then the account's, then nothing.
   */
  const setRate = async (t: ReturnType<typeof setup>, cents: number | null) => {
    await t.mutation(internal.settings.updateAs, {
      userId: ALICE,
      defaultHourlyRateCents: cents,
    })
  }

  it("prices billable time with no project at all", async () => {
    const t = setup()
    await setRate(t, 1_000) // $10/hr
    await entry(t, { startedAt: MON + 9 * HOUR, billable: true })

    const result = await breakdown(t)
    expect(result.billableCents).toBe(1_000)
    // Priced, so it is no longer "billable work nobody has valued".
    expect(result.unratedBillableMs).toBe(0)
  })

  it("prices a project that has no rate of its own", async () => {
    const t = setup()
    await setRate(t, 1_000)
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Unrated Co",
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })

    expect((await breakdown(t)).billableCents).toBe(1_000)
  })

  it("lets a project's own rate win over it", async () => {
    const t = setup()
    await setRate(t, 1_000)
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100, // $61/hr
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })

    expect((await breakdown(t)).billableCents).toBe(6_100)
  })

  /*
   * The case that makes `??` load-bearing rather than a style choice. A project
   * priced at zero is a DECISION — pro bono — and falling through to the
   * account rate would silently bill a client the user chose not to charge.
   */
  it("lets a project priced at ZERO win over it, rather than falling through", async () => {
    const t = setup()
    await setRate(t, 1_000)
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Pro Bono Co",
      hourlyRateCents: 0,
    })
    await entry(t, { startedAt: MON + 9 * HOUR, projectId, billable: true })

    const result = await breakdown(t)
    expect(result.billableCents).toBe(0)
    // Priced at nothing, NOT unpriced — the distinction the whole
    // `unratedBillableMs` field exists to carry.
    expect(result.unratedBillableMs).toBe(0)
  })

  it("leaves time unpriced when neither the project nor the account has a rate", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR, billable: true })

    const result = await breakdown(t)
    expect(result.billableCents).toBe(0)
    expect(result.unratedBillableMs).toBe(HOUR)
  })

  it("stops applying once the rate is cleared", async () => {
    const t = setup()
    await setRate(t, 1_000)
    await entry(t, { startedAt: MON + 9 * HOUR, billable: true })
    expect((await breakdown(t)).billableCents).toBe(1_000)

    // `null` clears it. An absent field and a stored zero are different facts.
    await setRate(t, null)
    const cleared = await breakdown(t)
    expect(cleared.billableCents).toBe(0)
    expect(cleared.unratedBillableMs).toBe(HOUR)
  })

  it("refuses a rate that is not a whole number of cents", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.settings.updateAs, {
        userId: ALICE,
        defaultHourlyRateCents: Number.NaN,
      }),
      "INVALID_RATE"
    )
  })

  it("reaches rangeSummary too, not only the charts", async () => {
    const t = setup()
    await setRate(t, 1_000)
    await entry(t, { startedAt: MON + 9 * HOUR, billable: true })

    const summary = await t.query(internal.entries.rangeSummaryAs, {
      userId: ALICE,
      fromMs: RANGE.fromMs,
      toMs: RANGE.toMs,
    })
    // The sentence above the charts and the charts themselves price the same
    // hour the same way, or the page contradicts itself.
    expect(summary.billableCents).toBe(1_000)
  })
})

describe("rangeBreakdown — by description", () => {
  it("groups by project AND title, so one title on two projects stays two rows", async () => {
    const t = setup()
    const { projectId: acme } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
      hourlyRateCents: 6_100,
    })
    const { projectId: beta } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Beta",
      hourlyRateCents: 6_100,
    })
    await entry(t, { startedAt: MON + HOUR, title: "Standup", projectId: acme })
    await entry(t, { startedAt: TUE + HOUR, title: "Standup", projectId: beta })

    const { titles } = await breakdown(t)
    expect(titles.map((row) => [row.project, row.title])).toEqual([
      ["Acme", "Standup"],
      ["Beta", "Standup"],
    ])
  })

  it("sums repeats of the same title on the same project into one row", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "Standup" })
    await entry(t, { startedAt: TUE + HOUR, title: "Standup" })

    const { titles } = await breakdown(t)
    expect(titles).toHaveLength(1)
    expect(titles[0]).toMatchObject({ title: "Standup", totalMs: 2 * HOUR, count: 2 })
  })

  it("orders by time descending, breaking ties by title so refetches do not reshuffle", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "Zebra", durationMs: HOUR })
    await entry(t, { startedAt: TUE + HOUR, title: "Alpha", durationMs: HOUR })
    await entry(t, { startedAt: WED + HOUR, title: "Long one", durationMs: 3 * HOUR })

    expect((await breakdown(t)).titles.map((row) => row.title)).toEqual([
      "Long one",
      "Alpha",
      "Zebra",
    ])
  })

  /*
   * An empty title is normal and must not be dropped — `timeEntries.title`
   * documents that "" is allowed, because blocking a start on a missing title
   * would destroy the reason the product exists. A row for it still has to
   * reach the document, or its time vanishes from a total that claims to be
   * complete.
   */
  it("keeps untitled work as its own row rather than dropping it", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "" })

    const { titles } = await breakdown(t)
    expect(titles).toHaveLength(1)
    expect(titles[0]).toMatchObject({ title: "", project: "", totalMs: HOUR })
  })

  /*
   * No project rate AND no account default rate. Since ad5b1a8, `rateOf` falls
   * back to `settings.defaultHourlyRateCents`, so "unrated" now means both are
   * unset — and a test that only omitted the project rate would start passing
   * or failing depending on a setting it never mentions.
   */
  it("marks unpriced billable time per row rather than pricing it at zero", async () => {
    const t = setup()
    const { projectId } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Unrated",
    })
    await entry(t, { startedAt: MON + HOUR, title: "Work", projectId, billable: true })

    const { titles } = await breakdown(t)
    expect(titles[0]).toMatchObject({ billableCents: 0, unratedBillableMs: HOUR })
  })

  it("caps the list and says so, rather than quietly ending it", async () => {
    const t = setup()
    for (let n = 0; n < 505; n++) {
      // Descending durations, so the cap keeps the heaviest 500 and the assertion
      // below can name exactly which ones were dropped.
      await entry(t, {
        startedAt: MON + n * 60_000,
        title: `T${n}`,
        durationMs: (600 - n) * 1_000,
      })
    }

    const { titles, titlesTruncated } = await breakdown(t)
    expect(titles).toHaveLength(500)
    expect(titlesTruncated).toBe(true)
    expect(titles.at(-1)?.title).toBe("T499")
  })

  it("does not claim truncation when the list fits", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "Work" })
    expect((await breakdown(t)).titlesTruncated).toBe(false)
  })

  it("sums to the same total as the headline", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A", durationMs: 90 * 60_000 })
    await entry(t, { startedAt: TUE + HOUR, title: "B", durationMs: 45 * 60_000 })

    const result = await breakdown(t)
    const summed = result.titles.reduce((n, row) => n + row.totalMs, 0)
    expect(summed).toBe(result.totalMs)
  })
})

describe("rangeBreakdown — weekly grouping", () => {
  /*
   * The export needs to split its breakdown by week, and the `titles` cut is
   * the only place that can carry a date: `days` has no project/title, and
   * `projects` has no date at all. Attribution is by START, matching every
   * other grouping in this file (days, hours) — an entry never splits across
   * two weeks.
   */
  it("labels each row with the local week its entries' starts fall in", async () => {
    const t = setup()
    // Monday and Tuesday of the same Monday-started week.
    await entry(t, { startedAt: MON + 9 * HOUR, title: "Standup" })
    await entry(t, { startedAt: TUE + 9 * HOUR, title: "Standup" })

    const { titles } = await breakdown(t, { weekStartDay: 1 })
    expect(titles).toHaveLength(1)
    expect(titles[0].weekStart).toBe("2026-08-03") // the Monday both fall in
  })

  it("honours weekStartDay rather than assuming Sunday", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + 9 * HOUR, title: "Standup" }) // a Monday

    // Sunday week start: Monday 3 Aug's week began Sunday 2 Aug.
    const sunday = await breakdown(t, { weekStartDay: 0 })
    expect(sunday.titles[0].weekStart).toBe("2026-08-02")

    // Monday week start: the entry's own day IS the week start.
    const monday = await breakdown(t, { weekStartDay: 1 })
    expect(monday.titles[0].weekStart).toBe("2026-08-03")
  })

  it("keeps the same title in two different weeks as two separate rows, not merged", async () => {
    const t = setup()
    const nextMon = MON + 7 * 24 * HOUR
    await entry(t, { startedAt: MON + 9 * HOUR, title: "Standup" }) // week of 3 Aug
    await entry(t, { startedAt: nextMon + 9 * HOUR, title: "Standup" }) // week of 10 Aug

    const result = await t.query(internal.entries.rangeBreakdownAs, {
      userId: ALICE,
      fromMs: MON,
      toMs: MON + 14 * 24 * HOUR,
      timeZone: "UTC",
      weekStartDay: 1,
    })
    expect(result.titles).toHaveLength(2)
    expect(result.titles.map((row) => row.weekStart).sort()).toEqual([
      "2026-08-03",
      "2026-08-10",
    ])
  })

  it("keeps one title on two projects in the same week as two rows, unaffected by the week key", async () => {
    const t = setup()
    const { projectId: acme } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Acme",
    })
    const { projectId: beta } = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Beta",
    })
    await entry(t, { startedAt: MON + HOUR, title: "Standup", projectId: acme })
    await entry(t, { startedAt: TUE + HOUR, title: "Standup", projectId: beta })

    const { titles } = await breakdown(t)
    expect(titles).toHaveLength(2)
    expect(new Set(titles.map((row) => row.weekStart)).size).toBe(1)
  })

  it("cuts the week key from the same scan, so titles still sum to the headline total", async () => {
    const t = setup()
    const nextMon = MON + 7 * 24 * HOUR
    await entry(t, { startedAt: MON + HOUR, title: "A", durationMs: 90 * 60_000 })
    await entry(t, { startedAt: nextMon + HOUR, title: "B", durationMs: 45 * 60_000 })

    const result = await t.query(internal.entries.rangeBreakdownAs, {
      userId: ALICE,
      fromMs: MON,
      toMs: MON + 14 * 24 * HOUR,
      timeZone: "UTC",
      weekStartDay: 1,
    })
    const summed = result.titles.reduce((n, row) => n + row.totalMs, 0)
    expect(summed).toBe(result.totalMs)
  })
})

/*
 * Notes on the breakdown — the data the PDF export prints when
 * `userSettings.pdfIncludeNotes` is on.
 *
 * Off by default at every level, and that is the property most worth pinning:
 * a note is prose the user wrote about how the work actually went, the PDF is
 * what goes to a client, and this query is the one place that decides whether
 * the two ever meet.
 */
describe("rangeBreakdown — notes", () => {
  it("carries no notes unless asked, however many the entries hold", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A", note: "Went fine." })

    const result = await breakdown(t)
    expect(result.titles[0].notes).toEqual([])
    expect(result.notesTruncated).toBe(false)
  })

  it("carries them when asked", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A", note: "Went fine." })

    const result = await breakdown(t, { withNotes: true })
    expect(result.titles[0].notes).toEqual(["Went fine."])
  })

  /* A row is a `(week, project, description)` GROUP, so it holds every entry
   * logged under one description in one week — five standups are five notes. */
  it("gathers every entry's note onto the row they share", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "Standup", note: "Monday" })
    await entry(t, { startedAt: TUE + HOUR, title: "Standup", note: "Tuesday" })

    const [row] = (await breakdown(t, { withNotes: true })).titles
    expect(row.notes).toEqual(["Monday", "Tuesday"])
  })

  /* The same sentence logged three times is one fact; printing it three times
   * is noise, and holding all three before collapsing them is two wasted
   * copies of it during the scan. */
  it("deduplicates a note repeated across entries", async () => {
    const t = setup()
    for (const day of [MON, TUE, WED]) {
      await entry(t, { startedAt: day + HOUR, title: "Standup", note: "Same as yesterday" })
    }

    const [row] = (await breakdown(t, { withNotes: true })).titles
    expect(row.notes).toEqual(["Same as yesterday"])
  })

  /* `undefined` and `""` are both "nobody wrote one", and a whitespace-only
   * note is the same absence typed differently. None may become a bullet with
   * nothing after it on the document. */
  it("ignores absent, empty and whitespace-only notes", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A" })
    await entry(t, { startedAt: MON + 2 * HOUR, title: "A", note: "" })
    await entry(t, { startedAt: MON + 3 * HOUR, title: "A", note: "   \n  " })

    const [row] = (await breakdown(t, { withNotes: true })).titles
    expect(row.notes).toEqual([])
  })

  it("trims a note rather than printing its leading whitespace", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A", note: "  Went fine.  " })

    const [row] = (await breakdown(t, { withNotes: true })).titles
    expect(row.notes).toEqual(["Went fine."])
  })

  it("keeps at most NOTES_PER_ROW_LIMIT distinct notes on one row", async () => {
    const t = setup()
    for (let n = 0; n < NOTES_PER_ROW_LIMIT + 3; n++) {
      await entry(t, { startedAt: MON + (n + 1) * 60_000, title: "A", note: `note ${n}` })
    }

    const result = await breakdown(t, { withNotes: true })
    expect(result.titles[0].notes).toHaveLength(NOTES_PER_ROW_LIMIT)
    // AND SAYS SO. Dropping notes silently is the failure this whole mechanism
    // exists to avoid: a row with eight notes printing five reads as work that
    // had only five things to say about it.
    expect(result.notesTruncated).toBe(true)
  })

  /* Dedup is NOT truncation. A week of identical standup notes collapses to one
   * fact and nothing is lost, so the flag must stay down — otherwise the
   * commonest note-writing habit in the product permanently prints a warning
   * about missing notes on every export. */
  it("does not call deduplication a truncation", async () => {
    const t = setup()
    for (let n = 0; n < NOTES_PER_ROW_LIMIT + 5; n++) {
      await entry(t, {
        startedAt: MON + (n + 1) * 60_000,
        title: "Standup",
        note: "Same as yesterday",
      })
    }

    const result = await breakdown(t, { withNotes: true })
    expect(result.titles[0].notes).toEqual(["Same as yesterday"])
    expect(result.notesTruncated).toBe(false)
  })

  /* The flag is about notes that were REQUESTED and dropped. With the setting
   * off nothing was asked for, so nothing is missing. */
  it("never reports truncation on an export that asked for no notes", async () => {
    const t = setup()
    for (let n = 0; n < NOTES_PER_ROW_LIMIT + 3; n++) {
      await entry(t, { startedAt: MON + (n + 1) * 60_000, title: "A", note: `note ${n}` })
    }

    expect((await breakdown(t)).notesTruncated).toBe(false)
  })

  /*
   * THE BOUND THAT ACTUALLY BINDS. A per-row cap cannot see the total: 500 rows
   * of five maximal notes is a multi-megabyte response, past the platform's own
   * limit and reached by a range that is large but not pathological.
   *
   * Running out is REPORTED rather than silent — a document that quietly stops
   * carrying notes reads as work that had none.
   */
  it("stops at the global character budget and says that it did", async () => {
    const t = setup()
    // Each row gets one note a twentieth of the budget long, so the budget runs
    // out partway through rather than on the first row or not at all.
    const note = "x".repeat(NOTES_CHAR_BUDGET / 20)
    for (let n = 0; n < 30; n++) {
      await entry(t, {
        startedAt: MON + (n + 1) * 60_000,
        title: `Row ${n}`,
        // Descending, so `titles` sorts in this same order and the budget is
        // demonstrably spent on the longest work first.
        durationMs: (30 - n) * 60_000,
        note: `${note}${n}`,
      })
    }

    const result = await breakdown(t, { withNotes: true })
    expect(result.notesTruncated).toBe(true)

    const spent = result.titles.reduce(
      (sum, row) => sum + row.notes.reduce((n, text) => n + text.length, 0),
      0
    )
    expect(spent).toBeLessThanOrEqual(NOTES_CHAR_BUDGET)
    // Spent on the longest work rather than an arbitrary slice: the first rows
    // have their notes, the last ones do not.
    expect(result.titles[0].notes).toHaveLength(1)
    expect(result.titles.at(-1)!.notes).toEqual([])
    // A row is given its note WHOLE or not at all — half a note is a sentence
    // that stops mid-clause on a document a client reads.
    for (const row of result.titles) {
      for (const text of row.notes) {
        expect(text.startsWith(note)).toBe(true)
        expect(text.length).toBeGreaterThan(note.length)
      }
    }
  })

  it("reports no truncation when the budget was never approached", async () => {
    const t = setup()
    await entry(t, { startedAt: MON + HOUR, title: "A", note: "Short." })
    expect((await breakdown(t, { withNotes: true })).notesTruncated).toBe(false)
  })
})
