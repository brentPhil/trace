import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { rangeBreakdownImpl } from "./entries"
import { MAX_ADDRESS_LENGTH, MAX_NAME_LENGTH } from "./clients"
import { centiHours } from "./lib/duration"
import { isValidCurrency } from "./lib/money"
import { invoiceTotals, lineAmountCents } from "./lib/invoiceMath"
import { nextInvoiceNumber } from "./lib/invoiceNumber"
import { invoiceDoc, invoiceLineDoc } from "./lib/docs"
import { NO_PROJECT_LABEL } from "./lib/labels"
import {
  INVOICE_LIST_LIMIT,
  INVOICE_NUMBER_SCAN_LIMIT,
  INVOICE_SCAN_LIMIT,
} from "./lib/scan"
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
// list
// ---------------------------------------------------------------------------

/**
 * A row of /invoices: the fields the list prints, plus the one figure that is
 * NOT on the invoice document — its total, which lives in the lines.
 *
 * `.pick`/`.extend` off `invoiceDoc` rather than a second hand-written object,
 * for the reason convex/lib/docs.ts gives: a return validator written out again
 * drifts from the schema and then rejects correct documents at runtime.
 */
const invoiceListRow = invoiceDoc
  .pick("_id", "number", "status", "billedTo", "currency", "issuedAt")
  .extend({ totalCents: v.number() })

const listReturns = v.object({
  invoices: v.array(invoiceListRow),
  /** True when invoices older than this page exist. The list must say so —
   *  see INVOICE_LIST_LIMIT in convex/lib/scan.ts for why there is a cap and
   *  why silently stopping at it would be a lie. */
  truncated: v.boolean(),
})

type InvoiceListRow = {
  _id: Id<"invoices">
  number: string
  status: Doc<"invoices">["status"]
  billedTo: string
  currency: string
  issuedAt: number
  totalCents: number
}

/**
 * The newest invoices, each totalled.
 *
 * DESCENDING `by_user_issued`, because "the one I raised last week" is the
 * question a list of invoices gets asked, and it is answered at the top.
 *
 * The total is an N+1 read — one `invoiceLines` query per row — which is what
 * `INVOICE_LIST_LIMIT` exists to bound; see that constant for the byte
 * arithmetic. One row past the limit is read so `truncated` can distinguish
 * "this is all of them" from "this is the newest 50", which the list has to
 * state rather than leave the reader to assume.
 */
async function listImpl(
  ctx: QueryCtx,
  userId: string
): Promise<{ invoices: Array<InvoiceListRow>; truncated: boolean }> {
  const page = await ctx.db
    .query("invoices")
    .withIndex("by_user_issued", (q) => q.eq("userId", userId))
    .order("desc")
    .take(INVOICE_LIST_LIMIT + 1)

  // Trashed rows are dropped after the take rather than by the index, because
  // `deletedAt` is not in this index's key and a second index for a column that
  // is null in every account which has not deleted an invoice is not worth its
  // write cost. `clients.listImpl` filters after reading for the same reason —
  // though it `.collect()`s and so has no page for a trashed row to cost a slot
  // on, which is the half of this that needed thinking about.
  //
  // Filter FIRST, then slice: slicing first would spend a page slot on every
  // trashed row and show fewer than the cap while claiming to show it.
  const live = page.filter((row) => row.deletedAt === null)
  const shown = live.slice(0, INVOICE_LIST_LIMIT)

  const invoices: Array<InvoiceListRow> = []
  for (const invoice of shown) {
    const lines = await ctx.db
      .query("invoiceLines")
      .withIndex("by_user_invoice", (q) =>
        q.eq("userId", userId).eq("invoiceId", invoice._id)
      )
      .collect()
    invoices.push({
      _id: invoice._id,
      number: invoice.number,
      status: invoice.status,
      billedTo: invoice.billedTo,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
      // The SAME `invoiceTotals` the document and the editor print, over the
      // STORED line amounts and this invoice's own taxes — so the figure in
      // the list and the figure on the invoice cannot come out different.
      totalCents: invoiceTotals(lines, invoice.taxes).totalCents,
    })
  }

  // `take(n)` returns fewer than n ONLY when the index is exhausted, so a short
  // page proves there is nothing older and `truncated` is then exactly right.
  //
  // The converse is not exact, and the inexactness is deliberately on the safe
  // side. A full page proves a 51st ROW exists, not a 51st LIVE row — so an
  // account holding exactly 51 invoices whose oldest is in the trash is told
  // older ones exist when only a deleted one does. Being told there is more to
  // see when there is not costs a glance; NOT being told when there is would be
  // the list quietly under-reporting how much has been billed, and that
  // direction is unreachable here: `truncated === false` implies the index ran
  // out, which implies every live row is on the page.
  //
  // Making it exact means reading past the page until 51 live rows are found,
  // which trades a bounded read for an unbounded one to sharpen a sentence.
  // Not worth it — and today nothing can soft-delete an invoice at all.
  return { invoices, truncated: page.length > INVOICE_LIST_LIMIT }
}

