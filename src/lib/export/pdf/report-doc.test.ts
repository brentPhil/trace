import { describe, expect, it } from "vitest"
import { reportPages, BREAKDOWN_TITLE, COL } from "./report-doc"
import { PAGE, PAPER, TYPE, paperColorFor } from "./paper"
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
    unpriced: false,
    averageDailyMs: 32_334_545,
    count: titleCount,
    truncated: false,
    percent: 100,
    ...over.totals,
  }
  const titles =
    over.titles ??
    Array.from({ length: titleCount }, (_, n) => ({
      project: "Vessel Vanguard",
      description: `CB-${n} Fixing something`,
      weekStart: "2026-07-13",
      notes: [],
      totalMs: HOUR,
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
    notesTruncated: over.notesTruncated ?? false,
  }
}

/**
 * The footnote block's text, reassembled into one string.
 *
 * The notes under the Total wrap, so a sentence is several ops; joining them
 * back is what lets a test assert the sentence a reader actually sees rather
 * than whichever fragment happened to land first.
 */
function footnoteText(page: { ops: Array<PdfOp> }): string {
  return page.ops
    .filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.x === PAGE.margin && op.size === TYPE.body && op.bold !== true
    )
    .map((op) => op.text)
    .join(" ")
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
    // Sentence case, per DESIGN.md's Sentence Case Rule — these were Title
    // Case, and the column headers below were tracked-out uppercase.
    for (const label of [
      "Total hours",
      "Billable hours",
      "Amount",
      "Average daily hours",
    ]) {
      expect(strings).toContain(label)
    }
  })

  /*
   * Every tile fills all three slots. Two of the four used to leave the
   * sub-line empty, which reads as a missing figure rather than as a figure
   * needing no qualifier — see `tile`'s own docstring on learning the shape
   * once.
   */
  it("qualifies every tile, not just the two that had a qualifier to hand", () => {
    const [first] = reportPages(rowsWith(3))
    const strings = textOf(first)
    expect(strings).toContain("3 entries")
    expect(strings).toContain("USD")
  })

  it("counts a single entry in the singular", () => {
    const [first] = reportPages(rowsWith(1))
    expect(textOf(first)).toContain("1 entry")
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
      textOf(page).some((line) => line.startsWith(BREAKDOWN_TITLE))
    )
    expect(breakdownPages.length).toBeGreaterThan(1)
    for (const page of breakdownPages) {
      // Only the two NUMERIC columns are labelled now: the first line of every
      // row is the project, so a "Description" label sat over something that
      // was not directly beneath it.
      expect(textOf(page)).toContain("Duration")
      expect(textOf(page)).toContain("Amount")
    }
  })

  /*
   * Printed paper separates. A breakdown page that names neither the range it
   * covers nor the fact that pages precede it is a table of unattributed hours
   * and dollars the moment it leaves the stapler — the same defect
   * `invoice-doc.ts` already closed for its own continuation pages.
   */
  it("names itself and its range on every breakdown page", () => {
    const pages = reportPages(rowsWith(120))
    const breakdownPages = pages.filter((page) => textOf(page).includes(BREAKDOWN_TITLE))
    expect(breakdownPages.length).toBeGreaterThan(1)
    for (const page of breakdownPages) {
      expect(textOf(page)).toContain("07/13/2026 to 07/25/2026")
    }
  })

  /*
   * Nothing is annotated "(continued)" — not the title, not a week band.
   *
   * It was, and it was captioning something the page already shows: the footer
   * says `Page 3 / 4`, which states both that pages precede this one and how
   * many follow — strictly more than the word did — and a repeated heading at
   * the top of a page is the ordinary convention for a group spanning a break.
   * Attribution is carried by repeating the title, the range and the week
   * label, all of which this file asserts elsewhere.
   */
  it("annotates nothing as continued", () => {
    for (const line of reportPages(rowsWith(120)).flatMap(textOf)) {
      expect(line).not.toContain("continued")
    }
  })

  it("ends with a Total row on the last page and nowhere else", () => {
    const pages = reportPages(rowsWith(120))
    const withTotal = pages.filter((page) => textOf(page).includes("Total"))
    expect(withTotal).toHaveLength(1)
    expect(withTotal[0]).toBe(pages.at(-1))
  })

  it("numbers every page as N / M, with M the real count", () => {
    const pages = reportPages(rowsWith(120))
    pages.forEach((page, index) => {
      expect(textOf(page)).toContain(`Page ${index + 1} / ${pages.length}`)
    })
  })

  /*
   * Asserted on the REASSEMBLED sentence, because the footnotes wrap. They did
   * not before, which is the defect this now guards: one 230-character `text`
   * op is ~1,265pt against 499pt of content width, so the warning ran two and a
   * half page-widths off the paper — on the one document that most needs it
   * read. `toContain` on the whole string would pass again the day somebody
   * un-wraps them.
   */
  it("carries the capped-list sentence onto the document, wrapped inside the page", () => {
    const pages = reportPages(rowsWith(3, { titlesTruncated: true }))
    expect(footnoteText(pages.at(-1)!)).toContain(
      "Only the 500 highest-duration rows in the range are listed — the same description in two different weeks counts as two rows — so a week's Subtotal may not include all of that week's work. Narrow the range for a complete breakdown."
    )
    // `op.x` means different things per alignment: the glyphs' start, their
    // end, or their midpoint. Measuring a right-aligned amount as `x + width`
    // would report every one of them as overflowing.
    for (const op of pages.at(-1)!.ops) {
      if (op.kind !== "text") continue
      const width = textWidth(op.text, op.size, op.bold ?? false)
      const right =
        op.align === "right" ? op.x : op.align === "center" ? op.x + width / 2 : op.x + width
      expect(right).toBeLessThanOrEqual(PAGE.width - PAGE.margin + 0.01)
    }
  })

  /*
   * Only when notes were actually requested. On an export that prints no notes
   * there is nothing missing to report, and saying so invents a defect.
   */
  it("says so when the note budget ran out, and only then", () => {
    const withNotes = reportPages(rowsWith(3, { notesTruncated: true }))
    expect(footnoteText(withNotes.at(-1)!)).toContain(
      "Some entry notes are not shown — this range holds more note text than the report carries."
    )
    const without = reportPages(rowsWith(3))
    expect(footnoteText(without.at(-1)!)).not.toContain("Some entry notes are not shown")
  })

  it("qualifies the amount when some billable time was never priced", () => {
    const pages = reportPages(
      rowsWith(3, {
        totals: { ...rowsWith(3).totals, unpriced: true },
      })
    )
    expect(pages.flatMap(textOf)).toContain(
      "Some billable time has no hourly rate and is not in the amount above."
    )
  })

  /*
   * HOURS is gone (see COL). It restated DURATION in the unit AMOUNT is
   * computed from, which earned its place on a table and not on a list — a
   * third figure to skip past on every one of five hundred rows. The CSV and
   * XLSX writers still carry it, which is where the audit trail lives.
   */
  it("prints two figures per row, not three", () => {
    const decimals = reportPages(rowsWith(3))
      .flatMap(textOf)
      .filter((line) => /^d+.d{2}$/.test(line))
    expect(decimals).toHaveLength(0)
  })

  /*
   * The project leads its row as a muted line above the description rather than
   * occupying a fixed 100pt column beside it — which is what gave the
   * description the width it needed.
   */
  it("puts the project above its description, not in a column beside it", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description: "Tide table caching",
          weekStart: "2026-07-13",
          notes: [],
          totalMs: HOUR,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)
    const find = (value: string) =>
      breakdown.ops.find(
        (op): op is Extract<PdfOp, { kind: "text" }> => op.kind === "text" && op.text === value
      )!
    const project = find("Sealogs")
    const description = find("Tide table caching")

    expect(project.x).toBe(description.x)
    expect(project.y).toBeGreaterThan(description.y)
    // Set smaller and muted: it is the row's heading, not its content.
    expect(project.size).toBe(TYPE.tick)
    expect(project.color).toBe(PAPER.inkMuted)
  })

  describe("notes", () => {
    const noted = (notes: Array<string>) =>
      rowsWith(1, {
        titles: [
          {
            project: "Sealogs",
            description: "Tide table caching",
            weekStart: "2026-07-13",
            notes,
            totalMs: HOUR,
            percent: 100,
            billableCents: 1_000,
            unpriced: false,
          },
        ],
      })

    /* Off by default is enforced upstream (the setting, and the query arg it
     * drives); what this file guarantees is that an empty list draws nothing
     * at all rather than an empty bullet. */
    it("draws nothing when a row carries no notes", () => {
      const strings = reportPages(noted([])).flatMap(textOf)
      expect(strings.some((line) => line.startsWith("·"))).toBe(false)
    })

    it("bullets each note under the description it belongs to", () => {
      const [, breakdown] = reportPages(noted(["Cache invalidation was the tricky part."]))
      const note = breakdown.ops.find(
        (op): op is Extract<PdfOp, { kind: "text" }> =>
          op.kind === "text" && op.text.startsWith("·")
      )!
      const description = breakdown.ops.find(
        (op): op is Extract<PdfOp, { kind: "text" }> =>
          op.kind === "text" && op.text === "Tide table caching"
      )!
      expect(note.text).toBe("· Cache invalidation was the tricky part.")
      // Indented past the description, below it, and set smaller and muted so
      // it cannot be mistaken for the description itself.
      expect(note.x).toBeGreaterThan(description.x)
      expect(note.y).toBeLessThan(description.y)
      expect(note.size).toBe(TYPE.tick)
      expect(note.color).toBe(PAPER.inkMuted)
    })

    /*
     * A wrapped note hangs under its own TEXT, not under its bullet, and the
     * bullet is drawn once per note rather than once per line — the two halves
     * of the same mistake.
     */
    it("hangs a wrapped note under its text and bullets it once", () => {
      const long =
        "Reproduced it by throttling to 3G in devtools — the optimistic write lands before the server clock does, so the reconciliation pass sees two writers and keeps the wrong one."
      const [, breakdown] = reportPages(noted([long]))
      const noteOps = breakdown.ops.filter(
        (op): op is Extract<PdfOp, { kind: "text" }> =>
          op.kind === "text" && op.size === TYPE.tick && op.color === PAPER.inkMuted && op.y < 700
      )
      const bulleted = noteOps.filter((op) => op.text.startsWith("·"))
      expect(noteOps.length).toBeGreaterThan(1)
      expect(bulleted).toHaveLength(1)
      // Continuations are indented past the first line, by the bullet's width.
      for (const op of noteOps.filter((candidate) => !candidate.text.startsWith("·"))) {
        expect(op.x).toBeGreaterThan(bulleted[0].x)
      }
      // No text was dropped on the way through the wrap.
      expect(noteOps.map((op) => op.text).join(" ").replace("· ", "")).toBe(long)
    })

    /* A row's reserved height must cover its notes, or the rows below it
     * overprint them — the same class of defect variable row heights already
     * introduced once for wrapped descriptions. */
    it("reserves the height its notes occupy", () => {
      const bare = reportPages(noted([]))
      const withNotes = reportPages(noted(["One.", "Two.", "Three."]))
      const totalY = (pages: ReturnType<typeof reportPages>) =>
        pages
          .at(-1)!
          .ops.find(
            (op): op is Extract<PdfOp, { kind: "text" }> =>
              op.kind === "text" && op.text === "Total"
          )!.y
      expect(totalY(withNotes)).toBeLessThan(totalY(bare))
    })
  })

  it("produces one page for an empty range rather than none", () => {
    const empty = rowsWith(0, {
      buckets: [],
      projects: [],
      totals: { ...rowsWith(0).totals, totalMs: 0, billableMs: 0, count: 0, percent: 0 },
    })
    expect(reportPages(empty)).toHaveLength(1)
  })

  /*
   * An empty block STATES its absence rather than drawing its own furniture
   * over nothing. Before this, an empty range still got a labelled y-axis and a
   * Billable/Non-billable legend around 228pt of blank paper, plus a
   * four-column legend header above no rows and a `tracked` caption floating
   * where a donut had not been drawn — a page of scaffolding for series that
   * were not there.
   */
  it("states the absence instead of drawing empty chart furniture", () => {
    const empty = rowsWith(0, {
      buckets: [],
      projects: [],
      totals: { ...rowsWith(0).totals, totalMs: 0, billableMs: 0, count: 0, percent: 0 },
    })
    const strings = textOf(reportPages(empty)[0])

    expect(strings).toContain("Nothing was tracked in this range.")
    expect(strings).toContain("No project time in this range.")
    // The furniture each block would otherwise have drawn.
    expect(strings).not.toContain("Billable")
    expect(strings).not.toContain("Non-billable")
    expect(strings).not.toContain("tracked")
    expect(strings).not.toContain("Share")
    expect(strings).not.toContain("0h")
  })

  /*
   * The scale is the one part of a chart that must be beyond question
   * (DESIGN.md §5) — and the exported chart had none at all: a row of bars with
   * a day label under each and nothing to read a height against.
   */
  it("gives the day chart a round-number scale", () => {
    const strings = textOf(reportPages(rowsWith(1))[0])
    expect(strings).toContain("0h")
    // `hourTicks` steps in hours people think in, so every tick is whole.
    const hourLabels = strings.filter((line) => /^\d+h$/.test(line))
    expect(hourLabels.length).toBeGreaterThan(1)
  })

  /*
   * The bars and the gridlines drawn behind them must agree. Scaling bars to
   * the tallest BAR while the axis tops out at a rounder, larger number makes
   * every bar on the page read high by the ratio between the two.
   */
  it("scales the bars to the axis top, not to the tallest bar", () => {
    const rows = rowsWith(1, {
      buckets: [
        {
          key: "2026-07-13",
          label: "Mon 13",
          title: "Mon, 13 Jul 2026",
          // 9h against a `hourTicks` top of 10h: the tallest bar must stop at
          // nine tenths of the plot, not fill it.
          totalMs: 9 * HOUR,
          billableMs: 9 * HOUR,
          nonBillableMs: 0,
          billableCents: 9_000,
          earnedCents: 9_000,
          count: 1,
          empty: false,
        },
      ],
    })
    const bars = reportPages(rows)[0].ops.filter(
      (op): op is Extract<PdfOp, { kind: "rect" }> => op.kind === "rect" && op.height > 20
    )
    expect(bars).toHaveLength(1)
    // The plot is 228pt tall; 9h of a 10h axis is 205.2pt.
    expect(bars[0].height).toBeCloseTo(228 * 0.9, 5)
  })

  /*
   * A one-bucket range is an ordinary export (a single day on its own). Sizing
   * its bar as `slot - gap` gave it the plot's entire width, which reads as a
   * shaded panel rather than a bar.
   */
  it("caps a lone bar's width instead of letting it fill the plot", () => {
    const rows = rowsWith(1)
    const bars = reportPages(rows)[0].ops.filter(
      (op): op is Extract<PdfOp, { kind: "rect" }> => op.kind === "rect" && op.height > 20
    )
    expect(bars).toHaveLength(1)
    expect(bars[0].width).toBeLessThanOrEqual(28)
  })

  /*
   * A tile value is drawn at a fixed x with no cell boundary to stop it, so a
   * wide amount printed straight over the tile to its right.
   */
  it("shrinks a tile value that would overprint the tile beside it", () => {
    // `$999,999.99` still fits at the full 18pt (115.7pt of a 124.8pt tile);
    // the next order of magnitude is where it stops fitting.
    const wide = rowsWith(1, {
      totals: { ...rowsWith(1).totals, billableCents: 999_999_999, unpriced: false },
    })
    const value = textOf(reportPages(wide)[0]).find((line) => line.startsWith("$"))
    expect(value).toBeDefined()

    const op = reportPages(wide)[0].ops.find(
      (candidate): candidate is Extract<PdfOp, { kind: "text" }> =>
        candidate.kind === "text" && candidate.text === value
    )!
    const tileWidth = (PAGE.width - 2 * PAGE.margin) / 4
    expect(textWidth(op.text, op.size, true)).toBeLessThanOrEqual(tileWidth)
    // Shrunk, but never below the step the Total row uses.
    expect(op.size).toBeGreaterThanOrEqual(TYPE.strong)
    expect(op.size).toBeLessThan(TYPE.tileValue)
  })

  /*
   * The legend's SHARE column is right-aligned, so its anchor is where the
   * glyphs END. A name drawn with no bound ran straight through them —
   * `Vessel Vanguard Maritime` overprinted `15.36%` on the one block that
   * states what each client is worth.
   */
  it("keeps a long project name out of the legend's share column", () => {
    const rows = rowsWith(1, {
      projects: [
        {
          name: "Vessel Vanguard Maritime Systems International",
          color: "amber",
          totalMs: 355_680_000,
          percent: 15.36,
          billableCents: 98_800,
          unratedBillableMs: 0,
        },
      ],
    })
    const page = reportPages(rows)[0]
    const share = page.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> => op.kind === "text" && op.text === "15.36%"
    )!
    const name = page.ops.find(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" && op.text.startsWith("Vessel Vanguard")
    )!
    expect(name.text).not.toBe("Vessel Vanguard Maritime Systems International")
    const nameEnd = name.x + textWidth(name.text, name.size, false)
    // SHARE is right-aligned: its glyphs begin this far left of its anchor.
    const shareStart = share.x - textWidth(share.text, share.size, false)
    expect(nameEnd).toBeLessThanOrEqual(shareStart)
  })

  it("keeps every axis tick label inside the page's right margin", () => {
    // A month of daily buckets — the case whose last label ran past the margin.
    const buckets = Array.from({ length: 31 }, (_, n) => ({
      key: `2026-07-${String(n + 1).padStart(2, "0")}`,
      label: `Wed ${n + 1}`,
      title: `Wed, ${n + 1} Jul 2026`,
      totalMs: HOUR,
      billableMs: HOUR,
      nonBillableMs: 0,
      billableCents: 1_000,
      earnedCents: 1_000,
      count: 1,
      empty: false,
    }))
    for (const op of reportPages(rowsWith(1, { buckets }))[0].ops) {
      if (op.kind !== "text" || op.align !== "center") continue
      const half = textWidth(op.text, op.size, op.bold ?? false) / 2
      expect(op.x + half).toBeLessThanOrEqual(PAGE.width - PAGE.margin)
      expect(op.x - half).toBeGreaterThanOrEqual(PAGE.margin)
    }
  })

  it("counts a single day worked in the singular", () => {
    const one = rowsWith(1, { meta: { ...rowsWith(1).meta, daysWorked: 1 } })
    expect(textOf(reportPages(one)[0])).toContain("over 1 day worked")
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
    // heading's own cap height (~8pt for 14pt bold DM Sans).
    expect(heading.y - realY).toBeGreaterThanOrEqual(8)
  })

  /*
   * IMPORTANT 2 — `donutSlices` (ops.ts) skips any project with
   * `totalMs <= 0`, so the returned slices are no longer in one-to-one
   * position with `rows.projects`. Indexing `rows.projects[sliceIndex]` by
   * SLICE index (the previous code) therefore shifts every slice AFTER a
   * zero-duration project onto the wrong project's colour, while the legend
   * — which iterates `rows.projects` directly and draws every project,
   * zero-duration ones included — still names the right one beside the
   * wrong swatch. This fixture puts the zero-duration project in the
   * MIDDLE of the list, the case a naive "skip the first" fix would miss.
   */
  it("colours each donut slice for its own project, even with a zero-duration project in the middle", () => {
    const rows = rowsWith(0, {
      titles: [],
      projects: [
        { name: "Alpha", color: "amber", totalMs: HOUR, percent: 50, billableCents: 100, unratedBillableMs: 0 },
        { name: "Zero Co", color: "slate", totalMs: 0, percent: 0, billableCents: 0, unratedBillableMs: 0 },
        { name: "Beta", color: "indigo", totalMs: HOUR, percent: 50, billableCents: 100, unratedBillableMs: 0 },
      ],
    })
    const [first] = reportPages(rows)
    const slices = first.ops.filter(
      (op): op is Extract<PdfOp, { kind: "path" }> => op.kind === "path"
    )

    // Two slices for two non-zero projects, in the SAME order they appear in
    // `rows.projects` (Alpha, then Beta) — Zero Co contributes no slice at all.
    expect(slices).toHaveLength(2)
    expect(slices[0].color).toEqual(paperColorFor("amber")) // Alpha
    expect(slices[1].color).toEqual(paperColorFor("indigo")) // Beta, NOT Zero Co's slate
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
          notes: [],
          totalMs: 445_507_000, // formatClock -> "123:45:07", as wide as a duration string gets
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
          notes: [],
          totalMs: HOUR,
          percent: 42,
          billableCents: 123_456,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)
    // `!bold` excludes the week band's own label and the Subtotal row, which
    // now sit at this same x and size — the list put them all on one left edge.
    const descriptionOps = breakdown.ops.filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" &&
        op.x === COL.description &&
        op.size === TYPE.body &&
        op.bold !== true
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
   * PROJECT IS NO LONGER A COLUMN — it leads its row as a muted line above the
   * description, at the list's own indent. Nothing sits to its right to collide
   * with (the figures are a line below it), so the thing it can run off is the
   * PAPER, and text past the right margin is text a printer silently clips.
   */
  it("keeps a long project name inside the right margin", () => {
    const rows = rowsWith(1, {
      titles: [
        {
          project: "A Genuinely Long Client-Facing Project Name For The Fleet",
          description: "Short note",
          weekStart: "2026-07-13",
          notes: [],
          totalMs: 3_661_000,
          percent: 12,
          billableCents: 4_000,
          unpriced: false,
        },
      ],
    })
    const [, breakdown] = reportPages(rows)

    // The project line is the only thing drawn at the list indent at
    // `TYPE.tick` — the column headers sit at that size too but on the header
    // row above, which this page's ops share with no data row.
    const projectOps = breakdown.ops.filter(
      (op): op is Extract<PdfOp, { kind: "text" }> =>
        op.kind === "text" &&
        op.x === COL.description &&
        op.size === TYPE.tick &&
        op.y < PAGE.height - PAGE.margin - 30
    )
    expect(projectOps).toHaveLength(1)

    for (const projectOp of projectOps) {
      const endX = COL.description + textWidth(projectOp.text, projectOp.size, false)
      expect(endX).toBeLessThanOrEqual(PAGE.width - PAGE.margin)
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
        notes: [],
        totalMs: HOUR,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      })),
    })
    const pages = reportPages(rows)
    const breakdownPages = pages.filter((page) =>
      textOf(page).some((line) => line.startsWith(BREAKDOWN_TITLE))
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

  /*
   * THE SAME INVARIANT, WITH NOTES — the case the fixture above cannot reach,
   * because every one of its rows hardcodes `notes: []`.
   *
   * Notes made a row's height unbounded in a packer that cannot split one. The
   * server permits `NOTES_PER_ROW_LIMIT` (5) notes of `MAX_NOTE_LENGTH` (2,000)
   * characters, which is ~150 wrapped lines — roughly twice a page — and the
   * "oversized row gets its own page and overflows" escape hatch then drew most
   * of it at a y pdf-lib silently discards. Note text disappeared from a
   * client's document with no marker.
   *
   * Seeded at exactly what the server's own caps allow, so this asserts the
   * real worst case rather than a comfortable one.
   */
  it("keeps a notes-heavy row inside the page, at the worst case the server permits", () => {
    const MAX_NOTE_LENGTH = 2_000
    const NOTES_PER_ROW_LIMIT = 5
    const rows = rowsWith(6, {
      titles: Array.from({ length: 6 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `[B-CB-${300 + n}] Reconciling offshore vessel maintenance logs against the client's own crew training CSV export`,
        weekStart: "2026-07-13",
        notes: Array.from(
          { length: NOTES_PER_ROW_LIMIT },
          (_unused, i) => `Note ${i} ${"lorem ipsum dolor sit amet ".repeat(MAX_NOTE_LENGTH / 27)}`
        ),
        totalMs: HOUR,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      })),
    })

    for (const page of reportPages(rows)) {
      for (const op of page.ops) {
        if (op.kind !== "text") continue
        if (/^Page \d+ \/ \d+$/.test(op.text)) continue
        expect(op.y).toBeGreaterThanOrEqual(BOTTOM)
      }
    }
  })

  /* Clipping to keep a row on its page is REPORTED, using the same sentence the
   * server's own character budget uses — the two are different mechanisms with
   * the same consequence for a reader. */
  it("says so when a row's notes were clipped to fit the page", () => {
    const huge = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description: "Tide table caching",
          weekStart: "2026-07-13",
          notes: Array.from({ length: 5 }, () => "lorem ipsum dolor sit amet ".repeat(74)),
          totalMs: HOUR,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ],
    })
    expect(footnoteText(reportPages(huge).at(-1)!)).toContain("Some entry notes are not shown")
  })

  /* A single maximal note must still print WHOLE — the limit is sized so the
   * ordinary "one long note" case is never the clipped one. */
  it("prints one maximal note whole rather than clipping it", () => {
    const one = "lorem ipsum dolor sit amet ".repeat(74) // ~2,000 characters
    const rows = rowsWith(1, {
      titles: [
        {
          project: "Sealogs",
          description: "Tide table caching",
          weekStart: "2026-07-13",
          notes: [one],
          totalMs: HOUR,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ],
    })
    const pages = reportPages(rows)
    const noteText = pages
      .at(-1)!
      .ops.filter(
        (op): op is Extract<PdfOp, { kind: "text" }> =>
          op.kind === "text" && op.size === TYPE.tick && op.color === PAPER.inkMuted && op.y < 700
      )
      .map((op) => op.text)
      .join(" ")
      .replace("· ", "")
    // Compared trimmed at both ends: the fixture's own repeat leaves a trailing
    // space, and the join reintroduces one at each wrap boundary.
    expect(noteText.trim()).toBe(one.trim())
    expect(footnoteText(pages.at(-1)!)).not.toContain("Some entry notes are not shown")
  })

  describe("weekly grouping", () => {
    it("draws each week's own heading, with its clamped date span", () => {
      // The default fixture's single week runs 2026-07-13 to 2026-07-19,
      // computed by the same `groupWeeks` the real pipeline uses.
      const pages = reportPages(rowsWith(1))
      expect(pages.flatMap(textOf)).toContain("13 – 19 Jul 2026")
    })

    it("draws a subtotal row beneath each week's rows, distinct from the grand Total", () => {
      const pages = reportPages(rowsWith(3))
      const strings = pages.flatMap(textOf)
      expect(strings).toContain("Subtotal")
      expect(strings).toContain("Total")
    })

    /*
     * The other end of the orphan rule. A heading stranded above no rows was
     * already prevented; a week whose LATER rows — and whose `Subtotal` — landed
     * on a page that never names the week was not, and put a bold
     * `Subtotal 24:30:00` under nothing at all on the observed three-page
     * export.
     */
    it("re-announces a week that runs past a page break", () => {
      const pages = reportPages(rowsWith(120))
      const isWeekBand = (line: string) => /^\d+ – \d+ \w+ \d{4}$/.test(line)
      // The single fixture week spans several pages, so its band is drawn once
      // per page it appears on rather than once for the document — unannotated,
      // and identical every time.
      const bands = pages.flatMap(textOf).filter(isWeekBand)
      expect(bands.length).toBeGreaterThan(1)
      expect(new Set(bands).size).toBe(1)
      // Every page carrying a Subtotal has that band above it, so no page ever
      // totals hours it has not named the week for.
      for (const page of pages.filter((candidate) => textOf(candidate).includes("Subtotal"))) {
        expect(textOf(page).some(isWeekBand)).toBe(true)
      }
    })

    /*
     * Every page of the table can be read on its own: no page may open with
     * rows or a subtotal that no heading on that page accounts for.
     */
    it("never leaves a subtotal on a page with no week heading above it", () => {
      for (const count of [40, 80, 120, 200]) {
        for (const page of reportPages(rowsWith(count))) {
          const strings = textOf(page)
          if (!strings.includes("Subtotal")) continue
          expect(strings.some((line) => /^\d+ – \d+ \w+ \d{4}( \(continued\))?$/.test(line))).toBe(
            true
          )
        }
      }
    })

    it("draws one heading and one subtotal per week, for a range spanning two weeks", () => {
      const week1 = Array.from({ length: 2 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W1-${n}`,
        weekStart: "2026-07-13",
        notes: [],
        totalMs: HOUR,
        percent: 12.5,
        billableCents: 1_000,
        unpriced: false,
      }))
      const week2 = Array.from({ length: 2 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W2-${n}`,
        weekStart: "2026-07-20",
        notes: [],
        totalMs: HOUR,
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
        notes: [],
        totalMs: HOUR,
        percent: 1,
        billableCents: 1_000,
        unpriced: false,
      }))
      const week2 = Array.from({ length: 3 }, (_, n) => ({
        project: "Vessel Vanguard",
        description: `W2-${n}`,
        weekStart: "2026-07-20",
        notes: [],
        totalMs: HOUR,
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
