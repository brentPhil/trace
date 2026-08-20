import type { Preset } from "@shared/entryFilter"

/**
 * `/invoices/new`'s search params: which range, and which filter over it.
 *
 * THE FIRST ROUTE IN THIS APP TO TAKE ANY, so this is the pattern the next one
 * copies. The whole of it is one pure function that TanStack calls as
 * `validateSearch`, and the one decision worth writing down is that it NEVER
 * THROWS.
 *
 * It could. `validateSearch` is allowed to, and the router catches it, records
 * a `SearchParamError` against the match and renders the route's error
 * component (see `router-core`'s `matchRoutes`). But look at what is actually
 * on the other end of a bad one: a link a user pasted to a colleague with the
 * `to` truncated, a bookmark from before a param was renamed, an editor that
 * ate a `&`. The honest answer to all three is the page, doing the most
 * conservative thing it can, saying which period it settled on — not an error
 * screen for a page that has no state to lose and nothing to be sorry about.
 *
 * So every field is optional and anything unreadable is DROPPED rather than
 * corrected or objected to. What an absent field then means is decided at
 * `/invoices/new`, where the user's timezone is known: no range means the
 * current week, and the page says so above the figures it draws from it. That
 * split is deliberate — a validator that reached for settings to invent a
 * default would be a validator that cannot be unit-tested, and the value it
 * invented would then be written into the URL as though the user had chosen it.
 *
 * Pure and framework-free: nothing here imports the router, which is what lets
 * every rule below be a plain assertion in invoice-search.test.ts.
 */

/** The three chips /reports offers, as the URL spells them. Narrowed against
 *  the shared `Preset` union so a fourth chip cannot be added there and
 *  silently ignored here. */
const PRESETS: ReadonlyArray<Preset> = ["no-project", "no-note", "under-a-minute"]

export type InvoiceSearch = {
  /** Inclusive start of the billed range, as a UTC instant. Present only
   *  together with `to` — see `readRange`. */
  from?: number
  /** Exclusive end, matching `rangeOf`'s half-open window. */
  to?: number
  /**
   * THREE-STATE, and the third state is why this is `string | undefined`
   * rather than a bare id: absent is "no project filter" and `""` is "entries
   * with NO project" (`NO_PROJECT_FILTER` in convex/lib/entryFilter.ts). The
   * server's own `projectId` arg spells the first of those `null`; the URL
   * spells it by leaving the key off, which is what keeps an unfiltered link
   * free of `?projectId=null`.
   */
  projectId?: string
  text?: string
  presets?: Array<Preset>
}

/**
 * Both ends of the range, or neither.
 *
 * NEVER ONE. A `from` with an unreadable `to` is not "half a period" — it is a
 * period whose end the page would have to invent, and an invoice raised over an
 * invented end bills a client for a span nobody chose. Dropping both falls back
 * to a range the page STATES, which is a guess the reader can see and correct.
 *
 * `to < from` is dropped for the same reason and not silently swapped: a
 * reversed pair is a caller that has confused its own arguments, and quietly
 * reversing them bills whatever that confusion happened to produce.
 *
 * Non-finite is checked explicitly because `Number("")` is 0, `Number(null)` is
 * 0 and `Number("12abc")` is NaN — the first two are the shapes an empty param
 * arrives as, and a range of `[0, 0)` is the epoch, not an absence.
 */
function readRange(raw: Record<string, unknown>): { from: number; to: number } | null {
  const from = readInstant(raw.from)
  const to = readInstant(raw.to)
  if (from === null || to === null) return null
  if (to < from) return null
  return { from, to }
}

function readInstant(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  // Numbers survive TanStack's default search parser as numbers, but a param
  // that arrives from anywhere else — a hand-typed URL, an old link, a test —
  // is a string, and refusing those would refuse the ordinary case.
  if (typeof value !== "string" || value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The presets, deduplicated and sorted — the same normalisation
 * `createFromRange` applies before it records them.
 *
 * Unknown members are dropped rather than the whole array: a link written by a
 * newer build carrying a fourth chip should still bill the three this one
 * understands, and dropping the lot would silently WIDEN the range instead.
 * Sorted so two links naming the same chips in two orders are one filter.
 *
 * A single value is accepted as well as an array. TanStack's parser reads
 * `?presets=no-note` as a bare string, and a filter with exactly one chip on it
 * is the most likely link anybody hand-writes.
 */
function readPresets(value: unknown): Array<Preset> {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : []
  const kept = raw.filter((item): item is Preset =>
    PRESETS.includes(item as Preset)
  )
  return [...new Set(kept)].sort()
}

/**
 * The URL, as the page's arguments. Handed to `validateSearch`.
 *
 * Every branch below drops rather than throws — see this module's own comment.
 * An empty `text` is dropped as well as an absent one: they are the same
 * filter, and keeping the empty spelling would put `?text=` on every link
 * raised from an unfiltered range.
 */
export function parseInvoiceSearch(raw: Record<string, unknown>): InvoiceSearch {
  const search: InvoiceSearch = {}

  const range = readRange(raw)
  if (range !== null) {
    search.from = range.from
    search.to = range.to
  }

  // `""` is kept — it is the "entries with no project" sentinel, not an
  // absence. Only a non-string (an array from a repeated key, a number from a
  // mangled link) is dropped.
  if (typeof raw.projectId === "string") search.projectId = raw.projectId

  if (typeof raw.text === "string" && raw.text !== "") search.text = raw.text

  const presets = readPresets(raw.presets)
  if (presets.length > 0) search.presets = presets

  return search
}

/**
 * The other direction: /reports' current range and filter, as the link's
 * search.
 *
 * Written here rather than inline in `-reports.tsx` so the two halves of one
 * contract sit together — a key added to the parser and forgotten in the
 * builder is a filter the button drops on the way to the page, and the invoice
 * would then bill a superset of the rows the user was looking at. That is the
 * exact failure `createFromRange` grew its filter arguments to close.
 *
 * `billableOnly` is deliberately not carried. `createFromRange` hard-codes it
 * true — an invoice bills billable time only — so a link able to say otherwise
 * would be offering a choice the mutation does not honour.
 *
 * Absent rather than empty, for every field, so an unfiltered range produces
 * `/invoices/new?from=…&to=…` and nothing else.
 */
export function invoiceSearchOf(
  range: { fromMs: number; toMs: number },
  filter: { projectId: string | null; text: string; presets: ReadonlyArray<Preset> }
): InvoiceSearch {
  const search: InvoiceSearch = { from: range.fromMs, to: range.toMs }
  if (filter.projectId !== null) search.projectId = filter.projectId
  if (filter.text !== "") search.text = filter.text
  if (filter.presets.length > 0) search.presets = [...filter.presets].sort()
  return search
}
