import { v } from "convex/values"
import type { ObjectType } from "convex/values"
import { paginationOptsValidator, paginationResultValidator } from "convex/server"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { assertOwned, getOwned, getOwnedIncludingDeleted } from "./owned"
import { dropEntryTags, syncEntryTags } from "./entryTags"
import { traceError } from "./errors"
import { applyTimeEdit, assertEnteredDuration, entryTimes } from "./lib/entryTimes"
import { timeEntryDoc } from "./lib/docs"
import { SUMMARY_SCAN_LIMIT } from "./lib/scan"
import { dayOf, isValidTimeZone, localPartsOf } from "./lib/day"
import { isFilterActive, matchesFilter } from "./lib/entryFilter"
import type { EntryFilter } from "./lib/entryFilter"
import type { EntryTimes, TimeEdit, TimesResult } from "./lib/entryTimes"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { PaginationOptions } from "convex/server"

/** A start timestamp further ahead than this is treated as a wrong clock. */
const CLOCK_SKEW_TOLERANCE_MS = 60_000
const MAX_TAGS_PER_ENTRY = 10
const MAX_TITLE_LENGTH = 500
const MAX_NOTE_LENGTH = 2_000

/*
 * Structure note.
 *
 * Each operation is a plain `*Impl` function taking an explicit `userId`, with
 * two thin wrappers: a public one that derives the userId from the session, and
 * an internal one that accepts it directly.
 *
 * The public wrapper is the ONLY way a client reaches any of this, and `userId`
 * never appears in a public args validator — so a caller cannot name a user
 * they are not. The internal variants exist because `internal.*` functions are
 * unreachable from clients, and they are what lets the domain logic be tested
 * for real (atomic handoff, idempotency, cross-user isolation) without wiring a
 * whole auth component into the test harness. They will also be what a cron
 * calls when the runaway-timer sweep lands.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Every entry currently running for a user.
 *
 * Returns a list, not a single row, and reads with `.collect()` rather than
 * `.unique()`. `.unique()` throws when two rows match — which would mean that
 * the moment a second running row appeared from any cause (an import, a restore
 * bug, a future split), the user could never stop their timer again, because
 * stop would throw before it could patch anything. There is no worse outcome in
 * a product whose first rule is "never lose time", and it would be reached from
 * the code written to protect it. Degrade, repair, and carry on.
 */
async function runningEntries(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Array<Doc<"timeEntries">>> {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_ended", (q) => q.eq("userId", userId).eq("endedAt", null))
    .collect()
  // A soft-deleted row is never "running", whatever its endedAt says.
  return rows.filter((row) => row.deletedAt === null)
}

/** Dedupes, sorts, caps, and proves the caller owns every tag. */
async function normaliseTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Array<Id<"tags">> | undefined
): Promise<Array<Id<"tags">>> {
  if (tagIds === undefined || tagIds.length === 0) return []

  const unique = [...new Set(tagIds)].sort()
  if (unique.length > MAX_TAGS_PER_ENTRY) {
    traceError("TOO_MANY_TAGS", `An entry can carry at most ${MAX_TAGS_PER_ENTRY} tags.`)
  }
  for (const tagId of unique) {
    await assertOwned(ctx, userId, "tags", tagId)
  }
  return unique
}

function checkTitle(title: string | undefined): void {
  if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
    traceError("TOO_LONG", "That title is too long.")
  }
}

export function checkNote(note: string | undefined): void {
  if (note !== undefined && note.length > MAX_NOTE_LENGTH) {
    traceError("TOO_LONG", `A note can be at most ${MAX_NOTE_LENGTH} characters.`)
  }
}

/**
 * Turns a refusal from the pure time domain into a thrown ConvexError.
 *
 * The domain returns a result rather than throwing so it stays testable without
 * a backend; the boundary is here, in exactly one place, so no caller can
 * accidentally write a row from a `!ok` result.
 */
function unwrapTimes(result: TimesResult): EntryTimes {
  if (result.ok) return result.times
  switch (result.code) {
    case "END_NOT_AFTER_START":
      return traceError("END_NOT_AFTER_START", "An entry has to end after it starts.")
    case "DURATION_TOO_LONG":
      return traceError(
        "DURATION_TOO_LONG",
        "That is longer than a day. Split it into two entries."
      )
    case "INVALID_DURATION":
      return traceError("INVALID_DURATION", "That is not a length of time.")
  }
}

/**
 * An empty note is an ABSENT note, not a stored empty string.
 *
 * Both would render the same today, but "has a note" is the field the day
 * header counts and Reports filters on, so two representations of nothing
 * would eventually disagree. `undefined` deletes the field in a Convex patch.
 */
function normaliseNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  checkNote(note)
  const trimmed = note.trim()
  return trimmed === "" ? undefined : trimmed
}

/** Closes an entry at `endedAt`, never before its own start. */
async function closeEntry(
  ctx: MutationCtx,
  entry: Doc<"timeEntries">,
  endedAt: number,
  now: number,
  extra?: { deletedAt: number }
): Promise<boolean> {
  const safeEnd = Math.max(endedAt, entry.startedAt + 1)
  const times = entryTimes(entry.startedAt, safeEnd)
  if (!times.ok) return false // unreachable given the clamp above
  await ctx.db.patch(entry._id, {
    endedAt: times.times.endedAt,
    durationMs: times.times.durationMs,
    updatedAt: now,
    ...(extra ?? {}),
  })
  return true
}

// ---------------------------------------------------------------------------
// getRunning
// ---------------------------------------------------------------------------

/**
 * The running entry, or null.
 *
 * Deliberately does NOT return elapsed time. `Date.now()` inside a query
 * resolves to the transaction's timestamp and creates no subscription to the
 * passage of time, so any elapsed value returned here would be fixed at its
 * first evaluation and never invalidate — a clock that silently stops. Elapsed
 * is derived on the client from `startedAt`, on every render.
 */
// The return type is annotated rather than inferred. Without it TypeScript
// reads `running[0]` as always present (noUncheckedIndexedAccess is off), so
// the inferred type claimed this never returns null — and every client reading
// `running.title` would have typechecked and then crashed on an idle timer.
async function getRunningImpl(
  ctx: QueryCtx,
  userId: string
): Promise<Doc<"timeEntries"> | null> {
  const running = await runningEntries(ctx, userId)
  // Newest wins if the invariant was ever violated; the next start or stop
  // repairs the rest.
  running.sort((a, b) => b.startedAt - a.startedAt)
  return running[0] ?? null
}

export const getRunning = query({
  args: {},
  returns: v.union(timeEntryDoc, v.null()),
  handler: async (ctx) => await getRunningImpl(ctx, await requireUserId(ctx)),
})

