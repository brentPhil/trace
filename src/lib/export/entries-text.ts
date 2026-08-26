import { NO_PROJECT_LABEL } from "@shared/labels"
import { formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { NO_DESCRIPTION } from "@/lib/export/report-rows"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayGroup, Entry } from "@/lib/group-entries"
import type { DayString } from "@shared/day"

/**
 * The log as plain text, for the clipboard.
 *
 * THE FOURTH EXPORT, and the only one with no file attached to it. PDF, CSV and
 * XLSX all answer "send this to a client"; this answers "paste this somewhere
 * and write about it" — a standup note, a status update, a prompt handed to an
 * assistant that will summarise the week. That reader is a person or a language
 * model reading prose, not a spreadsheet parsing columns, which is why this is
 * the one export that keeps the NOTES and drops the money.
 *
 * IT DOES NOT GO THROUGH `reportRows`. The other three writers share it because
 * they draw the same aggregated document and must never disagree about a
 * percentage. This draws something else entirely: individual entries, in the
 * order and grouping the log already put them in on screen, so that what lands
 * on the clipboard is what the reader was looking at when they pressed the
 * button. Feeding it through an aggregate would silently copy a different set
 * of rows than the one on screen.
 *
 * PURE, and typed against `DayGroup` — which the caller has already filtered.
 * This function applies no filter of its own and must not: the whole promise of
 * the button is "copy exactly these rows", and a second opinion about which
 * rows those are is the one way it can break that promise.
 */

export type EntriesTextOptions = {
  timeZone: string
  use12Hour: boolean
  /** The user's own unit, so a copied duration reads like the screen it came
   *  from. DESIGN.md permits decimal on a single row in an EXPORT, and this is
   *  one — see `format-total.ts` for why a row on screen is different. */
  display: DurationDisplay
  projectName: (id: string | undefined) => string
  /**
   * The day bounds of what was copied, when the page has any.
   *
   * `null` on /timer's unbounded "All dates" log, which genuinely has no range
   * to name — the day headings below still carry every date, so nothing is
   * lost by leaving the line out rather than inventing bounds for it.
   */
  range: { from: DayString; to: DayString } | null
  /**
   * What narrowed the log BEYOND its range, in the words the filter bar uses.
   *
   * Stated because the copied text outlives the screen it came from: a week's
   * worth of rows pasted into a standup note looks like the whole week, and
   * three hours of it may have been hidden by a project filter set twenty
   * minutes ago. Empty when nothing but the range applies.
   */
  narrowing: ReadonlyArray<string>
}

/**
 * `Mon 25 Aug 2026` — every day heading, spelt out in full.
 *
 * NOT `dayLabel`'s "Today"/"Yesterday", which is right on screen and wrong the
 * moment the text leaves it. A note pasted into Slack on Tuesday morning about
 * "Today" is a note about Monday, and the reader has no way to tell. The year
 * is always present for the same reason: the clipboard has no context.
 *
 * Built the way `dayLabel` builds its own — a UTC instant at noon, far enough
 * from either boundary that no zone can shift the rendered weekday off the
 * date it was given.
 */
const dayHeadingFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
})

function dayHeading(day: DayString | string): string {
  const [year, month, date] = day.split("-").map(Number)
  /*
   * Reassembled from parts rather than taken from `format`, to drop the comma
   * en-GB puts after the weekday once a year is present: `Wed, 5 Aug 2026`.
   * `dayLabel` spells a day `Thu 6 Aug` — no comma — only because it asks for
   * no year, and the two are read side by side (the log on screen, the text
   * pasted out of it). One product, one way a date is written.
   */
  return dayHeadingFormatter
    .formatToParts(new Date(Date.UTC(year, month - 1, date, 12)))
    .filter((part) => part.type !== "literal")
    .map((part) => part.value)
    .join(" ")
}

/** `17 Aug – 23 Aug 2026`, or a single day on its own. En dash, like every
 *  other range this product prints. */
function rangeHeading(from: DayString, to: DayString): string {
  return from === to
    ? dayHeading(from)
    : `${dayHeading(from)} – ${dayHeading(to)}`
}

