import { addDays } from "@shared/day"
import { TITLE_ROW_LIMIT } from "@shared/scan"
import { NO_PROJECT_LABEL, bucketDays, format } from "@/lib/report-series"
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

/**
 * What an entry with no title is called.
 *
 * `timeEntries.title` allows "" deliberately, so these rows are real and their
 * time is real. An empty description cell reads as a rendering fault; a stated
 * placeholder reads as work nobody named, which is the truth.
 *
 * EXPORTED as of the clipboard writer. It was not, on the stated ground that
 * nothing outside this file needed to name the placeholder itself — and that
 * held while every export came through `reportRows`. `entries-text.ts` does
 * not (it writes individual entries, not the aggregated document), so it has
 * to name an untitled entry itself, and two literals is how a CSV comes to say
 * "(no description)" while the text beside it says something else about the
 * very same entry.
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
  /** The DayString of the first day of the local week this row belongs to —
   *  carried through from `entries.rangeBreakdown` so CSV and XLSX can offer
   *  it as a plain column, and so `reportRows` can partition this same flat
   *  list into `weeks` below without a second query. */
  weekStart: DayString
  /**
   * This row's entries' distinct notes — prose the user wrote about how the
   * work actually went.
   *
   * EMPTY unless the export was asked for them: `userSettings.pdfIncludeNotes`
   * decides whether `entries.rangeBreakdown` collects them at all, so an empty
   * array here means either "nobody wrote one" or "this export does not print
   * notes", and the document never has to tell the two apart — it prints what
   * it is given.
   *
   * Read only by the PDF writer. CSV and XLSX deliberately do not carry it:
   * they are the machine-readable cuts, and a spreadsheet cell holding several
   * paragraphs joined by a separator is worse than no column at all.
   */
  notes: Array<string>
  totalMs: number
  /**
   * This row's share of the WHOLE RANGE — not of the week it is grouped
   * under below. A row inside a light week and a row inside a heavy week can
   * both show "25%" and mean the same duration; if this were percent-of-week
   * instead, two different weeks' "50%" rows could name two entirely
   * different durations with nothing on the page to say so. It is also what
   * makes every row across every week still sum to the 100% the grand TOTAL
   * row prints.
   */
  percent: number
  billableCents: number
  /** Some of this row's billable time has no rate, so its amount is a floor. */
  unpriced: boolean
}

/**
 * One calendar week's worth of `ReportTitleRow`s, plus its own subtotal.
 *
 * `rows` is a partition of `ReportRows.titles`, not a re-derivation: every
 * title row in the range appears in EXACTLY one week here, in the same
 * relative order it holds in the flat list. Grouping is client-side rather
 * than a second backend cut for the same reason `bucketDays` above is: the
 * export re-partitions the SAME scan `entries.rangeBreakdown` already did.
 */