export const getRunningAs = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await getRunningImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// listRange
// ---------------------------------------------------------------------------

/**
 * Entries whose START falls in a half-open instant range, newest first.
 *
 * Ranges on `startedAt` because there is no stored day key — see the plan §2.1.
 * The caller converts a local date to instants with convex/lib/day.ts, so the
 * log, the day totals, and Reports resolve days through the same function and
 * cannot disagree.
 *
 * Attribution is by START. An entry running from 23:00 to 01:30 belongs wholly
 * to the day it began, and Split is the manual correction — the same rule Toggl
 * uses, kept because the alternative silently divides one piece of work across
 * two invoices.
 */
async function listRangeImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number,
  limit: number
): Promise<Array<Doc<"timeEntries">>> {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .order("desc")
    .take(limit)
  return rows.filter((row) => row.deletedAt === null)
}

const listRangeArgs = {
  fromMs: v.number(),
  toMs: v.number(),
  limit: v.optional(v.number()),
}

export const listRange = query({
  args: listRangeArgs,
  returns: v.array(timeEntryDoc),
  handler: async (ctx, args) =>
    await listRangeImpl(
      ctx,
      await requireUserId(ctx),
      args.fromMs,
      args.toMs,
      args.limit ?? 500
    ),
})

export const listRangeAs = internalQuery({
  args: { ...listRangeArgs, userId: v.string() },
  handler: async (ctx, args) =>
    await listRangeImpl(ctx, args.userId, args.fromMs, args.toMs, args.limit ?? 500),
})

// ---------------------------------------------------------------------------
// listPage / rangeSummary — the history view
// ---------------------------------------------------------------------------

/**
 * A page of entries in a range, newest first.
 *
 * Paginated because history is unbounded in principle. The filters that can be
 * expressed as an index prefix (the date range) are applied here; project,
 * billable, text and the preset chips are applied on the client over what is
 * loaded — see the plan §3 on why a search index is the wrong MVP trade.
 *
 * Soft-deleted rows are filtered AFTER the page is taken, which makes pages
 * ragged. That is correct rather than convenient: the alternative is a second
 * index on deletedAt whose only purpose is to make page sizes tidy.
 */
async function listPageImpl(
  ctx: QueryCtx,
  userId: string,
  args: { fromMs: number; toMs: number; paginationOpts: PaginationOptions }
) {
  const result = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", args.fromMs).lt("startedAt", args.toMs)
    )
    .order("desc")
    .paginate(args.paginationOpts)

  return {
    ...result,
    page: result.page.filter((row) => row.deletedAt === null),
  }
}

const listPageArgs = {
  fromMs: v.number(),
  toMs: v.number(),
  paginationOpts: paginationOptsValidator,
}

export const listPage = query({
  args: listPageArgs,
  returns: paginationResultValidator(timeEntryDoc),
  handler: async (ctx, args) => await listPageImpl(ctx, await requireUserId(ctx), args),
})

export const listPageAs = internalQuery({
  args: { ...listPageArgs, userId: v.string() },
  returns: paginationResultValidator(timeEntryDoc),
  handler: async (ctx, { userId, ...args }) => await listPageImpl(ctx, userId, args),
})

/*
 * Named as a plain object of validators rather than inline in `v.object`, so
 * `rangeBreakdown` below can declare that it returns THESE fields plus its
 * groupings — rather than a second hand-copied list that drifts from this one
 * the first time a field is added to either.
 */
const summaryFields = {
  totalMs: v.number(),
  billableMs: v.number(),
  /** COMPLETED entries only — see below. */
  count: v.number(),
  /** Entries still running, which the totals deliberately exclude. */
  runningCount: v.number(),
  /** True when the range holds more entries than this scan looked at. */
  truncated: v.boolean(),
  /**
   * What the billable time above is worth, in cents, using the CALLER's
   * currency (see convex/lib/money.ts and userSettings.currency).
   *
   * Zero for a billable entry whose project has no `hourlyRateCents`, or no
   * project at all — a rate nothing set is not a rate of zero, but it is also
   * not money this total can claim to know. `unratedBillableMs` below is how
   * much time that was, so a caller can tell "worth nothing" from "worth an
   * amount nobody has priced". See `rangeSummaryImpl` for the exact rounding
   * rule this figure follows: it must be reproducible by hand.
   *
   * VALUED AT TODAY'S RATE, NOT THE RATE IN FORCE WHEN THE WORK WAS DONE.
   * There is no per-entry rate snapshot; this reads `projects.hourlyRateCents`
   * as it stands at query time, so raising a rate today changes what March was
   * worth on every report that covers March. That is deliberate and is argued
   * in full at `updateImpl` in convex/projects.ts — the short version is that a
   * rate is a price the user can type back, so re-pricing is reversible in a
   * way rewriting the billable flag would not be. The accepted cost is that an
   * invoice sent before a rate change is no longer reproducible from here.
   *
   * Shares `truncated` with the time above rather than its own flag: both
   * numbers come from the same scanned window of rows, so a truncated time
   * total implies an equally partial money total.
   */
  billableCents: v.number(),
  /**
   * How much of `billableMs` the money figure above could not value, because
   * the entry's project has no `hourlyRateCents` — or the entry has no project
   * at all.
   *
   * A SUBSET of `billableMs`, in the same units, over exactly the same rows
   * (completed and live; a running entry contributes to neither). So
   * `billableMs - unratedBillableMs` is the span `billableCents` actually
   * prices, and `unratedBillableMs === billableMs` with `billableMs > 0` is the
   * total case: real billable work, no money known.
   *
   * A rate of ZERO is priced, not unrated. Pro bono work is an explicit
   * decision and contributes 0 cents and 0 unrated milliseconds — the same
   * distinction `formatRate` renders as "No rate set" versus "$0.00/hr".
   *
   * This exists because `billableCents: 0` alone is indistinguishable from
   * "this work earned nothing", and the partial case — some projects rated,
   * some not — produces a plausible understated figure with nothing to mark it.
   * The caller is expected to qualify the money whenever this is above zero.
   */
  unratedBillableMs: v.number(),
}

const summaryReturns = v.object(summaryFields)

/**
 * The rows of a range, and whether there were more of them than we looked at.
 *
 * Shared by `rangeSummaryImpl` and `rangeBreakdownImpl` so the sentence at the
 * top of Reports and the charts beside it are reading the same window of the
 * same table. Two `.take()` calls with two limits is how a total comes to
 * disagree with the chart drawn directly underneath it.
 */
async function scanRange(ctx: QueryCtx, userId: string, fromMs: number, toMs: number) {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .take(SUMMARY_SCAN_LIMIT + 1)

  return {
    truncated: rows.length > SUMMARY_SCAN_LIMIT,
    live: rows.slice(0, SUMMARY_SCAN_LIMIT).filter((row) => row.deletedAt === null),
  }
}

