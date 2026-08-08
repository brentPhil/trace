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
 *     Edit day      -> START moves to the new date. DURATION is anchored, so
 *                      the end travels with it.
 *
 * The last one is the odd one out and has to be: it is the only edit where the
 * user is correcting WHEN the work happened rather than how long it took, and
 * it is the only one that cannot be expressed by the others. Routing "same
 * times, yesterday" through a start edit holds the end still, stretching the
 * entry across a day and tripping the 24-hour ceiling — a refusal on a gesture
 * that is not asking for anything unusual. Anchoring the duration also means a
 * date correction can never change what gets invoiced.
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
  /** `value` is the new START instant, already resolved against the target
   *  local date by the caller — that resolution needs a timezone and a DST
   *  policy, which live in convex/lib/day.ts, not here. */
  | { field: "day"; value: number }

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
    case "start": {
      // End is a fact the user did not touch. Duration follows.
      const result = entryTimes(edit.value, current.endedAt)
      return capEditedDuration(result)
    }

    case "end": {
      // Start is a fact the user did not touch. Duration follows. Giving a
      // running entry an end time is a stop, and it is the legitimate fix for
      // "I finished this twenty minutes ago and forgot to press stop".
      const result = entryTimes(current.startedAt, edit.value)
      return capEditedDuration(result)
    }

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

    case "day": {
      // A running entry has no length to carry, so the start simply moves.
      if (current.durationMs === null) return entryTimes(edit.value, null)

      // Carried, not recomputed from wall-clock arithmetic. Moving an entry
      // onto a day that springs forward would otherwise silently lose an hour
      // of billable time, and onto one that falls back would invent one.
      //
      // Deliberately NOT passed through capEditedDuration: the duration is
      // unchanged, so a runaway timer that legitimately ran for sixty hours
      // must stay movable. The ceiling exists for lengths a user types, and
      // nobody typed this one.
      return entryTimes(edit.value, edit.value + current.durationMs)
    }
  }
}

/**
 * The ceiling, applied to a result produced by editing a TIMESTAMP.
 *
 * The ceiling used to live only on the field literally named "duration", so a
 * mistyped year in the start field wrote a 584-day entry with no refusal —
 * into every day header, week total and export. All three edit fields are
 * user-entered, so all three are capped; `entryTimes` itself stays uncapped so
 * a genuinely-elapsed runaway timer can always be stopped.
 */
function capEditedDuration(result: TimesResult): TimesResult {
  if (!result.ok || result.times.durationMs === null) return result
  const entered = assertEnteredDuration(result.times.durationMs)
  return entered.ok ? result : entered
}

/**
 * Elapsed time for a running entry needs a clock, and this module has no
 * business owning one. Callers pass `now` explicitly.
 *
 * A completed entry reports its STORED durationMs rather than recomputing from
 * the timestamps. That is the field every total in the product sums, so the
 * number on the row and the number in the day header come from one place and
 * cannot disagree on screen. `entryTimes` is the sole writer, which is what
 * keeps the two consistent at rest.
 */
export function elapsedMs(times: EntryTimes, now: number): number {
  if (times.endedAt !== null) {
    return times.durationMs ?? times.endedAt - times.startedAt
  }
  // A non-finite clock yields zero, not NaN. NaN here would reach the
  // formatters and render "NaN:NaN:NaN" in place of the elapsed time.
  if (!Number.isFinite(now)) return 0
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
  // The last instant the entry occupies, not the first instant after it. Days
  // are half-open, so an entry ending exactly at local midnight belongs wholly
  // to the day it started in — flagging it would draw a continuation marker
  // into a day where it has zero time, contradicting the total directly above.
  return dayOf(times.startedAt) !== dayOf(times.endedAt - 1)
}
