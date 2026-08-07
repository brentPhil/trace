/**
 * The recap.
 *
 * The reason this product exists. A conventional tracker can only tell a client
 * that six hours happened; this assembles what those six hours WERE, from notes
 * the user already wrote, into something they can paste into a channel.
 *
 * Pure. No Convex, no DOM, no clock — the caller supplies the day's entries,
 * the projects they reference, and the two strings the user typed. That is what
 * makes the golden-output tests below possible, and it is why the recap body is
 * never stored: it is a function of its inputs, so storing it would create an
 * invalidation problem with a branch for every way an entry can change.
 *
 * The document is assembled once, here, and rendered twice (convex/lib/render).
 * Two renderers that each did their own grouping would eventually disagree
 * about what the user's day contained, which is the one thing they cannot do.
 */

import { formatCompactDuration } from "./duration"

export type RecapEntry = {
  id: string
  title: string
  note?: string
  projectId?: string
  startedAt: number
  durationMs: number
  billable: boolean
}

export type RecapProject = {
  id: string
  name: string
  color: string
}

export type BulletKind =
  /** One entry, one note. The good case. */
  | "noted"
  /** Titled entries with no note, summed. Never merged into a noted bullet. */
  | "title-only"
  /** Neither title nor note. Counted, never editorialised. */
  | "unlabelled"
  /** What the clipboard omits when the cap bites. */
  | "rollup"

export type RecapBullet = {
  kind: BulletKind
  text: string
  durationMs: number
  /** Every entry this bullet accounts for — the drill-down target. */
  entryIds: Array<string>
}

export type RecapBlock = {
  projectId: string | null
  projectName: string
  projectColor: string | null
  durationMs: number
  billableMs: number
  /** EVERY bullet. The panel shows these; the clipboard may show fewer. */
  bullets: Array<RecapBullet>
  /** How many of `bullets` the rendered text replaces with a rollup line. */
  omittedCount: number
  omittedMs: number
}

export type RecapDoc = {
  /** "YYYY-MM-DD" in the user's timezone. */
  day: string
  /** "Thu 6 Aug" — supplied, because formatting a date needs a locale. */
  dayLabel: string
  totalMs: number
  billableMs: number
  entryCount: number
  notedCount: number
  blocks: Array<RecapBlock>
  next?: string
  blocked?: string
  /**
   * Whether `blocked` was PREFILLED from a note rather than typed by the user.
   *
   * The UI has to be able to say which, and it cannot tell from the string.
   * Labelling something the user wrote as "suggested from your last note" is a
   * small lie that makes the whole prefill feel like the app editing them.
   */
  blockedIsSuggestion: boolean
}

/** Bullets the copied text is allowed to contain before rolling up. */
export const BULLET_CAP = 8

/** The label for work with no project. Not "Uncategorised", which scolds. */
export const NO_PROJECT = "No project"

// ---------------------------------------------------------------------------

/**
 * Builds the day's document.
 *
 * Grouped by PROJECT rather than chronologically, because a standup answers
 * "which client got what", not "what order did I do things in". The order
 * things happened is what the log is for.
 */