/**
 * A running total of one set of entries.
 *
 * Exists because the Summary tab needs this same arithmetic once for the whole
 * range, once per day, and once per project — and a per-bucket copy of the
 * money rule is a per-bucket chance to get it wrong in a way that only shows up
 * as a chart whose bars do not add up to the figure above them.
 */
type Ledger = {
  totalMs: number
  billableMs: number
  count: number
  runningCount: number
  /**
   * In cents × milliseconds. Divided by an hour's worth of milliseconds ONCE,
   * by `centsOf`. See the rounding rule on `post` below.
   */
  billableCentMs: number
  unratedBillableMs: number
}

function emptyLedger(): Ledger {
  return {
    totalMs: 0,
    billableMs: 0,
    count: 0,
    runningCount: 0,
    billableCentMs: 0,
    unratedBillableMs: 0,
  }
}

/*
 * A RUNNING entry is counted separately and contributes nothing to the total.
 *
 * It has no duration yet, and a query cannot supply one: `Date.now()` inside a
 * Convex query resolves to the transaction timestamp and creates no
 * subscription to the passage of time, so any elapsed value computed here would
 * freeze at its first evaluation.
 *
 * Silently treating it as 0 was worse than excluding it. The day header beneath
 * this sentence derives its total on the CLIENT and does include the live
 * elapsed time, so the two numbers described the same rows and disagreed — with
 * the smaller one labelled as the exact figure. The caller now has what it needs
 * to say so out loud.
 */
function post(
  ledger: Ledger,
  row: Pick<Doc<"timeEntries">, "durationMs" | "billable">,
  rateCents: number | null
): void {
  if (row.durationMs === null) {
    ledger.runningCount += 1
    return
  }
  ledger.count += 1
  ledger.totalMs += row.durationMs
  if (!row.billable) return

  ledger.billableMs += row.durationMs
  if (rateCents === null) {
    ledger.unratedBillableMs += row.durationMs
  } else {
    ledger.billableCentMs += row.durationMs * rateCents
  }
}

/**
 * What a ledger's billable time is worth, in whole cents.
 *
 * THE ROUNDING RULE for `billableCents`, stated once, here, because this is the
 * only place it is applied.
 *
 * Each billable entry's EXACT worth — `durationMs ÷ 3,600,000 × hourlyRateCents`
 * — is a real number, not a whole cent (a 7-minute block at $61/hr is
 * 711.1666… cents). Those exact values are SUMMED FIRST, unrounded, and the
 * grand total is rounded to the nearest cent exactly ONCE, at the very end.
 *
 * The sum is kept in `cents × milliseconds` and divided by 3,600,000 once, at
 * the end, rather than accumulating fractional cents as it goes. Same rule,
 * strictly better arithmetic: every term is an integer, so the running total
 * is EXACT rather than merely close while it stays inside JavaScript's
 * 9.007e15 exact-integer range — which `MAX_RATE_CENTS` in convex/projects.ts
 * is chosen to keep a 24h entry inside. There is no measured drift in the old
 * float version (10,000 one-minute entries at $61/hr summed to
 * 1016666.6666665188 against an exact 1016666.666…, the same cent); the
 * residual this removes is an exact half-cent total flipping by one. The
 * discriminating 305-not-306 test below is unchanged and still passes, which
 * is the point: this changes the precision, not the rule.
 *
 * Rounding each entry first and then summing the roundings is a different,
 * and for many small entries LARGER, total from identical data — three
 * one-minute blocks at $61/hr are 101.6666… cents each, which rounds to 102
 * apiece and sums to 306; summed first and rounded once they are exactly
 * 305. `convex/entries.test.ts` pins 305, not 306. This is exactly the
 * per-entry-vs-per-subtotal divergence the Tier 2 plan notes for duration
 * rounding ("twelve 4-minute entries rounded to 15 each is 3h; the 48-minute
 * total rounded is 48m") — it applies identically to money, and sum-then-
 * round is the rule a person doing this by hand on a calculator would also
 * land on: add up the exact amounts, then round the total once.
 *
 * A project with no `hourlyRateCents` — including no project at all —
 * contributes nothing: a rate nobody set is not a rate of zero.
 */
function centsOf(ledger: Ledger): number {
  return Math.round(ledger.billableCentMs / 3_600_000)
}

/**
 * Every project the given rows point at, resolved once each.
 *
 * Resolved UP FRONT rather than lazily inside the accumulation loop, so that
 * loop is synchronous — which is what lets `matchesFilter` (a pure predicate,
 * shared with the client) take a plain `projectName` function instead of
 * something that has to be awaited.
 *
 * Soft-deleted and archived projects are returned like any other. Last year's
 * entries must still render their project name, and pricing them by today's
 * rate is the same policy `rangeSummary` documents.
 */
async function projectsOf(
  ctx: QueryCtx,
  rows: ReadonlyArray<Doc<"timeEntries">>
): Promise<Map<Id<"projects">, Doc<"projects">>> {
  const found = new Map<Id<"projects">, Doc<"projects">>()
  // Distinct ids, not one lookup per row: a fortnight of one client's work is
  // forty rows naming the same project.
  for (const id of new Set(rows.map((row) => row.projectId))) {
    if (id === undefined) continue
    const project = await ctx.db.get(id)
    if (project !== null) found.set(id, project)
  }
  return found
}

/**
 * The rate to price a row at, or `null` when nobody has set one.
 *
 * Zero-rate projects are NOT null. `hourlyRateCents: 0` is a price somebody set
 * on purpose (pro bono), and it is the distinction `unratedBillableMs` exists
 * to carry.
 */
function rateOf(
  row: Pick<Doc<"timeEntries">, "projectId">,
  projects: Map<Id<"projects">, Doc<"projects">>
): number | null {
  if (row.projectId === undefined) return null
  return projects.get(row.projectId)?.hourlyRateCents ?? null
}

/**
 * Exact totals for a whole range, independent of how much of it is paginated
 * into view.
 *
 * Deliberately NOT derived from the loaded pages. A totals line that silently
 * means "of the fifty rows fetched so far" is precisely the number that ends up
 * on an invoice understated, and nothing on screen would reveal it. When the
 * range is genuinely too large to total, `truncated` says so and the UI stops
 * claiming a figure rather than showing a wrong one.
 */
