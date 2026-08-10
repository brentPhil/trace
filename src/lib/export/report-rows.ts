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