export const list = query({
  args: {},
  returns: listReturns,
  handler: async (ctx) => await listImpl(ctx, await requireUserId(ctx)),
})

export const listAs = internalQuery({
  args: { userId: v.string() },
  returns: listReturns,
  handler: async (ctx, args) => await listImpl(ctx, args.userId),
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
    //
    // NOT "too large to total exactly" — between INVOICE_SCAN_LIMIT and
    // SUMMARY_SCAN_LIMIT entries, /reports totals this same range exactly;
    // only this mutation's smaller, byte-safe read (see INVOICE_SCAN_LIMIT in
    // convex/lib/scan.ts) runs out first. The true claim is narrower: this
    // path reads less than /reports does, and the range has to shrink to fit.
    traceError(
      "RANGE_TOO_LARGE",
      "This period has more time entries than an invoice can total exactly — invoicing reads a smaller window than /reports does. Narrow the dates."
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
  // Bounded, not `.collect()`: `nextInvoiceNumber` needs the HIGHEST sequence
  // ever used, and `by_user_number` sorts `number` as a STRING — which does
  // NOT put that maximum at either end of the index (see
  // INVOICE_NUMBER_SCAN_LIMIT's comment in convex/lib/scan.ts for why). The
  // only provably-correct read is the whole table, so this bounds that read
  // and refuses outright once it doesn't fit, rather than risk a wrong
  // number that lets two invoices claim the same id.
  const invoiceRows = await ctx.db
    .query("invoices")
    .withIndex("by_user_number", (q) => q.eq("userId", userId))
    .take(INVOICE_NUMBER_SCAN_LIMIT + 1)
  if (invoiceRows.length > INVOICE_NUMBER_SCAN_LIMIT) {
    traceError(
      "INVOICE_HISTORY_TOO_LARGE",
      "This account has too many invoices for the next number to be verified unique."
    )
  }
  const usedNumbers = invoiceRows.map((row) => row.number)
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

// ---------------------------------------------------------------------------
// update — the document head
// ---------------------------------------------------------------------------

/*
 * BOUNDING THIS TEXT IS NOT HOUSEKEEPING.
 *
 * `INVOICE_NUMBER_SCAN_LIMIT` and `INVOICE_LIST_LIMIT` (convex/lib/scan.ts) are
 * both derived from a per-row byte estimate for an `invoices` row, and until
 * this mutation existed that estimate held only because no human could type
 * into one — `createFromRange` writes a `billedTo` bounded by clients.ts and
 * leaves the rest empty. This is the editor those two comments warned about, so
 * each bound below is a term in that arithmetic and changing one means redoing
 * the division there rather than trusting the number that is written down.
 */

/**
 * A party block: `billedTo` and `payTo`.
 *
 * Derived from clients.ts's own two bounds rather than picked again, because
 * `createFromRange` snapshots `name\naddress` into `billedTo` — a bound below
 * this one would let this product write a document its own editor then refuses
 * to save back, which the user would experience as an invoice that cannot be
 * touched without being retyped.
 */
export const MAX_PARTY_LENGTH = MAX_NAME_LENGTH + 1 + MAX_ADDRESS_LENGTH

/** A reference issued by the client's own purchasing system, not a sentence.
 *  The same 100 characters a client's name gets, which is already far past
 *  every real PO number and short enough that the field cannot become prose. */
export const MAX_PURCHASE_ORDER_LENGTH = 100

/**
 * "Net 30", "Due on receipt, bank transfer to …" — a line or two.
 *
 * Deliberately short, because this is the field a notes field would come back
 * as. An invoice states what is owed; commentary belongs on the time entries
 * the lines were built from, which is exactly the argument that keeps
 * `INVOICE_NUMBER_SCAN_LIMIT`'s per-row estimate honest.
 */
export const MAX_PAYMENT_TERMS_LENGTH = 200

/**
 * Trimmed at the ends, NEVER collapsed inside.
 *
 * The same rule and the same reason as `checkAddress` in clients.ts: a party
 * block is rendered verbatim on a document, so its internal newlines are the
 * block's shape, and a normaliser that tidied them would print a three-line
 * address on one line.
 */
function checkText(raw: string, what: string, max: number): string {
  const trimmed = raw.trim()
  if (trimmed.length > max) {
    traceError("TOO_LONG", `Keep the ${what} under ${max} characters.`)
  }
  return trimmed
}

/**
 * A date, as a real instant.
 *
 * `v.number()` round-trips NaN and Infinity — the same fact `INVALID_RATE`
 * exists for. One NaN `issuedAt` sorts nowhere in `by_user_issued`, renders as
 * "Invalid Date" on the document, and is invisible until a client is holding
 * the PDF.
 */
function checkInstant(value: number, what: string): number {
  if (!Number.isFinite(value)) {
    traceError("INVALID_DATE", `That ${what} is not a date I can read.`)
  }
  return value
}

/**
 * The fields a human types into the document head, patched one at a time.
 *
 * WHAT IS DELIBERATELY ABSENT, since a patch validator is a list of permissions:
 *
 *   - `number`. Making it editable means enforcing per-user uniqueness on
 *     write, which is the bounded full-table scan `createFromRange` performs
 *     for exactly that reason (see `INVOICE_NUMBER_SCAN_LIMIT`). That decision
 *     belongs beside that scan, not smuggled into a field patch — and an
 *     invoice quietly renumbered by a blur is two documents claiming one id.
 *   - `status`. `setStatus` below is what moves it, because the transitions
 *     are a rule rather than a value.
 *   - `taxes`, and every line. Task 6.
 *   - `sourceFromMs`, `sourceToMs`, `unratedMsAtCreation`, `clientId`,
 *     `clientKey`. These record where the figures came from. THE SNAPSHOT RULE
 *     is the load-bearing decision of this whole feature — an invoice holds
 *     values, not references — and provenance is the half of it that must not
 *     move even when the values do.
 *
 * `billedTo`, `payTo` and `currency` ARE snapshot fields and ARE editable, and
 * that is not a contradiction: the snapshot rule says this document never
 * re-reads the client, not that its own text is frozen while it is still a
 * draft. Editing them writes THIS row and never touches the `clients` row it
 * was copied from — correcting a typo on an invoice must not rename a client,
 * and renaming a client must not rewrite an invoice.
 */
const updateArgs = {
  invoiceId: v.id("invoices"),
  billedTo: v.optional(v.string()),
  payTo: v.optional(v.string()),
  currency: v.optional(v.string()),
  issuedAt: v.optional(v.number()),
  dueAt: v.optional(v.number()),
  purchaseOrder: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
}

type UpdateArgs = {
  invoiceId: Id<"invoices">
  billedTo?: string
  payTo?: string
  currency?: string
  issuedAt?: number
  dueAt?: number
  purchaseOrder?: string
  paymentTerms?: string
}

async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const invoice = await getOwned(ctx, userId, "invoices", args.invoiceId)

  /*
   * THE FREEZE, ENFORCED HERE.
   *
   * The editor also disables its fields once an invoice leaves draft, and that
   * is a convenience — this is the rule. An issued invoice is a document
   * somebody has been sent, so the copy in their inbox and the copy in this
   * table have to keep saying the same thing; a client-side `disabled` is one
   * stale tab or one hand-written mutation away from being no rule at all.
   *
   * The way back is `setStatus` to draft, which is the unlock: a deliberate
   * act, unlike typing an address.
   */
  if (invoice.status !== "draft") {
    traceError(
      "INVOICE_LOCKED",
      "This invoice has been issued, so its details are locked. Set it back to Draft to edit it."
    )
  }

  const patch: Partial<Doc<"invoices">> = { updatedAt: Date.now() }

  if (args.billedTo !== undefined) {
    patch.billedTo = checkText(args.billedTo, "billed-to block", MAX_PARTY_LENGTH)
  }
  if (args.payTo !== undefined) {
    patch.payTo = checkText(args.payTo, "pay-to block", MAX_PARTY_LENGTH)
  }
  if (args.currency !== undefined) {
    if (!isValidCurrency(args.currency)) {
      // The same refusal `settings.update` makes, in the same words: the list
      // is `money.SUPPORTED_CURRENCIES`, which is the runtime's own codes
      // narrowed to the ones whose minor unit really is a hundredth.
      traceError(
        "INVALID_CURRENCY",
        `"${args.currency}" is not a currency Trace can use. Pick one from the list in Settings.`
      )
    }
    patch.currency = args.currency
  }
  /*
   * The two dates are checked independently and NOT against each other.
   *
   * A due date before an issue date is odd, and refusing it here would still
   * be wrong: this editor autosaves one field per blur, so an ordering rule
   * makes moving an invoice a month forward refuse or succeed depending on
   * which of the two the user happens to blur first.
   *
   * Not refusing is not the same as saying nothing, and for a while it was.
   * `InvoiceMeta` now draws a non-blocking advisory under the due date whenever
   * it precedes the issue date — recomputed every render, so it is
   * order-independent in the way a write-time rule cannot be, and free
   * server-side. That is what makes the claim below true: the mistake IS
   * visible on the document, because something on the document names it.
   */
  if (args.issuedAt !== undefined) {
    patch.issuedAt = checkInstant(args.issuedAt, "invoice date")
  }
  if (args.dueAt !== undefined) {
    patch.dueAt = checkInstant(args.dueAt, "due date")
  }
  /*
   * Emptied means ABSENT, not "". Both optional fields print as "—" when unset,
   * and storing an empty string would be a second way to say the same thing —
   * `patch` with `undefined` removes the column, which is what "clear it"
   * means here. (`clientId` uses an explicit `null` for the same idea because
   * its schema type includes null; these two are plain `v.optional`.)
   */
  if (args.purchaseOrder !== undefined) {
    const po = checkText(args.purchaseOrder, "purchase order", MAX_PURCHASE_ORDER_LENGTH)
    patch.purchaseOrder = po === "" ? undefined : po
  }
  if (args.paymentTerms !== undefined) {
    const terms = checkText(args.paymentTerms, "payment terms", MAX_PAYMENT_TERMS_LENGTH)
    patch.paymentTerms = terms === "" ? undefined : terms
  }

  await ctx.db.patch(invoice._id, patch)
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
// setStatus
// ---------------------------------------------------------------------------

/**
 * Draft, Issued, Paid — a LINE, walked one step at a time.
 *
 * The legal moves, and what each one is:
 *
 *   draft  -> issued   Raising it. This is what freezes the document.
 *   issued -> draft    THE UNLOCK. The plan asks for exactly this and it is
 *                      why the freeze can be strict: an invoice sent with a
 *                      wrong address is fixable, in one deliberate act, rather
 *                      than by raising a second document.
 *   issued -> paid     The money arrived.
 *   paid   -> issued   It did not, or it was recorded against the wrong
 *                      invoice. Un-paying is a correction, not an unlock.
 *
 * The two refused moves are the ones that skip Issued. `draft -> paid` claims
 * a document nobody has been sent has already been settled, and it would also
 * be the one path to a frozen invoice that was never frozen at the moment it
 * was raised. `paid -> draft` is the same edge backwards: a paid invoice is
 * unlocked by un-paying it first, so the unlock is always one step from the
 * state the freeze belongs to. Two clicks, and each says what it does.
 *
 * Setting the status an invoice already has is a no-op rather than a refusal.
 * A double-fired click or a retried mutation must not raise an error at
 * somebody about a state they are already in.
 */
const STATUS_LINE = ["draft", "issued", "paid"] as const
type InvoiceStatus = (typeof STATUS_LINE)[number]

function isLegalStep(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return Math.abs(STATUS_LINE.indexOf(to) - STATUS_LINE.indexOf(from)) <= 1
}

const setStatusArgs = {
  invoiceId: v.id("invoices"),
  /** The schema's own union, not a second copy of it — a hand-repeated status
   *  validator is one literal away from accepting a status the table cannot
   *  hold. */
  status: invoiceDoc.fields.status,
}

async function setStatusImpl(
  ctx: MutationCtx,
  userId: string,
  invoiceId: Id<"invoices">,
  status: InvoiceStatus
) {
  const invoice = await getOwned(ctx, userId, "invoices", invoiceId)
  // Returned BEFORE the patch, not merely tolerated by it. A no-op that still
  // wrote `updatedAt` would move the document's own record of when it last
  // changed for a request that changed nothing — and `updatedAt` is the field
  // an audit reads to ask when an issued invoice was last touched.
  if (invoice.status === status) return null
  if (!isLegalStep(invoice.status, status)) {
    traceError(
      "INVALID_STATUS_CHANGE",
      "An invoice moves Draft, Issued, Paid one step at a time. Set this one to Issued first."
    )
  }
  await ctx.db.patch(invoice._id, { status, updatedAt: Date.now() })
  return null
}

export const setStatus = mutation({
  args: setStatusArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setStatusImpl(ctx, await requireUserId(ctx), args.invoiceId, args.status),
})

export const setStatusAs = internalMutation({
  args: { ...setStatusArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setStatusImpl(ctx, args.userId, args.invoiceId, args.status),
})
