import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { rangeBreakdownImpl } from "./entries"
import { centiHours } from "./lib/duration"
import { lineAmountCents } from "./lib/invoiceMath"
import { nextInvoiceNumber } from "./lib/invoiceNumber"
import { invoiceDoc, invoiceLineDoc } from "./lib/docs"
import { NO_PROJECT_LABEL } from "./lib/labels"
import { INVOICE_SCAN_LIMIT } from "./lib/scan"
import { currencyOf, defaultRateCents } from "./settings"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/**
 * Invoices: turning a filtered range from /reports into a billable document.
 *
 * Same shape as convex/projects.ts and convex/clients.ts: a `*Impl` taking an
 * explicit userId, a public wrapper deriving it from the session, and an
 * internal wrapper for tests. `userId` never appears in a public args
 * validator.
 */

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

const invoiceWithLines = v.object({
  ...invoiceDoc.fields,
  /** Ascending by `sortKey` — the printed order. */
  lines: v.array(invoiceLineDoc),
})

/**
 * An invoice and its lines, in print order.
 *
 * `invoiceLines` is never soft-deleted on its own (see the schema comment),
 * so there is no live filter to apply here — every row this index finds
 * belongs on the document.
 */
async function getImpl(ctx: QueryCtx, userId: string, invoiceId: Id<"invoices">) {
  const invoice = await getOwned(ctx, userId, "invoices", invoiceId)
  const lines = await ctx.db
    .query("invoiceLines")
    .withIndex("by_user_invoice", (q) => q.eq("userId", userId).eq("invoiceId", invoiceId))
    .collect()
  lines.sort((a, b) => a.sortKey - b.sortKey)
  return { ...invoice, lines }
}

const getArgs = { invoiceId: v.id("invoices") }

export const get = query({
  args: getArgs,
  returns: invoiceWithLines,
  handler: async (ctx, args) =>
    await getImpl(ctx, await requireUserId(ctx), args.invoiceId),
})

export const getAs = internalQuery({
  args: { ...getArgs, userId: v.string() },
  returns: invoiceWithLines,
  handler: async (ctx, args) => await getImpl(ctx, args.userId, args.invoiceId),
})

// ---------------------------------------------------------------------------
// createFromRange
// ---------------------------------------------------------------------------

const createFromRangeArgs = {
  /** UUIDv7 minted client-side before the mutation is sent — the same
   *  idempotency device `timeEntries.clientKey` uses. A retry after a lost
   *  response must not mint a second invoice number. */
  clientKey: v.string(),
  fromMs: v.number(),
  toMs: v.number(),
  /** Bucketing zone for `rangeBreakdownImpl` AND the zone the invoice number's
   *  date stamp is read in — see nextInvoiceNumber. Passed by the caller, like
   *  every other range query in this codebase, so this stays a pure function
   *  of its arguments rather than a second reader of `userSettings`. */
  timeZone: v.string(),
  weekStartDay: v.number(),
}

type CreateFromRangeArgs = {
  clientKey: string
  fromMs: number
  toMs: number
  timeZone: string
  weekStartDay: number
}

const createFromRangeReturns = v.object({
  invoiceId: v.id("invoices"),
  /** How much billable time in the range had no rate at all and so is on
   *  NEITHER this invoice nor any line of it — see `unratedBillableMs` on
   *  `entries.rangeBreakdownImpl`. The editor (Task 6) names this so the
   *  figure is never silently short. Read from the invoice's own
   *  `unratedMsAtCreation` on a replay — NEVER recomputed by re-scanning — so
   *  a retry reports the same figure the original response did. */
  unratedMs: v.number(),
  replayed: v.boolean(),
})

/** One line's worth of work, computed but not yet written. */
type PricedLine = {
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
  projectId: Id<"projects"> | undefined
}

/**
 * Turns a filtered `/reports` range into a draft invoice: one line per
 * project, priced at that project's rate (or the account default), snapshot
 * against today's client — never against tomorrow's.
 */
