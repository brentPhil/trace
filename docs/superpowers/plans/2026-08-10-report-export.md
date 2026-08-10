# Report Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the filtered range on `/reports` as a PDF, CSV, or XLSX document, in the shape of the Toggl summary report the user hands to clients today.

**Architecture:** One pure row-builder (`report-rows.ts`) turns a `Breakdown` into everything the three writers need; each writer is split into a **pure model** (sheet data / page ops) and a thin binary renderer, so pagination and cell typing are unit-testable without parsing a PDF or unzipping an XLSX. Both binary libraries load behind `await import()` inside the click handler.

**Tech Stack:** TypeScript, Convex, TanStack Start/Router, React 19, Base UI, Tailwind v4, Vitest (three projects: `unit` / `dom` / `convex`), `pdf-lib@1.17.1`, `write-excel-file@4.1.1`.

This plan implements **steps 2–4 and part of 3** of §9 in
`docs/superpowers/specs/2026-08-10-invoicing-and-report-export-design.md`.
The invoices domain (spec steps 1, 5–7) is a **separate plan**, written after
this one lands so it is written against real `pdf/` primitives rather than
predicted ones.

## Global Constraints

- **Money is integer cents.** Never a float. `convex/lib/money.ts` is the only parser and formatter.
- **Decimal hours are 2 dp, floored, integer arithmetic** — `Math.floor(ms / 36_000)`. Applies to totals and export only, never a single entry's row.
- **`userId` leads every Convex index.** Ownership is a key prefix, not a filter.
- **Pure shared code lives in `convex/lib` (aliased `@shared`)** and must import neither Convex nor the DOM.
- **Components must not import the generated Convex API for types** — `eslint.config.js` enforces this. Use the structural `Breakdown` type in `src/lib/report-series.ts`.
- **Meaning is never carried by colour alone** (DESIGN.md). Every series in the PDF is also labelled.
- **Brass is currency amounts only.** A billable duration is not money and renders as ordinary ink.
- **Empty spans are hatched, never a bar of height zero** (the Hatch Rule).
- **A truncated range must never become a document.** `breakdown.truncated === true` disables export with the reason stated.
- Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` before every commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `centiHours` — one decimal-hours rule

`formatDecimalHours` already contains the exact integer arithmetic the invoice
quantity needs. Extracting the number from the string is what stops the invoice
plan from writing a second copy of it.

**Files:**
- Modify: `convex/lib/duration.ts:184-196`
- Test: `convex/lib/duration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `centiHours(ms: number): number` — integer hundredths of an hour, floored. `formatDecimalHours(ms: number): string` keeps its exact current behaviour.

- [ ] **Step 1: Write the failing test**

Append to `convex/lib/duration.test.ts`:

```ts
describe("centiHours", () => {
  it("counts whole hundredths of an hour, floored", () => {
    expect(centiHours(29_520_000)).toBe(820) // 8h 12m -> 8.20 h
    expect(centiHours(3_600_000)).toBe(100) // 1h
    expect(centiHours(1_044_000)).toBe(29) // 0.29 h exactly
  })

  /*
   * The bug this arithmetic exists to prevent. `Math.floor((ms / 3_600_000) *
   * 100)` gives 28 here, because 0.29 * 100 is 28.999999999999996 in binary
   * floating point. It understates, always, and by an amount invisible on an
   * invoice.
   */
  it("never understates a duration to a float rounding error", () => {
    for (let centi = 1; centi <= 2_401; centi++) {
      expect(centiHours(centi * 36_000)).toBe(centi)
    }
  })

  it("floors a partial hundredth rather than rounding it up", () => {
    expect(centiHours(35_999)).toBe(0)
    expect(centiHours(71_999)).toBe(1)
  })

  it("reads a non-duration as zero rather than NaN", () => {
    expect(centiHours(0)).toBe(0)
    expect(centiHours(-1)).toBe(0)
    expect(centiHours(Number.NaN)).toBe(0)
  })
})

describe("formatDecimalHours", () => {
  it("renders centiHours to two places", () => {
    expect(formatDecimalHours(29_520_000)).toBe("8.20")
    expect(formatDecimalHours(0)).toBe("0.00")
  })
})
```

Add `centiHours` to the existing import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project unit convex/lib/duration.test.ts
```

Expected: FAIL — `centiHours is not a function`.

- [ ] **Step 3: Write minimal implementation**

Replace `convex/lib/duration.ts:184-196` with:

```ts
/**
 * Milliseconds as an integer count of HUNDREDTHS OF AN HOUR.
 *
 * The unit an invoice line quantity is stored in, and the number
 * `formatDecimalHours` renders. Extracted so there is one of it: the invoice's
 * `quantityCentis` and the figure printed on /reports must be the same
 * arithmetic, or a client reconciles a document against a screen that disagrees
 * with it.
 *
 * Integer arithmetic, not `Math.floor((ms / HOUR) * 100)`.
 *
 * In binary floating point, 0.29 * 100 is 28.999999999999996, so flooring it
 * gives 28. That understated 144 of 2401 exact centihours — 6% of durations,
 * always low, never high. 8h 12m billed as 8.19 instead of 8.20. It is
 * undetectable by eye on an invoice, which is what made it worth an integer.
 *
 * 36000 ms is exactly one centihour, so this division has no remainder to lose.
 *
 * Flooring is the contract, not a detail: no figure ever displays more time
 * than was recorded, and a set of parts never sums above the whole.
 */
export function centiHours(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.floor(ms / 36_000)
}

/**
 * `8.20` — decimal hours, two places, floored. Totals and export only.
 */
