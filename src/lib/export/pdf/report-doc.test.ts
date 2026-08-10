import { describe, expect, it } from "vitest"
import { reportPages, COL } from "./report-doc"
import { PAGE } from "./paper"
import { helveticaWidth } from "./ops"
import type { PdfOp } from "./ops"
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
  it("keeps the rendered description clear of where the duration text actually begins", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description:
            "[B-CB-326] Building Crew Training CSV and PDF download for the offshore vessel maintenance logs",
          totalMs: 445_507_000, // formatClock -> "123:45:07", as wide as a duration string gets
          centiHours: 44550,
          percent: 42,
          billableCents: 123_456,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)

    // `size === 8` (the row's own font size) is what actually picks out the
    // data row: filtering on text content alone also catches the page's bold,
    // 11pt block heading, which happens to share `COL.description`'s left
    // margin coincidentally (both trace back to `LEFT`).
    const descriptionOp = breakdown.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.description && op.size === 8
    )
    const durationOp = breakdown.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.duration && op.align === "right" && op.size === 8
    )
    expect(descriptionOp).toBeDefined()
    expect(durationOp).toBeDefined()
    if (!descriptionOp || !durationOp) return

    const descriptionEndX =
      COL.description + helveticaWidth(descriptionOp.text, descriptionOp.size, descriptionOp.bold ?? false)
    const durationStartX =
      COL.duration - helveticaWidth(durationOp.text, durationOp.size, durationOp.bold ?? false)

    expect(descriptionEndX).toBeLessThan(durationStartX)
  })

  /*
   * Same reasoning, one column over. PROJECT is left-aligned so its own start
   * is not the failure mode DURATION has, but its budget must still stop
   * before DESCRIPTION's start (minus a real gutter), not run into it.
   */
  it("keeps the rendered project cell clear of where the description column starts", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "A Genuinely Long Client-Facing Project Name For The Fleet",
          description: "Short note",
          totalMs: 3_661_000,
          centiHours: 101,
          percent: 12,
          billableCents: 4_000,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)

    // Same reason as above: `size === 8` isolates the data row from both the
    // header label and the page's bold block heading, which shares `COL.project`
    // (== `LEFT`) purely by coincidence.
    const projectOp = breakdown.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === COL.project && op.size === 8
    )
    expect(projectOp).toBeDefined()
    if (!projectOp) return

    const projectEndX =
      COL.project + helveticaWidth(projectOp.text, projectOp.size, projectOp.bold ?? false)

    expect(projectEndX).toBeLessThan(COL.description)
  })
})