async function createFromRangeImpl(
  ctx: MutationCtx,
  userId: string,
  args: CreateFromRangeArgs
) {
  const replay = await ctx.db
    .query("invoices")
    .withIndex("by_user_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", args.clientKey)
    )
    .first()
  if (replay !== null) {
    return { invoiceId: replay._id, unratedMs: replay.unratedMsAtCreation, replayed: true }
  }

  /*
   * The SAME `rangeBreakdownImpl` /reports draws, called with a MutationCtx.
   *
   * A second scan written here would be a second rounding rule, and the
   * invoice would disagree with the page the user raised it from — which is
   * the one disagreement this product cannot afford.
   *
   * `INVOICE_SCAN_LIMIT`, not the default `SUMMARY_SCAN_LIMIT` — this runs
   * inside a mutation, and has to refuse before the transaction's own byte
   * ceiling arrives, not after it. See that constant's comment in
   * convex/lib/scan.ts.
   */
  const breakdown = await rangeBreakdownImpl(
    ctx,
    userId,
    {
      fromMs: args.fromMs,
      toMs: args.toMs,
      timeZone: args.timeZone,
      weekStartDay: args.weekStartDay,
      billableOnly: true,
    },
    INVOICE_SCAN_LIMIT
  )

  if (breakdown.truncated) {
    // Every figure on a truncated /reports is a floor. A floor on an invoice
    // under-bills a client by an unknown amount with nothing on the document
    // to reveal it, so this is refused outright rather than invoiced.
    traceError(
      "RANGE_TOO_LARGE",
      "This period is too large to total exactly, so it cannot be invoiced. Narrow the dates."
    )
  }

  // Each project's own document, fetched once. `rangeBreakdownImpl` prices
  // time but does not expose `hourlyRateCents` or `clientId` — the two facts
  // an invoice needs that a /reports chart does not.
  const projectDocs = new Map<Id<"projects">, Doc<"projects">>()
  for (const p of breakdown.projects) {
    if (p.projectId !== null && p.billableMs > 0) {
      const doc = await ctx.db.get(p.projectId)
      if (doc !== null) projectDocs.set(p.projectId, doc)
    }
  }

  /*
   * One client for the whole invoice. A project with no client set does not
   * count against this — see `projectFields.clientId` in the schema — but two
   * DIFFERENT clients in one range is refused outright, naming both: silently
   * merging them bills one company for another company's work on a single
   * document with a single total.
   *
   * Checked over every project that has billable time in the range, not only
   * the ones that end up priced below — an unrated project's hours earn
   * nothing, but the range still genuinely touched that client's work, and a
   * range spanning two clients is exactly as wrong whether or not one side
   * happens to be priced yet.
   */
  let clientId: Id<"clients"> | null = null
  for (const p of breakdown.projects) {
    if (p.billableMs === 0) continue
    const project = p.projectId === null ? undefined : projectDocs.get(p.projectId)
    const projectClientId = project?.clientId ?? null
    if (projectClientId === null) continue
    if (clientId === null) {
      clientId = projectClientId
    } else if (clientId !== projectClientId) {
      const [a, b] = await Promise.all([ctx.db.get(clientId), ctx.db.get(projectClientId)])
      traceError(
        "MIXED_CLIENTS",
        `This range covers two clients — "${a?.name ?? "one client"}" and ` +
          `"${b?.name ?? "another client"}" — and an invoice can only be billed ` +
          `to one. Narrow the dates or filter to a single client.`
      )
    }
  }

  const client = clientId === null ? null : await ctx.db.get(clientId)
  // SNAPSHOT text, not a join. Renaming a client afterwards must not rewrite
  // this invoice — `clientId` beside it is what still answers "show me
  // everything billed to Vessel Vanguard".
  const billedTo =
    client === null
      ? ""
      : client.address.trim() === ""
        ? client.name
        : `${client.name}\n${client.address}`

  // `defaultRateCents` is typed for a `QueryCtx`; a `MutationCtx` satisfies it
  // structurally, the same fact that lets `rangeBreakdownImpl` above be called
  // unmodified — see that export's doc comment.
  const accountRateCents = await defaultRateCents(ctx, userId)

  const lines: Array<PricedLine> = []
  for (const p of breakdown.projects) {
    if (p.billableMs === 0) continue
    // A project's rate is resolved uniformly for every row inside it (see
    // `rateOf` in entries.ts), so `unratedBillableMs` for one project bucket
    // is either 0 or exactly `billableMs` — never partial. Skip the latter:
    // billable time nobody has priced is excluded, not guessed at.
    if (p.unratedBillableMs > 0) continue

    const project = p.projectId === null ? undefined : projectDocs.get(p.projectId)
    // Zero is a rate somebody chose, not "no rate" — `??` is what keeps a
    // zero-rate project's line at $0.00 instead of falling through to the
    // account default. Same rule as `rateOf`.
    const unitCents = project?.hourlyRateCents ?? accountRateCents
    if (unitCents === null) continue // unreachable: unratedBillableMs === 0 above proves a rate exists

    const quantityCentis = centiHours(p.billableMs)
    lines.push({
      // A stated label, not "" — a blank cell beside a real amount on a
      // printed invoice reads as a rendering fault, not as "work with no
      // project". Shared with the client's own charts via convex/lib/labels.ts
      // so the two never print two different names for the same bucket.
      description: project?.name ?? NO_PROJECT_LABEL,
      quantityCentis,
      unitCents,
      amountCents: lineAmountCents(quantityCentis, unitCents),
      projectId: project?._id,
    })
  }

  const now = Date.now()
  const usedNumbers = (
    await ctx.db
      .query("invoices")
      .withIndex("by_user_number", (q) => q.eq("userId", userId))
      .collect()
  ).map((row) => row.number)
  const number = nextInvoiceNumber(now, args.timeZone, usedNumbers)

  const invoiceId = await ctx.db.insert("invoices", {
    userId,
    clientKey: args.clientKey,
    number,
    status: "draft",
    clientId,
    billedTo,
    // Filled in by the editor (Task 6). Empty rather than a guess: nothing
    // in this range says who the freelancer is or wants to be paid as.
    payTo: "",
    currency: await currencyOf(ctx, userId),
    issuedAt: now,
    // Net 30, the most common freelance default and a plain, editable
    // starting point — the editor (Task 6) is where a user states their own
    // terms via `paymentTerms`.
    dueAt: now + 30 * 24 * 60 * 60 * 1000,
    taxes: [],
    // Provenance only — NEVER read back to recompute anything. See the
    // schema comment on `sourceFromMs`/`sourceToMs`.
    sourceFromMs: args.fromMs,
    sourceToMs: args.toMs,
    // SNAPSHOT — see the schema comment. Read back verbatim on the replay
    // branch above, never recomputed.
    unratedMsAtCreation: breakdown.unratedBillableMs,
    updatedAt: now,
    deletedAt: null,
  })

  for (const [index, line] of lines.entries()) {
    await ctx.db.insert("invoiceLines", {
      userId,
      invoiceId,
      kind: "time",
      description: line.description,
      quantityCentis: line.quantityCentis,
      unitCents: line.unitCents,
      amountCents: line.amountCents,
      projectId: line.projectId,
      sortKey: index,
      deletedAt: null,
    })
  }

  return { invoiceId, unratedMs: breakdown.unratedBillableMs, replayed: false }
}

export const createFromRange = mutation({
  args: createFromRangeArgs,
  returns: createFromRangeReturns,
  handler: async (ctx, args) =>
    await createFromRangeImpl(ctx, await requireUserId(ctx), args),
})

export const createFromRangeAs = internalMutation({
  args: { ...createFromRangeArgs, userId: v.string() },
  returns: createFromRangeReturns,
  handler: async (ctx, { userId, ...args }) =>
    await createFromRangeImpl(ctx, userId, args),
})
