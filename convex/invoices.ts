import { v } from "convex/values"
import type { ObjectType } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { rangeBreakdownImpl } from "./entries"
import { MAX_ADDRESS_LENGTH, MAX_NAME_LENGTH } from "./clients"
import { isValidCurrency } from "./lib/money"
import { invoiceTotals } from "./lib/invoiceMath"
import { billableBucketsOf, invoiceLineDrafts } from "./lib/invoiceLines"
import { nextInvoiceNumber } from "./lib/invoiceNumber"
import { partyBlockOf } from "./lib/party"
import { invoiceDoc, invoiceLineDoc } from "./lib/docs"
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
 *
 * AN INVOICE IS WRITE-ONCE. `createFromRange` is the only writer this file has
 * and there is no `update`: a numbered document that gets sent to a client is
 * composed once, at /invoices/new, and is a record from the moment it exists.
 * Everything a human types onto one therefore arrives as an argument to
 * creation and is bounded there — which is why the length bounds and
 * `checkText` below live beside that mutation rather than beside an editor.
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
  .pick("_id", "number", "billedTo", "currency", "issuedAt")
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
      billedTo: invoice.billedTo,
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
      // The SAME `invoiceTotals` the record page and the PDF print, over the
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
// What a human may type onto an invoice, and how long it may be
// ---------------------------------------------------------------------------

/*
 * BOUNDING THIS TEXT IS NOT HOUSEKEEPING.
 *
 * `INVOICE_NUMBER_SCAN_LIMIT` and `INVOICE_LIST_LIMIT` (convex/lib/scan.ts) are
 * both derived from a per-row byte estimate for an `invoices` row, and that
 * estimate holds only because every free string this file writes is capped
 * below. Each bound is a term in that arithmetic, so changing one means redoing
 * the division there rather than trusting the number that is written down.
 *
 * The set of terms is not only the four below: `MAX_SOURCE_TEXT_LENGTH` further
 * down bounds the two provenance strings a filter puts on the row, and counts
 * twice. The division in convex/lib/scan.ts names all of them; this comment
 * names none of them, deliberately, because a second list here would be the one
 * that stopped agreeing.
 *
 * These bounds outlived the editor they were written for. An invoice used to be
 * editable and they were enforced on `invoices.update`; an invoice is now
 * write-once and they are enforced at CREATION, which is the only moment a
 * human types into one. Not one of them changed value in the move — the row is
 * the same row and the division is the same division.
 */

/**
 * A party block: `billedTo` and `payTo`.
 *
 * Derived from clients.ts's own two bounds rather than picked again, because
 * `createFromRange` can snapshot `name\naddress` into `billedTo` — a bound
 * below this one would let this product refuse to write a block it assembled
 * itself, which the user would experience as an invoice that cannot be raised
 * from a client they were allowed to save.
 */
export const MAX_PARTY_LENGTH = MAX_NAME_LENGTH + 1 + MAX_ADDRESS_LENGTH

/** A reference issued by the client's own purchasing system, not a sentence.
 *  The same 100 characters a client's name gets, which is already far past
 *  every real PO number and short enough that the field cannot become prose. */
export const MAX_PURCHASE_ORDER_LENGTH = 100

/**
 * "Net 30", "Due on receipt" — a line, in the meta grid beside the dates.
 *
 * Short because of WHERE it is rather than what it is worth saying: this is a
 * name/value row of the document head, and a paragraph in a `<dl>` beside
 * "Purchase order" is a layout that has stopped working. The paragraph has
 * somewhere to go — `notes`, at the foot of the document, bounded below.
 */
export const MAX_PAYMENT_TERMS_LENGTH = 200

/**
 * The message at the foot of the document — payment details, thanks, terms.
 *
 * THREE TIMES `paymentTerms`, and the ratio is the argument. What actually goes
 * here is a bank block: account name, bank, account number, IBAN, SWIFT, an
 * intermediary bank for an international transfer, a reference line, and a
 * sentence of thanks under it. That is structurally a party block — a handful
 * of labelled lines printed verbatim — so 600 puts it within a character of
 * `MAX_PARTY_LENGTH` (601), and a product that lets someone paste a 601-
 * character address has no reason to give the account details beside it less
 * room.
 *
 * It is not an essay, and the cap is where it is so it cannot become one. A
 * `<textarea>` at the bottom of a document is exactly where a user would paste
 * a contract, and this field is the largest single term in the per-row byte
 * estimate `INVOICE_NUMBER_SCAN_LIMIT` divides ~3.0 MB by — see convex/lib/
 * scan.ts, where the division is redone with this term in it. That division has
 * ~300 B a row left over, so this bound could reach about 900 before
 * `INVOICE_NUMBER_SCAN_LIMIT` has to move; past that, MOVE IT rather than
 * restate the estimate.
 */
