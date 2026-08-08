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
  /** More than one running entry existed. Should be impossible; reported rather
   *  than swallowed, because the recovery path stops all of them and the user
   *  deserves to know their data was repaired. */
  | "INVARIANT_MULTIPLE_RUNNING"

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
export function isTraceError(error: unknown): error is { data: TraceErrorData } {
  if (typeof error !== "object" || error === null) return false
  const data: unknown = (error as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return false
  return typeof (data as { code?: unknown }).code === "string"
}

/** The error code of a caught value, or null if it is not a Trace error. */
export function traceErrorCode(error: unknown): TraceErrorCode | null {
  return isTraceError(error) ? error.data.code : null
}