export type ReportWeek = {
  /** This week's own grouping key, and the DayString every row inside it
   *  shares — the local week its entries' starts fall in. */
  weekStart: DayString
  /** The span as printed, e.g. "1 – 7 Aug 2026". Clamped to the report's own
   *  `from`/`to` at both ends: a week's true calendar span can start before
   *  the range or run past it, and claiming days nothing was queried for is
   *  the same defect `report-series.ts`'s `titleOf` avoids for the weekly
   *  chart label. */
  label: string
  rows: Array<ReportTitleRow>
  subtotal: {
    totalMs: number
    /** This week's share of the range — NOT its rows' percents summed by a
     *  reader; those are already range-relative (see `ReportTitleRow.percent`
     *  above), and this is the same quantity computed once for the heading. */
    percent: number
    /**
     * The sum of this week's rows' OWN independently-rounded amounts — the
     * same choice `projects` makes and for the same reason: a week's amount
     * is a figure a reader adds up by hand from the rows beneath it, so it
     * has to equal that sum exactly. It may therefore differ from a
     * proportional slice of the grand total by a few cents, which is a real
     * property of money, not a bug — see `centsOf` in convex/entries.ts.
     */
    billableCents: number
    /** True when ANY row in the week is itself unpriced — the same
     *  "this figure is a floor" meaning a row's own `unpriced` carries. */
    unpriced: boolean
  }
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
    /**
     * Whether `billableCents` above is a floor rather than the real figure —
     * the ONE derivation all three writers must read instead of each
     * re-deciding it from `breakdown.unratedBillableMs` (see the writers' own
     * `moneyOr`/`amount`/`money` calls).
     *
     * `unratedBillableMs > 0` — ANY unrated billable time, not
     * `unratedBillableMs >= billableMs` ("ALL of it"). The two make
     * different claims: `billableCents: 0` with `unratedBillableMs: 0` is
     * work genuinely worth nothing (a zero rate somebody chose, or no
     * billable time at all) and IS a real amount — under the "ALL" rule
     * `0 >= 0` is true and that real zero gets dashed out as if it were
     * unknown. `unratedBillableMs > 0` means some of the figure is actually
     * missing, so the total UNDERSTATES — the "ALL" rule only dashes once
     * EVERY billable cent is unrated, leaving a partly-unrated total to
     * print as if it were complete. This is the same "ANY" basis a row's own
     * `unpriced` and a week's `subtotal.unpriced` already use below — this
     * field is what stopped the grand total from being the one figure on
     * the page computed by a different rule than everything beneath it.
     */
    unpriced: boolean
    averageDailyMs: number
    count: number
    truncated: boolean
    /**
     * The grand TOTAL row's own Percent cell — each row's share of TOTAL
     * DURATION, so this is the range's own total as a share of itself: 100,
     * except an empty range, where `percentOf`'s empty-whole rule answers 0
     * rather than a nonsensical 100-of-nothing.
     *
     * Computed ONCE here, the same fix commit b9b700f already made for the
     * grand-total Amount: before this field existed, `to-csv.ts`,
     * `to-xlsx.ts` and `report-doc.ts` each independently wrote
     * `totalMs === 0 ? 0 : 100`, kept in sync only by a comment in each file
     * pointing at the other two. NOT `billablePercent` — that measures the
     * range's billable SHARE, an unrelated question this cell does not ask.
     */
    percent: number
  }
  buckets: Array<Bucket>
  projects: Array<ReportProjectRow>
  /** Flat, in the SAME order `entries.rangeBreakdown` returns it (time
   *  descending, ties broken by title) — kept alongside `weeks` because CSV
   *  and XLSX read it directly with a `Week` column rather than the nested
   *  shape (see to-csv.ts, to-xlsx.ts). */
  titles: Array<ReportTitleRow>
  /** `titles`, split by week, ascending — what the PDF renders as sections. */
  weeks: Array<ReportWeek>
  titlesTruncated: boolean
  /** Notes were requested and the budget ran out before every row got its own,
   *  so some rows print fewer notes than their entries hold. Carries
   *  `NOTES_CAP_NOTE` onto the document, the same way `titlesTruncated`
   *  carries `TITLE_CAP_NOTE`. */
  notesTruncated: boolean
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

/**
 * A week's printed span, e.g. "1 – 7 Aug 2026" or "28 Jul – 3 Aug 2026".
 *
 * The month and year are stated once, on whichever end needs to introduce
 * them, rather than on both ends unconditionally — repeating "Aug 2026" on a
 * week that never leaves August reads as noise on a document meant to be
 * scanned quickly. `start` and `end` arrive already clamped to the report's
 * own range by the caller.
 */
