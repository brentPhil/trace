/**
 * The error vocabulary, shared by the Convex functions that throw and the
 * client code that reacts.
 *
 * Deliberately in convex/lib and deliberately free of imports: the client needs
 * these strings to decide what to render, and it cannot import anything that
 * pulls in `convex/server`. The thrower lives in convex/errors.ts.
 */

export type TraceErrorCode =
  /** No signed-in user. Already thrown by requireUser in convex/auth.ts. */
  | "UNAUTHENTICATED"
  /** The row does not exist, is deleted, or belongs to someone else. These are
   *  deliberately one code: distinguishing them would leak whether a given id
   *  exists for another user. */
  | "NOT_FOUND"
  /** A duration that is zero, negative, or not a number. */
  | "INVALID_DURATION"
  /** An end at or before its start. */
  | "END_NOT_AFTER_START"
  /** A single entered duration longer than a day. Offers a split, not an error. */
  | "DURATION_TOO_LONG"
  /** More than the per-entry tag cap. */
  | "TOO_MANY_TAGS"
  /** A project or tag cannot be deleted while live entries reference it. This
   *  is what keeps an old invoice reproducible: a dangling reference cannot
   *  occur, so entries need no denormalised project-name snapshot. */
  | "IN_USE"
  /** Text past its stored limit. */
  | "TOO_LONG"
  /** A one-off data migration has not finished, so the index the operation
   *  would consult does not yet cover all of history. Distinct from IN_USE
   *  because it says nothing about the row the user asked about — reading it as
   *  "in use" would send them looking for entries that do not exist. */
  | "NOT_READY"
  /** A timezone string this runtime cannot resolve. */
  | "INVALID_TIMEZONE"
  /** A week start outside 0-6. Its own code rather than borrowing
   *  INVALID_TIMEZONE: both arrive from the same settings form, and a caller
   *  branching on the code would send someone to fix their timezone over a
   *  number that has nothing to do with one. */
  | "INVALID_WEEK_START"
  /** A currency code the runtime's formatter cannot resolve. */
  | "INVALID_CURRENCY"
  /** An hourly rate that is not a whole, non-negative, plausible number of
   *  minor units. Its own code rather than INVALID_CURRENCY: both come from
   *  money handling, but one is about which currency and the other is about
   *  the amount, and a caller branching on the code would otherwise send
   *  someone to /settings to fix a currency that is perfectly fine. NaN is the
   *  case that earns this: `v.number()` round-trips non-finite doubles, and one
   *  stored NaN rate renders every OTHER project's money as "$NaN" too. */
  | "INVALID_RATE"
  /** A selected invoice logo is missing, too large, or not PNG/JPEG. */
  | "INVALID_LOGO"
  /** More than one running entry existed. Should be impossible; reported rather
   *  than swallowed, because the recovery path stops all of them and the user
   *  deserves to know their data was repaired. */
  | "INVARIANT_MULTIPLE_RUNNING"
  /** A bulk import was handed no rows. Refused rather than treated as a no-op:
   *  the only way to send an empty batch is a caller whose parse produced
   *  nothing, and reporting "imported 0" as success is how a broken importer
   *  gets shipped. */
  | "EMPTY_IMPORT"
  /** A bulk operation over existing rows — e.g. updateMany — was given an
   *  empty id list. Its own code rather than EMPTY_IMPORT: that code's doc
   *  and callers are about a parse that produced nothing, but this caller
   *  already has real rows in hand and simply passed none of them, so a
   *  reader chasing "imported 0" from this error would land in the wrong
   *  feature entirely. */
  | "EMPTY_SELECTION"
  /** An import asked for a project with a blank name. Distinct from TOO_LONG:
   *  the name came from a file rather than a field, so there is no input to
   *  send anyone back to. */
  | "INVALID_PROJECT_NAME"
  /** A range too large for `rangeBreakdownImpl` to total exactly. Refused
   *  outright rather than invoiced as a floor: every figure on a truncated
   *  /reports is a floor, and a floor on an invoice under-bills a client by an
   *  unknown amount with nothing on the document to reveal it. */
  | "RANGE_TOO_LARGE"
  /** A range whose billable time touches more than one client's projects.
   *  Refused rather than merged: silently combining them bills one company
   *  for another company's work, on one document, with one total. */
  | "MIXED_CLIENTS"
  /** A date that is not a finite instant. Its own code for the reason
   *  INVALID_RATE has one: `v.number()` round-trips NaN, and one NaN
   *  `issuedAt` sorts nowhere in `by_user_issued` and prints as "Invalid Date"
   *  on a document nobody re-reads before sending. */
  | "INVALID_DATE"
  /** Too many invoices exist to prove what the next number's sequence should
   *  be — see INVOICE_NUMBER_SCAN_LIMIT in convex/lib/scan.ts. Refused rather
   *  than guessed: a wrong number here means two documents claiming the same
   *  invoice id, which is worse than refusing to mint one. */
  | "INVOICE_HISTORY_TOO_LARGE"
  /** The range priced NO lines at all — every bucket in it is either empty or
   *  unrated, so the document would carry a $0.00 total and nothing to justify
   *  it. Refused rather than minted, because an invoice is write-once: there is
   *  no `remove` and nothing sets `deletedAt`, so a zero-line document is
   *  permanent, un-editable, un-deletable, and has spent a sequence number. The
   *  same trade `RANGE_TOO_LARGE` and `MIXED_CLIENTS` make — every other
   *  permanent-document risk in this feature refuses rather than mints. */
  | "NO_PRICED_TIME"
  /** No Google account is linked, so there is nothing to sync or list. Its own
   *  code rather than NOT_FOUND: the caller's recovery is "connect Google",
   *  which is a button, not a missing row. */
  | "GOOGLE_NOT_CONNECTED"
  /** Google refused the stored refresh token — the user revoked access, or the
   *  grant expired. Distinct from GOOGLE_NOT_CONNECTED because the account IS
   *  linked and the recovery is to consent again rather than to connect; a
   *  caller branching on the code would otherwise offer to link an account that
   *  is already there. */
  | "GOOGLE_REAUTH_REQUIRED"

export type TraceErrorData = {
  code: TraceErrorCode
  message: string
  /** Optional payload — e.g. the id of the row that blocked a delete. */
  meta?: Record<string, string | number | boolean>
}

/**
 * Narrows an unknown caught value to a Trace error.
 *
 * Structural rather than `instanceof ConvexError`, so the client can use it
 * without importing anything from Convex, and so it survives the error being
 * serialised across the wire.
 */
export function isTraceError(
  error: unknown
): error is { data: TraceErrorData } {
  if (typeof error !== "object" || error === null) return false
  const data: unknown = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return false
  return typeof (data as { code?: unknown }).code === "string"
}

/** The error code of a caught value, or null if it is not a Trace error. */
export function traceErrorCode(error: unknown): TraceErrorCode | null {
  return isTraceError(error) ? error.data.code : null
}
