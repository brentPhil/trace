/**
 * The reconciliation rule.
 *
 * start, end and duration are over-determined: any two fix the third. Toggl
 * ships the choice of which one moves as a desktop *preference*, which is
 * evidence that a hidden rule confuses people — but a preference is worse,
 * because now the same gesture means different things on different machines.
 *
 * Trace has one rule, stated in the UI:
 *
 *     Timestamps are facts; duration is arithmetic.
 *
 *     Edit start    -> duration recomputes. End does not move.
 *     Edit end      -> duration recomputes. Start does not move.
 *     Edit duration -> END moves. Start is anchored.
 *     Edit duration on a RUNNING entry -> there is no end, so START moves.
 *
 * Never move a timestamp the user did not type. The caller anchors the
 * immovable field visually — with weight or a glyph, never a hue.
 *
 * This is also the sole writer of the time fields on an entry, which is what
 * makes the durationMs denormalisation safe: there is exactly one place where
 * `durationMs === endedAt - startedAt` can be violated, and it is here.
 *
 * Pure. No Convex imports, no DOM.
 */

import { MAX_DURATION_MS } from "./duration"

export type EntryTimes = {
  startedAt: number
  /** null means running. */
  endedAt: number | null
  /** null exactly when endedAt is null. */
  durationMs: number | null
}

export type TimeErrorCode =
  | "END_NOT_AFTER_START"
  | "INVALID_DURATION"
  | "DURATION_TOO_LONG"

export type TimesResult =
  | { ok: true; times: EntryTimes }
  | { ok: false; code: TimeErrorCode }

/**
 * Builds a consistent set of time fields, or refuses.
 *
 * Every mutation that writes startedAt or endedAt goes through this. A row that
 * did not come out of this function is a row whose duration might not match its
 * timestamps, and every total in the product sums that field.
 *
 * Note what is NOT checked here: the 24-hour ceiling. This function enforces
 * CONSISTENCY, not policy. A timer left running over a weekend produces a
 * 60-hour entry, and that is real recorded time — refusing it here would make
 * stop() fail, which means a timer that can never be stopped. The ceiling
 * applies to durations a user TYPES, and is enforced by parseDuration and by
 * assertEnteredDuration below.
 */
export function entryTimes(startedAt: number, endedAt: number | null): TimesResult {
  if (!Number.isFinite(startedAt)) return { ok: false, code: "INVALID_DURATION" }

  if (endedAt === null) {
    return { ok: true, times: { startedAt, endedAt: null, durationMs: null } }
  }

  if (!Number.isFinite(endedAt)) return { ok: false, code: "INVALID_DURATION" }
  if (endedAt <= startedAt) return { ok: false, code: "END_NOT_AFTER_START" }

  return { ok: true, times: { startedAt, endedAt, durationMs: endedAt - startedAt } }
}

/**
 * The policy ceiling, applied to a duration the user entered rather than one a
 * clock produced. Callers offer "longer than a day — split it?" rather than
 * treating this as an error.
 */
export function assertEnteredDuration(
  durationMs: number
): { ok: true } | { ok: false; code: TimeErrorCode } {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, code: "INVALID_DURATION" }
  }
  if (durationMs > MAX_DURATION_MS) return { ok: false, code: "DURATION_TOO_LONG" }
  return { ok: true }
}

export type TimeEdit =
  | { field: "start"; value: number }
  | { field: "end"; value: number }
  | { field: "duration"; value: number }

/**
 * Applies one field edit under the rule above.
 *
 * Takes the whole current time triple rather than individual fields so that the
 * "which one moves" decision can never be made by the caller, on either side of
 * the wire.
 *
 * `now` is only consulted for the one case that genuinely needs it: setting a
 * duration on a running entry, where the assertion being made is "this has been
 * running for N", and the only way to honour that is to move the start.
 */
export function applyTimeEdit(
  current: EntryTimes,
  edit: TimeEdit,
  now: number
): TimesResult {
  switch (edit.field) {
    case "start":
      // End is a fact the user did not touch. Duration follows.
      return entryTimes(edit.value, current.endedAt)

    case "end":
      // Start is a fact the user did not touch. Duration follows. Giving a
      // running entry an end time is a stop, and it is the legitimate fix for
      // "I finished this twenty minutes ago and forgot to press stop".
      return entryTimes(current.startedAt, edit.value)

    case "duration": {
      // A duration the user typed, so the policy ceiling applies here — unlike
      // in entryTimes, which only enforces consistency.
      const entered = assertEnteredDuration(edit.value)
      if (!entered.ok) return entered

      if (current.endedAt === null) {
        // No end exists to move, so the anchor has to be the other side. The
        // UI must say so — this is the same gesture with a different meaning,
        // and silently moving a start time would be exactly the kind of guess
        // "defensible by default" rules out.
        return entryTimes(now - edit.value, null)
      }

      // Start is anchored; the end moves.
      return entryTimes(current.startedAt, current.startedAt + edit.value)
    }
  }
}

/**
 * Elapsed time for a running entry needs a clock, and this module has no
 * business owning one. Callers pass `now` explicitly.
 */
export function elapsedMs(times: EntryTimes, now: number): number {
  if (times.endedAt !== null) return times.endedAt - times.startedAt
  return Math.max(0, now - times.startedAt)
}

/**
 * Whether an entry crosses local midnight, which the row renders with a
 * continuation marker. Attribution stays with the START day — the entry is not
 * split — and Split is the manual correction.
 */
export function crossesMidnight(
  times: EntryTimes,
  dayOf: (instantMs: number) => string
): boolean {
  if (times.endedAt === null) return false
  return dayOf(times.startedAt) !== dayOf(times.endedAt)
}