export function assembleRecap(input: {
  day: string
  dayLabel: string
  entries: Array<RecapEntry>
  projects: Array<RecapProject>
  next?: string
  blocked?: string
  blockedIsSuggestion?: boolean
}): RecapDoc {
  const byId = new Map(input.projects.map((p) => [p.id, p]))

  // No duration threshold anywhere in this function. A four-minute entry that
  // the user bothered to write a note on is often the most informative line in
  // the recap; short entries are handled by ORDERING, never by filtering.
  const grouped = new Map<string, Array<RecapEntry>>()
  for (const entry of input.entries) {
    const key = entry.projectId ?? ""
    const list = grouped.get(key)
    if (list === undefined) grouped.set(key, [entry])
    else list.push(entry)
  }

  const blocks: Array<RecapBlock> = []
  for (const [key, entries] of grouped) {
    const project = key === "" ? null : (byId.get(key) ?? null)
    blocks.push({
      projectId: key === "" ? null : key,
      // A project the caller did not supply still gets a block. Dropping it
      // would lose real hours from a document that sits beside an invoice.
      projectName: project?.name ?? NO_PROJECT,
      projectColor: project?.color ?? null,
      durationMs: sum(entries, (e) => e.durationMs),
      billableMs: sum(entries.filter((e) => e.billable), (e) => e.durationMs),
      bullets: buildBullets(entries),
      omittedCount: 0,
      omittedMs: 0,
    })
  }

  // Billable first. This is how an "admin" or "internal" bucket sorts to the
  // bottom without the product ever having to guess what those words mean.
  blocks.sort(
    (a, b) =>
      b.billableMs - a.billableMs ||
      b.durationMs - a.durationMs ||
      a.projectName.localeCompare(b.projectName)
  )

  applyCap(blocks)

  return {
    day: input.day,
    dayLabel: input.dayLabel,
    totalMs: sum(input.entries, (e) => e.durationMs),
    billableMs: sum(input.entries.filter((e) => e.billable), (e) => e.durationMs),
    entryCount: input.entries.length,
    notedCount: input.entries.filter((e) => hasNote(e)).length,
    blocks,
    next: blank(input.next),
    blocked: blank(input.blocked),
    blockedIsSuggestion:
      input.blockedIsSuggestion === true && blank(input.blocked) !== undefined,
  }
}

// ---------------------------------------------------------------------------

/**
 * One block's bullets.
 *
 * The load-bearing rule: entries sharing a title emit one bullet per NOTED
 * entry, plus at most one title-only bullet summing the un-noted ones.
 *
 * Un-noted time never folds into a noted bullet. It would be trivial to add the
 * silent 40 minutes to the line that has a sentence on it and produce a tidier
 * document — and that is exactly the wrong trade. The Hatch Rule exists so that
 * missing notes stay visible, and this separate line is the same pressure
 * carried into the artifact. Folding would make the recap look complete while
 * quietly attributing time to a description that does not cover it.
 */
function buildBullets(entries: Array<RecapEntry>): Array<RecapBullet> {
  const bullets: Array<RecapBullet> = []

  const unlabelled: Array<RecapEntry> = []
  // Insertion-ordered so that, with all else equal, bullets follow the order
  // the work happened in.
  const titleGroups = new Map<string, Array<RecapEntry>>()

  for (const entry of entries) {
    const title = entry.title.trim()
    if (!hasNote(entry) && title === "") {
      unlabelled.push(entry)
      continue
    }
    const list = titleGroups.get(title)
    if (list === undefined) titleGroups.set(title, [entry])
    else list.push(entry)
  }

  for (const [title, group] of titleGroups) {
    const unnoted: Array<RecapEntry> = []

    for (const entry of group) {
      if (hasNote(entry)) {
        bullets.push({
          kind: "noted",
          text: collapse(entry.note ?? ""),
          durationMs: entry.durationMs,
          entryIds: [entry.id],
        })
      } else {
        unnoted.push(entry)
      }
    }

    if (unnoted.length > 0) {
      // Verbatim, and indistinguishable from a noted bullet in the copied text.
      // Omitting it would lose billable time from a document that sits beside
      // an invoice; annotating it ("no note") would advertise the user's own
      // hygiene to their client. The pressure belongs in the app, not here.
      bullets.push({
        kind: "title-only",
        text: collapse(title),
        durationMs: sum(unnoted, (e) => e.durationMs),
        entryIds: unnoted.map((e) => e.id),
      })
    }
  }

  if (unlabelled.length > 0) {
    // Counted, visible, not editorialised.
    bullets.push({
      kind: "unlabelled",
      text: `${unlabelled.length} unlabelled ${unlabelled.length === 1 ? "entry" : "entries"}`,
      durationMs: sum(unlabelled, (e) => e.durationMs),
      entryIds: unlabelled.map((e) => e.id),
    })
  }

  const startOf = new Map<string, number>()
  for (const entry of entries) startOf.set(entry.id, entry.startedAt)

  bullets.sort(
    (a, b) =>
      b.durationMs - a.durationMs ||
      (startOf.get(a.entryIds[0]) ?? 0) - (startOf.get(b.entryIds[0]) ?? 0)
  )

  return bullets
}

