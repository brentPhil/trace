import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

/**
 * Chroneli's domain tables.
 *
 * Better Auth is installed as a Convex component, so user, session and account
 * tables live in the component's own namespace rather than here. `userId` below
 * is the Better Auth user's `_id` — a STRING, not a `v.id()`, because it names a
 * document in another namespace.
 *
 * Two shapes are load-bearing and are argued in
 * docs/superpowers/plans/2026-08-08-time-tracking-implementation-plan.md:
 *
 *   - There is no stored `dayKey`. Entries hold a UTC instant and nothing else;
 *     "which local day is this" is computed from convex/lib/day.ts at query
 *     time. Storing it would mean the ordinary inline-edit path silently
 *     re-buckets historical entries under whatever timezone the user is in
 *     today, which changes an already-invoiced month with no audit trail.
 *
 *   - A running entry is `endedAt === null`, stored as an explicit union rather
 *     than an optional field, so it is indexable. Toggl's negative-duration
 *     encoding is not adopted: a field whose units flip with its sign turns
 *     every sum into a place to forget a branch.
 */
/*
 * The field shapes are named consts rather than object literals inline in
 * `defineTable`, so `convex/lib/docs.ts` can build the `returns` validators for
 * the public queries from the SAME definitions the tables are declared with.
 * Hand-copied return validators drift from the schema silently, and a validator
 * that has drifted is worse than none: it rejects documents that are in fact
 * correct, at runtime, in production.
 */