async function rangeSummaryImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number
) {
  const { truncated, live } = await scanRange(ctx, userId, fromMs, toMs)
  /*
   * BILLABLE ROWS ONLY, unlike `rangeBreakdownImpl`, which needs every
   * project's name and colour to label a bar.
   *
   * The only thing this function wants from a project is its rate, and a rate
   * is only ever consulted for a billable row. Resolving all of them would make
   * a range of fifty projects with nothing billable in it do fifty document
   * reads to answer a question none of them bear on — which is what the
   * pre-`projectsOf` version avoided by looking a project up lazily, inside the
   * `if (row.billable)` branch.
   */
  const projects = await projectsOf(ctx, live.filter((row) => row.billable))

  const ledger = emptyLedger()
  for (const row of live) post(ledger, row, rateOf(row, projects))

  return {
    totalMs: ledger.totalMs,
    billableMs: ledger.billableMs,
    count: ledger.count,
    runningCount: ledger.runningCount,
    truncated,
    billableCents: centsOf(ledger),
    unratedBillableMs: ledger.unratedBillableMs,
  }
}

const rangeSummaryArgs = { fromMs: v.number(), toMs: v.number() }

export const rangeSummary = query({
  args: rangeSummaryArgs,
  returns: summaryReturns,
  handler: async (ctx, args) =>
    await rangeSummaryImpl(ctx, await requireUserId(ctx), args.fromMs, args.toMs),
})

export const rangeSummaryAs = internalQuery({
  args: { ...rangeSummaryArgs, userId: v.string() },
  returns: summaryReturns,
  handler: async (ctx, args) =>
    await rangeSummaryImpl(ctx, args.userId, args.fromMs, args.toMs),
})

// ---------------------------------------------------------------------------
// rangeBreakdown — what Reports' Summary tab draws
// ---------------------------------------------------------------------------

const dayTotal = v.object({
  day: v.string(),
  totalMs: v.number(),
  billableMs: v.number(),
  billableCents: v.number(),
  count: v.number(),
})

const projectTotal = v.object({
  /** null is the unassigned bucket. What to CALL it is the UI's business. */
  projectId: v.union(v.id("projects"), v.null()),
  name: v.string(),
  color: v.string(),
  totalMs: v.number(),
  billableMs: v.number(),
  billableCents: v.number(),
  unratedBillableMs: v.number(),
  count: v.number(),
})

/*
 * The summary's fields, spread rather than restated.
 *
 * The Summary tab shows the same sentence as the Detailed tab above its charts,
 * and a hand-copied second list of these fields is how the sentence and the
 * bars underneath it come to be computed from two different definitions.
 */
const breakdownReturns = v.object({
  ...summaryFields,
  /**
   * SPARSE — only days that hold at least one entry, ascending.
   *
   * The caller knows the range it asked for and already has `addDays`, so it
   * can fill the gaps itself; a year-long range would otherwise ship 365 rows
   * of zeroes to draw the same picture. Filling them is also where the caller
   * decides what an empty day looks like, which is a design question (see the
   * Hatch Rule in DESIGN.md), not a storage one.
   */
  days: v.array(dayTotal),
  /** Descending by time, so the caller can draw a ranked bar chart without
   *  re-sorting and without inventing its own tie-break. */
  projects: v.array(projectTotal),
  /**
   * Twenty-four buckets of tracked milliseconds, indexed by the LOCAL hour an
   * entry started in.
   *
   * Attribution is by start, matching how an entry is attributed to a day (see
   * `listRangeImpl`): a block from 23:00 to 01:30 lands wholly in hour 23. The
   * alternative — dividing one piece of work across two buckets — is the same
   * silent split that rule already rejects, and the question this answers is
   * "when do I begin work", which the start is the honest answer to.
   */
  hours: v.array(v.number()),
})

const breakdownArgs = {
  fromMs: v.number(),
  toMs: v.number(),
  /**
   * The zone the days and hours are bucketed in.
   *
   * Passed by the caller rather than read from `userSettings` here, so this
   * query is a pure function of its arguments and the client cannot end up
   * drawing bars bucketed by one zone beside a log grouped by another — it
   * sends the same `settings.timezone` that `groupByDay` uses.
   */
  timeZone: v.string(),
  /**
   * The FilterBar, applied server-side over the whole range.
   *
   * The Detailed tab applies these on the client over loaded pages, which is
   * the right trade there — it is showing rows, and it says out loud when it is
   * still loading them. A chart cannot say that usefully: half a period's bars
   * look exactly like a period with less work in it. So the same predicate
   * (`convex/lib/entryFilter.ts`, shared with the client) runs here, over the
   * scan that is already happening.
   */
  projectId: v.optional(v.union(v.string(), v.null())),
  billableOnly: v.optional(v.boolean()),
  text: v.optional(v.string()),
  presets: v.optional(
    v.array(
      v.union(
        v.literal("no-project"),
        v.literal("no-note"),
        v.literal("under-a-minute")
      )
    )
  ),
}

/*
 * DERIVED from the validator above, never restated.
 *
 * A hand-written twin compiles perfectly while `breakdownArgs` grows a field
 * the handler then silently ignores — the same drift `summaryFields` is spread
 * to avoid a few lines up.
 */
type BreakdownArgs = ObjectType<typeof breakdownArgs>

/** Get-or-create, so the accumulation loop below reads as one line per bucket. */
function bucket<K>(buckets: Map<K, Ledger>, key: K): Ledger {
  let ledger = buckets.get(key)
  if (ledger === undefined) {
    ledger = emptyLedger()
    buckets.set(key, ledger)
  }
  return ledger
}

/**
 * The same range as `rangeSummary`, cut three ways: by day, by project, and by
 * hour of the day.
 *
 * One scan, one ledger type, one rounding rule — so the headline figure and
 * every bar drawn from these groupings are the same arithmetic over the same
 * rows. The alternative (a second query per chart) is four independent chances
 * to disagree with the sentence above them, at four times the read cost.
 */
