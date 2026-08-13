import type { Entry } from "@/lib/group-entries"

/**
 * One line of the log: an entry on its own, or several of them behind a count.
 *
 * A DISCLOSURE, NEVER A MERGE. Nothing here is stored, nothing is rewritten,
 * and every member stays individually present and individually editable one
 * click away. That distinction is the whole reason grouping is allowed to exist
 * in a product whose stated rule is that it "never silently rounds, merges, or
 * guesses on the user's behalf" — see
 * docs/superpowers/specs/2026-08-13-grouped-entries-design.md.
 */
export type LogItem =
  | { kind: "row"; entry: Entry }
  | {
      kind: "sitting"
      /** `title\0projectId`. Stable, and the state key the log expands on. */
      key: string
      /** Two or more, newest first. A one-member sitting is never built. */
      entries: Array<Entry>
      totalMs: number
      /** How many members carry prose — the parent's "n of m noted". */
      notedCount: number
      /** Earliest start. */
      fromMs: number
      /**
       * Latest end.
       *
       * `toMs - fromMs` CAN EXCEED `totalMs`, by the size of the gaps between
       * members, and that is a recorded decision rather than a defect: the span
       * answers "when in the day was this", and `totalMs` is the only figure
       * that ever reaches an invoice.
       */
      toMs: number
    }

/*
 * NUL, for the same reason `rangeBreakdownImpl` uses it in convex/entries.ts:
 * the first segment is a user-supplied title that may contain any printable
 * character, so `:` or `|` as a separator lets one title impersonate another.
 */
const SEP = "\u0000"

/** The two fields that decide whether two entries are the same work. */
export function sittingKey(entry: Entry): string {
  return `${entry.title.trim()}${SEP}${entry.projectId ?? ""}`
}

/**
 * Total even though `groupByDay` only ever hands this completed rows — a
 * function that reads `endedAt!` is one refactor away from being wrong.
 */
function endOf(entry: Entry): number {
  return entry.endedAt ?? entry.startedAt + (entry.durationMs ?? 0)
}

/**
 * One day's entries, with repeats of a title+project folded behind a count.
 *
 * Input is the array `groupByDay` produces: completed entries, newest first.
 * Output preserves that order — a sitting takes the position of its NEWEST
 * member, so every row that is not part of a group stays exactly where it was.
 *
 * Two rules here are decisions rather than mechanism, and both are deliberate:
 *
 *   - A key with ONE member emits `kind: "row"`. A count badge beside a single
 *     entry is a claim about a group that does not exist, and it means a day of
 *     unique titles renders byte-identical to the log this replaces.
 *
 *   - An UNTITLED entry never groups. Two blank-titled entries on one project
 *     would collapse behind an empty label, hiding two separate pieces of
 *     unaccounted work under nothing at all — the opposite of what the log is
 *     for.
 */
export function toLogItems(entries: Array<Entry>): Array<LogItem> {
  const buckets: Array<{ key: string; entries: Array<Entry> }> = []
  const indexByKey = new Map<string, number>()

  for (const entry of entries) {
    if (entry.title.trim() === "") {
      // Its own bucket, never registered in the map, so it can never be joined.
      buckets.push({ key: "", entries: [entry] })
      continue
    }

    const key = sittingKey(entry)
    const at = indexByKey.get(key)
    if (at === undefined) {
      indexByKey.set(key, buckets.length)
      buckets.push({ key, entries: [entry] })
    } else {
      buckets[at].entries.push(entry)
    }
  }

  return buckets.map(({ key, entries: members }) => {
    const first = members[0]
    if (members.length === 1) return { kind: "row", entry: first }

    let totalMs = 0
    let notedCount = 0
    let fromMs = first.startedAt
    let toMs = endOf(first)

    for (const member of members) {
      totalMs += member.durationMs ?? 0
      if ((member.note ?? "").trim() !== "") notedCount += 1
      if (member.startedAt < fromMs) fromMs = member.startedAt
      const end = endOf(member)
      if (end > toMs) toMs = end
    }

    return { kind: "sitting", key, entries: members, totalMs, notedCount, fromMs, toMs }
  })
}
