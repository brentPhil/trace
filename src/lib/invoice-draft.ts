import { isTraceError } from "@shared/codes"
import { addDays, dayOf, startOfDay } from "@shared/day"
import { partyBlockOf } from "@shared/party"
import { SUMMARY_LABEL } from "@shared/labels"
import type { DayString } from "@shared/day"

/**
 * The document a person types on `/invoices/new`, before it is a document.
 *
 * An invoice is write-once, so this form is the ONLY moment the product has to
 * learn who a numbered document is billed to, who is to be paid, and on what
 * terms — there is no editor afterwards to fill a gap in. That makes the draft
 * worth its own pure module rather than eight `useState`s in a route: the
 * prefills are real decisions with reasons, and each one is a plain assertion
 * here instead of something only reachable by rendering a page.
 *
 * Everything is held as the STRING the control shows, including the two dates,
 * which are `DayString`s because that is what `<input type="date">` reads and
 * writes. Converting to instants happens once, on the way out (`draftArgs`), in
 * the user's STORED zone — never the browser's.
 */

/**
 * The fields `createFromRange` can refuse by name.
 *
 * Spelled exactly as the mutation's own arguments are, because that is what
 * arrives in `meta.field` — see the `InvoiceField` union in convex/invoices.ts.
 * A refusal that cannot be matched to a control is a refusal the user has to
 * find by rereading eight boxes.
 */
export const INVOICE_FIELDS = [
  "billedTo",
  "payTo",
  "purchaseOrder",
  "paymentTerms",
  "summaryDescription",
  "notes",
  "currency",
  "issuedAt",
  "dueAt",
] as const

export type InvoiceField = (typeof INVOICE_FIELDS)[number]

/** A refusal per field, from the one attempt that sent all of them. */
export type InvoiceFieldErrors = Partial<Record<InvoiceField, string>>

export type InvoiceDraft = {
  billedTo: string
  payTo: string
  purchaseOrder: string
  paymentTerms: string
  summaryDescription: string
  notes: string
  currency: string
  issuedOn: DayString
  dueOn: DayString
  mergeLines: boolean
}

/**
 * Which field a refusal is about, or null when it named none.
 *
 * `meta.field` rather than the message's prose: the sentence already names the
 * field for a human ("Keep the pay-to block under 601 characters"), and a client
 * matching on that prose breaks the day somebody improves the wording. Narrowed
 * against `INVOICE_FIELDS` so a code this build does not know falls through to
 * the page-level refusal rather than being dropped beside a control that is not
 * the one at fault.
 */
export function refusedField(error: unknown): InvoiceField | null {
  if (!isTraceError(error)) return null
  const field = error.data.meta?.field
  const known: ReadonlyArray<string> = INVOICE_FIELDS
  return typeof field === "string" && known.includes(field)
    ? (field as InvoiceField)
    : null
}

/**
 * Which refusal belongs to which control.
 *
 * The draft holds the two dates as DAYS — `issuedOn`, `dueOn` — because that is
 * what a date input reads and writes, while the mutation refuses them under the
 * instant names it takes them by, `issuedAt` and `dueAt`. Without this map a
 * refusal about the due date would arrive keyed to a field the form has no box
 * for, and it would render nowhere at all: silently, with the document
 * unraised and nothing on screen saying why.
 */
export const REFUSAL_FIELD_OF: Record<keyof InvoiceDraft, InvoiceField> = {
  billedTo: "billedTo",
  payTo: "payTo",
  purchaseOrder: "purchaseOrder",
  paymentTerms: "paymentTerms",
  summaryDescription: "summaryDescription",
  notes: "notes",
  currency: "currency",
  issuedOn: "issuedAt",
  dueOn: "dueAt",
  mergeLines: "summaryDescription",
}

/**
 * The one client a range's billable work belongs to, or null.
 *
 * MIRRORS the loop in `createFromRangeImpl` and is deliberately NOT the
 * authority on it: the server refuses `MIXED_CLIENTS` over the rows it will
 * actually bill, and it has to, because only it can name both clients. This
 * exists to decide one thing — whether there is a single, unambiguous block to
 * PREFILL into the Billed to box — and it answers null in exactly the two cases
 * where prefilling would be a guess: no client at all, and more than one.
 *
 * The same basis as the server's: every project with billable time in the
 * range, priced or not. An unrated project earns nothing, but the range still
 * genuinely touched that client's work, and a range spanning two clients is
 * exactly as ambiguous whether or not one side happens to have a rate yet.
 * A project with no client set does not count against it.
 */