async function rangeBreakdownImpl(ctx: QueryCtx, userId: string, args: BreakdownArgs) {
  if (!isValidTimeZone(args.timeZone)) {
    traceError("INVALID_TIMEZONE", `"${args.timeZone}" is not a timezone I know.`)
  }

  const { truncated, live } = await scanRange(ctx, userId, args.fromMs, args.toMs)
  const projectDocs = await projectsOf(ctx, live)

  const filter: EntryFilter = {
    projectId: args.projectId ?? null,
    billableOnly: args.billableOnly ?? false,
    text: args.text ?? "",
    presets: args.presets ?? [],
  }
  const nameOf = (id: string | undefined) =>
    id === undefined ? "" : (projectDocs.get(id as Id<"projects">)?.name ?? "")
  const rows = isFilterActive(filter)
    ? live.filter((row) => matchesFilter(row, filter, nameOf))
    : live

  const total = emptyLedger()
  const byDay = new Map<string, Ledger>()
  // Keyed by id, with "" for the unassigned bucket — a `Map` keyed by
  // `Id | undefined` would work too, but `undefined` as a live map key is the
  // kind of thing that survives a refactor as a silently-dropped bucket.
  const byProject = new Map<string, Ledger>()
  const hours = Array.from({ length: 24 }, () => 0)

  for (const row of rows) {
    const rateCents = rateOf(row, projectDocs)
    post(total, row, rateCents)
    post(bucket(byDay, dayOf(row.startedAt, args.timeZone)), row, rateCents)
    post(bucket(byProject, row.projectId ?? ""), row, rateCents)
    if (row.durationMs !== null) {
      hours[localPartsOf(row.startedAt, args.timeZone).hour] += row.durationMs
    }
  }

  /*
   * Per-day amounts are the DELTAS OF A ROUNDED RUNNING TOTAL, not each day's
   * own rounded amount.
   *
   * Rounding each day independently and summing gives a figure that can differ
   * from `billableCents` by a cent per day — which the Summary tab would draw
   * as a cumulative line ending somewhere other than the total printed directly
   * above it. Taking deltas of the running total makes the last point EXACTLY
   * `centsOf(total)` by construction, because the final running sum is the same
   * `billableCentMs` the headline rounds, and every intermediate day is still
   * the best whole-cent approximation of the period-to-date.
   *
   * Projects below are rounded independently instead, and that asymmetry is
   * deliberate: a project's amount is what you would invoice that client, so it
   * has to be right on its own rather than right in a sequence. Its parts may
   * therefore differ from the whole by a few cents, which is a real property of
   * money and not something to hide by making each client's figure depend on
   * the sort order of the others.
   */
  const days = []
  let runningCentMs = 0
  let paidToDate = 0
  for (const day of [...byDay.keys()].sort()) {
    const ledger = byDay.get(day)!
    runningCentMs += ledger.billableCentMs
    const cumulative = Math.round(runningCentMs / 3_600_000)
    days.push({
      day,
      totalMs: ledger.totalMs,
      billableMs: ledger.billableMs,
      billableCents: cumulative - paidToDate,
      count: ledger.count,
    })
    paidToDate = cumulative
  }

  const projects = [...byProject.entries()]
    .map(([key, ledger]) => {
      const doc = key === "" ? undefined : projectDocs.get(key as Id<"projects">)
      return {
        projectId: doc?._id ?? null,
        name: doc?.name ?? "",
        color: doc?.color ?? "",
        totalMs: ledger.totalMs,
        billableMs: ledger.billableMs,
        billableCents: centsOf(ledger),
        unratedBillableMs: ledger.unratedBillableMs,
        count: ledger.count,
      }
    })
    // Longest first, ties broken by name so the order is stable across refetches
    // — a bar chart that reshuffles itself on every reactive update is unusable.
    .sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name))

  return {
    totalMs: total.totalMs,
    billableMs: total.billableMs,
    count: total.count,
    runningCount: total.runningCount,
    truncated,
    billableCents: centsOf(total),
    unratedBillableMs: total.unratedBillableMs,
    days,
    projects,
    hours,
  }
}

export const rangeBreakdown = query({
  args: breakdownArgs,
  returns: breakdownReturns,
  handler: async (ctx, args) =>
    await rangeBreakdownImpl(ctx, await requireUserId(ctx), args),
})

