import { describe, expect, it } from "vitest"
import { reportPages, COL } from "./report-doc"
import { PAGE, TYPE } from "./paper"
import { textWidth } from "./ops"
import { groupWeeks } from "../report-rows"
import type { PdfOp } from "./ops"
import type { ReportRows } from "../report-rows"

const BOTTOM = PAGE.margin

const HOUR = 3_600_000

/**
 * `over.weeks` is derived from `over.titles` (or the default rows) with the
 * SAME `groupWeeks` the real export pipeline uses, unless a test supplies its
 * own `weeks` — most tests here are about pagination geometry and truncation,
 * not grouping, so they get a realistic single-week `weeks` for free just by
 * giving their rows a `weekStart`. Tests about the week sections themselves
 * (headings, subtotals, the orphan rule) pass `weeks` explicitly instead, so
 * they can pick exact row counts to land on a page boundary.
 */
function rowsWith(titleCount: number, over: Partial<ReportRows> = {}): ReportRows {
  const meta = {
    from: "2026-07-13",
    to: "2026-07-25",
    currency: "USD",
    daysWorked: 11,
    granularity: "day" as const,
    ...over.meta,
  }
  const totals = {
    totalMs: 355_680_000,
    billableMs: 355_680_000,
    billablePercent: 100,
    billableCents: 98_800,
    unratedBillableMs: 0,
    averageDailyMs: 32_334_545,
    count: titleCount,
    truncated: false,
    ...over.totals,
  }
  const titles =
    over.titles ??
    Array.from({ length: titleCount }, (_, n) => ({
      project: "Vessel Vanguard",
      description: `CB-${n} Fixing something`,
      weekStart: "2026-07-13",
      totalMs: HOUR,
      centiHours: 100,
      percent: 1,
      billableCents: 1_000,
      unpriced: false,
    }))

  return {
    meta,
    totals,
    buckets: over.buckets ?? [
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
    projects: over.projects ?? [
      {
        name: "Vessel Vanguard",
        color: "amber",
        totalMs: 355_680_000,
        percent: 100,
        billableCents: 98_800,
        unratedBillableMs: 0,
      },
    ],
    titles,
    weeks: over.weeks ?? groupWeeks(titles, totals.totalMs, meta.from, meta.to),
    titlesTruncated: over.titlesTruncated ?? false,
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

  // P1-6: the Billable tile previously jammed `40:17:00 100%` into one string,
  // which reads as a single figure. The percent belongs on its own sub-line,
  // the same anatomy the Average tile already uses for its divisor.
  it("keeps the Billable tile's percent on its own sub-line, not glued to the duration", () => {
    const [first] = reportPages(rowsWith(1))
    const strings = textOf(first)
    expect(strings).toContain("98:48:00")
    expect(strings).not.toContain("98:48:00  100%")
    expect(strings.some((s) => s.includes("100%") && s !== "98:48:00")).toBe(true)
  })

  // P0-3: the donut is drawn through render.ts's SVG-space flip (`scale(1,-1)`
  // about `PAGE.height`), so a real, y-up page position must be converted with
  // `PAGE.height - realY` before being handed to `donutSlices`. Feeding a
  // plain y-up value straight through (the previous bug) put the donut's own
  // top edge a few points ABOVE its heading's baseline instead of below it.
  it("keeps the donut's top edge below its heading once the SVG y-flip is accounted for", () => {
    const [first] = reportPages(rowsWith(1))
    const heading = first.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.text === "Project distribution"
    )
    const slice = first.ops.find(
      (op): op is Extract<PdfOp, { kind: "path" }> => op.kind === "path"
    )
    expect(heading).toBeDefined()
    expect(slice).toBeDefined()
    if (!heading || !slice) return

    // The path's `M` command starts at the outer arc's twelve-o'clock point —
    // the donut's own top edge — in the y-DOWN space the SVG flip expects.
    const [, svgY] = slice.d.match(/^M [\d.eE+-]+ ([\d.eE+-]+)/) ?? []
    expect(svgY).toBeDefined()
    const realY = PAGE.height - Number(svgY)

    expect(realY).toBeLessThan(heading.y)
    // Not just "less than" by a rounding error: comfortably clear of the
    // heading's own cap height (~8pt for 11pt bold Helvetica).
    expect(heading.y - realY).toBeGreaterThanOrEqual(8)
  })

  /*
   * P0-1's actual invariant, asserted as geometry rather than by eye. DURATION
   * is right-aligned: COL.duration is where its glyphs END and they extend
   * LEFTWARD from there. A description budget measured "up to COL.duration"
   * (the anchor the duration text ENDS at, not where it BEGINS) leaves the
   * region the duration itself occupies double-claimed. This must hold for a
   * row with both a long description and a wide duration — the exact
   * `[B-CB-326] Building Crew Training...` / `7:51:34` collision that was
   * observed in a rendered export.
   */
  it("keeps every wrapped description line clear of where the duration text actually begins", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description:
            "[B-CB-326] Building Crew Training CSV and PDF download for the offshore vessel maintenance logs",
          weekStart: "2026-07-13",
          totalMs: 445_507_000, // formatClock -> "123:45:07", as wide as a duration string gets
          centiHours: 44550,
          percent: 42,
          billableCents: 123_456,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)

    // `size === TYPE.body` (the row's own font size) is what actually picks out data
    // rows: filtering on text content alone also catches the page's bold,
    // heading, which happens to share `COL.description`'s left
    // margin coincidentally (both trace back to `LEFT`). This description is
    // long enough at the row's own column width to wrap onto several lines
    // now that it is no longer truncated, so EVERY one of those lines — not
    // just the first found — must clear where DURATION's glyphs begin.
    const descriptionOps = breakdown.ops.filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.description && op.size === TYPE.body
    )
    const durationOp = breakdown.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.duration && op.align === "right" && op.size === TYPE.body
    )
    expect(descriptionOps.length).toBeGreaterThan(1)
    expect(durationOp).toBeDefined()
    if (!durationOp) return

    const durationStartX =
      COL.duration - textWidth(durationOp.text, durationOp.size, durationOp.bold ?? false)

    for (const descriptionOp of descriptionOps) {
      const descriptionEndX =
        COL.description +
        textWidth(descriptionOp.text, descriptionOp.size, descriptionOp.bold ?? false)
      expect(descriptionEndX).toBeLessThan(durationStartX)
    }
  })

  /*
   * The table stops truncating descriptions with an ellipsis and wraps them
   * instead — the whole point of this change is that the text a billed line
   * is justified by must still be readable, not cut off with `…`.
   */
  it("renders a long description as multiple text ops rather than one ending in an ellipsis", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description:
            "[B-CB-326] Building Crew Training CSV and PDF download for the offshore vessel maintenance logs",
          weekStart: "2026-07-13",
          totalMs: HOUR,
          centiHours: 100,
          percent: 42,
          billableCents: 123_456,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)
    const descriptionOps = breakdown.ops.filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.description && op.size === TYPE.body
    )
    expect(descriptionOps.length).toBeGreaterThan(1)
    for (const op of descriptionOps) {
      expect(op.text.endsWith("…")).toBe(false)
    }
    // Every line reassembles the original words, in order — wrapping must not
    // silently drop any of the text a client reconciles against an invoice.
    expect(descriptionOps.map((op) => op.text).join(" ")).toBe(rows.titles[0].description)
  })

  /*
   * Same reasoning, one column over. PROJECT is left-aligned so its own start
   * is not the failure mode DURATION has, but its budget must still stop
   * before DESCRIPTION's start (minus a real gutter), not run into it — for
   * every wrapped line, not just whichever one `.find` happened to return.
   */
  it("keeps every wrapped project line clear of where the description column starts", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "A Genuinely Long Client-Facing Project Name For The Fleet",
          description: "Short note",
          weekStart: "2026-07-13",
          totalMs: 3_661_000,
          centiHours: 101,
          percent: 12,
          billableCents: 4_000,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)

    // Same reason as above: `size === TYPE.body` isolates data rows from both the
    // header label and the page's bold block heading, which shares
    // `COL.project` (== `LEFT`) purely by coincidence.
    const projectOps = breakdown.ops.filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.project && op.size === TYPE.body
    )
    expect(projectOps.length).toBeGreaterThan(1)

    for (const projectOp of projectOps) {
      const projectEndX =
        COL.project + textWidth(projectOp.text, projectOp.size, projectOp.bold ?? false)
      expect(projectEndX).toBeLessThan(COL.description)
    }
  })

  /*
   * The pagination invariant that variable row heights put directly at risk:
   * a fixed rows-per-page count can no longer guarantee this, since a page's
   * actual content height now depends on how many lines each row wrapped to.
   * A fixture where every description wraps to three lines is the case most
   * likely to push a row's bottom line past the margin if the accumulator is
   * wrong.
   */
  it("keeps every row's text within the page's bottom margin, with a wrapping-heavy fixture", () => {
    const LONG_DESCRIPTION =
      "Reconciling offshore vessel maintenance logs against the client's own crew training CSV export for the quarter"
    const rows = rowsWith(40, {
      titles: Array.from({ length: 40 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `[B-CB-${300 + n}] ${LONG_DESCRIPTION}`,
        weekStart: "2026-07-13",
        totalMs: HOUR,
        centiHours: 100,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      })),
    })
    const pages = reportPages(rows)
    const breakdownPages = pages.filter((page) =>
      textOf(page).includes("Project and description breakdown")
    )
    expect(breakdownPages.length).toBeGreaterThan(1) // confirms the fixture actually spans pages

    for (const page of breakdownPages) {
      for (const op of page.ops) {
        if (op.kind !== "text") continue
        // The footer is deliberately drawn IN the bottom margin, at
        // `BOTTOM - 18` — it is not a table row and must not be held to the
        // row invariant it is exempt from by design.
        if (/^Page \d+ \/ \d+$/.test(op.text)) continue
        expect(op.y).toBeGreaterThanOrEqual(BOTTOM)
      }
    }
  })

  describe("weekly grouping", () => {
    it("draws each week's own heading, with its clamped date span", () => {
      // The default fixture's single week runs 2026-07-13 to 2026-07-19,
      // computed by the same `groupWeeks` the real pipeline uses.
      const pages = reportPages(rowsWith(1))
      expect(pages.flatMap(textOf)).toContain("13 – 19 Jul 2026")
    })

    it("draws a subtotal row beneath each week's rows, distinct from the grand TOTAL", () => {
      const pages = reportPages(rowsWith(3))
      const strings = pages.flatMap(textOf)
      expect(strings).toContain("Subtotal")
      expect(strings).toContain("TOTAL")
    })

    it("draws one heading and one subtotal per week, for a range spanning two weeks", () => {
      const week1 = Array.from({ length: 2 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W1-${n}`,
        weekStart: "2026-07-13",
        totalMs: HOUR,
        centiHours: 100,
        percent: 12.5,
        billableCents: 1_000,
        unpriced: false,
      }))
      const week2 = Array.from({ length: 2 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W2-${n}`,
        weekStart: "2026-07-20",
        totalMs: HOUR,
        centiHours: 100,
        percent: 12.5,
        billableCents: 1_000,
        unpriced: false,
      }))
      const titles = [...week1, ...week2]
      const rows = rowsWith(titles.length, {
        titles,
        // Extended past both weeks' real spans so neither label is clamped —
        // clamping itself is `reportRows`' own concern and is covered in
        // report-rows.test.ts; this test is only about one heading and one
        // subtotal appearing per week.
        meta: { ...rowsWith(0).meta, to: "2026-07-26" },
        totals: { ...rowsWith(0).totals, totalMs: 4 * HOUR, count: 4 },
      })

      const strings = reportPages(rows).flatMap(textOf)
      // Two distinct week headings, and two "Subtotal" rows — one per week.
      expect(strings).toContain("13 – 19 Jul 2026")
      expect(strings).toContain("20 – 26 Jul 2026")
      expect(strings.filter((s) => s === "Subtotal")).toHaveLength(2)
    })

    /*
     * THE ORPHAN RULE. A week heading with its first row pushed to the next
     * page reads as an announcement of a week with no work in it — the exact
     * defect `report-doc.ts`'s pagination pass exists to prevent by looking
     * ahead to the heading's own first row before deciding whether the
     * heading fits.
     *
     * The row counts here are engineered, not arbitrary: `perPageBudget` at
     * this document's fixed geometry (TOP/BOTTOM margins, HEADER_GAP, the
     * reserved TOTAL slot) is 672.89pt, and every single-line row/heading/
     * subtotal slot is 20pt. Thirty week-one rows plus its own heading and
     * subtotal consume exactly 640pt, leaving 32.89pt of page one — enough
     * for week two's heading (20pt) ALONE, but not enough for the heading
     * plus its first row (40pt). A page-one-only accumulator would therefore
     * place the heading on page one and bump only the row to page two; the
     * guarded packer must move both together instead.
     */
    it("keeps a week heading on the same page as its first row, never split across a page boundary", () => {
      const week1 = Array.from({ length: 30 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W1-${n}`,
        weekStart: "2026-07-13",
        totalMs: HOUR,
        centiHours: 100,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      }))
      const week2 = Array.from({ length: 3 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W2-${n}`,
        weekStart: "2026-07-20",
        totalMs: HOUR,
        centiHours: 100,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      }))
      const titles = [...week1, ...week2]
      const rows = rowsWith(titles.length, {
        titles,
        // Extended past week two's real span so its label is not clamped —
        // clamping is exercised separately in report-rows.test.ts.
        meta: { ...rowsWith(0).meta, to: "2026-07-26" },
        totals: { ...rowsWith(0).totals, totalMs: 33 * HOUR, count: 33 },
      })

      const pages = reportPages(rows)
      const pageOf = (needle: string) =>
        pages.findIndex((page) => textOf(page).includes(needle))

      const headingPage = pageOf("20 – 26 Jul 2026")
      const firstRowPage = pageOf("W2-0")
      expect(headingPage).toBeGreaterThan(-1)
      expect(firstRowPage).toBeGreaterThan(-1)
      expect(headingPage).toBe(firstRowPage)
    })
  })
})
