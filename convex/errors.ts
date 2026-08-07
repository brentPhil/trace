import { ConvexError } from "convex/values"
import type { TraceErrorCode, TraceErrorData } from "./lib/codes"

/**
 * Throws a Trace error.
 *
 * Return type is `never` so callers can use it as the last statement of a
 * branch without TypeScript losing the narrowing — `if (!row) traceError(...)`
 * leaves `row` non-null afterwards.
 *
 * The vocabulary lives in convex/lib/codes.ts, which the client imports; this
 * file is the only place that constructs one, and it is server-side because
 * `ConvexError` comes from `convex/values`.
 */
export function traceError(
  code: TraceErrorCode,
  message: string,
  meta?: TraceErrorData["meta"]
): never {
  const data: TraceErrorData = meta === undefined ? { code, message } : { code, message, meta }
  throw new ConvexError(data)
}