export const MAX_NOTES_LENGTH = 600

/**
 * WHICH FIELD A REFUSAL IS ABOUT, as data rather than as a sentence.
 *
 * The creation form sends the whole document in one mutation, so a refusal has
 * to be shown beside the field that caused it or the user is left rereading
 * eight controls for the one that is too long. The message already NAMES the
 * field in prose ("Keep the pay-to block under 601 characters"), and a client
 * matching on that prose is a client that breaks the day somebody improves the
 * wording — so the name travels in `meta.field` instead, spelled exactly as the
 * argument is.
 *
 * `meta` is already part of `TraceErrorData` (convex/lib/codes.ts) and is
 * additive: a caller that ignores it still gets the same code and the same
 * sentence it always did.
 */
type InvoiceField =
  | "billedTo"
  | "payTo"
  | "currency"
  | "issuedAt"
  | "dueAt"
  | "purchaseOrder"
  | "paymentTerms"
  | "notes"

/**
 * Trimmed at the ends, NEVER collapsed inside.
 *
 * The same rule and the same reason as `checkAddress` in clients.ts: a party
 * block is rendered verbatim on a document, so its internal newlines are the
 * block's shape, and a normaliser that tidied them would print a three-line
 * address on one line.
 *
 * `field` is absent for the two provenance strings `createFromRange` bounds:
 * those arrive from /reports' filter bar rather than from a control on the
 * form, so there is nothing for a refusal to point at.
 */
function checkText(raw: string, what: string, max: number, field?: InvoiceField): string {
  const trimmed = raw.trim()
  if (trimmed.length > max) {
    traceError(
      "TOO_LONG",
      `Keep the ${what} under ${max} characters.`,
      field === undefined ? undefined : { field }
    )
  }
  return trimmed
}

/**
 * A date, as a real instant.
 *
 * `v.number()` round-trips NaN and Infinity — the same fact `INVALID_RATE`
 * exists for. One NaN `issuedAt` sorts nowhere in `by_user_issued`, renders as
 * "Invalid Date" on the document, and is invisible until a client is holding
 * the PDF. There is no editor to correct it in, which is what turns a tidiness
 * check into the only thing standing between a typo and a permanent record.
 */
function checkInstant(value: number, what: string, field: InvoiceField): number {
  if (!Number.isFinite(value)) {
    traceError("INVALID_DATE", `That ${what} is not a date I can read.`, { field })
  }
  return value
}

/**
 * An emptied optional field is ABSENT, not "".
 *
 * `purchaseOrder`, `paymentTerms` and `notes` all print as nothing when unset,
 * and storing an empty string would be a second spelling of the same fact —
 * which is how a later `!== undefined` check quietly stops working.
 */
function orAbsent(value: string): string | undefined {
  return value === "" ? undefined : value
}

// ---------------------------------------------------------------------------
// createFromRange
// ---------------------------------------------------------------------------

/**
 * A search needle, and the id of the project it was typed beside.
 *
 * Both are stored on the invoice as provenance, so both are free strings on an
 * `invoices` row — which is the thing `INVOICE_NUMBER_SCAN_LIMIT` and
 * `INVOICE_LIST_LIMIT` (convex/lib/scan.ts) divide a byte budget by. Two more
 * unbounded columns there is that division silently ceasing to hold, which is
 * the failure mode both of those comments were written to prevent, so this is a
 * term in their arithmetic and not a tidiness rule.
 *
 * 100, the same bound a purchase order and a client's name get: far past any
 * phrase somebody types to narrow a fortnight's work, far past the ~32
 * characters a Convex id occupies, and short enough that neither field can
 * become the prose an invoice deliberately has no room for. A project id
 * cannot be typed at all, so its share of this is a guard against a
 * hand-written client rather than a limit a user can meet.
 */