/**
 * Decides which bullets the rendered text keeps.
 *
 * Every block keeps its top bullet, unconditionally and before any budget is
 * spent. A block reduced to nothing but "plus 4 more" would tell the reader a
 * project happened and refuse to say what — worse than omitting the project.
 *
 * The remaining budget is spent in document order, so the block that matters
 * most (billable first) is the one that stays complete.
 *
 * `bullets` is never truncated. The panel shows the whole day and states
 * exactly what the clipboard leaves out; the cap is a property of the copied
 * artifact, not of the user's record.
 */
function applyCap(blocks: Array<RecapBlock>): void {
  let budget = Math.max(0, BULLET_CAP - blocks.length)

  for (const block of blocks) {
    // One guaranteed, plus whatever is left.
    const take = Math.min(block.bullets.length, 1 + budget)
    budget -= Math.max(0, take - 1)

    const omitted = block.bullets.slice(take)
    block.omittedCount = omitted.length
    block.omittedMs = sum(omitted, (b) => b.durationMs)
  }
}

// ---------------------------------------------------------------------------

/** Markers that make a clause read as an obstacle rather than a report. */
const BLOCKED_MARKERS = /[?]|blocked|waiting|need/i

/**
 * Prefills `Blocked` from the day's last noted entry.
 *
 * Returns the SHORTEST clause-bounded suffix of that note containing a marker,
 * and always a contiguous verbatim substring of what the user wrote. Never a
 * paraphrase, never a stitched-together summary: this text goes into a channel
 * under the user's name, and a sentence they did not write appearing there
 * would be a betrayal of the only thing the product is asking them to trust.
 *
 * A prefill, not an answer. The caller puts it in an editable field.
 */
export function suggestBlocked(entries: Array<RecapEntry>): string | undefined {
  const noted = entries.filter((e) => hasNote(e))
  if (noted.length === 0) return undefined

  const last = noted.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a))
  const note = collapse(last.note ?? "")
  if (note === "") return undefined

  // Split on clause boundaries, KEEPING them, so the reassembled suffix is
  // character-for-character what the user typed. `?` is not a boundary — it is
  // a marker, and a question is the clause we want to keep whole.
  const parts = note.split(/(?<=[.;—])\s+/)

  for (let i = parts.length - 1; i >= 0; i--) {
    const suffix = parts.slice(i).join(" ").trim()
    if (BLOCKED_MARKERS.test(suffix)) return suffix
  }
  return undefined
}

// ---------------------------------------------------------------------------

function hasNote(entry: RecapEntry): boolean {
  return (entry.note ?? "").trim() !== ""
}

function sum<T>(items: Array<T>, of: (item: T) => number): number {
  let total = 0
  for (const item of items) total += of(item)
  return total
}

/**
 * Newlines become spaces.
 *
 * A note is prose and may well be several lines; a bullet is one line. Left
 * alone, an embedded newline breaks the list in Slack and silently turns the
 * rest of the note into a paragraph of its own.
 *
 * The user's own `*` characters are deliberately NOT touched — see render.ts.
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function blank(text: string | undefined): string | undefined {
  const trimmed = text?.trim() ?? ""
  return trimmed === "" ? undefined : trimmed
}

/** Shared by both renderers so a duration cannot be formatted two ways. */
export function recapDuration(ms: number): string {
  return formatCompactDuration(ms)
}
