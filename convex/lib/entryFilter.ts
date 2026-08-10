/**
 * Which entries a set of filters keeps.
 *
 * ONE predicate, on both sides of the wire. Reports puts a single FilterBar
 * above two tabs — a Summary built from a server-side aggregate and a Detailed
 * log filtered on the client over loaded pages — and those two tabs answer the
 * same question about the same rows. A second copy of this rule is how they
 * come to disagree: the charts would say six hours on a project and the list
 * beneath them would show five, with nothing on screen to say which is wrong.
 *
 * The date range is deliberately NOT here. It is an index prefix, applied by
 * the query before a row is ever read, and expressing it as a predicate would
 * invite someone to scan a year to answer a question about a week.
 *
 * Pure. No Convex imports, no DOM — the same rule as convex/lib/day.ts, and for
 * the same reason.
 */

export type Preset = "no-project" | "no-note" | "under-a-minute"

export const PRESETS: ReadonlyArray<Preset> = [
  "no-project",
  "no-note",
  "under-a-minute",
]

/**
 * The filters that do not depend on a bounded range.
 *
 * `projectId` is a three-state field and the third state is the interesting
 * one: `null` means "no project filter", `""` means "entries with NO project",
 * and an id means that project. Reports offers "No project" as a real choice in
 * the picker, so the sentinel has to be expressible.
 */
export type EntryFilter = {
  projectId: string | null
  billableOnly: boolean
  text: string
  presets: ReadonlyArray<Preset>
}

/**
 * Just enough of an entry to decide, rather than `Doc<"timeEntries">`.
 *
 * The server passes real documents and the client passes real documents, but
 * naming the whole document here would drag the generated data model into a
 * file that must stay importable from both runtimes. Structural typing means
 * both callers still pass their documents unchanged.
 */
export type FilterableEntry = {
  title: string
  note?: string
  projectId?: string
  billable: boolean
  /** null means running — see the `under-a-minute` branch below. */
  durationMs: number | null
}

/** Nothing is filtered out, so a caller can skip the scan entirely. */
export function isFilterActive(filter: EntryFilter): boolean {
  return (
    filter.projectId !== null ||
    filter.billableOnly ||
    filter.presets.length > 0 ||
    filter.text.trim() !== ""
  )
}

/**
 * Whether an entry survives the filters.
 *
 * `projectName` resolves an entry's project id to a name for the text search.
 * Passed in rather than looked up, because the two callers hold that mapping in
 * completely different shapes — a `Map` the client already has loaded, and a
 * per-query cache of Convex documents on the server — and neither should have
 * to adopt the other's.
 */
export function matchesFilter(
  entry: FilterableEntry,
  filter: EntryFilter,
  projectName: (id: string | undefined) => string
): boolean {
  if (filter.projectId !== null) {
    // "" is the sentinel for "no project", so the filter can express it.
    const want = filter.projectId === "" ? undefined : filter.projectId
    if (entry.projectId !== want) return false
  }

  if (filter.billableOnly && !entry.billable) return false

  for (const preset of filter.presets) {
    if (preset === "no-project" && entry.projectId !== undefined) return false
    if (preset === "no-note" && (entry.note ?? "").trim() !== "") return false
    if (preset === "under-a-minute") {
      // A RUNNING entry has no duration yet, and `?? 0` made every one of them
      // match — so the chip meant to surface accidental mis-starts surfaced the
      // timer the user was actively running, however long it had been going.
      if (entry.durationMs === null) return false
      // Strictly under. The chip exists to find a timer begun and stopped by
      // accident, and an exact 60s entry is not one.
      if (entry.durationMs >= 60_000) return false
    }
  }

  const needle = filter.text.trim().toLowerCase()
  if (needle !== "") {
    // Title, note AND project name. Searching only the title would miss the
    // field this product exists to collect.
    const haystack = [entry.title, entry.note ?? "", projectName(entry.projectId)]
      .join(" ")
      .toLowerCase()
    if (!haystack.includes(needle)) return false
  }

  return true
}
