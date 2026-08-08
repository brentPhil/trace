import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

/**
 * Trace's domain tables.
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
  updatedAt: v.number(),
  deletedAt: v.union(v.number(), v.null()),
}

export const tagFields = {
  userId: v.string(),
  name: v.string(),
  updatedAt: v.number(),
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

  tags: defineTable(tagFields).index("by_user_name", ["userId", "name"]),

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
    completedAt: v.number(),
  }).index("by_name", ["name"]),

  entryTags: defineTable(entryTagFields)
    // by_user_tag is the one this table exists for: tags.remove reads its first
    // row and stops. by_user_entry is how a write path finds the rows it has to
    // reconcile when an entry's tags change.
    .index("by_user_tag", ["userId", "tagId"])
    .index("by_user_entry", ["userId", "entryId"]),

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
    /** Minutes past local midnight, default 1050 (17:30). Minutes rather than
     *  hours because the default is not on an hour, and because an hourly
     *  schedule cannot serve Asia/Kolkata, Asia/Kathmandu or Pacific/Chatham
     *  at all. */
    recapMinuteLocal: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * Day-scoped user prose only.
   *
   * The recap body itself is NEVER stored — it is a pure function of the day's
   * entries, derived on read. Storing it would create an invalidation problem
   * with a branch for every way an entry can change. These two optional strings
   * are the only part of a recap the user types that is not already an entry.
   */
  recapDays: defineTable({
    userId: v.string(),
    /** "YYYY-MM-DD" in the user's timezone. */
    day: v.string(),
    next: v.optional(v.string()),
    blocked: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_user_day", ["userId", "day"]),
})