export function formatDecimalHours(ms: number): string {
  return (centiHours(ms) / 100).toFixed(2)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run --project unit convex/lib/duration.test.ts
```

Expected: PASS, including the pre-existing `formatDecimalHours` tests.

- [ ] **Step 5: Verify nothing else regressed, then commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add convex/lib/duration.ts convex/lib/duration.test.ts
git commit -m "refactor(duration): name the decimal-hours integer, so an invoice can reuse it

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The `titles` cut on `rangeBreakdown`

The report's largest block is one row per distinct description. `rangeBreakdown`
cuts its scan by day, project and hour; this adds a fourth cut **off the same
scan**, because a second query is a second chance to disagree with the charts
above it.

**Files:**
- Modify: `convex/entries.ts` (validators near `projectTotal`, the accumulation loop and return in `rangeBreakdownImpl`)
- Modify: `src/lib/report-series.ts` (the structural `Breakdown` type)
- Test: `convex/entries.breakdown.test.ts`

**Interfaces:**
- Consumes: `Ledger`, `bucket()`, `post()`, `centsOf()`, `projectsOf()` — all private to `convex/entries.ts`.
- Produces: `rangeBreakdown` returns two new fields:
  - `titles: Array<{ projectId: Id<"projects"> | null; project: string; title: string; totalMs: number; billableMs: number; billableCents: number; unratedBillableMs: number; count: number }>` — descending by `totalMs`, ties broken by `title`, capped at `TITLE_LIMIT`.
  - `titlesTruncated: boolean`
- Produces: `TitleTotal` exported from `src/lib/report-series.ts`.

- [ ] **Step 1: Write the failing test**

Append to `convex/entries.breakdown.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project convex convex/entries.breakdown.test.ts
```

Expected: FAIL — `Cannot read properties of undefined (reading 'map')`, because `titles` does not exist.

- [ ] **Step 3: Add the validator and the cap**

In `convex/entries.ts`, immediately after the `projectTotal` validator:

```ts
/**
 * How many distinct descriptions a breakdown will name.
 *
 * Past this the block is not a table anyone reads, and shipping every row of a
 * pathological range costs the client more than the answer is worth.
 * `titlesTruncated` is what stops the list from merely ending: a document that
 * silently stops naming work reads as a complete account of the period.
 */
const TITLE_LIMIT = 500

const titleTotal = v.object({
  /** null is the unassigned bucket, same convention as `projectTotal`. */
  projectId: v.union(v.id("projects"), v.null()),
  /** Resolved here rather than by the caller: the export writers are pure and
   *  hold no project map. "" for the unassigned bucket — what to CALL it is
   *  the UI's business, exactly as `projectTotal` decides. */
  project: v.string(),
  /** "" is a real, valid title and gets its own row. */
  title: v.string(),
  totalMs: v.number(),
  billableMs: v.number(),
  billableCents: v.number(),
  unratedBillableMs: v.number(),
  count: v.number(),
})
```

In the `breakdownReturns` object, after `hours`:

```ts
  /**
   * One row per (project, description), descending by time — the largest block
   * of the exported report.
   *
   * Cut from the SAME scan as `days`, `projects` and `hours` rather than by a
   * second query. One scan, one ledger type, one rounding rule, so the table a
   * client reconciles cannot disagree with the chart printed above it.
   */
  titles: v.array(titleTotal),
  /** The list was cut at `TITLE_LIMIT`. Surfaced on the page and in the
   *  document, because a truncated list of work reads as a complete one. */
  titlesTruncated: v.boolean(),
```

- [ ] **Step 4: Accumulate and return the cut**

In `rangeBreakdownImpl`, beside the other bucket maps:

```ts
  /*
   * Keyed by `projectId\u0000title`, with "" for the unassigned project.
   *
   * A NUL separator rather than a `:` or a `|`, because the second half is a
   * user-supplied title that may contain any printable character — a project id
   * plus "a:b" and a project id ending ":a" plus "b" must not collide into one
   * row. NUL is the one byte a title cannot hold.
   */
  const byTitle = new Map<string, Ledger>()
```

Inside the `for (const row of rows)` loop, after the `byProject` line:

```ts
    post(bucket(byTitle, `${row.projectId ?? ""}\u0000${row.title}`), row, rateCents)
```

After the `projects` array is built and before the `return`:

```ts
  /*
   * Rounded independently per row, like `projects` and unlike `days` — the same
   * asymmetry, for the same reason. A description's amount is a line somebody
   * may put on an invoice, so it has to be right on its own rather than right
   * in a sequence. Its parts may therefore differ from the whole by a few cents,
   * which is a real property of money.
   */
  const allTitles = [...byTitle.entries()]
    .map(([key, ledger]) => {
      const split = key.indexOf("\u0000")
      const projectKey = key.slice(0, split)
      const doc =
        projectKey === "" ? undefined : projectDocs.get(projectKey as Id<"projects">)
      return {
        projectId: doc?._id ?? null,
        project: doc?.name ?? "",
        title: key.slice(split + 1),
        totalMs: ledger.totalMs,
        billableMs: ledger.billableMs,
        billableCents: centsOf(ledger),
        unratedBillableMs: ledger.unratedBillableMs,
        count: ledger.count,
      }
    })
    // Ties broken by title so the order is stable across refetches — a table
    // that reshuffles itself on every reactive update cannot be read.
    .sort((a, b) => b.totalMs - a.totalMs || a.title.localeCompare(b.title))
```

And in the returned object, after `hours`:

```ts
    titles: allTitles.slice(0, TITLE_LIMIT),
    titlesTruncated: allTitles.length > TITLE_LIMIT,
```

- [ ] **Step 5: Extend the structural type**

In `src/lib/report-series.ts`, after `ProjectTotal`:

```ts
/** One (project, description) pair's totals. `project` is "" when unassigned. */
export type TitleTotal = {
  projectId: string | null
  project: string
  title: string
  totalMs: number
  billableMs: number
  billableCents: number
  unratedBillableMs: number
  count: number
}
```

And in `Breakdown`, after `hours`:

```ts
  titles: Array<TitleTotal>
  titlesTruncated: boolean
```

- [ ] **Step 6: Fix the two fixtures the widened type breaks**

`EMPTY_BREAKDOWN` lives in `src/lib/report-series.ts` (exported from there
alongside `EMPTY_TOTALS` as of ad5b1a8 — it is no longer a local const in
`reports.tsx`). It gains:

```ts
  titles: [],
  titlesTruncated: false,
```

Then:

```bash
pnpm typecheck
```

Expected: PASS. Fix every other `Breakdown` literal `tsc` names the same way —
at time of writing that is `src/routes/_authed/-reports.test.tsx`, but do not
assume the list; let the compiler produce it.

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm vitest run --project convex convex/entries.breakdown.test.ts
```

Expected: PASS, all eight new tests plus the existing suites.

- [ ] **Step 8: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add convex/entries.ts src/lib/report-series.ts src/routes/_authed/reports.tsx convex/entries.breakdown.test.ts
git commit -m "feat(reports): cut the breakdown by description, off the same scan

The exported report's largest block is one row per description. A second
query for it would be a second scan of the same rows and a second chance to
disagree with the chart printed above it, so this rides the existing ledger.

Capped at 500 with titlesTruncated beside it: a list of work that merely
stops reads as a complete account of the period.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `report-rows` — one shape, three writers

**Files:**
- Create: `src/lib/export/report-rows.ts`
- Test: `src/lib/export/report-rows.test.ts`

**Interfaces:**
- Consumes: `Breakdown`, `TitleTotal`, `bucketDays`, `Bucket`, `Granularity` from `@/lib/report-series`; `centiHours` from `@shared/duration`; `DayString` from `@shared/day`.
- Produces:
  ```ts
  export const NO_PROJECT: string
  export type ReportRows = {
    meta: { from: DayString; to: DayString; currency: string; daysWorked: number; granularity: Granularity }
    totals: { totalMs: number; billableMs: number; billablePercent: number; billableCents: number; unratedBillableMs: number; averageDailyMs: number; count: number; truncated: boolean }
    buckets: Array<Bucket>
    projects: Array<{ name: string; color: string; totalMs: number; percent: number; billableCents: number; unratedBillableMs: number }>
    titles: Array<{ project: string; description: string; totalMs: number; centiHours: number; percent: number; billableCents: number; unpriced: boolean }>
    titlesTruncated: boolean
  }
  export function reportRows(breakdown: Breakdown, opts: { from: DayString; to: DayString; currency: string }): ReportRows
  export function percentOf(part: number, whole: number): number
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/report-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { NO_PROJECT, percentOf, reportRows } from "./report-rows"
import type { Breakdown } from "@/lib/report-series"

const HOUR = 3_600_000

function breakdownOf(over: Partial<Breakdown> = {}): Breakdown {
  return {
    totalMs: 0,
    billableMs: 0,
    count: 0,
    runningCount: 0,
    truncated: false,
    billableCents: 0,
    unratedBillableMs: 0,
    days: [],
    projects: [],
    hours: Array.from({ length: 24 }, () => 0),
    titles: [],
    titlesTruncated: false,
    ...over,
  }
}

const RANGE = { from: "2026-07-13", to: "2026-07-15", currency: "USD" } as const

describe("percentOf", () => {
  it("gives two decimal places, matching the reference report", () => {
    expect(percentOf(2_880_000, 355_680_000)).toBe(0.81)
    expect(percentOf(355_680_000, 355_680_000)).toBe(100)
  })

  it("answers zero for an empty whole rather than NaN", () => {
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe("reportRows — totals", () => {
  it("averages over days that hold work, not calendar days", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 9 * HOUR,
        count: 3,
        days: [
          { day: "2026-07-13", totalMs: 5 * HOUR, billableMs: 0, billableCents: 0, count: 2 },
          { day: "2026-07-15", totalMs: 4 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
        ],
      }),
      RANGE
    )

    // Two days worked out of three in range. Dividing by three would report
    // 3h/day for someone who worked four and five.
    expect(rows.meta.daysWorked).toBe(2)
    expect(rows.totals.averageDailyMs).toBe(4.5 * HOUR)
  })

  it("reports a zero average for an empty range rather than dividing by zero", () => {
    const rows = reportRows(breakdownOf(), RANGE)
    expect(rows.totals.averageDailyMs).toBe(0)
    expect(rows.totals.billablePercent).toBe(0)
  })

  it("carries truncation through, because the caller must refuse on it", () => {
    expect(reportRows(breakdownOf({ truncated: true }), RANGE).totals.truncated).toBe(true)
  })
})

describe("reportRows — buckets", () => {
  it("densifies the range, so a day off stays visible as a gap", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 9 * HOUR,
        days: [
          { day: "2026-07-13", totalMs: 5 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
          { day: "2026-07-15", totalMs: 4 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
        ],
      }),
      RANGE
    )

    expect(rows.buckets.map((b) => b.key)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ])
    expect(rows.buckets[1]).toMatchObject({ empty: true, totalMs: 0 })
  })
})

describe("reportRows — projects and descriptions", () => {
  it("names the unassigned bucket rather than printing an empty cell", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        projects: [
          {
            projectId: null,
            name: "",
            color: "",
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
        titles: [
          {
            projectId: null,
            project: "",
            title: "",
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.projects[0].name).toBe(NO_PROJECT)
    expect(rows.titles[0].project).toBe(NO_PROJECT)
    // An untitled entry gets a stated placeholder too — an empty description
    // cell reads as a rendering fault, not as work nobody named.
    expect(rows.titles[0].description).toBe("(no description)")
  })

  it("carries decimal hours per row, so a writer never re-derives them", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 29_520_000,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            totalMs: 29_520_000,
            billableMs: 29_520_000,
            billableCents: 98_800,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.titles[0].centiHours).toBe(820)
    expect(rows.titles[0].percent).toBe(100)
    expect(rows.titles[0].unpriced).toBe(false)
  })

  it("marks a row unpriced when any of its billable time has no rate", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            totalMs: HOUR,
            billableMs: HOUR,
            billableCents: 0,
            unratedBillableMs: HOUR,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.titles[0].unpriced).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project unit src/lib/export/report-rows.test.ts
```

Expected: FAIL — `Failed to resolve import "./report-rows"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/export/report-rows.ts`:

```ts
import { centiHours } from "@shared/duration"
import { bucketDays } from "@/lib/report-series"
import type { Bucket, Breakdown, Granularity } from "@/lib/report-series"
import type { DayString } from "@shared/day"

/**
 * Everything the three export writers draw, derived once.
 *
 * PURE, and typed against the structural `Breakdown` in report-series.ts rather
 * than the generated Convex API — the same boundary eslint.config.js enforces
 * for components, applied here because a document layout is exactly the kind of
 * thing worth running under a dozen shapes of made-up data.
 *
 * Every writer reads THIS, never the raw breakdown. A CSV that re-derived its
 * own percentages is a CSV that can disagree with the PDF beside it, and the
 * two are handed to the same client in the same email.
 */

/** What an entry with no project is called, once, for every writer. */
export const NO_PROJECT = "No project"

/**
 * What an entry with no title is called.
 *
 * `timeEntries.title` allows "" deliberately, so these rows are real and their
 * time is real. An empty description cell reads as a rendering fault; a stated
 * placeholder reads as work nobody named, which is the truth.
 */
export const NO_DESCRIPTION = "(no description)"

export type ReportProjectRow = {
  name: string
  color: string
  totalMs: number
  percent: number
  billableCents: number
  unratedBillableMs: number
}

export type ReportTitleRow = {
  project: string
  description: string
  totalMs: number
  /** Hundredths of an hour — the quantity an invoice line would bill. */
  centiHours: number
  percent: number
  billableCents: number
  /** Some of this row's billable time has no rate, so its amount is a floor. */
  unpriced: boolean
}

export type ReportRows = {
  meta: {
    from: DayString
    to: DayString
    currency: string
    /** Days that hold at least one entry — see `averageDailyMs`. */
    daysWorked: number
    granularity: Granularity
  }
  totals: {
    totalMs: number
    billableMs: number
    billablePercent: number
    billableCents: number
    unratedBillableMs: number
    averageDailyMs: number
    count: number
    truncated: boolean
  }
  buckets: Array<Bucket>
  projects: Array<ReportProjectRow>
  titles: Array<ReportTitleRow>
  titlesTruncated: boolean
}

/**
 * A share, as a percentage to two places — the precision the reference report
 * prints (`0.81%`, `2.23%`, `100%`).
 *
 * An empty whole answers 0 rather than NaN. A range with nothing in it is a
 * legitimate thing to export, and `NaN%` in a cell is the kind of defect that
 * reaches a client.
 */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 10_000) / 100
}

export function reportRows(
  breakdown: Breakdown,
  opts: { from: DayString; to: DayString; currency: string }
): ReportRows {
  const { granularity, buckets } = bucketDays(breakdown.days, opts.from, opts.to)

  /*
   * The average is over days that HOLD WORK, not calendar days in the range.
   *
   * A fortnight with weekends off is 14 calendar days and ~10 worked ones.
   * Dividing by 14 reports 7h/day for someone who worked nine, which is a
   * figure that argues against the user in a rate conversation. `daysWorked` is
   * carried in `meta` so the document can label the divisor rather than leave
   * the reader to guess it.
   */
  const daysWorked = breakdown.days.length
  const averageDailyMs = daysWorked === 0 ? 0 : breakdown.totalMs / daysWorked

  return {
    meta: {
      from: opts.from,
      to: opts.to,
      currency: opts.currency,
      daysWorked,
      granularity,
    },
    totals: {
      totalMs: breakdown.totalMs,
      billableMs: breakdown.billableMs,
      billablePercent: percentOf(breakdown.billableMs, breakdown.totalMs),
      billableCents: breakdown.billableCents,
      unratedBillableMs: breakdown.unratedBillableMs,
      averageDailyMs,
      count: breakdown.count,
      truncated: breakdown.truncated,
    },
    buckets,
    projects: breakdown.projects.map((project) => ({
      name: project.name === "" ? NO_PROJECT : project.name,
      color: project.color,
      totalMs: project.totalMs,
      percent: percentOf(project.totalMs, breakdown.totalMs),
      billableCents: project.billableCents,
      unratedBillableMs: project.unratedBillableMs,
    })),
    titles: breakdown.titles.map((row) => ({
      project: row.project === "" ? NO_PROJECT : row.project,
      description: row.title === "" ? NO_DESCRIPTION : row.title,
      totalMs: row.totalMs,
      centiHours: centiHours(row.totalMs),
      percent: percentOf(row.totalMs, breakdown.totalMs),
      billableCents: row.billableCents,
      unpriced: row.unratedBillableMs > 0,
    })),
    titlesTruncated: breakdown.titlesTruncated,
  }
}

/**
 * The sentence a capped list must carry, in every writer.
 *
 * Written once because it appears in the PDF, the workbook and on the page, and
 * three near-identical sentences drift until they claim three different limits.
 * Kept beside `reportRows` rather than in each writer for the same reason the
 * rows themselves are: one derivation, three renderings.
 */
export const TITLE_CAP_NOTE =
  "Only the 500 longest descriptions are listed. Narrow the range for a complete breakdown."

/** The sentence unpriced billable time must carry. Same reasoning. */
export const UNPRICED_NOTE =
  "Some billable time has no hourly rate and is not in the amount above."
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run --project unit src/lib/export/report-rows.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add src/lib/export/report-rows.ts src/lib/export/report-rows.test.ts
git commit -m "feat(export): derive the report's rows once, for all three writers

A writer that re-derives its own percentages is a writer that can disagree
with the document beside it, and both go to the same client in the same
email. Averages over days worked rather than calendar days, and says which
divisor it used.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: CSV, and the download path

**Files:**
- Create: `src/lib/export/to-csv.ts`
- Create: `src/lib/export/download.ts`
- Test: `src/lib/export/to-csv.test.ts`
- Test: `src/lib/export/download.test.ts`

**Interfaces:**
- Consumes: `ReportRows` from `./report-rows`; `formatClock`, `formatDecimalHours` from `@shared/duration`.
- Produces:
  - `toCsv(rows: ReportRows): string`
  - `csvBlob(rows: ReportRows): Blob`
  - `exportFilename(from: string, to: string, extension: string): string`
  - `downloadBlob(blob: Blob, filename: string): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/export/to-csv.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { toCsv } from "./to-csv"
import type { ReportRows } from "./report-rows"

const HOUR = 3_600_000

function rowsOf(titles: ReportRows["titles"]): ReportRows {
  return {
    meta: {
      from: "2026-07-13",
      to: "2026-07-25",
      currency: "USD",
      daysWorked: 1,
      granularity: "day",
    },
    totals: {
      totalMs: HOUR,
      billableMs: HOUR,
      billablePercent: 100,
      billableCents: 1_000,
      unratedBillableMs: 0,
      averageDailyMs: HOUR,
      count: 1,
      truncated: false,
    },
    buckets: [],
    projects: [],
    titles,
    titlesTruncated: false,
  }
}

const ONE: ReportRows["titles"] = [
  {
    project: "Acme",
    description: "Standup",
    totalMs: HOUR,
    centiHours: 100,
    percent: 100,
    billableCents: 1_000,
    unpriced: false,
  },
]

describe("toCsv", () => {
  it("leads with a header row and nothing else — a preamble is not a CSV", () => {
    const [header] = toCsv(rowsOf(ONE)).split("\r\n")
    expect(header).toBe(
      "Project,Description,Duration,Decimal hours,Percent,Amount,Currency"
    )
  })

  it("writes both duration forms, so the reader need not convert either", () => {
    expect(toCsv(rowsOf(ONE)).split("\r\n")[1]).toBe(
      "Acme,Standup,1:00:00,1.00,100,10.00,USD"
    )
  })

  it("separates records with CRLF, per RFC 4180", () => {
    expect(toCsv(rowsOf(ONE))).toContain("\r\n")
  })

  /*
   * Real entry titles contain all three. A title is free text the user typed
   * while working, and "Fixing view - toggle bleeding across Maintenance, Log
   * Entries, and vessels" is taken verbatim from the reference report.
   */
  it("quotes and doubles the three characters that break a CSV", () => {
    const csv = toCsv(
      rowsOf([
        {
          project: "Acme",
          description: 'Fixing "toggle" bleeding across Maintenance, Log\nEntries',
          totalMs: HOUR,
          centiHours: 100,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ])
    )

    expect(csv.split("\r\n")[1]).toBe(
      'Acme,"Fixing ""toggle"" bleeding across Maintenance, Log\nEntries",1:00:00,1.00,100,10.00,USD'
    )
  })

  it("ends with a TOTAL record, so a truncated paste is visibly incomplete", () => {
    const lines = toCsv(rowsOf(ONE)).split("\r\n")
    expect(lines.at(-1)).toBe("TOTAL,,1:00:00,1.00,100,10.00,USD")
  })

  it("writes an amount of nothing for an unpriced row rather than 0.00", () => {
    const csv = toCsv(
      rowsOf([{ ...ONE[0], billableCents: 0, unpriced: true }])
    )
    // Empty, not "0.00". Zero is a real rate somebody chose; unpriced is a
    // question nobody has answered, and the two must not share a cell value.
    expect(csv.split("\r\n")[1]).toBe("Acme,Standup,1:00:00,1.00,100,,USD")
  })
})
```

Create `src/lib/export/download.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { exportFilename } from "./download"

describe("exportFilename", () => {
  it("names the range, so two exports never collide in a downloads folder", () => {
    expect(exportFilename("2026-07-13", "2026-07-25", "csv")).toBe(
      "trace-report-2026-07-13_2026-07-25.csv"
    )
  })

  it("does not repeat a single-day range", () => {
    expect(exportFilename("2026-07-13", "2026-07-13", "pdf")).toBe(
      "trace-report-2026-07-13.pdf"
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run --project unit src/lib/export/to-csv.test.ts src/lib/export/download.test.ts
```

Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Write `to-csv.ts`**

```ts
import { formatClock, formatDecimalHours } from "@shared/duration"
import type { ReportRows } from "./report-rows"

/**
 * The breakdown table, and only it.
 *
 * A CSV exists to be pasted into something else. Reproducing the PDF's four
 * blocks here — tiles, a chart's worth of daily rows, a donut's ranking — would
 * produce a file with four different row shapes in it, which no spreadsheet can
 * read as a table and no script can parse without a state machine. The other
 * blocks are what XLSX has sheets for.
 *
 * No preamble either. A "Summary report from … to …" line above the header is
 * the single most common reason a CSV opens with everything in column A.
 */

/** RFC 4180: quote only when we must, and double an embedded quote. */
function cell(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function record(values: ReadonlyArray<string>): string {
  return values.map(cell).join(",")
}

/**
 * An amount, or nothing at all.
 *
 * `0.00` and "nobody has set a rate for this" are different claims, and
 * `billableCents: 0` alone cannot tell them apart — which is the same
 * distinction `unratedBillableMs` exists to carry on /reports. An empty cell is
 * the honest rendering of the second; a spreadsheet sums it as zero either way,
 * but a human reading the column can see which rows were never priced.
 */
function amount(cents: number, unpriced: boolean): string {
  return unpriced ? "" : (cents / 100).toFixed(2)
}

const HEADER = [
  "Project",
  "Description",
  "Duration",
  "Decimal hours",
  "Percent",
  "Amount",
  "Currency",
]

export function toCsv(rows: ReportRows): string {
  const { currency } = rows.meta

  const body = rows.titles.map((row) =>
    record([
      row.project,
      row.description,
      formatClock(row.totalMs),
      formatDecimalHours(row.totalMs),
      String(row.percent),
      amount(row.billableCents, row.unpriced),
      currency,
    ])
  )

  /*
   * A TOTAL record, last.
   *
   * The row that makes an incomplete paste visible: a reader who copied half
   * the file has a total that does not match its own rows, instead of a
   * plausible smaller number with nothing to contradict it.
   */
  const total = record([
    "TOTAL",
    "",
    formatClock(rows.totals.totalMs),
    formatDecimalHours(rows.totals.totalMs),
    // Checked against TOTAL DURATION, which is what this column measures —
    // NOT `billablePercent`. A range can be entirely non-billable and still
    // hold many hours, and branching on the billable share printed `0` here
    // beneath title rows that correctly summed to 100.
    String(rows.totals.totalMs === 0 ? 0 : 100),
    amount(rows.totals.billableCents, rows.totals.unratedBillableMs > 0),
    currency,
  ])

  return [record(HEADER), ...body, total].join("\r\n")
}

/**
 * The CSV as a file, with a UTF-8 BOM.
 *
 * The BOM is not decoration. Excel on Windows opens a BOM-less UTF-8 CSV in the
 * system ANSI codepage, which turns every non-ASCII character in a project name
 * or a title into mojibake — and this product's users are freelancers billing
 * across borders. `text/csv;charset=utf-8` alone does not reach Excel, because
 * Excel reads the bytes, not the Blob's type.
 */
export function csvBlob(rows: ReportRows): Blob {
  return new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" })
}
```

- [ ] **Step 4: Write `download.ts`**

```ts
/**
 * Getting a generated file out of the tab.
 *
 * Its own module because every writer ends here, and because the two
 * awkward parts — Safari's revoke timing and a filename that does not collide —
 * are worth stating once.
 */

/**
 * `trace-report-2026-07-13_2026-07-25.csv`.
 *
 * The range is in the name because a freelancer exports the same report for
 * consecutive fortnights and then has to tell two files apart in a downloads
 * folder six weeks later. A single-day range is not repeated, because
 * `…-2026-07-13_2026-07-13` reads as a defect.
 */
export function exportFilename(from: string, to: string, extension: string): string {
  const range = from === to ? from : `${from}_${to}`
  return `trace-report-${range}.${extension}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  // Appended before clicking: Firefox ignores a click on an anchor that is not
  // in the document.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  /*
   * Revoked on a later task, not synchronously.
   *
   * Safari reads the object URL asynchronously after the click, so revoking in
   * the same tick cancels the download it was created for — and does it
   * silently, which is the worst version: the button appears to work and no
   * file arrives.
   */
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run --project unit src/lib/export/to-csv.test.ts src/lib/export/download.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add src/lib/export/to-csv.ts src/lib/export/download.ts src/lib/export/to-csv.test.ts src/lib/export/download.test.ts
git commit -m "feat(export): write the breakdown as CSV, with a BOM and a TOTAL row

The BOM is what stops Excel on Windows reading UTF-8 as the ANSI codepage
and turning every accented project name into mojibake. The TOTAL row is what
makes a half-copied paste visibly incomplete rather than plausibly smaller.

An unpriced row's amount cell is empty, not 0.00 — zero is a rate somebody
chose and unpriced is a question nobody answered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: XLSX — three sheets of real cells

**SheetJS (`xlsx`) is deliberately not used.** npm's latest is `0.18.5`,
abandoned there in 2023 with known prototype-pollution and ReDoS advisories;
SheetJS publishes only to its own CDN now, which is not a dependency this
project should acquire. `write-excel-file` is browser-first, maintained, and
about a tenth of the size.

**Files:**
- Modify: `package.json`
- Create: `src/lib/export/to-xlsx.ts`
- Test: `src/lib/export/to-xlsx.test.ts`

**Interfaces:**
- Consumes: `ReportRows` from `./report-rows`; `formatClock` from `@shared/duration`.
- Produces:
  - `xlsxSheets(rows: ReportRows): Array<{ sheet: string; data: SheetData }>` — pure, testable.
  - `xlsxBlob(rows: ReportRows): Promise<Blob>` — dynamic-imports the library.

- [ ] **Step 1: Install the dependency**

```bash
pnpm add write-excel-file@4.1.1
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/export/to-xlsx.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { xlsxSheets } from "./to-xlsx"
import type { ReportRows } from "./report-rows"

const HOUR = 3_600_000

const ROWS: ReportRows = {
  meta: {
    from: "2026-07-13",
    to: "2026-07-25",
    currency: "USD",
    daysWorked: 2,
    granularity: "day",
  },
  totals: {
    totalMs: 3 * HOUR,
    billableMs: 3 * HOUR,
    billablePercent: 100,
    billableCents: 3_000,
    unratedBillableMs: 0,
    averageDailyMs: 1.5 * HOUR,
    count: 2,
    truncated: false,
  },
  buckets: [
    {
      key: "2026-07-13",
      label: "Mon 13",
      title: "Mon, 13 Jul 2026",
      totalMs: 2 * HOUR,
      billableMs: 2 * HOUR,
      nonBillableMs: 0,
      billableCents: 2_000,
      earnedCents: 2_000,
      count: 1,
      empty: false,
    },
  ],
  projects: [
    {
      name: "Acme",
      color: "amber",
      totalMs: 3 * HOUR,
      percent: 100,
      billableCents: 3_000,
      unratedBillableMs: 0,
    },
  ],
  titles: [
    {
      project: "Acme",
      description: "Standup",
      totalMs: 3 * HOUR,
      centiHours: 300,
      percent: 100,
      billableCents: 3_000,
      unpriced: false,
    },
  ],
  titlesTruncated: false,
}

describe("xlsxSheets", () => {
  it("writes three sheets, named for what a reader is looking for", () => {
    expect(xlsxSheets(ROWS).map((s) => s.sheet)).toEqual([
      "Summary",
      "By day",
      "Breakdown",
    ])
  })

  /*
   * The whole reason this is XLSX and not a second CSV. A duration written as
   * the string "3:00:00" cannot be summed, averaged or charted; the recipient
   * retypes the column, which is the transcription step this feature exists to
   * delete.
   */
  it("writes durations as numbers, so the recipient can sum the column", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[3]).toEqual({ value: 3, type: Number, format: "0.00" })
  })

  it("writes amounts as currency-formatted numbers, not strings", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[5]).toEqual({ value: 30, type: Number, format: '#,##0.00" "USD' })
  })

  it("writes days as real dates, so a pivot can group them by week", () => {
    const byDay = xlsxSheets(ROWS).find((s) => s.sheet === "By day")!
    const [, first] = byDay.data
    expect(first[0]).toMatchObject({ type: Date, format: "yyyy-mm-dd" })
    expect((first[0] as { value: Date }).value.toISOString()).toBe(
      "2026-07-13T00:00:00.000Z"
    )
  })

  it("leaves an unpriced amount empty rather than writing a zero a pivot would sum", () => {
    const unpriced = {
      ...ROWS,
      titles: [{ ...ROWS.titles[0], billableCents: 0, unpriced: true }],
    }
    const breakdown = xlsxSheets(unpriced).find((s) => s.sheet === "Breakdown")!
    expect(breakdown.data[1][5]).toBeNull()
  })

  it("says out loud when the description list was capped", () => {
    const capped = { ...ROWS, titlesTruncated: true }
    const summary = xlsxSheets(capped).find((s) => s.sheet === "Summary")!
    const flat = summary.data.flat().map((cell) => (cell as { value?: unknown })?.value)
    expect(flat).toContain(
      "Only the 500 longest descriptions are listed. Narrow the range for a complete breakdown."
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run --project unit src/lib/export/to-xlsx.test.ts
```

Expected: FAIL — `Failed to resolve import "./to-xlsx"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/export/to-xlsx.ts`:

```ts
import { parseDayString } from "@shared/day"
import { centiHours, formatClock } from "@shared/duration"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "./report-rows"
import type { ReportRows } from "./report-rows"
// `/browser`, not the bare package name: write-excel-file@4.1.1 publishes NO
// "." export — only ./node, ./browser, ./universal and ./utility.
import type { SheetData } from "write-excel-file/browser"

/**
 * The report as a workbook.
 *
 * Split in two on purpose: `xlsxSheets` is a pure function producing the cell
 * model, and `xlsxBlob` is a four-line wrapper that hands it to the library.
 * Everything worth getting wrong — which cells are numbers, which are dates,
 * what an unpriced amount looks like — is therefore testable without unzipping
 * a binary in a unit test.
 *
 * NOT SheetJS. npm's `xlsx` is stuck at 0.18.5, abandoned there since 2023 with
 * known prototype-pollution and ReDoS advisories; SheetJS publishes to its own
 * CDN now, which is not a dependency this project should take on for a download
 * button.
 */

const BOLD = { fontWeight: "bold" } as const

/** A duration in HOURS, as a number a spreadsheet can sum. */
function hours(ms: number) {
  /*
   * `centiHours`, NOT `ms / 3_600_000`.
   *
   * `format: "0.00"` makes Excel ROUND for display, so an un-floored value can
   * render as more time than was recorded — and the same entry then reads 8.20
   * here and 8.19 in the CSV, which obeys the flooring rule. Two documents in
   * one email that disagree is what this pipeline exists to prevent.
   */
  return { value: centiHours(ms) / 100, type: Number, format: "0.00" } as const
}

/**
 * Money as a number, or an empty cell.
 *
 * `null` rather than `0` for unpriced work, for the reason the CSV states: a
 * pivot table sums a zero and reports a confident wrong total, where it skips
 * a blank.
 */
function money(cents: number, currency: string, unpriced: boolean) {
  if (unpriced) return null
  return { value: cents / 100, type: Number, format: `#,##0.00" "${currency}` } as const
}

/**
 * A `DayString` as a real date cell at UTC midnight.
 *
 * UTC, not local: the calendar date was already decided server-side by
 * convex/lib/day.ts under the user's stored zone, and re-interpreting it in the
 * browser's zone is how a Monday becomes the previous Sunday in a pivot.
 */
function date(day: string) {
  const { year, month, day: d } = parseDayString(day)
  return {
    value: new Date(Date.UTC(year, month - 1, d)),
    type: Date,
    format: "yyyy-mm-dd",
  } as const
}

function text(value: string, bold = false) {
  return { value, type: String, ...(bold ? BOLD : {}) } as const
}

function summarySheet(rows: ReportRows): SheetData {
  const { meta, totals } = rows
  const data: SheetData = [
    [text("Summary report", true)],
    [text("From"), text(meta.from)],
    [text("To"), text(meta.to)],
    [],
    [text("Total hours", true), hours(totals.totalMs)],
    [text("Billable hours", true), hours(totals.billableMs)],
    [text("Billable %", true), { value: totals.billablePercent, type: Number, format: "0.00" }],
    [
      text("Amount", true),
      money(totals.billableCents, meta.currency, totals.unratedBillableMs > 0),
    ],
    [text("Average daily hours", true), hours(totals.averageDailyMs)],
    [text("Days worked", true), { value: meta.daysWorked, type: Number }],
    [text("Entries", true), { value: totals.count, type: Number }],
    [],
    [text("Project", true), text("Hours", true), text("%", true), text("Amount", true)],
    ...rows.projects.map((project) => [
      text(project.name),
      hours(project.totalMs),
      { value: project.percent, type: Number, format: "0.00" } as const,
      money(project.billableCents, meta.currency, project.unratedBillableMs > 0),
    ]),
  ]

  if (totals.unratedBillableMs > 0) {
    data.push([], [text("Note"), text(UNPRICED_NOTE)])
  }
  if (rows.titlesTruncated) {
    data.push([], [text("Note"), text(TITLE_CAP_NOTE)])
  }
  return data
}

function byDaySheet(rows: ReportRows): SheetData {
  return [
    [
      text("Date", true),
      text("Hours", true),
      text("Billable hours", true),
      text("Entries", true),
    ],
    ...rows.buckets.map((bucket) => [
      date(bucket.key),
      hours(bucket.totalMs),
      hours(bucket.billableMs),
      { value: bucket.count, type: Number } as const,
    ]),
  ]
}

function breakdownSheet(rows: ReportRows): SheetData {
  const { currency } = rows.meta
  return [
    [
      text("Project", true),
      text("Description", true),
      text("Duration", true),
      text("Hours", true),
      text("%", true),
      text("Amount", true),
    ],
    ...rows.titles.map((row) => [
      text(row.project),
      text(row.description),
      // The clock form stays as text beside the numeric one: it is what the
      // reference report prints, and a reader reconciling against that PDF
      // needs the same string to compare against.
      text(formatClock(row.totalMs)),
      hours(row.totalMs),
      { value: row.percent, type: Number, format: "0.00" } as const,
      money(row.billableCents, currency, row.unpriced),
    ]),
    [
      text("TOTAL", true),
      null,
      text(formatClock(rows.totals.totalMs), true),
      hours(rows.totals.totalMs),
      // Same expression as the CSV's TOTAL row. Hardcoding 100 exported an
      // empty range as 100% here and 0% there, from identical data.
      { value: rows.totals.totalMs === 0 ? 0 : 100, type: Number, format: "0.00" } as const,
      money(
        rows.totals.billableCents,
        currency,
        rows.totals.unratedBillableMs > 0
      ),
    ],
  ]
}

export function xlsxSheets(rows: ReportRows): Array<{ sheet: string; data: SheetData }> {
  return [
    { sheet: "Summary", data: summarySheet(rows) },
    { sheet: "By day", data: byDaySheet(rows) },
    { sheet: "Breakdown", data: breakdownSheet(rows) },
  ]
}

export async function xlsxBlob(rows: ReportRows): Promise<Blob> {
  // Dynamic, so the library never reaches the main bundle. A user who does not
  // export pays nothing for the button.
  const { default: writeXlsxFile } = await import("write-excel-file/browser")
  return await writeXlsxFile(xlsxSheets(rows)).toBlob()
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run --project unit src/lib/export/to-xlsx.test.ts
```

Expected: PASS, 6 tests. `TITLE_CAP_NOTE` and `UNPRICED_NOTE` already exist —
Task 3 defined them in `report-rows.ts`, beside the rows they describe.

- [ ] **Step 6: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add package.json pnpm-lock.yaml src/lib/export/to-xlsx.ts src/lib/export/to-xlsx.test.ts
git commit -m "feat(export): write the report as a workbook of real cells

Durations are numbers and days are dates, because a duration written as the
string \"3:00:00\" cannot be summed and the recipient retypes the column —
which is the transcription step this whole feature exists to delete.

write-excel-file rather than SheetJS: npm's xlsx is stuck at 0.18.5,
abandoned there since 2023 with open advisories.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The Export menu — CSV and XLSX live on the page

**Files:**
- Create: `src/components/ui/menu.tsx`
- Create: `src/components/reports/export-menu.tsx`
- Modify: `src/routes/_authed/reports.tsx:132-144`
- Test: `src/components/reports/export-menu.test.tsx`

**Interfaces:**
- Consumes: `Breakdown` (structural), `reportRows`, `csvBlob`, `xlsxBlob`, `exportFilename`, `downloadBlob`.
- Produces: `<ExportMenu breakdown={…} from={…} to={…} currency={…} disabledReason={string | null} />`

- [ ] **Step 1: Vendor the Base UI Menu**

Create `src/components/ui/menu.tsx`, following the vendoring style of
`src/components/ui/tabs.tsx`:

```tsx
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />
}

function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menu-trigger"
      className={cn(className)}
      {...props}
    />
  )
}

function MenuContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner sideOffset={6} align="end">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            // `border-edge-raised`, not `border-edge`: this popup sits on
            // Surface Raised, where Edge measures 2.60:1 and is under the
            // 3:1 floor. DESIGN.md states the distinction.
            "z-50 min-w-40 rounded-md border border-edge-raised bg-surface-raised p-1 text-sm shadow-lg outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none",
        "data-highlighted:bg-surface data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Menu, MenuContent, MenuItem, MenuTrigger }
```

- [ ] **Step 2: Write the failing test**

Create `src/components/reports/export-menu.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ExportMenu } from "@/components/reports/export-menu"
import type { Breakdown } from "@/lib/report-series"

/*
 * `fireEvent`, not `@testing-library/user-event`, and plain assertions rather
 * than jest-dom matchers. Neither package is a dependency of this project, and
 * every other .test.tsx here drives Base UI popups with `fireEvent.click` plus
 * `findByRole` — see classifier-pickers.test.tsx.
 */
afterEach(cleanup)

const HOUR = 3_600_000

const BREAKDOWN: Breakdown = {
  totalMs: HOUR,
  billableMs: HOUR,
  count: 1,
  runningCount: 0,
  truncated: false,
  billableCents: 1_000,
  unratedBillableMs: 0,
  days: [
    { day: "2026-07-13", totalMs: HOUR, billableMs: HOUR, billableCents: 1_000, count: 1 },
  ],
  projects: [],
  hours: Array.from({ length: 24 }, () => 0),
  titles: [
    {
      projectId: null,
      project: "Acme",
      title: "Standup",
      totalMs: HOUR,
      billableMs: HOUR,
      billableCents: 1_000,
      unratedBillableMs: 0,
      count: 1,
    },
  ],
  titlesTruncated: false,
}

const PROPS = {
  breakdown: BREAKDOWN,
  from: "2026-07-13" as const,
  to: "2026-07-13" as const,
  currency: "USD",
}

describe("ExportMenu", () => {
  it("offers exactly the three formats", async () => {
    render(<ExportMenu {...PROPS} disabledReason={null} />)

    fireEvent.click(screen.getByRole("button", { name: /export/i }))

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent)
    ).toEqual(["PDF", "CSV", "XLSX"])
  })

  /*
   * The rule this component exists to enforce. `truncated` means every figure
   * on /reports is a floor, and a floor that becomes a document handed to a
   * client is a client under-billed by an unknown amount with nothing on the
   * page to reveal it. Disabled with the reason ON the control, not a toast
   * after a click that appeared to work.
   */
  it("refuses a truncated range, and says why on the control itself", () => {
    render(
      <ExportMenu
        {...PROPS}
        breakdown={{ ...BREAKDOWN, truncated: true }}
        disabledReason="This period is too large to total exactly. Narrow the dates."
      />
    )

    const trigger = screen.getByRole("button", { name: /export/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)

    // The reason must be REACHABLE, not merely present. `aria-describedby`
    // pointing at rendered text is what a screen reader announces; a `title`
    // on a disabled control is announced by nothing and focusable by no one.
    const describedBy = trigger.getAttribute("aria-describedby")
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "This period is too large to total exactly. Narrow the dates."
    )
  })

  it("downloads a CSV named for the range", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    // jsdom implements neither, and `downloadBlob` calls both.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    })

    render(<ExportMenu {...PROPS} disabledReason={null} />)
    fireEvent.click(screen.getByRole("button", { name: /export/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "CSV" }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe("trace-report-2026-07-13.csv")

    vi.unstubAllGlobals()
    click.mockRestore()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run --project dom src/components/reports/export-menu.test.tsx
```

Expected: FAIL — `Failed to resolve import "./export-menu"`.

- [ ] **Step 4: Write the component**

Create `src/components/reports/export-menu.tsx`:

```tsx
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { downloadBlob, exportFilename } from "@/lib/export/download"
import { csvBlob } from "@/lib/export/to-csv"
import { reportRows } from "@/lib/export/report-rows"
import { xlsxBlob } from "@/lib/export/to-xlsx"
import type { Breakdown } from "@/lib/report-series"
import type { DayString } from "@shared/day"

/**
 * The three formats, and the one rule above them.
 *
 * Disabled with the reason ON the trigger rather than enabled-then-failing.
 * `truncated` means every figure on this page is a floor; a floor that becomes
 * a PDF in a client's inbox is the single worst thing this feature can do, and
 * a toast after a click that appeared to work is not a refusal.
 */
export function ExportMenu({
  breakdown,
  from,
  to,
  currency,
  disabledReason,
}: {
  breakdown: Breakdown
  from: DayString
  to: DayString
  currency: string
  /** Non-null disables the control and is announced as its description. */
  disabledReason: string | null
}) {
  const [busy, setBusy] = useState(false)

  async function run(format: "pdf" | "csv" | "xlsx") {
    setBusy(true)
    try {
      const rows = reportRows(breakdown, { from, to, currency })
      const blob =
        format === "csv"
          ? csvBlob(rows)
          : format === "xlsx"
            ? await xlsxBlob(rows)
            : await (await import("@/lib/export/to-pdf")).pdfBlob(rows)
      downloadBlob(blob, exportFilename(from, to, format))
    } finally {
      setBusy(false)
    }
  }

  const describedBy = disabledReason === null ? undefined : "export-disabled-reason"

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              disabled={disabledReason !== null || busy}
              aria-describedby={describedBy}
            >
              {busy ? "Exporting…" : "Export"}
              <ChevronDown className="size-4" />
            </Button>
          }
        />
        <MenuContent>
          <MenuItem onClick={() => void run("pdf")}>PDF</MenuItem>
          <MenuItem onClick={() => void run("csv")}>CSV</MenuItem>
          <MenuItem onClick={() => void run("xlsx")}>XLSX</MenuItem>
        </MenuContent>
      </Menu>
      {/*
        Rendered rather than put in `title`: a tooltip on a DISABLED control is
        unreachable by keyboard and invisible to a screen reader, which is
        exactly the user who most needs to know why the button will not work.
      */}
      {disabledReason === null ? null : (
        <span id="export-disabled-reason" className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  )
}
```

- [ ] **Step 5: Create a temporary `to-pdf` stub so the dynamic import type-checks**

Create `src/lib/export/to-pdf.ts`:

```ts
import type { ReportRows } from "./report-rows"

/** Replaced in Task 8. Present so `ExportMenu`'s dynamic import type-checks. */
export async function pdfBlob(_rows: ReportRows): Promise<Blob> {
  throw new Error("PDF export is not implemented yet")
}
```

- [ ] **Step 6: Wire it into the page**

In `src/routes/_authed/reports.tsx`, inside the `Reports` component, replace the
`return (` block's opening — from `<div className="flex flex-col">` through the
closing `</div>` of the `<div className="flex w-full flex-col gap-3 px-4 pt-3">`
that wraps `<FilterBar …/>` — with the following. Locate it structurally, not by
line number: this file has moved twice already.

```tsx
  /*
   * The breakdown, read HERE as well as inside SummaryTab.
   *
   * Deliberately the same `breakdownArgs` key, which is why that helper is
   * exported: convexQuery + TanStack Query dedupe an identical key into ONE
   * Convex subscription, so with the Summary tab open this costs no extra
   * reads. With the Detailed tab open it costs one, which is the price of
   * export working from either tab — and exporting only from the tab that
   * happens to be mounted would be a worse answer than a second subscription.
   */
  const range = useMemo(
    () => rangeOf(filters, settings.timezone),
    [filters, settings.timezone]
  )
  const { data: breakdown, isPlaceholderData } = useQuery({
    ...convexQuery(
      api.entries.rangeBreakdown,
      breakdownArgs(range, settings.timezone, filters)
    ),
    placeholderData: (previous) => previous,
  })

  const exportDisabledReason =
    breakdown === undefined || isPlaceholderData
      ? "Still totalling this period."
      : breakdown.truncated
        ? "This period is too large to total exactly — the figures are a floor, not the real total. Narrow the dates."
        : breakdown.count === 0
          ? "Nothing tracked in this period."
          : null

  return (
    <div className="flex flex-col">
      {/* `w-full px-4`, the same pair the rows below it take, so the filter
          row and everything under it share their left and right edges. */}
      <div className="flex w-full flex-col gap-3 px-4 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <FilterBar
              filters={filters}
              projects={projects}
              today={today}
              weekStartDay={settings.weekStartDay}
              onChange={setFilters}
            />
          </div>
          <ExportMenu
            breakdown={breakdown ?? EMPTY_BREAKDOWN}
            from={filters.from}
            to={filters.to}
            currency={settings.currency}
            disabledReason={exportDisabledReason}
          />
        </div>
      </div>
```

Add the import beside the other component imports:

```tsx
import { ExportMenu } from "@/components/reports/export-menu"
```

`EMPTY_BREAKDOWN` is already imported at the top of this file from
`@/lib/report-series`, so nothing needs moving.

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm vitest run --project dom src/components/reports/export-menu.test.tsx src/routes/_authed/-reports.test.tsx
```

Expected: PASS. If the existing reports route test asserts on the filter row's DOM shape, update it for the new wrapper `div` rather than removing the assertion.

- [ ] **Step 8: Verify in the browser**

```bash
pnpm dev
```

Open `/reports`, click **Export → CSV**, and confirm a file named
`trace-report-<from>_<to>.csv` downloads and opens in a spreadsheet with the
breakdown table and a TOTAL row. Repeat for **XLSX** and confirm three sheets,
with the Hours column summable.

- [ ] **Step 9: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add src/components/ui/menu.tsx src/components/reports/export-menu.tsx src/lib/export/to-pdf.ts src/routes/_authed/reports.tsx src/components/reports/export-menu.test.tsx
git commit -m "feat(reports): offer the range as a file, and refuse when it is a floor

The export control reads the same breakdown key the Summary tab does, so it
dedupes into one subscription rather than a second scan.

Disabled with the reason on the control when the range is truncated: every
figure on this page is a floor then, and a floor in a client's inbox is a
client under-billed with nothing on the document to reveal it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: PDF primitives — paper, and things to draw on it

**Files:**
- Modify: `package.json`
- Create: `src/lib/export/pdf/paper.ts`
- Create: `src/lib/export/pdf/ops.ts`
- Test: `src/lib/export/pdf/ops.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  ```ts
  // paper.ts
  export const PAGE: { width: 595.28; height: 841.89; margin: 48 }
  export const PAPER: Record<"ink" | "inkMuted" | "rule" | "brass" | "bar" | "barMuted" | "hatch", [number, number, number]>
  export function paperColorFor(paletteKey: string): [number, number, number]

  // ops.ts
  export type PdfOp = TextOp | RectOp | PathOp | HatchOp
  export type PdfPage = { ops: Array<PdfOp> }
  export function text(op: Omit<TextOp, "kind">): TextOp
  export function rect(op: Omit<RectOp, "kind">): RectOp
  export function donutSlices(values: ReadonlyArray<number>, cx: number, cy: number, outer: number, inner: number): Array<string>
  export function barColumns(values: ReadonlyArray<{ billableMs: number; nonBillableMs: number; empty: boolean }>, box: { x: number; y: number; width: number; height: number }): Array<PdfOp>
  ```

- [ ] **Step 1: Install pdf-lib**

```bash
pnpm add pdf-lib@1.17.1
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/export/pdf/ops.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { barColumns, donutSlices } from "./ops"

describe("donutSlices", () => {
  it("returns one path per non-zero value", () => {
    expect(donutSlices([3, 1], 100, 100, 40, 24)).toHaveLength(2)
  })

  it("skips a zero-length slice rather than emitting a degenerate arc", () => {
    expect(donutSlices([3, 0, 1], 100, 100, 40, 24)).toHaveLength(2)
  })

  it("draws nothing at all for an empty total", () => {
    expect(donutSlices([], 100, 100, 40, 24)).toEqual([])
    expect(donutSlices([0, 0], 100, 100, 40, 24)).toEqual([])
  })

  /*
   * A single 100% slice is the reference report's own case (one member, one
   * project). An arc of exactly 360 degrees has identical start and end points,
   * which most renderers draw as nothing at all.
   */
  it("closes a full circle as two arcs rather than one degenerate one", () => {
    const [path] = donutSlices([1], 100, 100, 40, 24)
    expect(path.match(/A/g)).toHaveLength(4)
  })
})

describe("barColumns", () => {
  const BOX = { x: 0, y: 0, width: 100, height: 50 }

  it("scales the tallest column to the full height", () => {
    const ops = barColumns(
      [
        { billableMs: 100, nonBillableMs: 0, empty: false },
        { billableMs: 50, nonBillableMs: 0, empty: false },
      ],
      BOX
    )
    const heights = ops.filter((op) => op.kind === "rect").map((op) => op.height)
    expect(heights[0]).toBe(50)
    expect(heights[1]).toBe(25)
  })

  it("stacks non-billable above billable, so the two always sum to the column", () => {
    const ops = barColumns([{ billableMs: 50, nonBillableMs: 50, empty: false }], BOX)
    const rects = ops.filter((op) => op.kind === "rect")
    expect(rects).toHaveLength(2)
    expect(rects[0].height + rects[1].height).toBe(50)
  })

  /*
   * The Hatch Rule. A day with nothing tracked is not a bar of height zero —
   * that reads as "no data arrived" — it is an absence, and absence is a
   * texture.
   */
  it("hatches an empty span instead of drawing a zero-height bar", () => {
    const ops = barColumns([{ billableMs: 0, nonBillableMs: 0, empty: true }], BOX)
    expect(ops.some((op) => op.kind === "hatch")).toBe(true)
    expect(ops.some((op) => op.kind === "rect")).toBe(false)
  })

  it("draws nothing but hatch when every span is empty, rather than dividing by zero", () => {
    const ops = barColumns(
      [
        { billableMs: 0, nonBillableMs: 0, empty: true },
        { billableMs: 0, nonBillableMs: 0, empty: true },
      ],
      BOX
    )
    expect(ops.every((op) => op.kind === "hatch")).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run --project unit src/lib/export/pdf/ops.test.ts
```

Expected: FAIL — `Failed to resolve import "./ops"`.

- [ ] **Step 4: Write `paper.ts`**

```ts
/**
 * The app is a warm graphite room; a document is paper.
 *
 * A `bg-ground` PDF is one nobody can print and a recipient reads as broken, so
 * the palette is re-derived at paper luminance here — once, in a table — rather
 * than inverted ad hoc at each draw call.
 *
 * DESIGN.md's rules survive the trip and are what this table encodes: brass is
 * currency amounts and nothing else (the Two Temperatures Rule), and no series
 * is identified by its colour alone — every one is labelled in the layout.
 *
 * Values are sRGB 0..1 triples, which is what pdf-lib's `rgb()` takes.
 */

export const PAGE = {
  /** A4 portrait in PostScript points, matching the reference report. */
  width: 595.28,
  height: 841.89,
  margin: 48,
} as const

export type Rgb = readonly [number, number, number]

export const PAPER = {
  /** Body text. Near-black, warm, never pure #000 — pure black on white is
   *  harsher in print than on a screen. */
  ink: [0.11, 0.10, 0.09],
  /** Labels, axis ticks, the footer. */
  inkMuted: [0.42, 0.41, 0.39],
  /** Table rules and separators. */
  rule: [0.82, 0.81, 0.79],
  /** Money, and only money. */
  brass: [0.55, 0.42, 0.09],
  /** A billable bar segment. */
  bar: [0.35, 0.44, 0.52],
  /** A non-billable bar segment — same hue, lighter, and always labelled, so
   *  the distinction never rests on the colour. */
  barMuted: [0.72, 0.76, 0.80],
  /** The Hatch Rule's stroke: absence, drawn as texture. */
  hatch: [0.86, 0.85, 0.83],
} as const satisfies Record<string, Rgb>

/**
 * A project's palette key at paper luminance.
 *
 * Falls back to `inkMuted` for a key this table does not know, rather than
 * throwing: a project colour added to `convex/lib/palette.ts` later must not
 * break an export of last year's work.
 */
/*
 * All twelve keys of `convex/lib/palette.ts`, and exactly those.
 *
 * DERIVED, not invented: each is the app's own `--project-*` oklch from
 * src/styles.css — every one of which is `oklch(0.72 C H)`, tuned for a dark
 * room — re-rendered at L = 0.55 for white paper, keeping its chroma and hue.
 * The trailing figure is the result's contrast against white; the floor for a
 * filled shape is 3:1 (WCAG 2.2 SC 1.4.11) and the worst here is 4.51:1.
 *
 * L = 0.55 is the LIGHTEST value that clears 4.5:1 across all twelve, so it
 * keeps as much of each hue's identity as legibility allows.
 */
const PROJECT_INK: Record<string, Rgb> = {
  slate: [0.412, 0.450, 0.491], // 4.84:1
  rose: [0.687, 0.299, 0.377], // 5.20:1
  coral: [0.690, 0.317, 0.225], // 5.15:1
  amber: [0.655, 0.359, 0.0], // 5.05:1
  olive: [0.462, 0.465, 0.102], // 4.77:1
  moss: [0.265, 0.515, 0.208], // 4.61:1
  sage: [0.233, 0.508, 0.373], // 4.64:1
  teal: [0.0, 0.525, 0.455], // 4.51:1
  cyan: [0.0, 0.512, 0.535], // 4.59:1
  indigo: [0.363, 0.411, 0.739], // 5.00:1
  violet: [0.494, 0.366, 0.696], // 5.12:1
  plum: [0.607, 0.323, 0.585], // 5.20:1
}

export function paperColorFor(paletteKey: string): Rgb {
  return PROJECT_INK[paletteKey] ?? PAPER.inkMuted
}
```

> **Note for the implementer:** the twelve keys above ARE
> `convex/lib/palette.ts`'s key set as of this plan — verified, not assumed.
> Add a test asserting `PROJECT_COLORS.every((key) => key in PROJECT_INK)`, so a
> colour added to the palette later fails a test rather than silently rendering
> grey in an exported chart. Do not delete the fallback: it is what keeps an
> export of last year's work rendering after such an addition.

- [ ] **Step 5: Write `ops.ts`**

```ts
import { PAPER } from "./paper"
import type { Rgb } from "./paper"

/**
 * A page as DATA, not as calls into pdf-lib.
 *
 * The split that makes this testable: `ops.ts` and `report-doc.ts` decide WHAT
 * is on each page and where, in plain objects a unit test can assert against,
 * and `render.ts` is the only file that touches the PDF library. Pagination is
 * the part that breaks, and asserting it by extracting text back out of a
 * generated binary is a test that fails for reasons that have nothing to do
 * with the layout.
 *
 * Coordinates are PDF user space: origin BOTTOM-LEFT, y increasing upward.
 */

export type TextOp = {
  kind: "text"
  x: number
  y: number
  text: string
  size: number
  bold?: boolean
  align?: "left" | "right"
  color?: Rgb
}

export type RectOp = {
  kind: "rect"
  x: number
  y: number
  width: number
  height: number
  color: Rgb
}

/** An arbitrary filled path, given as SVG path data. Used for donut slices. */
export type PathOp = { kind: "path"; x: number; y: number; d: string; color: Rgb }

/** A hatched region — absence. Rendered as diagonal strokes, never a fill. */
export type HatchOp = { kind: "hatch"; x: number; y: number; width: number; height: number }

export type PdfOp = TextOp | RectOp | PathOp | HatchOp
export type PdfPage = { ops: Array<PdfOp> }

export function text(op: Omit<TextOp, "kind">): TextOp {
  return { kind: "text", ...op }
}

export function rect(op: Omit<RectOp, "kind">): RectOp {
  return { kind: "rect", ...op }
}

const TAU = Math.PI * 2

function pointOn(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

/**
 * A donut, as one SVG path per slice.
 *
 * Zero-length slices are skipped rather than emitted as degenerate arcs, and a
 * single 100% slice — the reference report's own case, one project — is drawn
 * as TWO 180-degree arcs per edge. One arc of exactly 360 degrees has identical
 * start and end points, which most renderers resolve to nothing at all: the
 * chart would silently vanish in exactly the case it is most likely to be used.
 */
export function donutSlices(
  values: ReadonlyArray<number>,
  cx: number,
  cy: number,
  outer: number,
  inner: number
): Array<string> {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return []

  const paths: Array<string> = []
  let angle = -Math.PI / 2 // Twelve o'clock, which is where a reader starts.

  for (const value of values) {
    if (value <= 0) continue
    const sweep = (value / total) * TAU
    const end = angle + sweep
    // Split anything past a half-turn, which also covers the full-circle case.
    const mid = angle + sweep / 2
    const large = 0

    const [ox1, oy1] = pointOn(cx, cy, outer, angle)
    const [oxm, oym] = pointOn(cx, cy, outer, mid)
    const [ox2, oy2] = pointOn(cx, cy, outer, end)
    const [ix2, iy2] = pointOn(cx, cy, inner, end)
    const [ixm, iym] = pointOn(cx, cy, inner, mid)
    const [ix1, iy1] = pointOn(cx, cy, inner, angle)

    paths.push(
      [
        `M ${ox1} ${oy1}`,
        `A ${outer} ${outer} 0 ${large} 1 ${oxm} ${oym}`,
        `A ${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}`,
        `L ${ix2} ${iy2}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ixm} ${iym}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}`,
        "Z",
      ].join(" ")
    )
    angle = end
  }
  return paths
}

const COLUMN_GAP = 3

/**
 * A stacked bar per span, scaled to the tallest one.
 *
 * An empty span is HATCHED, never drawn as a bar of height zero (the Hatch
 * Rule): a zero-height bar and "no data arrived" are the same picture, and the
 * gap where somebody took a Thursday off is information the chart exists to
 * carry.
 */
export function barColumns(
  values: ReadonlyArray<{ billableMs: number; nonBillableMs: number; empty: boolean }>,
  box: { x: number; y: number; width: number; height: number }
): Array<PdfOp> {
  if (values.length === 0) return []

  const tallest = Math.max(
    ...values.map((value) => value.billableMs + value.nonBillableMs)
  )
  const slot = box.width / values.length
  const barWidth = Math.max(1, slot - COLUMN_GAP)

  const ops: Array<PdfOp> = []
  values.forEach((value, index) => {
    const x = box.x + index * slot + COLUMN_GAP / 2

    if (value.empty) {
      ops.push({ kind: "hatch", x, y: box.y, width: barWidth, height: box.height })
      return
    }

    // `tallest` is only zero when every span is empty, which the branch above
    // has already taken — but a non-empty span holding a zero-length entry
    // reaches here, so the guard stays.
    const scale = tallest <= 0 ? 0 : box.height / tallest
    const billable = value.billableMs * scale
    const nonBillable = value.nonBillableMs * scale

    if (billable > 0) {
      ops.push(rect({ x, y: box.y, width: barWidth, height: billable, color: PAPER.bar }))
    }
    if (nonBillable > 0) {
      ops.push(
        rect({
          x,
          y: box.y + billable,
          width: barWidth,
          height: nonBillable,
          color: PAPER.barMuted,
        })
      )
    }
  })
  return ops
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run --project unit src/lib/export/pdf/ops.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add package.json pnpm-lock.yaml src/lib/export/pdf/paper.ts src/lib/export/pdf/ops.ts src/lib/export/pdf/ops.test.ts
git commit -m "feat(export): draw a page as data, on paper rather than in the app's room

Ops are plain objects so pagination is assertable without extracting text
back out of a generated binary. Empty spans hatch rather than drawing a bar
of height zero, and a lone 100% slice is two arcs — one 360-degree arc has
identical endpoints and renders as nothing, in exactly the case a solo
freelancer's chart always hits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The report document

**Files:**
- Create: `src/lib/export/pdf/report-doc.ts`
- Create: `src/lib/export/pdf/render.ts`
- Rewrite: `src/lib/export/to-pdf.ts`
- Test: `src/lib/export/pdf/report-doc.test.ts`

**Interfaces:**
- Consumes: `ReportRows`, `TITLE_CAP_NOTE`, `UNPRICED_NOTE` from `../report-rows`; `PAGE`, `PAPER`, `paperColorFor` from `./paper`; every export of `./ops`.
- Produces:
  - `reportPages(rows: ReportRows): Array<PdfPage>`
  - `renderPages(pages: Array<PdfPage>): Promise<Blob>`
  - `pdfBlob(rows: ReportRows): Promise<Blob>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/export/pdf/report-doc.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { reportPages } from "./report-doc"
import type { ReportRows } from "../report-rows"

const HOUR = 3_600_000

function rowsWith(titleCount: number, over: Partial<ReportRows> = {}): ReportRows {
  return {
    meta: {
      from: "2026-07-13",
      to: "2026-07-25",
      currency: "USD",
      daysWorked: 11,
      granularity: "day",
    },
    totals: {
      totalMs: 355_680_000,
      billableMs: 355_680_000,
      billablePercent: 100,
      billableCents: 98_800,
      unratedBillableMs: 0,
      averageDailyMs: 32_334_545,
      count: titleCount,
      truncated: false,
    },
    buckets: [
      {
        key: "2026-07-13",
        label: "Mon 13",
        title: "Mon, 13 Jul 2026",
        totalMs: 5 * HOUR,
        billableMs: 5 * HOUR,
        nonBillableMs: 0,
        billableCents: 5_000,
        earnedCents: 5_000,
        count: 1,
        empty: false,
      },
    ],
    projects: [
      {
        name: "Vessel Vanguard",
        color: "amber",
        totalMs: 355_680_000,
        percent: 100,
        billableCents: 98_800,
        unratedBillableMs: 0,
      },
    ],
    titles: Array.from({ length: titleCount }, (_, n) => ({
      project: "Vessel Vanguard",
      description: `CB-${n} Fixing something`,
      totalMs: HOUR,
      centiHours: 100,
      percent: 1,
      billableCents: 1_000,
      unpriced: false,
    })),
    titlesTruncated: false,
    ...over,
  }
}

/** Every string drawn on a page, for assertions that do not care about layout. */
function textOf(page: { ops: Array<{ kind: string }> }): Array<string> {
  return page.ops
    .filter((op): op is { kind: "text"; text: string } => op.kind === "text")
    .map((op) => op.text)
}

describe("reportPages", () => {
  it("leads with the range, as the reference report does", () => {
    const [first] = reportPages(rowsWith(1))
    expect(textOf(first)).toContain("Summary report from 07/13/2026 to 07/25/2026")
  })

  it("puts the four summary tiles on the first page", () => {
    const [first] = reportPages(rowsWith(1))
    const strings = textOf(first)
    for (const label of [
      "Total Hours",
      "Billable Hours",
      "Amount",
      "Average Daily Hours",
    ]) {
      expect(strings).toContain(label)
    }
  })

  it("labels the average's divisor rather than leaving the reader to guess it", () => {
    const [first] = reportPages(rowsWith(1))
    expect(textOf(first)).toContain("over 11 days worked")
  })

  it("draws both chart blocks on the first page", () => {
    const [first] = reportPages(rowsWith(1))
    const strings = textOf(first)
    expect(strings).toContain("Duration by day")
    expect(strings).toContain("Project distribution")
  })

  it("flows a long breakdown onto further pages", () => {
    const pages = reportPages(rowsWith(120))
    expect(pages.length).toBeGreaterThan(2)
  })

  /*
   * The property that makes the table readable when it spans four pages, which
   * the reference report does. A continuation page whose columns are unlabelled
   * is a page of unattributed numbers.
   */
  it("repeats the column header on every breakdown page", () => {
    const pages = reportPages(rowsWith(120))
    const breakdownPages = pages.filter((page) =>
      textOf(page).includes("Project and description breakdown")
    )
    expect(breakdownPages.length).toBeGreaterThan(1)
    for (const page of breakdownPages) {
      expect(textOf(page)).toContain("DESCRIPTION")
      expect(textOf(page)).toContain("DURATION")
    }
  })

  it("ends with a TOTAL row on the last page and nowhere else", () => {
    const pages = reportPages(rowsWith(120))
    const withTotal = pages.filter((page) => textOf(page).includes("TOTAL"))
    expect(withTotal).toHaveLength(1)
    expect(withTotal[0]).toBe(pages.at(-1))
  })

  it("numbers every page as N / M, with M the real count", () => {
    const pages = reportPages(rowsWith(120))
    pages.forEach((page, index) => {
      expect(textOf(page)).toContain(`Page ${index + 1} / ${pages.length}`)
    })
  })

  it("carries the capped-list sentence onto the document, not just the screen", () => {
    const pages = reportPages(rowsWith(3, { titlesTruncated: true }))
    expect(pages.flatMap(textOf)).toContain(
      "Only the 500 longest descriptions are listed. Narrow the range for a complete breakdown."
    )
  })

  it("qualifies the amount when some billable time was never priced", () => {
    const pages = reportPages(
      rowsWith(3, {
        totals: { ...rowsWith(3).totals, unratedBillableMs: HOUR },
      })
    )
    expect(pages.flatMap(textOf)).toContain(
      "Some billable time has no hourly rate and is not in the amount above."
    )
  })

  it("produces one page for an empty range rather than none", () => {
    const empty = rowsWith(0, {
      buckets: [],
      projects: [],
      totals: { ...rowsWith(0).totals, totalMs: 0, billableMs: 0, count: 0 },
    })
    expect(reportPages(empty)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run --project unit src/lib/export/pdf/report-doc.test.ts
```

Expected: FAIL — `Failed to resolve import "./report-doc"`.

- [ ] **Step 3: Write `report-doc.ts`**

```ts
import { formatClock, formatDecimalHours } from "@shared/duration"
import { formatMoney } from "@shared/money"
import { parseDayString } from "@shared/day"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "../report-rows"
import { barColumns, donutSlices, rect, text } from "./ops"
import { PAGE, PAPER, paperColorFor } from "./paper"
import type { PdfOp, PdfPage } from "./ops"
import type { ReportRows } from "../report-rows"

/**
 * The report, as pages of ops.
 *
 * PURE — no pdf-lib, no DOM, no clock. Pagination is the part of a document
 * that breaks, and this is what lets it be asserted directly instead of by
 * extracting text back out of a generated binary and hoping the extractor and
 * the writer agree about word order.
 *
 * Four blocks, matching the reference report and retitled for a single-user
 * product: Toggl's "member" axis is meaningless here, so its two member blocks
 * become project ones.
 */

const LEFT = PAGE.margin
const RIGHT = PAGE.width - PAGE.margin
const TOP = PAGE.height - PAGE.margin
const BOTTOM = PAGE.margin

/** Where the breakdown table's columns sit. Right-aligned columns give their
 *  right edge, which is what `align: "right"` measures from. */
const COL = {
  project: LEFT,
  description: LEFT + 120,
  duration: RIGHT - 190,
  hours: RIGHT - 130,
  percent: RIGHT - 70,
  amount: RIGHT,
} as const

const ROW_HEIGHT = 16
const HEADER_GAP = 26

/** `2026-07-13` as `07/13/2026`, the reference report's own format. */
function us(day: string): string {
  const { year, month, day: date } = parseDayString(day)
  return `${String(month).padStart(2, "0")}/${String(date).padStart(2, "0")}/${year}`
}

function moneyOr(cents: number, currency: string, unpriced: boolean): string {
  return unpriced ? "—" : formatMoney(cents, currency)
}

function tile(x: number, y: number, label: string, value: string, brass = false): Array<PdfOp> {
  return [
    text({ x, y, text: label, size: 8, color: PAPER.inkMuted }),
    text({
      x,
      y: y - 18,
      text: value,
      size: 16,
      bold: true,
      // Brass is a CURRENCY amount and nothing else. A billable duration is
      // time that will become money, not money, and renders as ordinary ink.
      color: brass ? PAPER.brass : PAPER.ink,
    }),
  ]
}

function summaryPage(rows: ReportRows): PdfPage {
  const { meta, totals } = rows
  const ops: Array<PdfOp> = []

  ops.push(
    text({
      x: LEFT,
      y: TOP,
      text: `Summary report from ${us(meta.from)} to ${us(meta.to)}`,
      size: 16,
      bold: true,
    })
  )

  // ---- Block 1: the four tiles -------------------------------------------
  const tileY = TOP - 52
  const tileWidth = (RIGHT - LEFT) / 4
  ops.push(
    ...tile(LEFT, tileY, "Total Hours", formatClock(totals.totalMs)),
    ...tile(
      LEFT + tileWidth,
      tileY,
      "Billable Hours",
      `${formatClock(totals.billableMs)}  ${totals.billablePercent}%`
    ),
    ...tile(
      LEFT + tileWidth * 2,
      tileY,
      "Amount",
      moneyOr(totals.billableCents, meta.currency, totals.unratedBillableMs >= totals.billableMs),
      true
    ),
    ...tile(
      LEFT + tileWidth * 3,
      tileY,
      "Average Daily Hours",
      formatClock(totals.averageDailyMs)
    ),
    /*
     * The divisor, stated. "7.6 h/day" over a fortnight with weekends off is a
     * different claim from "9.0 h/day over 11 days worked", and the first one
     * argues against the user in a rate conversation. Leaving the reader to
     * infer which was used is the same defect as an unqualified amount.
     */
    text({
      x: LEFT + tileWidth * 3,
      y: tileY - 32,
      text: `over ${meta.daysWorked} days worked`,
      size: 7,
      color: PAPER.inkMuted,
    })
  )

  if (totals.unratedBillableMs > 0) {
    ops.push(
      text({ x: LEFT, y: tileY - 48, text: UNPRICED_NOTE, size: 8, color: PAPER.inkMuted })
    )
  }

  // ---- Block 2: duration by day ------------------------------------------
  const chartTop = tileY - 78
  const chartBox = { x: LEFT, y: chartTop - 130, width: RIGHT - LEFT, height: 120 }
  ops.push(
    text({ x: LEFT, y: chartTop, text: "Duration by day", size: 11, bold: true }),
    ...barColumns(rows.buckets, chartBox)
  )

  const slot = rows.buckets.length === 0 ? 0 : chartBox.width / rows.buckets.length
  rows.buckets.forEach((bucket, index) => {
    ops.push(
      text({
        x: chartBox.x + index * slot,
        y: chartBox.y - 11,
        text: bucket.label,
        size: 6,
        color: PAPER.inkMuted,
      })
    )
  })

  // Both series named. DESIGN.md: meaning is never carried by colour alone,
  // and a legend is what discharges that for a stacked bar.
  ops.push(
    rect({ x: LEFT, y: chartBox.y - 28, width: 8, height: 8, color: PAPER.bar }),
    text({ x: LEFT + 12, y: chartBox.y - 27, text: "Billable", size: 8, color: PAPER.inkMuted }),
    rect({ x: LEFT + 66, y: chartBox.y - 28, width: 8, height: 8, color: PAPER.barMuted }),
    text({
      x: LEFT + 78,
      y: chartBox.y - 27,
      text: "Non-billable",
      size: 8,
      color: PAPER.inkMuted,
    })
  )

  // ---- Block 3: project distribution -------------------------------------
  const donutTop = chartBox.y - 58
  const cx = LEFT + 60
  const cy = donutTop - 62
  ops.push(
    text({ x: LEFT, y: donutTop, text: "Project distribution", size: 11, bold: true })
  )

  const slices = donutSlices(
    rows.projects.map((project) => project.totalMs),
    cx,
    cy,
    52,
    30
  )
  slices.forEach((d, index) => {
    ops.push({
      kind: "path",
      x: 0,
      y: 0,
      d,
      color: paperColorFor(rows.projects[index]?.color ?? ""),
    })
  })

  rows.projects.forEach((project, index) => {
    const y = donutTop - 24 - index * 15
    ops.push(
      rect({
        x: cx + 84,
        y,
        width: 8,
        height: 8,
        color: paperColorFor(project.color),
      }),
      text({ x: cx + 98, y: y + 1, text: project.name, size: 9 }),
      text({
        x: RIGHT - 90,
        y: y + 1,
        text: `${project.percent}%`,
        size: 9,
        align: "right",
        color: PAPER.inkMuted,
      }),
      text({
        x: RIGHT,
        y: y + 1,
        text: formatClock(project.totalMs),
        size: 9,
        align: "right",
      })
    )
  })

  return { ops }
}

const BREAKDOWN_TITLE = "Project and description breakdown"

/** The block heading plus the column header, drawn identically on every page
 *  of the table. Repeated rather than drawn once: a continuation page with
 *  unlabelled columns is a page of unattributed numbers. */
function breakdownHeader(): Array<PdfOp> {
  const y = TOP - 24
  return [
    text({ x: LEFT, y: TOP, text: BREAKDOWN_TITLE, size: 11, bold: true }),
    text({ x: COL.project, y, text: "PROJECT", size: 7, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: "DESCRIPTION", size: 7, color: PAPER.inkMuted }),
    text({ x: COL.duration, y, text: "DURATION", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.hours, y, text: "HOURS", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.percent, y, text: "%", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.amount, y, text: "AMOUNT", size: 7, align: "right", color: PAPER.inkMuted }),
    rect({ x: LEFT, y: y - 6, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
  ]
}

function breakdownRow(row: ReportRows["titles"][number], y: number, currency: string): Array<PdfOp> {
  return [
    text({ x: COL.project, y, text: row.project, size: 8, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: row.description, size: 8 }),
    text({ x: COL.duration, y, text: formatClock(row.totalMs), size: 8, align: "right" }),
    text({ x: COL.hours, y, text: formatDecimalHours(row.totalMs), size: 8, align: "right" }),
    text({ x: COL.percent, y, text: `${row.percent}%`, size: 8, align: "right", color: PAPER.inkMuted }),
    text({
      x: COL.amount,
      y,
      text: moneyOr(row.billableCents, currency, row.unpriced),
      size: 8,
      align: "right",
      color: row.unpriced ? PAPER.inkMuted : PAPER.brass,
    }),
  ]
}

export function reportPages(rows: ReportRows): Array<PdfPage> {
  const pages: Array<PdfPage> = [summaryPage(rows)]
  const { currency } = rows.meta

  /*
   * The TOTAL row is reserved a slot on the last page from the start.
   *
   * Paginating the rows first and appending the total afterwards puts it alone
   * on a fifth page whenever the rows happen to fill the fourth — a document
   * whose final page is one number with no table above it.
   */
  const perPage = Math.floor((TOP - HEADER_GAP - BOTTOM - ROW_HEIGHT * 2) / ROW_HEIGHT)

  let index = 0
  do {
    const slice = rows.titles.slice(index, index + perPage)
    const ops = breakdownHeader()
    slice.forEach((row, n) => {
      ops.push(...breakdownRow(row, TOP - HEADER_GAP - (n + 1) * ROW_HEIGHT, currency))
    })
    index += perPage

    const last = index >= rows.titles.length
    if (last) {
      const y = TOP - HEADER_GAP - (slice.length + 2) * ROW_HEIGHT
      ops.push(
        rect({ x: LEFT, y: y + ROW_HEIGHT - 4, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
        text({ x: COL.project, y, text: "TOTAL", size: 9, bold: true }),
        text({ x: COL.duration, y, text: formatClock(rows.totals.totalMs), size: 9, bold: true, align: "right" }),
        text({ x: COL.hours, y, text: formatDecimalHours(rows.totals.totalMs), size: 9, bold: true, align: "right" }),
        text({ x: COL.percent, y, text: "100%", size: 9, bold: true, align: "right" }),
        text({
          x: COL.amount,
          y,
          text: moneyOr(
            rows.totals.billableCents,
            currency,
            rows.totals.unratedBillableMs >= rows.totals.billableMs
          ),
          size: 9,
          bold: true,
          align: "right",
          color: PAPER.brass,
        })
      )
      if (rows.titlesTruncated) {
        ops.push(
          text({ x: LEFT, y: y - 20, text: TITLE_CAP_NOTE, size: 8, color: PAPER.inkMuted })
        )
      }
      if (rows.totals.unratedBillableMs > 0) {
        ops.push(
          text({ x: LEFT, y: y - 34, text: UNPRICED_NOTE, size: 8, color: PAPER.inkMuted })
        )
      }
    }

    pages.push({ ops })
  } while (index < rows.titles.length)

  /*
   * An empty range gets the summary page and nothing else. A breakdown page
   * holding a header, a rule and a TOTAL of zero is a page that says "here is
   * the work" above no work.
   */
  const finished = rows.titles.length === 0 ? [pages[0]] : pages

  finished.forEach((page, n) => {
    page.ops.push(
      text({
        x: RIGHT,
        y: BOTTOM - 18,
        text: `Page ${n + 1} / ${finished.length}`,
        size: 7,
        align: "right",
        color: PAPER.inkMuted,
      })
    )
  })

  return finished
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run --project unit src/lib/export/pdf/report-doc.test.ts
```

Expected: PASS, 11 tests. If `perPage` produces a page count the "flows onto
further pages" test disagrees with, adjust `ROW_HEIGHT`/`HEADER_GAP` — do not
weaken the assertion.

- [ ] **Step 5: Write `render.ts`, the only file that touches pdf-lib**

```ts
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { PAGE, PAPER } from "./paper"
import type { PdfPage } from "./ops"
import type { PDFFont, PDFPage } from "pdf-lib"

/**
 * Ops onto paper. The ONLY file in the project that imports pdf-lib.
 *
 * Helvetica rather than the app's DM Sans. Embedding a variable webfont means
 * `@pdf-lib/fontkit`, a TTF asset in the bundle, and a subsetting step — a real
 * amount of weight for a document nobody reads for its typeface. Worth
 * revisiting when the invoice PDF lands, since that one carries the user's
 * brand; a report handed over as evidence does not.
 */

const HATCH_SPACING = 5

function drawHatch(
  page: PDFPage,
  op: { x: number; y: number; width: number; height: number }
): void {
  const color = rgb(...PAPER.hatch)
  // Diagonals at 45 degrees, clipped by drawing only within the box. Absence as
  // a texture (the Hatch Rule) — never a fill, which would read as a value.
  for (let offset = 0; offset < op.width + op.height; offset += HATCH_SPACING) {
    const x1 = op.x + Math.min(offset, op.width)
    const y1 = op.y + Math.max(0, offset - op.width)
    const x2 = op.x + Math.max(0, offset - op.height)
    const y2 = op.y + Math.min(offset, op.height)
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color })
  }
}

export async function renderPages(pages: Array<PdfPage>): Promise<Blob> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const model of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    for (const op of model.ops) {
      if (op.kind === "text") {
        const font: PDFFont = op.bold ? bold : regular
        // Right alignment is measured, not approximated: the amount column is
        // the one a reader scans down, and a ragged right edge in it reads as
        // a different number of digits than is there.
        const width = op.align === "right" ? font.widthOfTextAtSize(op.text, op.size) : 0
        page.drawText(op.text, {
          x: op.x - width,
          y: op.y,
          size: op.size,
          font,
          color: rgb(...(op.color ?? PAPER.ink)),
        })
      } else if (op.kind === "rect") {
        page.drawRectangle({
          x: op.x,
          y: op.y,
          width: op.width,
          height: op.height,
          color: rgb(...op.color),
        })
      } else if (op.kind === "path") {
        // pdf-lib's SVG path space is y-DOWN from the given origin, while every
        // coordinate in `ops.ts` is y-up PDF user space. `scale: -1` on y is
        // what reconciles them, and it is done here rather than in the path
        // builder so the ops stay in one coordinate system.
        page.drawSvgPath(op.d, { x: op.x, y: PAGE.height, color: rgb(...op.color) })
      } else {
        drawHatch(page, op)
      }
    }
  }

  return new Blob([await doc.save()], { type: "application/pdf" })
}
```

> **Note for the implementer:** `drawSvgPath`'s y-axis convention is the one
> thing here that must be confirmed against a rendered file rather than a test.
> Generate a report with two projects, open it, and check the donut is a donut
> and is inside the page. If it is mirrored vertically, the fix is in this
> function only — `ops.ts` and `report-doc.ts` do not change.

- [ ] **Step 6: Replace the `to-pdf.ts` stub**

```ts
import { reportPages } from "./pdf/report-doc"
import { renderPages } from "./pdf/render"
import type { ReportRows } from "./report-rows"

export async function pdfBlob(rows: ReportRows): Promise<Blob> {
  return await renderPages(reportPages(rows))
}
```

- [ ] **Step 7: Confirm the library stays out of the main bundle**

```bash
pnpm build
```

Expected: `pdf-lib` and `write-excel-file` appear in their own chunks, not in
the entry chunk. Check the Vite output listing; if either landed in the entry,
the cause is a static `import` somewhere that should be `await import()`.

- [ ] **Step 8: Verify in the browser**

```bash
pnpm dev
```

On `/reports`, pick a range with at least two projects and 60+ distinct
titles, then **Export → PDF**. Confirm against
`TogglTrack_Report_Summary_report_(from_07_13_2026_to_07_25_2026).pdf`:

- page 1 has the range heading, four tiles, the day chart with a legend, and the donut
- the breakdown spans several pages, each carrying `DESCRIPTION` / `DURATION`
- `TOTAL` appears once, on the last page
- every page has `Page N / M` with M matching the real count
- amounts are brass, durations are not
- a day with nothing tracked is hatched, not a flat bar

- [ ] **Step 9: Commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

```bash
git add src/lib/export/pdf/report-doc.ts src/lib/export/pdf/render.ts src/lib/export/to-pdf.ts src/lib/export/pdf/report-doc.test.ts
git commit -m "feat(export): lay the report out on paper, in four blocks

Pagination reserves the TOTAL row's slot up front rather than appending it,
so a table that happens to fill its last page does not produce a final page
holding one number and no table.

The header repeats on every breakdown page, and the average states its
divisor: 7.6 h/day over calendar days and 9.0 h/day over days worked are
different claims, and only one of them is what happened.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §2's `titles` cut → Task 2. §2's truncation refusal → Task 6
Step 4 and its second test. §3's pipeline layout → Tasks 3–5, 7–8. §3's "charts
are drawn, not screenshotted" → Task 7. §3's "the PDF is paper" → Task 7
`paper.ts`. §4's Export dropdown → Task 6. §6's four blocks, repeating header,
`Page N / M`, CSV-is-the-table-only, three-sheet XLSX → Task 8 and Task 5. §7's
test list → the CSV quoting test (Task 4), the PDF pagination tests (Task 8),
`report-rows` fixtures (Task 3).

**Deliberately out of scope**, and tracked for the invoices plan: §1 (all three
tables), §4's `/invoices` routes and Clients tab, §5's editor, §6's invoice PDF.
`centiHours` (Task 1) is the one piece of that work pulled forward, because the
invoice quantity and the exported decimal hours must be the same arithmetic.

**Two spec details this plan sharpens.** The spec said "one row per title" for
CSV without saying what an unpriced amount looks like — it is an empty cell, not
`0.00`, for the reason `unratedBillableMs` exists. And the spec did not define
"Average Daily Hours"; this plan divides by days worked and prints the divisor
on the document, because the alternative silently understates the user's rate.

**One risk carried forward.** `drawSvgPath`'s y-axis convention is asserted by
eye in Task 8 Step 8, not by a test. It is isolated to `render.ts`, and every
other layout property is covered by `report-doc.test.ts`.

**Three defects a second pass caught**, all now fixed above and all of the same
kind — assuming a tool the repo does not actually have:

1. Task 6's test imported `@testing-library/user-event` and used the jest-dom
   matchers `toBeDisabled` / `toHaveAccessibleDescription`. **Neither package is
   a dependency.** Rewritten to the house idiom — `fireEvent` plus `findByRole`,
   as in `src/components/classifiers/classifier-pickers.test.tsx` — with plain
   assertions. The `aria-describedby` assertion is now stronger than the matcher
   would have been: it resolves the id and reads the element's text, so it
   proves the reason is reachable rather than merely referenced.
2. Task 5 defined `TITLE_CAP_NOTE` and `UNPRICED_NOTE` in a step *after* the
   file importing them, so its own test could never have gone green. Both
   constants now live in Task 3 beside `reportRows`, which is where they
   belonged: one derivation, three renderings.
3. `\u0000` and `\uFEFF` were written as literal control characters rather than
   escape sequences, which made this file register as binary to `grep`. Both are
   now escapes.

**Verified against the repo rather than assumed:** `Button`'s `outline` variant
and `size` prop; the `surface-raised`, `edge-raised` and `brass` Tailwind
tokens; `parseDayString` / `formatClock` / `formatDecimalHours` / `formatMoney`
exports; `write-excel-file@4.1.1`'s `writeXlsxFile(sheets).toBlob()` signature
and its `{ value, type, format }` cell shape; and that npm's `xlsx` is stranded
at `0.18.5`.