/**
 * One entry, as one line.
 *
 * THE VARIABLE-LENGTH FIELD IS LAST. Time, duration and project are fixed-shape
 * and come first, so every line's leading columns land in the same places and a
 * title containing a `·` cannot be mistaken for a field boundary. That is also
 * why the project is always printed, `No project` included: omitting the
 * segment when an entry has none would shift the title into the project's
 * position on some lines and not others, which is precisely the ambiguity a
 * separator-delimited line has to avoid.
 *
 * `endedAt`, not the running ellipsis — `DayGroup.entries` is completed rows
 * only, so `formatTimeRange`'s open-ended branch is unreachable from here.
 */
function entryLine(entry: Entry, options: EntriesTextOptions): string {
  const title = entry.title.trim() === "" ? NO_DESCRIPTION : entry.title.trim()
  const when = formatTimeRange(
    entry.startedAt,
    entry.endedAt,
    options.timeZone,
    options.use12Hour
  )
  const project = options.projectName(entry.projectId) || NO_PROJECT_LABEL

  return `- ${when} · ${formatTotal(entry.durationMs ?? 0, options.display)} · ${project} · ${title}`
}

/**
 * A note under the entry it belongs to, every line of it indented.
 *
 * NOT CLIPPED, unlike the log's one-line default: `notesExpanded` is a screen
 * affordance for scanning, and the note is the single most valuable thing on
 * the clipboard — it is the only field that says what actually happened, which
 * is the whole reason to paste this into a standup.
 *
 * Indented rather than prefixed with a marker so the note reads as prose
 * belonging to the line above it. A blank line inside a multi-paragraph note
 * stays blank rather than becoming two indent characters and nothing else.
 */
function noteLines(note: string): Array<string> {
  return note
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `    ${line.trimEnd()}`))
}

export function entriesText(
  groups: ReadonlyArray<DayGroup>,
  options: EntriesTextOptions
): string {
  const lines: Array<string> = []

  /*
   * THE TOTAL IS SUMMED FROM THE ROWS PRINTED BELOW, never from
   * `DayGroup.totalMs`.
   *
   * They disagree on purpose and the disagreement reaches here: a day's
   * `totalMs` includes a running entry's elapsed time, while `entries` — the
   * rows this writes — deliberately excludes it. Carrying the group's own
   * total across would put a heading above a list of rows that visibly do not
   * add up to it, in a document whose reader cannot check it against the
   * screen. So every figure here is the sum of exactly what was written.
   */
  const days = groups
    .filter((group) => group.entries.length > 0)
    .map((group) => ({
      group,
      totalMs: group.entries.reduce(
        (sum, entry) => sum + (entry.durationMs ?? 0),
        0
      ),
    }))

  const count = days.reduce((n, day) => n + day.group.entries.length, 0)
  const totalMs = days.reduce((ms, day) => ms + day.totalMs, 0)

  lines.push(
    options.range === null
      ? "Time entries"
      : `Time entries · ${rangeHeading(options.range.from, options.range.to)}`
  )
  lines.push(
    `${count} ${count === 1 ? "record" : "records"} · ${formatTotal(totalMs, options.display)}`
  )
  if (options.narrowing.length > 0) {
    lines.push(`Filtered by: ${options.narrowing.join(", ")}`)
  }

  for (const { group, totalMs: dayMs } of days) {
    lines.push("")

    /*
     * A running entry is COUNTED IN THE SENTENCE AND NOT IN THE FIGURES.
     *
     * It has no duration yet, so there is nothing honest to add to the day's
     * total and no end time to print — but it is work in progress, and work in
     * progress is exactly what a standup note is about. Saying so is the only
     * way the reader learns that the day has one more thing in it than the
     * lines below show. /reports drops running entries before grouping, so
     * this only ever fires on /timer.
     */
    const running =
      group.runningCount === 0
        ? ""
        : ` (${group.runningCount} still running, not counted)`
    lines.push(
      `${dayHeading(group.day)} — ${formatTotal(dayMs, options.display)}${running}`
    )

    for (const entry of group.entries) {
      lines.push(entryLine(entry, options))
      const note = (entry.note ?? "").trim()
      if (note !== "") lines.push(...noteLines(note))
    }
  }

  // A trailing newline, so pasting this above existing text does not weld the
  // last note to whatever follows it.
  return `${lines.join("\n")}\n`
}
