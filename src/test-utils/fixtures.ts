import type { EntryActions } from "@/hooks/use-entry-actions"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * The documents the route tests render against.
 *
 * These were copy-pasted across `-timer.test.tsx`, `-reports.test.tsx` and
 * `-projects.test.tsx`. `SETTINGS` in particular is a whole `settings.get`
 * document, and a route that reads a field missing from it fails with an
 * unrelated-looking suspense error rather than "you forgot `currency`" — so
 * three copies meant every new settings field was three edits, any one of
 * which could be missed.
 */

/** A Wednesday, mid-week: the instant the route tests pin `Date.now` to. */
export const NOW = Date.parse("2026-08-05T12:00:00.000Z")

/** Everything `api.settings.get` answers with. */
export const SETTINGS = {
  timezone: "UTC",
  weekStartDay: 1,
  durationDisplay: "hms" as const,
  timeFormat: "24" as const,
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: false,
  currency: "USD",
  pdfIncludeNotes: false,
}

/**
 * "This component may not write anything."
 *
 * Empty rather than a set of spies, deliberately: a case that renders with this
 * and then reaches one of the actions throws a TypeError naming the verb, which
 * is a better failure than a silent no-op that lets a test claim a control
 * works. A case that means to assert on a write states its own spies.
 */
export const noEntryActions = {} as EntryActions

/** A one-hour completed entry starting at `NOW`. */
export function makeEntry(
  overrides: Partial<Doc<"timeEntries">> = {}
): Doc<"timeEntries"> {
  return {
    _id: "entry" as unknown as Id<"timeEntries">,
    _creationTime: NOW,
    userId: "user-1",
    clientKey: "client-1",
    title: "Untitled entry",
    note: undefined,
    startedAt: NOW,
    endedAt: NOW + 3_600_000,
    durationMs: 3_600_000,
    projectId: undefined,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

/**
 * The minimal entry the `matches` predicate is exercised against, by
 * `history-filters.test.ts` and by `filter-controls.test.tsx` — which feed the
 * same predicate and so must not disagree about what an unremarkable entry
 * looks like.
 *
 * Deliberately NOT `makeEntry`: `matches` reads title, note, project and
 * duration and nothing else, so the fixture states only those. Times are 0/1
 * to make it obvious that no date filtering happens here — the range is
 * applied server-side, before `matches` ever sees a row.
 */
export function filterEntry(
  over: Partial<Doc<"timeEntries">> = {}
): Doc<"timeEntries"> {
  return {
    _id: "e1" as unknown as Id<"timeEntries">,
    _creationTime: 0,
    userId: "u",
    clientKey: "k",
    title: "Work",
    startedAt: 0,
    endedAt: 1,
    durationMs: 3_600_000,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}