export const MAX_SOURCE_TEXT_LENGTH = 100

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
  /*
   * THE FILTER BAR, and the reason /reports' promise is now literally true.
   *
   * Copied field for field from `entries.rangeBreakdown`'s own validators —
   * `projectId` three-state (null is "no filter", "" is "entries with no
   * project"), `text`, and the preset union spelled out rather than referenced,
   * because that query keeps its args private. They are handed straight to the
   * SAME `rangeBreakdownImpl` the page drew its figures with, so an invoice
   * bills the rows on screen rather than a superset of them.
   *
   * Without this the product deadlocked, and it took two live clients to
   * notice: an unfiltered range covering both is refused `MIXED_CLIENTS`, and
   * narrowing to one used to make the invoice describe rows the page was not
   * showing — so /reports disabled the button instead. Neither route raised an
   * invoice, while `MIXED_CLIENTS` itself said "filter to a single client".
   *
   * `billableOnly` is NOT here, and must not be. This mutation hard-codes it
   * true below: an invoice bills billable time only, which is a product rule
   * about what an invoice IS, not a view setting the page happens to be in.
   * Accepting it as an argument would make it look negotiable and would let a
   * caller raise an invoice for time nobody intends to charge for.
   */
  projectId: v.optional(v.union(v.string(), v.null())),
  text: v.optional(v.string()),
  presets: v.optional(
    v.array(
      v.union(v.literal("no-project"), v.literal("no-note"), v.literal("under-a-minute"))
    )
  ),

  /*
   * THE DOCUMENT ITSELF — asked once, on /invoices/new, and then frozen.
   *
   * An invoice is write-once, so these are not conveniences: they are the ONLY
   * moment this product has to learn who the document is billed to, who is to
   * be paid, and on what terms. Nothing in a range of time entries says any of
   * it, and there is no editor afterwards to fill a gap in.
   *
   * Every one is optional, and each absence has a stated meaning rather than a
   * blank: `billedTo` falls back to the range's own client (below), `currency`
   * to the account's setting, `issuedAt` to now and `dueAt` to thirty days
   * after it. The three that print as nothing when unset stay unset.
   *
   * Each is bounded on write by the constants above and each refusal names its
   * own field in `meta.field`, so the form can put the sentence beside the box
   * that earned it.
   *
   * WHAT IS DELIBERATELY ABSENT, since an args validator is a list of
   * permissions:
   *
   *   - `number`. It is minted here, one past the highest sequence this account
   *     has ever used, against the bounded uniqueness scan below. A caller able
   *     to name it is two documents claiming one id.
   *   - `taxes`, and every line. Lines are derived from the range — that is
   *     what this mutation IS — and a tax editor is not built.
   *   - `clientId`, `sourceFromMs`, `sourceToMs`, `unratedMsAtCreation`. These
   *     record where the figures came from and are computed here from the scan
   *     that produced them. Provenance a caller can assert is not provenance.
   */
  billedTo: v.optional(v.string()),
  payTo: v.optional(v.string()),
  purchaseOrder: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  notes: v.optional(v.string()),
  currency: v.optional(v.string()),
  issuedAt: v.optional(v.number()),
  dueAt: v.optional(v.number()),
}

/*
 * DERIVED from the validators above, never restated — the same device and the
 * same reason as `BreakdownArgs` in convex/entries.ts. The hand-written twin
 * this replaces would have compiled perfectly while the three fields just added
 * went unread by the handler, which is precisely the bug being fixed here.
 */
type CreateFromRangeArgs = ObjectType<typeof createFromRangeArgs>

const createFromRangeReturns = v.object({
  invoiceId: v.id("invoices"),
  /** How much billable time in the range had no rate at all and so is on
   *  NEITHER this invoice nor any line of it — see `unratedBillableMs` on
   *  `entries.rangeBreakdownImpl`. `BillPreview` on /invoices/new names this
   *  figure under the table, BEFORE the button is pressed — which is the only
   *  moment it can still be acted on, since an invoice is write-once. Read from
   *  the invoice's own
   *  `unratedMsAtCreation` on a replay — NEVER recomputed by re-scanning — so
   *  a retry reports the same figure the original response did. */
  unratedMs: v.number(),
  replayed: v.boolean(),
})