function weekLabel(start: DayString, end: DayString): string {
  const sameMonth = start.slice(0, 7) === end.slice(0, 7)
  if (sameMonth) {
    return `${format(start, { day: "numeric" })} – ${format(end, {
      day: "numeric",
      month: "short",
      year: "numeric",
    })}`
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  const startOptions: Intl.DateTimeFormatOptions = sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" }
  return `${format(start, startOptions)} – ${format(end, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`
}

/**
 * `titles`, partitioned into `ReportWeek`s — ascending by `weekStart`, each
 * carrying its own clamped label and a subtotal derived from its own rows.
 *
 * Kept as its own function (rather than inlined into `reportRows`) so the
 * grouping — the part a PDF layout test needs to drive directly with a hand
 * built list of rows — is callable without constructing a whole `Breakdown`.
 */
export function groupWeeks(
  titles: ReadonlyArray<ReportTitleRow>,
  rangeTotalMs: number,
  from: DayString,
  to: DayString
): Array<ReportWeek> {
  const byWeek = new Map<DayString, Array<ReportTitleRow>>()
  for (const row of titles) {
    const existing = byWeek.get(row.weekStart)
    if (existing === undefined) byWeek.set(row.weekStart, [row])
    else existing.push(row)
  }

  return [...byWeek.keys()].sort().map((weekStart) => {
    const rows = byWeek.get(weekStart)!
    const totalMs = rows.reduce((n, row) => n + row.totalMs, 0)
    const billableCents = rows.reduce((n, row) => n + row.billableCents, 0)

    const rawEnd = addDays(weekStart, 6)
    const labelStart = weekStart < from ? from : weekStart
    const labelEnd = rawEnd > to ? to : rawEnd

    return {
      weekStart,
      label: weekLabel(labelStart, labelEnd),
      rows,
      subtotal: {
        totalMs,
        percent: percentOf(totalMs, rangeTotalMs),
        billableCents,
        unpriced: rows.some((row) => row.unpriced),
      },
    }
  })
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

  const titles = breakdown.titles.map((row) => ({
    project: row.project === "" ? NO_PROJECT_LABEL : row.project,
    description: row.title === "" ? NO_DESCRIPTION : row.title,
    weekStart: row.weekStart,
    notes: row.notes,
    totalMs: row.totalMs,
    percent: percentOf(row.totalMs, breakdown.totalMs),
    billableCents: row.billableCents,
    unpriced: row.unratedBillableMs > 0,
  }))

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
      unpriced: breakdown.unratedBillableMs > 0,
      averageDailyMs,
      count: breakdown.count,
      truncated: breakdown.truncated,
      percent: percentOf(breakdown.totalMs, breakdown.totalMs),
    },
    buckets,
    projects: breakdown.projects.map((project) => ({
      name: project.name === "" ? NO_PROJECT_LABEL : project.name,
      color: project.color,
      totalMs: project.totalMs,
      percent: percentOf(project.totalMs, breakdown.totalMs),
      billableCents: project.billableCents,
      unratedBillableMs: project.unratedBillableMs,
    })),
    titles,
    weeks: groupWeeks(titles, breakdown.totalMs, opts.from, opts.to),
    titlesTruncated: breakdown.titlesTruncated,
    notesTruncated: breakdown.notesTruncated,
  }
}

/**
 * The sentence a capped list must carry, in every writer.
 *
 * Written once because it appears in the PDF, the workbook and on the page, and
 * three near-identical sentences drift until they claim three different limits.
 * Kept beside `reportRows` rather than in each writer for the same reason the
 * rows themselves are: one derivation, three renderings.
 *
 * The count itself is interpolated from `TITLE_ROW_LIMIT` (convex/lib/scan.ts)
 * rather than typed as a literal "500" here — a constant in one file and a
 * hand-typed number in this sentence is how the two stop agreeing the day
 * only one of them changes.
 */
export const TITLE_CAP_NOTE =
  `Only the ${TITLE_ROW_LIMIT} highest-duration rows in the range are listed — the same description in two different weeks counts as two rows — so a week's Subtotal may not include all of that week's work. Narrow the range for a complete breakdown.`

/**
 * The sentence a note list cut short by the budget must carry.
 *
 * Beside `TITLE_CAP_NOTE` and written for the same reason: a document that
 * silently stops carrying notes reads as work that had none, and "this row had
 * nothing to say" is a different claim from "we ran out of room to say it".
 * Only ever printed when notes were actually asked for.
 */
export const NOTES_CAP_NOTE =
  "Some entry notes are not shown — this range holds more note text than the report carries."

/** The sentence unpriced billable time must carry. Same reasoning. */
export const UNPRICED_NOTE =
  "Some billable time has no hourly rate and is not in the amount above."

/**
 * WHERE A RATE IS SET, for the two places that have to say it.
 *
 * `BillPreview` says it under a preview that is short by an unpriced bucket;
 * `invoiceDisabledReason` says it on a button refusing a range where EVERY
 * bucket is. Same fix, same two places to apply it, so it is one sentence —
 * a second phrasing of "go and set a rate" is how the two start naming
 * different screens.
 */
export const SET_A_RATE_NOTE =
  "Set a rate on the project, or on the account in Settings, to bill it."
