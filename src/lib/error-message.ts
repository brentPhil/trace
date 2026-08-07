import { isTraceError } from "@shared/codes"

/**
 * The sentence to show a person for a caught error.
 *
 * Trace errors already carry a message written for a human — that is the whole
 * point of the code/message pair — so it is used verbatim. Anything else is a
 * bug, a network failure, or a Convex internal, and none of those have a
 * message worth showing: they name internals, and a user reading "Uncaught
 * TypeError: e.map is not a function" beneath a time field learns nothing and
 * loses confidence in the number above it.
 */
export function errorMessage(error: unknown): string {
  if (isTraceError(error)) return error.data.message
  return "That didn't save. Try again."
}