/**
 * Turns a filtered `/reports` range into a finished invoice: one line per
 * project, priced at that project's rate (or the account default), snapshot
 * against today's client — never against tomorrow's — and carrying whatever
 * the creation form was told about the document itself.
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
   * THE TYPED DOCUMENT, checked FIRST — before the range is scanned.
   *
   * Two reasons, and the second is the load-bearing one. A refusal a user can
   * act on should not cost a 2,000-row read, and more importantly the refusals
   * this mutation makes are ordered by how fixable they are: "your notes are
   * too long" points at a box on the form, while `RANGE_TOO_LARGE` and
   * `MIXED_CLIENTS` ask the user to go back to /reports and narrow something.
   * Checking the cheap, local mistakes first means the form never sends
   * somebody to another page over a paste accident.
   *
   * `undefined` is left `undefined` rather than defaulted here: what an absent
   * field means differs per field, and each default is applied at the point
   * where the value it falls back to is actually known.
   */
  const typedBilledTo =
    args.billedTo === undefined
      ? undefined
      : checkText(args.billedTo, "billed-to block", MAX_PARTY_LENGTH, "billedTo")
  const payTo =
    args.payTo === undefined
      ? ""
      : checkText(args.payTo, "pay-to block", MAX_PARTY_LENGTH, "payTo")
  const purchaseOrder =
    args.purchaseOrder === undefined
      ? undefined
      : orAbsent(
          checkText(
            args.purchaseOrder,
            "purchase order",
            MAX_PURCHASE_ORDER_LENGTH,
            "purchaseOrder"
          )
        )
  const paymentTerms =
    args.paymentTerms === undefined
      ? undefined
      : orAbsent(
          checkText(
            args.paymentTerms,
            "payment terms",
            MAX_PAYMENT_TERMS_LENGTH,
            "paymentTerms"
          )
        )
  /*
   * Trimmed at the ends and NEVER collapsed inside, by the same `checkText` the
   * party blocks use and for the same reason: this prints verbatim at the foot
   * of the document, so its internal newlines are the bank block's shape. A
   * normaliser that tidied them would print an account, an IBAN and a SWIFT
   * code as one run-on line on a document a client has to read a number off.
   */
  const notes =
    args.notes === undefined
      ? undefined
      : orAbsent(checkText(args.notes, "notes", MAX_NOTES_LENGTH, "notes"))
  /*
   * The two dates are checked independently and NOT against each other.
   *
   * A due date before an issue date is odd, and refusing it here would still be
   * wrong: "due on receipt" is a real arrangement, back-dating a document to
   * the day the work finished is ordinary, and a rule comparing the pair would
   * refuse some perfectly deliberate combinations of the two.
   *
   * Not refusing is not the same as saying nothing. The creation form draws a
   * non-blocking advisory under the due date whenever it precedes the invoice
   * date, recomputed from the values on screen — so the mistake is named BEFORE
   * the document is minted, which is the only moment it can still be fixed.
   */
  const typedIssuedAt =
    args.issuedAt === undefined
      ? undefined
      : checkInstant(args.issuedAt, "invoice date", "issuedAt")
  const typedDueAt =
    args.dueAt === undefined ? undefined : checkInstant(args.dueAt, "due date", "dueAt")
  if (args.currency !== undefined && !isValidCurrency(args.currency)) {
    // The same refusal `settings.update` makes, in the same words: the list is
    // `money.SUPPORTED_CURRENCIES`, which is the runtime's own codes narrowed
    // to the ones whose minor unit really is a hundredth.
    traceError(
      "INVALID_CURRENCY",
      `"${args.currency}" is not a currency Chroneli can use. Pick one from the list in Settings.`,
      { field: "currency" }
    )
  }

  /*
   * ONE filter, computed once, then both billed from and recorded.
   *
   * The same values go into `rangeBreakdownImpl` below and onto the invoice
   * row at the bottom — not two separately-derived copies — so the document's
   * account of which rows it billed cannot describe a different set from the
   * one it actually billed.
   *
   * `checkText` (the bound-and-trim above) refuses either string past
   * `MAX_SOURCE_TEXT_LENGTH`, without a `field` — these two arrive from
   * /reports' filter bar rather than from a control on the creation form, so
   * there is nothing to point a refusal at. Trimming changes
   * nothing about what matches: `matchesFilter` trims the needle itself, and a
   * project id has no whitespace to lose.
   *
   * Presets are deduplicated, which is what BOUNDS this field — there are three
   * of them, so a caller sending eight thousand copies of one chip stores three
   * elements at most. Deduplicating cannot change what is billed either: the
   * predicate ANDs the presets together, so a repeat is a no-op, and sorting
   * only makes two identical filters record identically.
   */
  const sourceText = checkText(args.text ?? "", "search filter", MAX_SOURCE_TEXT_LENGTH)
  const sourceProjectId =
    args.projectId === undefined || args.projectId === null
      ? null
      : checkText(args.projectId, "project filter", MAX_SOURCE_TEXT_LENGTH)
  const sourcePresets = [...new Set(args.presets ?? [])].sort()

  /*
   * The SAME `rangeBreakdownImpl` /reports draws, called with a MutationCtx.
   *
   * A second scan written here would be a second rounding rule, and the
   * invoice would disagree with the page the user raised it from — which is
   * the one disagreement this product cannot afford. The filter is threaded
   * through for the same reason one step further out: the page applies these
   * three fields to this same scan, so an invoice raised without them would
   * bill a strict superset of the rows the user was looking at.
   *
   * `billableOnly: true` is HARD-CODED and is not an argument. An invoice
   * bills billable time only — that is what an invoice is in this product, a
   * documented rule rather than whatever state the billable chip happened to
   * be in when the button was pressed.
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
      projectId: sourceProjectId,
      text: sourceText,
      presets: sourcePresets,
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
      // "A SINGLE PROJECT", not "a single client", which is what this sentence
      // used to say. There is no client filter on /reports — the picker is by
      // project — so the old advice named a control that does not exist, and
      // for as long as this mutation ignored the filter entirely it was worse
      // than imprecise: taking it disabled the button. Filtering to one project
      // is always followable and always yields a document billed to one client,
      // which is the property this refusal is protecting.
      traceError(
        "MIXED_CLIENTS",
        `This range covers two clients — "${a?.name ?? "one client"}" and ` +
          `"${b?.name ?? "another client"}" — and an invoice can only be billed ` +
          `to one. Narrow the dates or filter to a single project.`
      )
    }
  }

  const client = clientId === null ? null : await ctx.db.get(clientId)
  // SNAPSHOT text, not a join. Renaming a client afterwards must not rewrite
  // this invoice — `clientId` beside it is what still answers "show me
  // everything billed to Vessel Vanguard".
  //
  // `partyBlockOf` rather than the two lines it replaces: /invoices/new prefills
  // this exact block into the Billed to box, and a block assembled twice is a
  // form that shows one address and stores another.
  const snapshotBilledTo = client === null ? "" : partyBlockOf(client)
  /*
   * A SUPPLIED BLOCK WINS, including an empty one.
   *
   * The user is on a form that has already been prefilled with the block above
   * and is telling this mutation who the document is billed to; a fallback that
   * second-guessed them would put a client's address back onto an invoice they
   * had just cleared, permanently, with no editor to take it out again.
   *
   * `undefined` — the field never sent — is the only thing that falls back, and
   * that is what keeps a caller with no form (a script, a test) getting the
   * range's own client exactly as it always did.
   *
   * `clientId` beside it is unaffected either way: it records which client's
   * work this range touched, which is a fact about the scan rather than about
   * the text somebody typed.
   */
  const billedTo = typedBilledTo ?? snapshotBilledTo

  // `defaultRateCents` is typed for a `QueryCtx`; a `MutationCtx` satisfies it
  // structurally, the same fact that lets `rangeBreakdownImpl` above be called
  // unmodified — see that export's doc comment.
  const accountRateCents = await defaultRateCents(ctx, userId)

  /*
   * THE LINES, from the SHARED builder — the very function /invoices/new draws
   * its preview with.
   *
   * Not a loop written out here. This mutation mints a numbered document from a
   * preview the user has just read and agreed to, and a preview computed by a
   * second copy of these rules is a preview that can quietly disagree with what
   * gets stored. See convex/lib/invoiceLines.ts, which is where every rule this
   * used to spell out inline now lives, once.
   *
   * The BUCKETS are shared too, and that half is newer. They used to be
   * assembled here from `projectDocs` — the documents this handler fetched for
   * `clientId` — while the preview had to assemble its own from whatever it
   * could see. Two assemblies of one list is a second place for a rate to come
   * out different, so `billableBucketsOf` reads them off the breakdown's own
   * rows, which is the single answer both sides already hold. `projectDocs`
   * stays for the client check below, which is a question about ownership
   * rather than about money.
   */
  const lines = invoiceLineDrafts(
    billableBucketsOf(breakdown.projects),
    accountRateCents
  )

  /*
   * NO LINES IS NOT A DOCUMENT. Refused here, where it is still refusable.
   *
   * `invoiceLineDrafts` skips a bucket whose billable time has no rate — time
   * nobody priced is left off rather than guessed at — so a range with hours in
   * it but no project rate and no account default prices NOTHING and would be
   * inserted as a numbered invoice with zero lines and a $0.00 total. That is
   * the most likely first run of this feature, not an edge: tracked billable
   * time, no rate set anywhere.
   *
   * An invoice is write-once. There is no `remove`, nothing sets `deletedAt`,
   * and the number is spent the moment the row exists — so that document is
   * permanent, un-editable and un-deletable, and the account's next invoice is
   * numbered one past it. Every other permanent-document risk in this mutation
   * refuses rather than mints (`RANGE_TOO_LARGE`, `MIXED_CLIENTS`,
   * `INVOICE_HISTORY_TOO_LARGE`), and this is the same trade.
   *
   * SERVER-SIDE AS WELL AS ON THE PAGE, which is the half that makes it a rule.
   * /invoices/new disables its button for the same state in the same words, but
   * `createFromRangeAs` is reachable without that page and a hand-typed URL
   * reaches the mutation — a client-side guard on a permanent document is a
   * convenience, not a rule.
   *
   * It subsumes the empty range too: no entries means no buckets means no
   * lines, and "this would bill nothing" is the true thing to say about both.
   */
  if (lines.length === 0) {
    traceError(
      "NO_PRICED_TIME",
      "Nothing in this period has an hourly rate, so this invoice would have no lines and a $0.00 total. Set a rate on the project, or on the account in Settings, to bill it."
    )
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

  const issuedAt = typedIssuedAt ?? now

  const invoiceId = await ctx.db.insert("invoices", {
    userId,
    clientKey: args.clientKey,
    number,
    clientId,
    billedTo,
    // Empty rather than a guess when nobody said: nothing in a range of time
    // entries says who the freelancer is or wants to be paid as, and this
    // product has no pay-to setting to read one from. The creation form is
    // where that question gets asked.
    payTo,
    currency: args.currency ?? (await currencyOf(ctx, userId)),
    issuedAt,
    // Net 30, the most common freelance default — and a default rather than a
    // policy, which is why the form offers a date picker beside it. Counted
    // from the invoice's OWN issue date rather than from `now`, so a document
    // dated last week is due thirty days after it says it was raised.
    dueAt: typedDueAt ?? issuedAt + 30 * 24 * 60 * 60 * 1000,
    purchaseOrder,
    paymentTerms,
    notes,
    taxes: [],
    // Provenance only — NEVER read back to recompute anything. See the
    // schema comment on `sourceFromMs`/`sourceToMs`.
    sourceFromMs: args.fromMs,
    sourceToMs: args.toMs,
    // The rest of that same answer, under the same never-recompute rule: the
    // dates say WHEN, these three say WHICH ROWS. Written even when they are
    // the unfiltered defaults, so an absent field means "raised before this was
    // recorded" and never "raised from everything" — see the schema comment.
    // The very values the scan above ran with, not a second derivation of them.
    sourceProjectId,
    sourceText,
    sourcePresets,
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
      // `null` is how the shared builder spells the unassigned bucket — it is
      // pure and holds no Convex types (see convex/lib/invoiceLines.ts) — while
      // the column is `v.optional(v.id("projects"))`. One spelling of "no
      // project" per side of that boundary, converted at it.
      projectId: line.projectId === null ? undefined : (line.projectId as Id<"projects">),
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