export function singleClientId(
  buckets: ReadonlyArray<{ projectId: string | null; billableMs: number }>,
  clientIdOf: (projectId: string) => string | null
): string | null {
  let found: string | null = null
  for (const bucket of buckets) {
    if (bucket.billableMs === 0) continue
    if (bucket.projectId === null) continue
    const clientId = clientIdOf(bucket.projectId)
    if (clientId === null) continue
    if (found === null) found = clientId
    else if (found !== clientId) return null
  }
  return found
}

/**
 * NET 30, and it is a default rather than a policy.
 *
 * The same thirty days `createFromRange` falls back to when a caller sends no
 * `dueAt`, stated here as well because the form always sends one: the figure a
 * user sees in the box has to be the figure the mutation would have chosen, or
 * the default silently depends on whether a page was involved.
 */
export const DEFAULT_TERM_DAYS = 30

/**
 * The form as it opens: today, thirty days, the account's currency, and the
 * range's own client.
 *
 * WHAT IS PREFILLED AND WHAT IS NOT is the whole content of this function.
 *
 *   - `billedTo` comes from the client whose work the range touched, through
 *     the SAME `partyBlockOf` the mutation would snapshot — so the box shows
 *     exactly what would otherwise be written behind the user's back, where
 *     they can read it and change it. `null` when the range touches no client
 *     or more than one: a guess between two clients is the one prefill that
 *     could put a document in the wrong company's inbox.
 *   - `payTo` is EMPTY, and this is the field the form exists for. Nothing in a
 *     range of time entries says who the freelancer is, and this product has no
 *     pay-to setting to read one from. An invoice with no pay-to block tells a
 *     client nothing about where to send the money.
 *   - `issuedOn` is today IN THE STORED ZONE. A freelancer raising an invoice
 *     from an airport must not date it a day either side of what they think.
 *   - `dueOn` is thirty days after the ISSUE date rather than after today, so
 *     back-dating the document moves its due date with it.
 *
 * The three that print as nothing when unset — purchase order, payment terms,
 * notes — open empty, because an invented default there is a sentence the user
 * did not write appearing on a document they cannot edit afterwards.
 */
export function newInvoiceDraft(opts: {
  nowMs: number
  timeZone: string
  currency: string
  client: { name: string; address: string } | null
  mergeInvoiceLines: boolean
}): InvoiceDraft {
  const issuedOn = dayOf(opts.nowMs, opts.timeZone)
  return {
    billedTo: opts.client === null ? "" : partyBlockOf(opts.client),
    payTo: "",
    purchaseOrder: "",
    paymentTerms: "",
    summaryDescription: SUMMARY_LABEL,
    notes: "",
    currency: opts.currency,
    issuedOn,
    dueOn: addDays(issuedOn, DEFAULT_TERM_DAYS),
    mergeLines: opts.mergeInvoiceLines,
  }
}

/**
 * The draft, as the arguments `invoices.createFromRange` takes.
 *
 * EVERY FIELD IS SENT, including the empty ones, and that is deliberate. The
 * mutation treats `undefined` as "nobody said" and falls back — `billedTo` to
 * the range's client, `currency` to the account's — while an empty STRING is a
 * block the user cleared on purpose. This form has shown the user every one of
 * these values, so "nobody said" is no longer true of any of them, and a
 * fallback that put a client's address back onto an invoice they had just
 * emptied would be permanent.
 *
 * The dates go out as the FIRST INSTANT of the chosen day in the stored zone,
 * which is what makes `dayOf` on the way back out land on the same date the
 * picker showed. `startOfDay` is the one place that conversion lives.
 */
export function draftArgs(draft: InvoiceDraft, timeZone: string) {
  return {
    billedTo: draft.billedTo,
    payTo: draft.payTo,
    purchaseOrder: draft.purchaseOrder,
    paymentTerms: draft.paymentTerms,
    summaryDescription: draft.summaryDescription,
    notes: draft.notes,
    currency: draft.currency,
    issuedAt: startOfDay(draft.issuedOn, timeZone),
    dueAt: startOfDay(draft.dueOn, timeZone),
    mergeLines: draft.mergeLines,
  }
}

/**
 * Whether the due date precedes the invoice date — an ADVISORY, never a
 * refusal.
 *
 * `createFromRange` deliberately does not compare the two (see its comment):
 * "due on receipt" is a real arrangement and back-dating a document to the day
 * the work finished is ordinary, so a rule refusing the pair would refuse
 * perfectly deliberate combinations. Saying nothing was the other half of that
 * decision going wrong — nothing drew the relationship, so the mistake was only
 * visible to a reader who already knew to look, and there is no editor to fix
 * it in afterwards.
 *
 * Compared as DAYS, which is free here: the draft holds day strings, and
 * `"2026-09-04" < "2026-08-05"` is the right comparison for ISO dates.
 */
export function dueBeforeIssue(draft: InvoiceDraft): boolean {
  return draft.dueOn < draft.issuedOn
}
