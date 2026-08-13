import type { Entry } from "@/lib/group-entries"
import type { Id } from "../../convex/_generated/dataModel"

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
      /**
       * The tag union — see `tagUnion`. The parent's picker opens on this, and
       * what it writes goes to every member.
       */
      tagIds: Array<Id<"tags">>
      /**
       * Every member is billable.
       *
       * ALL, not any. The parent's `$` is a claim about the sitting, and a mark
       * meaning "some of these" is a mark that means nothing. A mixed group
       * reads unlit, and one click on the parent makes it uniform.
       */
      allBillable: boolean
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
 * Every distinct note in a sitting, oldest first, as one editable string.
 *
 * NOTHING IS RESOLVED BEHIND THE USER. A sitting whose members carry different
 * prose must never pick a winner on their behalf — the losing text is the one
 * thing PRODUCT.md says the product exists for. So every word goes on screen
 * and the user edits down to what they meant, which makes the first save of a
 * mixed group the only moment prose changes, and it changes in front of them.
 *
 * DISTINCT, not merely concatenated: the ordinary case is the same account
 * typed twice, and offering it back twice would be asking the user to tidy up
 * after a duplication they did not cause.
 *
 * Oldest first because that is the order the work happened in, and it is the
 * order a person rereading their own day expects to find it in — the input
 * array is newest-first, so this reverses it.
 *
 * CAN EXCEED THE SERVER'S `MAX_NOTE_LENGTH` (`convex/entries.ts`). Several
 * members each carrying a long note can join past the limit a single note is
 * held to, so the sheet can open on text the server will refuse with
 * `TOO_LONG` on save. Not truncated here on purpose — silently dropping the
 * user's own prose to fit is worse than a refusal they can see and edit down
 * from. The sheet's own error state is what surfaces that refusal.
 */
export function joinNotes(entries: Array<Entry>): string {
  const seen = new Set<string>()
  const notes: Array<string> = []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const note = (entries[index].note ?? "").trim()
    if (note === "" || seen.has(note)) continue
    seen.add(note)
    notes.push(note)
  }

  // A blank line between them, matching the paragraph break a note is written
  // with in the textarea — see `note-sheet.tsx` on Enter inserting a newline.
  return notes.join("\n\n")
}

/**
 * Every tag any member carries, in the order first met scanning oldest first.
 *
 * A UNION rather than an intersection, because the parent's picker opens on
 * this and then writes what it is given back to every member: an intersection
 * would silently strip a tag off the member that had it the moment the picker
 * was opened and closed.
 */
export function tagUnion(entries: Array<Entry>): Array<Id<"tags">> {
  const seen = new Set<string>()
  const tagIds: Array<Id<"tags">> = []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    for (const tagId of entries[index].tagIds) {
      if (seen.has(tagId)) continue
      seen.add(tagId)
      tagIds.push(tagId)
    }
  }

  return tagIds
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
    let allBillable = true
    let fromMs = first.startedAt
    let toMs = endOf(first)

    for (const member of members) {
      totalMs += member.durationMs ?? 0
      if (!member.billable) allBillable = false
      if (member.startedAt < fromMs) fromMs = member.startedAt
      const end = endOf(member)
      if (end > toMs) toMs = end
    }

    return {
      kind: "sitting",
      key,
      entries: members,
      totalMs,
      tagIds: tagUnion(members),
      allBillable,
      fromMs,
      toMs,
    }
  })
}