export const timeEntryFields = {
  userId: v.string(),
  /** UUIDv7 minted by the client before the mutation is sent. Makes a create
   *  idempotent, so a retry after a lost response returns the existing row
   *  instead of duplicating the entry — which is exactly what happens on a
   *  phone with bad signal, when nobody is watching. */
  clientKey: v.string(),
  /** "" is allowed and normal. Blocking start on a missing title would
   *  destroy the reason the product exists. Also the grouping and
   *  autocomplete key. */
  title: v.string(),
  /** The differentiator. Never a grouping, matching, or autocomplete key —
   *  that is the mistake that makes Toggl's single description field
   *  unusable for prose. */
  note: v.optional(v.string()),
  startedAt: v.number(),
  /** null means running. */
  endedAt: v.union(v.number(), v.null()),
  /** Denormalised because Convex has no generated columns and every total in
   *  the product sums it. convex/lib/entryTimes.ts is the sole writer, which
   *  is what keeps it honest. null exactly when endedAt is null. */
  durationMs: v.union(v.number(), v.null()),
  projectId: v.optional(v.id("projects")),
  /** Unique, sorted, capped. Flat by design — hierarchy is what turns tags
   *  into a second project taxonomy. */
  tagIds: v.array(v.id("tags")),
  billable: v.boolean(),
  /** "web" | "import" | "api". The cheapest observability there is. */
  source: v.string(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const projectFields = {
  userId: v.string(),
  name: v.string(),
  /** A key into a fixed palette, not a free-form colour. Legibility, never
   *  the sole carrier of meaning. */
  color: v.string(),
  /** Archive, never delete. Last year's entries must still render their
   *  project name. */
  archived: v.boolean(),
  billableByDefault: v.boolean(),
  hourlyRateCents: v.optional(v.number()),
  /** Optional, and stays optional: a project without a client is normal and
   *  must remain startable. What makes "Create invoice" able to pre-fill. */
  clientId: v.optional(v.id("clients")),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const clientFields = {
  userId: v.string(),
  name: v.string(),
  /** A free-text block rendered VERBATIM on the invoice, newlines included.
   *  Deliberately not a structured address: a street/city/postcode schema is a
   *  taxonomy nobody asked for and gets the international cases wrong. */
  address: v.string(),
  email: v.optional(v.string()),
  /** Archive, never delete — the same rule as projects, and for the same
   *  reason: an invoice raised last year must still render its client. */
  archived: v.boolean(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const tagFields = {
  userId: v.string(),
  name: v.string(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const invoiceFields = {
  userId: v.string(),
  /** UUIDv7 minted client-side before the mutation is sent — the same
   *  idempotency device `timeEntries.clientKey` uses. A retry after a lost
   *  response must not mint a second invoice number. */
  clientKey: v.string(),
  number: v.string(),
  /*
   * There is deliberately no `status`. A draft/issued/paid workflow shipped
   * here and was removed: it made the product a place to TRACK invoices, and
   * what it was asked to be is a place to RAISE one and export it. An invoice
   * is a document you edit and send, always editable — so there is no state to
   * hold, nothing to freeze, and nothing to unlock.
   *
   * It came out in three steps, because Convex validates existing documents
   * against the schema on push and a straight deletion fails the deploy rather
   * than the data: make it optional, clear the column
   * (`migrations.clearInvoiceStatus`, run 2026-08-11), then delete the field.
   * Any future column removal on a table with rows in it owes the same three.
   */
  clientId: v.union(v.id("clients"), v.null()),
  /** SNAPSHOT of the client's block at creation, not a join. Renaming a client
   *  must not rewrite last year's invoices; `clientId` beside it is what still
   *  answers "show me everything billed to Vessel Vanguard". */
  billedTo: v.string(),
  payTo: v.string(),
  /** Snapshot. `userSettings.currency` may change; this invoice may not. */
  currency: v.string(),
  /** Snapshot of the account logo selected when this document was raised. */
  logoStorageId: v.optional(v.id("_storage")),
  issuedAt: v.number(),
  dueAt: v.number(),
  purchaseOrder: v.optional(v.string()),
  paymentTerms: v.optional(v.string()),
  /** The message to the client at the FOOT of the document: where to send the
   *  money, a thank-you, anything the terms line above is too short to hold.
   *  Rendered verbatim, newlines and all, like a party block — it is prose a
   *  human wrote to another human, not a field.
   *
   *  Bounded by `MAX_NOTES_LENGTH` on write, which is not housekeeping: it is
   *  the largest term in `INVOICE_NUMBER_SCAN_LIMIT`'s per-row byte estimate
   *  (convex/lib/scan.ts) and widening it means redoing that division. */
  notes: v.optional(v.string()),
  /** Ordered, applied to the subtotal in order. `basisPoints` rather than a
   *  percentage float: 8.25% is 825, and no tax line is ever the result of
   *  0.1 + 0.2. */
  taxes: v.array(v.object({ label: v.string(), basisPoints: v.number() })),
  /** Provenance: which range built this. NEVER read to recompute anything — it
   *  exists so a human can ask where the figures came from. */
  sourceFromMs: v.union(v.number(), v.null()),
  sourceToMs: v.union(v.number(), v.null()),
  /*
   * Provenance, continued: WHICH ROWS of that range. Same rule as the two
   * instants above — never read to recompute anything, ever.
   *
   * They exist because a range alone MISDESCRIBES an invoice the moment
   * `createFromRange` bills a filtered view. "3–9 August" and "3–9 August,
   * project Website only, rows matching 'migration'" are different sets of
   * work with the same dates, and a human asking where a figure came from
   * would be handed the first sentence for the second invoice — provenance
   * that reads as complete while naming a superset of what was billed.
   *
   * `billableOnly` is deliberately absent. It is not a view setting an invoice
   * happens to have been raised under: `createFromRange` hard-codes it true
   * for every invoice this product will ever raise, so storing it would record
   * a choice nobody made and imply it could have been otherwise.
   *
   * OPTIONAL, and each one WRITTEN ON EVERY NEW INVOICE — including the
   * unfiltered defaults (`null`, `""`, `[]`). So absence means exactly one
   * thing, "raised before this product recorded which rows it billed", rather
   * than being a second spelling of "no filter". Existing rows keep validating
   * and keep telling the truth about themselves.
   */
  sourceProjectId: v.optional(v.union(v.string(), v.null())),
  /** Bounded by `MAX_SOURCE_TEXT_LENGTH` on write — see that constant and
   *  `INVOICE_NUMBER_SCAN_LIMIT`, whose per-row byte estimate this is a term
   *  in. Stored as the filter matched: trimmed, never otherwise normalised. */
  sourceText: v.optional(v.string()),
  /** Deduplicated and sorted on write, which is what bounds it: there are three
   *  presets, so the stored set can never exceed three elements however many
   *  the caller sent. */
  sourcePresets: v.optional(
    v.array(
      v.union(
        v.literal("no-project"),
        v.literal("no-note"),
        v.literal("under-a-minute")
      )
    )
  ),
  /** SNAPSHOT of `entries.rangeBreakdownImpl`'s `unratedBillableMs` for the
   *  source range, AT CREATION — how much billable time had no rate and so
   *  landed on neither this invoice nor any line of it. Like every other
   *  figure here, it must NEVER be recomputed: a rate set after the fact must
   *  not rewrite what a past invoice excluded. Exists so `createFromRange`'s
   *  replay path can return the real figure instead of a bare `0` — see
   *  `unratedMs` on that mutation's return type. */
  unratedMsAtCreation: v.number(),
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const invoiceLineFields = {
  userId: v.string(),
  invoiceId: v.id("invoices"),
  kind: v.union(v.literal("time"), v.literal("custom")),
  description: v.string(),
  /** Hundredths of an hour. 98.8 h is 9880. An integer, never a float — the
   *  same reason money is held in cents. */
  quantityCentis: v.number(),
  unitCents: v.number(),
  /** STORED, not derived at render. Deriving it would make a printed document
   *  a function of today's rounding rules rather than of the day it was
   *  raised. */
  amountCents: v.number(),
  /** Provenance only. Never read for money. */
  projectId: v.optional(v.id("projects")),
  sortKey: v.number(),
  /** Unused: `invoiceLines` is hard-deleted with its parent invoice, never
   *  soft-deleted on its own. Carried anyway so every OWNED_TABLES row has the
   *  same shape and `owned.ts`'s `getOwned` keeps ONE code path rather than a
   *  second one for the tables without it. */
  deletedAt: v.union(v.number(), v.null()),
}

/**
 * The index Convex cannot build over `timeEntries.tagIds`.
 *
 * Array membership is not indexable, so "is this tag still in use?" would
 * otherwise mean reading every entry in the account — and a bounded version of
 * that read cannot distinguish "unused" from "did not look far enough", which
 * is why deleting a tag used to stop working entirely past 2,000 entries.
 *
 * A row exists EXACTLY when a live entry carries the tag. There is deliberately
 * no `deletedAt` here: liveness in a column would put a filter back after the
 * index, and the whole point is that the first row found is the answer. Soft-
 * deleting an entry drops its rows and restoring it puts them back — which is
 * also what preserves the rule that a tag carried only by trashed entries is
 * still deletable.
 *
 * Derived state, so `convex/entryTags.ts` is its sole writer — at the convex
 * root, NOT under convex/lib, which is aliased `@shared` and compiled into the
 * client, so everything there must stay pure. `tagIds`
 * remains on the entry and remains what every render reads; this table is an
 * index beside it, not a replacement for it.
 */
export const entryTagFields = {
  userId: v.string(),
  entryId: v.id("timeEntries"),
  tagId: v.id("tags"),
}

/**
 * The Google Calendar mirror, and the line down the middle of it.
 *
 * `googleEvents` holds ONLY Google's facts. Every sync is free to replace a row
 * without reading it first, and the prune is free to delete one, because
 * nothing the user did is stored here — so nothing the user did can be lost by
 * either. `googleEventTracking` beside it holds OUR facts about the same event
 * and is never pruned.
 *
 * Two writers with different rights is the whole argument. Put the tick on the
 * mirror row and every upsert has to be field-selective forever; the day
 * someone writes a whole-row `replace`, every user's ticks disappear with no
 * error. It is the same case `entryTags` makes for existing beside `tagIds`
 * rather than replacing it — derived state and user-owned state have different
 * lifetimes.
 */

/** One row per user who has linked Google. Where the re-consent flag lives, and
 *  the list the cron iterates. */
export const googleConnectionFields = {
  userId: v.string(),
  /** "reauth" means Google refused the refresh token. Sync STOPS for this user
   *  until they consent again — retrying a revoked grant every 15 minutes
   *  forever is how a quiet failure becomes an expensive one. */
  status: v.union(v.literal("ok"), v.literal("reauth")),
  /** The calendar LIST is refreshed at most once a day; events are polled every
   *  15 minutes. Held here so the interval is a stored fact rather than a
   *  second cron nobody can see the schedule of. */
  calendarsRefreshedAt: v.union(v.number(), v.null()),
  lastSyncedAt: v.union(v.number(), v.null()),
  lastErrorAt: v.union(v.number(), v.null()),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
}

export const googleCalendarFields = {
  userId: v.string(),
  /** Google's calendar id — "primary", or an address. Not a `v.id()`: it names
   *  a document in Google's namespace, the same way `userId` names one in Better
   *  Auth's. */
  googleId: v.string(),
  summary: v.string(),
  /** Whether this calendar is drawn AND fetched. A calendar nothing may draw is
   *  not mirrored: there is no point paying for rows nobody can see. It is also
   *  what makes hiding a calendar suspend its pending ticks in Phase 2 —
   *  `googleTick` reads the mirror, and a hidden calendar has nothing in it. */
  show: v.boolean(),
  /** What an entry made from this calendar's meetings is classified as. Optional
   *  and stays optional: an unclassified entry is already a normal state. */
  defaultProjectId: v.optional(v.id("projects")),
  /** What makes polling cheap — Google returns only what changed since this was
   *  issued. `null` means the next fetch is a full window fetch, which is both
   *  the first-run state and the recovery from a 410. */
  syncToken: v.union(v.string(), v.null()),
  lastSyncedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
}

/** The most attendees stored on one event row.
 *
 *  A bound, not a preference. Convex caps a document at 1MB and the schema
 *  guidelines warn against unbounded arrays in a document; a company-wide invite
 *  has thousands of attendees and would both blow the cap and rewrite the whole
 *  row on every poll. `attendeeCount` beside the array is what lets the popover
 *  say "+ 40 more" honestly rather than implying the list is complete. */
export const MAX_ATTENDEES = 50

/** Google descriptions carry pasted agendas and mail footers and are routinely
 *  tens of kilobytes. Truncated on write for the same reason as the attendee
 *  cap, and truncated ONCE on the way in rather than at every render. */
export const MAX_DESCRIPTION_LENGTH = 4_000

export const googleEventFields = {
  userId: v.string(),
  /** The `googleCalendars.googleId` this came from. */
  calendarId: v.string(),
  /** Google's event id, unique per calendar. A recurring meeting arrives as
   *  instances under `singleEvents: true`, each with its own id, which is what
   *  keeps a daily standup from collapsing into one row. */
  eventId: v.string(),
  /** Google's `summary`. "" is legal and normal; the grid falls back to
   *  "Untitled", the same fallback `titleOf` already applies to an entry. */
  title: v.string(),
  /** ABSOLUTE INSTANTS. Google returns RFC3339 with an offset, so `Date.parse`
   *  is lossless. Never a wall-clock string — the failure `calendar-events.ts`
   *  documents for entries applies here identically, and an event drawn an hour
   *  off its real start is the defect this feature can least afford. */
  startedAt: v.number(),
  endedAt: v.number(),
  /** True when Google returned `date` rather than `dateTime`. Such an event has
   *  no clock, and the grid has no all-day rail (`allDaySlot={false}`), so it is
   *  stored and never drawn. */
  isAllDay: v.boolean(),
  /** "confirmed" | "tentative". NEVER "cancelled": a cancelled event arrives
   *  from incremental sync as a tombstone with no times at all, and is deleted
   *  from the mirror rather than stored — see convex/googleEvents.ts. */
  status: v.string(),
  /** The signed-in user's RSVP, read off the attendee Google marks `self: true`,
   *  or "none" when there is no such attendee.
   *
   *  STORED AND DISPLAYED, NEVER BRANCHED ON. It is written down because the
   *  field looks exactly like a gate and an earlier draft of this feature used
   *  it as one. In Phase 2 the checkbox is the only thing that decides whether a
   *  meeting is tracked; an RSVP heuristic here would be the product guessing on
   *  the user's behalf. */
  myResponse: v.string(),
  location: v.optional(v.string()),
  /** Truncated to MAX_DESCRIPTION_LENGTH on write. */
  description: v.optional(v.string()),
  conferenceUrl: v.optional(v.string()),
  htmlLink: v.optional(v.string()),
  organizer: v.optional(
    v.object({ name: v.optional(v.string()), email: v.optional(v.string()) })
  ),
  /** Capped at MAX_ATTENDEES. */
  attendees: v.array(
    v.object({
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      response: v.string(),
    })
  ),
  /** How many Google actually reported, which may exceed the array's length. */
  attendeeCount: v.number(),
  /** Google's own `updated`, so a change is detectable without diffing fields. */
  googleUpdatedAt: v.number(),
  updatedAt: v.number(),
}

export const googleEventTrackingFields = {
  userId: v.string(),
  calendarId: v.string(),
  eventId: v.string(),
  /** The checkbox. Phase 2 owns the writer; the READER ships in Phase 1,
   *  because it is what suppresses a ghost whose entry already exists. */
  trackOnStart: v.boolean(),
  /** Which entry this meeting produced. Also what suppresses the ghost: the grid
   *  never draws an hour twice. */
  entryId: v.union(v.id("timeEntries"), v.null()),
  /** Which entry the switch closed, so undo can reopen it. */
  interruptedEntryId: v.union(v.id("timeEntries"), v.null()),
  updatedAt: v.number(),
}

export default defineSchema({
  timeEntries: defineTable(timeEntryFields)
    // userId leads every index: ownership is a key prefix, not a filter that
    // someone can forget on the one query that matters.
    .index("by_user_ended", ["userId", "endedAt"])
    .index("by_user_started", ["userId", "startedAt"])
    .index("by_user_clientKey", ["userId", "clientKey"])
    .index("by_user_project", ["userId", "projectId"]),

  projects: defineTable(projectFields).index("by_user_archived_name", [
    "userId",
    "archived",
    "name",
  ]),

  clients: defineTable(clientFields).index("by_user_archived_name", [
    "userId",
    "archived",
    "name",
  ]),

  tags: defineTable(tagFields).index("by_user_name", ["userId", "name"]),

  invoices: defineTable(invoiceFields)
    .index("by_user_number", ["userId", "number"])
    .index("by_user_clientKey", ["userId", "clientKey"])
    .index("by_user_issued", ["userId", "issuedAt"]),

  invoiceLines: defineTable(invoiceLineFields).index("by_user_invoice", [
    "userId",
    "invoiceId",
  ]),

  /**
   * Which one-off data migrations have finished.
   *
   * Exists because `entryTags` is only trustworthy once it covers ALL history.
   * Between the schema landing and the backfill finishing, the table is empty,
   * and an empty index reads exactly like "this tag is used by nothing" — so a
   * delete in that window would destroy a tag a thousand entries carry. One row
   * turns that window from brief into impossible.
   */
  migrationState: defineTable({
    name: v.string(),
    /** Where the next page starts. null before the first page and once
     *  finished. Held HERE rather than passed in by the caller: a starting
     *  point supplied from outside can skip rows the run then declares
     *  covered, and `completedAt` is trusted absolutely. Optional only so a
     *  row written by an earlier build of this migration still validates. */
    cursor: v.optional(v.union(v.string(), v.null())),
    /** null until the final page reports done. */
    completedAt: v.union(v.number(), v.null()),
  }).index("by_name", ["name"]),

  entryTags: defineTable(entryTagFields)
    // by_user_tag is the one this table exists for: tags.remove reads its first
    // row and stops. by_user_entry is how a write path finds the rows it has to
    // reconcile when an entry's tags change.
    .index("by_user_tag", ["userId", "tagId"])
    .index("by_user_entry", ["userId", "entryId"]),

  googleConnections: defineTable(googleConnectionFields)
    .index("by_user", ["userId"])
    /*
     * NOT led by userId, and the exception is deliberate.
     *
     * Every other index in this file starts with `userId` because ownership must
     * be a key prefix rather than a filter someone can forget. This one is read
     * by exactly one caller — the sync cron, which is an internalAction
     * enumerating work ACROSS users and has no user to scope to. It is never
     * reachable from a user-facing query, and `by_user` above is what those use.
     */
    .index("by_status", ["status"]),

  googleCalendars: defineTable(googleCalendarFields)
    .index("by_user_googleId", ["userId", "googleId"])
    .index("by_user_show", ["userId", "show"]),

  googleEvents: defineTable(googleEventFields)
    // The upsert's key.
    .index("by_user_calendar_event", ["userId", "calendarId", "eventId"])
    // The grid's range read, and the prune's scan.
    .index("by_user_started", ["userId", "startedAt"])
    /*
     * Every row of ONE calendar, which is what two whole-calendar operations
     * need: hiding a calendar deletes its mirrored events, and a calendar Google
     * has stopped reporting takes its events with it.
     *
     * Without this both would read a page of the user's events and filter by
     * `calendarId` in JavaScript — and a filter after the index scan does not
     * reduce rows read, so the cost would be the whole mirror however few rows
     * the target calendar holds. `startedAt` trails the key so the deletes come
     * off in a stable order and a bounded page can be resumed.
     */
    .index("by_user_calendar_started", ["userId", "calendarId", "startedAt"]),

  googleEventTracking: defineTable(googleEventTrackingFields).index(
    "by_user_calendar_event",
    ["userId", "calendarId", "eventId"]
  ),

  userSettings: defineTable({
    userId: v.string(),
    /** IANA, first-class. Never the browser's zone at read time — that is how a
     *  travelling freelancer's entries silently jump days. */
    timezone: v.string(),
    /** 0 = Sunday. Honoured from the first week total; assuming Sunday is wrong
     *  for most of the world. */
    weekStartDay: v.number(),
    durationDisplay: v.union(v.literal("hms"), v.literal("decimal")),
    timeFormat: v.union(v.literal("12"), v.literal("24")),
    runawayThresholdMs: v.number(),
    /** Opt-out for the tab-title clock, which a screen reader announces. */
    tabTitleClock: v.boolean(),
    /** ISO 4217, e.g. "USD". Optional and additive, unlike the columns above:
     *  a row written before this field existed has no opinion, and `get`
     *  falls back to `SETTINGS_DEFAULTS.currency` rather than this needing a
     *  backfill migration. Governs how `projects.hourlyRateCents` and the
     *  billable amount on /reports are displayed — never assume `$`, a
     *  freelancer's stored timezone says nothing about their currency. */
    currency: v.optional(v.string()),
    /** The account's fallback hourly rate, in cents.
     *
     *  Applies to billable time that no project rate covers — including time
     *  with NO project, which was previously unpriceable however billable it
     *  was. Toggl calls this the workspace rate and resolves the same way:
     *  the most granular rate wins, and this is the least granular one there
     *  is. Optional, and ABSENT rather than zero when unset — "nobody has
     *  priced this" and "priced at nothing" are different facts, and
     *  `unratedBillableMs` exists to tell them apart. */
    defaultHourlyRateCents: v.optional(v.number()),
    /** Print each row's entry notes in the exported PDF report.
     *
     *  Optional and additive like `currency` above — a row written before this
     *  field existed has no opinion, and `settings.get` falls back to
     *  `SETTINGS_DEFAULTS` rather than this needing a backfill.
     *
     *  OFF by default, and the default is the safe one rather than the
     *  convenient one: a note is prose the user wrote to themselves about how
     *  the work actually went, and the PDF is the artefact that goes to a
     *  client. Opting in has to be a decision somebody made. It also governs
     *  whether `entries.rangeBreakdown` is asked to carry notes at all, so off
     *  costs nothing on the query either. */
    pdfIncludeNotes: v.optional(v.boolean()),
    /** Collapse repeats of one title+project within a day into one log row.
     *
     *  Optional and additive like `currency` and `pdfIncludeNotes` above — a
     *  row written before this field existed has no opinion, and `settings.get`
     *  falls back to `SETTINGS_DEFAULTS` rather than this needing a backfill.
     *
     *  ON by default, and the difference from `pdfIncludeNotes` is the point:
     *  that flag governs what reaches a CLIENT, so its default has to be the
     *  cautious one. This governs only how rows are drawn on the user's own
     *  screen. Nothing is merged, nothing is stored per group, and every entry
     *  stays individually present and editable one click away — see
     *  docs/superpowers/specs/2026-08-13-grouped-entries-design.md, which
     *  argues that at length against PRODUCT.md's rule that the product
     *  "never silently rounds, merges, or guesses on the user's behalf". */
    groupEntries: v.optional(v.boolean()),
    /** Merge same-rate project rows into one client-facing invoice line.
     * Optional and additive: older settings rows fall through to the account
     * default, and an individual invoice can override it without changing
     * this preference. */
    mergeInvoiceLines: v.optional(v.boolean()),
    /** Current account logo pointer. Repointing never deletes the old file:
     * historical invoices may still snapshot it. */
    logoStorageId: v.optional(v.id("_storage")),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
})