export const rangeBreakdownAs = internalQuery({
  args: { ...breakdownArgs, userId: v.string() },
  returns: breakdownReturns,
  handler: async (ctx, { userId, ...args }) =>
    await rangeBreakdownImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// titleSuggestions
// ---------------------------------------------------------------------------

/** How far back autocomplete looks. Recent work is what gets repeated. */
const SUGGESTION_SCAN = 400

const suggestion = v.object({
  title: v.string(),
  projectId: v.optional(v.id("projects")),
  tagIds: v.array(v.id("tags")),
  billable: v.boolean(),
  lastUsedAt: v.number(),
  count: v.number(),
})

/**
 * Previous titles, with the classification each one last carried.
 *
 * Returns project, tags and billable — and deliberately NOT the note. The note
 * describes what happened during one specific interval; copying it onto a new
 * block of time would put a false account on work nobody has done yet, in the
 * user's own voice, indistinguishable from something they wrote.
 *
 * This is EXACTLY the set `resume` inherits, and that is the point. Toggl's
 * autocomplete and its resume button inherit different sets from each other —
 * tags come along on one path and not the other — so a user who notices cannot
 * trust either, and a user who does not notice silently loses tags.
 *
 * Ranked by recency rather than frequency: the thing you did an hour ago is a
 * better guess than the thing you did forty times last quarter.
 */
async function titleSuggestionsImpl(
  ctx: QueryCtx,
  userId: string,
  prefix: string,
  limit: number
) {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .order("desc")
    .take(SUGGESTION_SCAN)

  const needle = prefix.trim().toLowerCase()
  const seen = new Map<
    string,
    {
      title: string
      projectId?: Id<"projects">
      tagIds: Array<Id<"tags">>
      billable: boolean
      lastUsedAt: number
      count: number
    }
  >()

  for (const row of rows) {
    if (row.deletedAt !== null) continue
    const title = row.title.trim()
    if (title === "") continue
    if (needle !== "" && !title.toLowerCase().includes(needle)) continue

    // Case-insensitive key so "Standup" and "standup" are one suggestion, but
    // the FIRST spelling seen wins — and rows arrive newest first, so that is
    // the most recent spelling rather than an arbitrary one.
    const key = title.toLowerCase()
    const existing = seen.get(key)
    if (existing === undefined) {
      seen.set(key, {
        title,
        projectId: row.projectId,
        tagIds: row.tagIds,
        billable: row.billable,
        lastUsedAt: row.startedAt,
        count: 1,
      })
    } else {
      existing.count += 1
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit)
}

const titleSuggestionsArgs = {
  prefix: v.optional(v.string()),
  limit: v.optional(v.number()),
}

export const titleSuggestions = query({
  args: titleSuggestionsArgs,
  returns: v.array(suggestion),
  handler: async (ctx, args) =>
    await titleSuggestionsImpl(
      ctx,
      await requireUserId(ctx),
      args.prefix ?? "",
      args.limit ?? 6
    ),
})

export const titleSuggestionsAs = internalQuery({
  args: { ...titleSuggestionsArgs, userId: v.string() },
  returns: v.array(suggestion),
  handler: async (ctx, args) =>
    await titleSuggestionsImpl(ctx, args.userId, args.prefix ?? "", args.limit ?? 6),
})

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

const startArgs = {
  /** UUIDv7 minted by the client. Replaying it returns the original row. */
  clientKey: v.string(),
  title: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  projectId: v.optional(v.id("projects")),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

const startReturns = v.object({
  entryId: v.id("timeEntries"),
  stoppedEntryIds: v.array(v.id("timeEntries")),
  /** The clock-skew source. Taken from a mutation rather than a query because a
   *  mutation genuinely re-evaluates on every call. */
  serverNow: v.number(),
  replayed: v.boolean(),
})

type StartArgs = {
  clientKey: string
  title?: string
  startedAt?: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/**
 * Starts tracking. Never refuses.
 *
 * Three things happen atomically, which is the whole reason this is one
 * mutation rather than a stop followed by a start: any running entry is closed
 * at exactly the new entry's start instant, so there is no gap and no overlap,
 * and no window in which a crash leaves two timers running or none.
 *
 * The absence of error paths is deliberate. Nothing is required — no title, no
 * project, no tags — and a start arriving with an impossible timestamp is
 * CLAMPED rather than rejected. A phone whose clock is a minute behind a laptop
 * that started something ten seconds ago would otherwise be told to go and stop
 * a timer on another device, which is exactly the friction that makes people
 * abandon a tracker.
 */
async function startImpl(ctx: MutationCtx, userId: string, args: StartArgs) {
  const now = Date.now()

  const replay = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", args.clientKey)
    )
    .first()
  if (replay !== null) {
    return { entryId: replay._id, stoppedEntryIds: [], serverNow: now, replayed: true }
  }

  checkTitle(args.title)

  let startedAt = args.startedAt ?? now
  // A start far in the future is a wrong clock, not an intention.
  if (startedAt > now + CLOCK_SKEW_TOLERANCE_MS) startedAt = now

  const running = await runningEntries(ctx, userId)
  // Clamp forward past every running entry so the handoff is strictly ordered.
  // One millisecond, not one second: this is a boundary, not a gap.
  for (const entry of running) {
    if (startedAt <= entry.startedAt) startedAt = entry.startedAt + 1
  }

  const stoppedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, startedAt, now)) stoppedEntryIds.push(entry._id)
  }

  const project =
    args.projectId === undefined
      ? null
      : await getOwned(ctx, userId, "projects", args.projectId)
  const tagIds = await normaliseTagIds(ctx, userId, args.tagIds)

  const entryId = await ctx.db.insert("timeEntries", {
    userId,
    clientKey: args.clientKey,
    title: args.title ?? "",
    startedAt,
    endedAt: null,
    durationMs: null,
    projectId: args.projectId,
    tagIds,
    // Inherited from the project unless the caller said otherwise, so a
    // billable client's work is billable without the user remembering.
    billable: args.billable ?? project?.billableByDefault ?? false,
    source: "web",
    updatedAt: now,
    deletedAt: null,
  })
  await syncEntryTags(ctx, userId, entryId, tagIds)

  return { entryId, stoppedEntryIds, serverNow: now, replayed: false }
}

export const start = mutation({
  args: startArgs,
  returns: startReturns,
  handler: async (ctx, args) => await startImpl(ctx, await requireUserId(ctx), args),
})

export const startAs = internalMutation({
  args: { ...startArgs, userId: v.string() },
  returns: startReturns,
  handler: async (ctx, { userId, ...args }) => await startImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

const stopReturns = v.object({
  stoppedEntryIds: v.array(v.id("timeEntries")),
  serverNow: v.number(),
})

/**
 * Stops whatever is running. Never refuses, and is a no-op when nothing is.
 *
 * Two tabs both pressing S within a second must not produce an error in the
 * second one — the user's intent was satisfied either way. An empty
 * `stoppedEntryIds` is the signal that there was nothing to do.
 *
 * A runaway timer left over a weekend produces an entry longer than a day. That
 * is real recorded time and it stops normally; the 24-hour ceiling applies to
 * durations a user TYPES, not to a clock that genuinely ran. Refusing here
 * would make the timer permanently unstoppable.
 */
async function stopImpl(ctx: MutationCtx, userId: string, endedAt: number | undefined) {
  const now = Date.now()
  const running = await runningEntries(ctx, userId)

  const stoppedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, endedAt ?? now, now)) {
      stoppedEntryIds.push(entry._id)
    }
  }
  return { stoppedEntryIds, serverNow: now }
}

export const stop = mutation({
  args: { endedAt: v.optional(v.number()) },
  returns: stopReturns,
  handler: async (ctx, args) =>
    await stopImpl(ctx, await requireUserId(ctx), args.endedAt),
})

export const stopAs = internalMutation({
  args: { userId: v.string(), endedAt: v.optional(v.number()) },
  returns: stopReturns,
  handler: async (ctx, args) => await stopImpl(ctx, args.userId, args.endedAt),
})

// ---------------------------------------------------------------------------
// setTitle
// ---------------------------------------------------------------------------

const setTitleArgs = {
  entryId: v.id("timeEntries"),
  title: v.string(),
}

/**
 * Retitles an entry.
 *
 * Its own mutation rather than a field on a general update, because it is the
 * single highest-frequency write in the product — the user types into the timer
 * bar while the clock runs — and it must stay a cheap, last-write-wins patch. A
 * general update carrying optimistic-concurrency checks would fight a debounced
 * editor and surface a conflict dialog in the middle of typing.
 */
async function setTitleImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  title: string
) {
  checkTitle(title)
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)
  await ctx.db.patch(entry._id, { title, updatedAt: Date.now() })
  return null
}

export const setTitle = mutation({
  args: setTitleArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTitleImpl(ctx, await requireUserId(ctx), args.entryId, args.title),
})

export const setTitleAs = internalMutation({
  args: { ...setTitleArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTitleImpl(ctx, args.userId, args.entryId, args.title),
})

// ---------------------------------------------------------------------------
// discardRunning
// ---------------------------------------------------------------------------

const discardReturns = v.object({
  discardedEntryIds: v.array(v.id("timeEntries")),
})

/**
 * Throws away the running entry.
 *
 * A separate verb from delete, because killing a timer started by accident and
 * destroying recorded history are different intents carrying different risk.
 * Toggl conflates them behind one three-dot Delete.
 *
 * Soft-deletes with a real end time rather than a zero duration, so the row in
 * the trash is a valid interval and restoring it yields something usable rather
 * than a ghost.
 */
async function discardRunningImpl(ctx: MutationCtx, userId: string) {
  const now = Date.now()
  const running = await runningEntries(ctx, userId)

  const discardedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, now, now, { deletedAt: now })) {
      await dropEntryTags(ctx, userId, entry._id)
      discardedEntryIds.push(entry._id)
    }
  }
  return { discardedEntryIds }
}

