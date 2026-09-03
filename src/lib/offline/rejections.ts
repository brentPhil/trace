import { traceErrorCode } from "@shared/codes"

/**
 * Convex's mutation promise does not reject for a lost network — it waits.
 * It rejects when the server refused. Almost every refusal is final (the
 * title was too long; the entry is gone), so the op is dropped and reported.
 * The one that is not: no session. That resolves itself when the token is
 * refreshed, and dropping recorded time for it would be the product's worst
 * failure.
 */
export function isRetryableRejection(error: unknown): boolean {
  return traceErrorCode(error) === "UNAUTHENTICATED"
}