export const discardRunning = mutation({
  args: {},
  returns: discardReturns,
  handler: async (ctx) => await discardRunningImpl(ctx, await requireUserId(ctx)),
})

export const discardRunningAs = internalMutation({
  args: { userId: v.string() },
  returns: discardReturns,
  handler: async (ctx, args) => await discardRunningImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// setNote
// ---------------------------------------------------------------------------

const setNoteArgs = {
  entryId: v.id("timeEntries"),
  note: v.string(),
}

/**
 * Writes the note — the field this product exists for.
 *
 * Split from `update` for the same reason `setTitle` is: it is written from the
 * stop sheet under a fifteen-second budget, and it must be a cheap
 * last-write-wins patch that cannot fail for a reason unrelated to the note.
 *
 * Works on a RUNNING entry too. The note is a description of the work, not of
 * the interval, and a user who knows what they are doing at 10:04 should not
 * have to wait until they stop to write it down.
 */
async function setNoteImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  note: string
) {
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)
  await ctx.db.patch(entry._id, { note: normaliseNote(note), updatedAt: Date.now() })
  return null
}

export const setNote = mutation({
  args: setNoteArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setNoteImpl(ctx, await requireUserId(ctx), args.entryId, args.note),
})

export const setNoteAs = internalMutation({
  args: { ...setNoteArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await setNoteImpl(ctx, args.userId, args.entryId, args.note),
})

// ---------------------------------------------------------------------------
// update — the non-time fields
// ---------------------------------------------------------------------------

const updateArgs = {
  entryId: v.id("timeEntries"),
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  // v.null() is "clear the project", absent is "leave it alone". Without the
  // distinction there is no way to express unassigning one.
  projectId: v.optional(v.union(v.id("projects"), v.null())),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

type UpdateArgs = {
  entryId: Id<"timeEntries">
  title?: string
  note?: string
  projectId?: Id<"projects"> | null
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/**
 * Edits the fields that are not times.
 *
 * Every field is optional and absent means "unchanged", so the inline editor
 * sends only what the user touched. Two people editing different fields of the
 * same row therefore do not overwrite each other, which a whole-document write
 * would do.
 *
 * Changing the project does NOT re-inherit `billable`. Inheritance is a
 * convenience at creation time; re-applying it here would silently reverse a
 * decision the user made deliberately on this specific entry.
 */
async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const entry = await getOwned(ctx, userId, "timeEntries", args.entryId)
  checkTitle(args.title)

  const patch: Partial<Doc<"timeEntries">> = { updatedAt: Date.now() }

  if (args.title !== undefined) patch.title = args.title
  if (args.note !== undefined) patch.note = normaliseNote(args.note)
  if (args.billable !== undefined) patch.billable = args.billable

  if (args.projectId !== undefined) {
    if (args.projectId !== null) {
      await assertOwned(ctx, userId, "projects", args.projectId)
      patch.projectId = args.projectId
    } else {
      patch.projectId = undefined
    }
  }

  if (args.tagIds !== undefined) {
    patch.tagIds = await normaliseTagIds(ctx, userId, args.tagIds)
  }

  await ctx.db.patch(entry._id, patch)
  // Only when tags were part of the patch. `getOwned` above already refused a
  // soft-deleted entry, so this row is live and its join rows should exist.
  if (patch.tagIds !== undefined) {
    await syncEntryTags(ctx, userId, entry._id, patch.tagIds)
  }
  return null
}

export const update = mutation({
  args: updateArgs,
  returns: v.null(),
  handler: async (ctx, args) => await updateImpl(ctx, await requireUserId(ctx), args),
})

export const updateAs = internalMutation({
  args: { ...updateArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, ...args }) => await updateImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// editTime
// ---------------------------------------------------------------------------

const editTimeArgs = {
  entryId: v.id("timeEntries"),
  field: v.union(
    v.literal("start"),
    v.literal("end"),
    v.literal("duration"),
    v.literal("day")
  ),
  /** An instant for start/end/day, a length in ms for duration. For `day` it is
   *  the new START instant: resolving a picked date against the entry's local
   *  time-of-day needs a timezone and a DST policy, which the caller has. */
  value: v.number(),
}

const editTimeReturns = v.object({
  startedAt: v.number(),
  endedAt: v.union(v.number(), v.null()),
  durationMs: v.union(v.number(), v.null()),
})

/**
 * Moves exactly one of start, end, or duration.
 *
 * The reconciliation rule — which of the other two follows — lives entirely in
 * `applyTimeEdit`, so the client cannot decide it and the two sides of the wire
 * cannot disagree. See convex/lib/entryTimes.ts for the rule itself.
 *
 * Giving a running entry an end time is a stop, and it is the ordinary fix for
 * "I finished twenty minutes ago and forgot". It is allowed here rather than
 * pushed to `stop`, because the user is looking at the row, not the timer bar.
 */
async function editTimeImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  edit: TimeEdit
) {
  const now = Date.now()
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)

  // A running entry whose start is in the future would read 0:00:00 and stay
  // there — a stopped-looking clock that is actually running. Clamp rather than
  // refuse, matching `start`: the intent is legible, only the number is wrong.
  //
  // `day` is included because it moves the same field by another name. Leaving
  // it out would make re-dating a running entry the documented way around a
  // guard the field beside it enforces.
  const movesStart = edit.field === "start" || edit.field === "day"
  const clamped =
    movesStart && entry.endedAt === null && edit.value > now
      ? ({ field: edit.field, value: now } as const)
      : edit

  const times = unwrapTimes(
    applyTimeEdit(
      { startedAt: entry.startedAt, endedAt: entry.endedAt, durationMs: entry.durationMs },
      clamped,
      now
    )
  )

  await ctx.db.patch(entry._id, {
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    durationMs: times.durationMs,
    updatedAt: now,
  })
  return times
}

export const editTime = mutation({
  args: editTimeArgs,
  returns: editTimeReturns,
  handler: async (ctx, args) =>
    await editTimeImpl(ctx, await requireUserId(ctx), args.entryId, {
      field: args.field,
      value: args.value,
    } as TimeEdit),
})

export const editTimeAs = internalMutation({
  args: { ...editTimeArgs, userId: v.string() },
  returns: editTimeReturns,
  handler: async (ctx, args) =>
    await editTimeImpl(ctx, args.userId, args.entryId, {
      field: args.field,
      value: args.value,
    } as TimeEdit),
})

// ---------------------------------------------------------------------------
// remove / restore
// ---------------------------------------------------------------------------

const removeReturns = v.object({
  /** Empty when the entry was already deleted — remove is idempotent. */
  removedEntryIds: v.array(v.id("timeEntries")),
})

/**
 * Soft-deletes an entry.
 *
 * Soft, because the undo toast has to be able to bring it back, and because
 * "never lose time" is the first rule. A hard delete is a maintenance sweep,
 * not a user gesture.
 *
 * Deleting a RUNNING entry closes it first, so the row in the trash is a valid
 * interval. Restoring a row with `endedAt: null` would otherwise resurrect a
 * second running timer hours later, violating the one-running invariant from a
 * gesture the user has already forgotten making.
 */
async function removeImpl(ctx: MutationCtx, userId: string, entryId: Id<"timeEntries">) {
  const now = Date.now()
  const entry = await getOwnedIncludingDeleted(ctx, userId, "timeEntries", entryId)

  if (entry.deletedAt !== null) return { removedEntryIds: [] }

  if (entry.endedAt === null) {
    // Guarded, matching discardRunning. If the close did not happen the row is
    // still live, and dropping its join rows anyway would leave a live entry
    // whose tags nothing protects — a fail-open on the one invariant this table
    // exists to hold. Unreachable given closeEntry's clamp; free to rule out.
    if (!(await closeEntry(ctx, entry, now, now, { deletedAt: now }))) {
      return { removedEntryIds: [] }
    }
  } else {
    await ctx.db.patch(entry._id, { deletedAt: now, updatedAt: now })
  }
  // The row is no longer live, so it no longer holds its tags. `tagIds` is left
  // alone — the entry is in the trash, not edited — and restore reads it back.
  await dropEntryTags(ctx, userId, entry._id)
  return { removedEntryIds: [entry._id] }
}

export const remove = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: removeReturns,
  handler: async (ctx, args) =>
    await removeImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const removeAs = internalMutation({
  args: { entryId: v.id("timeEntries"), userId: v.string() },
  returns: removeReturns,
  handler: async (ctx, args) => await removeImpl(ctx, args.userId, args.entryId),
})

/**
 * Undo.
 *
 * Restores as a COMPLETED entry whatever the stored `endedAt` says. `remove`
 * always closes a running row on the way out, but an import or an older row
 * could still carry a null end, and restoring that would hand the user a second
 * running timer they did not start. Ending it at its own updatedAt is the
 * honest reading: that is the last instant the row was known to be live.
 */
async function restoreImpl(ctx: MutationCtx, userId: string, entryId: Id<"timeEntries">) {
  const now = Date.now()
  const entry = await getOwnedIncludingDeleted(ctx, userId, "timeEntries", entryId)

  if (entry.deletedAt === null) return { restoredEntryIds: [] }

  if (entry.endedAt === null) {
    const times = unwrapTimes(
      entryTimes(entry.startedAt, Math.max(entry.updatedAt, entry.startedAt + 1))
    )
    await ctx.db.patch(entry._id, { ...times, deletedAt: null, updatedAt: now })
  } else {
    await ctx.db.patch(entry._id, { deletedAt: null, updatedAt: now })
  }
  // Live again, so it holds its tags again. Rebuilt from `tagIds`, which the
  // delete deliberately left intact.
  await syncEntryTags(ctx, userId, entry._id, entry.tagIds)
  return { restoredEntryIds: [entry._id] }
}

const restoreReturns = v.object({
  restoredEntryIds: v.array(v.id("timeEntries")),
})

export const restore = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: restoreReturns,
  handler: async (ctx, args) =>
    await restoreImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const restoreAs = internalMutation({
  args: { entryId: v.id("timeEntries"), userId: v.string() },
  returns: restoreReturns,
  handler: async (ctx, args) => await restoreImpl(ctx, args.userId, args.entryId),
})

// ---------------------------------------------------------------------------
// create — manual entry
// ---------------------------------------------------------------------------

const createArgs = {
  clientKey: v.string(),
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.number(),
  projectId: v.optional(v.id("projects")),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

const createReturns = v.object({
  entryId: v.id("timeEntries"),
  replayed: v.boolean(),
})

type CreateArgs = {
  clientKey: string
  title?: string
  note?: string
  startedAt: number
  endedAt: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
  /**
   * How the row got here, for `timeEntries.source`. Internal callers only —
   * the public `create` never passes it, so anything typed into the app is
   * "manual" and cannot claim otherwise.
   *
   * It exists because a bulk import has to be undoable. Sixty rows that
   * arrived together and are indistinguishable from sixty the user typed is
   * not a state anyone can get out of.
   */
  source?: "manual" | "import"
}

/**
 * Creates a completed entry from typed times.
 *
 * Unlike `start`, this one REFUSES bad input rather than clamping it. Both
 * timestamps came from a keyboard, so an end before its start is a typo the
 * user can see and fix — clamping it would silently record a length they did
 * not mean. `start` clamps because the wrong value there comes from a device
 * clock the user cannot see or correct.
 *
 * Idempotent on `clientKey`, like `start`, so a retried submit cannot produce a
 * duplicate day's work.
 */
async function createImpl(ctx: MutationCtx, userId: string, args: CreateArgs) {
  const now = Date.now()

  const replay = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", args.clientKey)
    )
    .first()
  if (replay !== null) return { entryId: replay._id, replayed: true }

  checkTitle(args.title)
  const note = normaliseNote(args.note)

  // Consistency first, then the policy ceiling — these times were typed, so the
  // 24-hour limit applies here in a way it never does to a clock that ran.
  const times = unwrapTimes(entryTimes(args.startedAt, args.endedAt))
  const entered = assertEnteredDuration(times.durationMs ?? 0)
  if (!entered.ok) unwrapTimes(entered)

  const project =
    args.projectId === undefined
      ? null
      : await getOwned(ctx, userId, "projects", args.projectId)
  const tagIds = await normaliseTagIds(ctx, userId, args.tagIds)

  const entryId = await ctx.db.insert("timeEntries", {
    userId,
    clientKey: args.clientKey,
    title: args.title ?? "",
    note,
    ...times,
    projectId: args.projectId,
    tagIds,
    billable: args.billable ?? project?.billableByDefault ?? false,
    source: args.source ?? "manual",
    updatedAt: now,
    deletedAt: null,
  })
  await syncEntryTags(ctx, userId, entryId, tagIds)

  return { entryId, replayed: false }
}

/** Exported for `convex/import.ts`, which needs the same validation, the same
 *  clientKey idempotency and the same tag sync — but a different `source`. A
 *  mutation cannot call another mutation in Convex, so it calls this. */
export { createImpl }

export const create = mutation({
  args: createArgs,
  returns: createReturns,
  handler: async (ctx, args) => await createImpl(ctx, await requireUserId(ctx), args),
})

export const createAs = internalMutation({
  args: { ...createArgs, userId: v.string() },
  returns: createReturns,
  handler: async (ctx, { userId, ...args }) => await createImpl(ctx, userId, args),
})
