import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import { createImpl } from "./entries"
import { traceError } from "./errors"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

/**
 * Bulk import of tracked time from another tracker.
 *
 * Internal only. There is no UI for this and deliberately no public mutation:
 * an import writes a whole fortnight in one transaction, which is not something
 * a session token should be able to ask for.
 *
 * Everything here goes through `entries.createImpl`, so an imported row is
 * validated, deduplicated and tag-synced exactly like a typed one. The single
 * difference is `source: "import"`, which is what makes the whole batch
 * findable again — see `undoImport`.
 */

/**
 * Who exists in this deployment, so a caller can identify the right account
 * before writing to it rather than after.
 *
 * Reads the domain tables rather than the Better Auth component: an account
 * that has never tracked anything is not one you would be importing into, and
 * this avoids reaching across a namespace boundary for a debugging aid.
 */
export const accounts = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      userId: v.string(),
      entries: v.number(),
      imported: v.number(),
      projects: v.array(v.string()),
      timezone: v.string(),
    })
  ),
  handler: async (ctx) => {
    const settings = await ctx.db.query("userSettings").collect()
    const out = []
    for (const row of settings) {
      const entries = await ctx.db
        .query("timeEntries")
        .withIndex("by_user_started", (q) => q.eq("userId", row.userId))
        .collect()
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_user_archived_name", (q) => q.eq("userId", row.userId))
        .collect()
      out.push({
        userId: row.userId,
        entries: entries.filter((e) => e.deletedAt === null).length,
        imported: entries.filter((e) => e.deletedAt === null && e.source === "import")
          .length,
        projects: projects.filter((p) => p.deletedAt === null).map((p) => p.name),
        timezone: row.timezone,
      })
    }
    return out
  },
})

const importedEntry = v.object({
  clientKey: v.string(),
  title: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  /** Per ENTRY, not per batch. A real export carries a billable flag on each
   *  row, and forcing the batch to agree would either invent revenue on
   *  unbilled work or discard it on billed work. */
  billable: v.optional(v.boolean()),
  /** Also per entry, and optional: "no project" is a normal, common state in
   *  every tracker, and collapsing it onto the batch's project would file
   *  standups and admin under a client. */
  projectName: v.optional(v.string()),
})

/**
 * Inserts a batch, creating the project if it is not already there.
 *
 * BOUNDED BY THE CALLER, not by a `.take()`. A Convex mutation has a write
 * ceiling, and a batch that exceeds it fails atomically — which is the right
 * failure, because a half-imported fortnight is worse than none. The caller
 * chunks; `replayed` in the result is what makes re-sending a chunk safe.
 */
export const importEntries = internalMutation({
  args: {
    userId: v.string(),
    entries: v.array(importedEntry),
  },
  returns: v.object({
    inserted: v.number(),
    replayed: v.number(),
    projects: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    if (args.entries.length === 0) {
      traceError("EMPTY_IMPORT", "Nothing to import.")
    }

    /*
     * Resolved once per distinct name, not once per row. The lookup is a full
     * scan of the user's projects, and a fortnight of one client's work is
     * forty rows naming the same project — forty scans to learn one id.
     */
    const byName = new Map<string, Id<"projects">>()
    for (const entry of args.entries) {
      if (entry.projectName === undefined) continue
      const key = entry.projectName.trim().toLowerCase()
      if (byName.has(key)) continue
      byName.set(
        key,
        await ensureProject(ctx, args.userId, entry.projectName, entry.billable ?? false)
      )
    }

    let inserted = 0
    let replayed = 0
    for (const entry of args.entries) {
      const projectId =
        entry.projectName === undefined
          ? undefined
          : byName.get(entry.projectName.trim().toLowerCase())

      const result = await createImpl(ctx, args.userId, {
        clientKey: entry.clientKey,
        title: entry.title,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        projectId,
        // Explicit, never `?? project.billableByDefault`. The export knows
        // whether this row was billed; the project default is a guess about
        // rows nobody has decided about yet, and letting it win here would
        // silently re-price imported history.
        billable: entry.billable ?? false,
        source: "import",
      })
      if (result.replayed) replayed++
      else inserted++
    }

    return { inserted, replayed, projects: [...byName.keys()] }
  },
})

/**
 * Get-or-create by name, matching what the picker does.
 *
 * Never creates a second project with a name the user already has — an import
 * that silently forks "SeaLogs" into two is exactly the mess that makes people
 * distrust importers.
 */
async function ensureProject(
  ctx: MutationCtx,
  userId: string,
  name: string,
  billableByDefault: boolean
) {
  const trimmed = name.trim()
  if (trimmed === "") traceError("INVALID_PROJECT_NAME", "A project needs a name.")

  const existing = await ctx.db
    .query("projects")
    .withIndex("by_user_archived_name", (q) => q.eq("userId", userId))
    .collect()
  const match = existing.find(
    (p) => p.deletedAt === null && p.name.toLowerCase() === trimmed.toLowerCase()
  )
  if (match !== undefined) return match._id

  const now = Date.now()
  return await ctx.db.insert("projects", {
    userId,
    name: trimmed,
    color: "slate",
    archived: false,
    billableByDefault,
    updatedAt: now,
    deletedAt: null,
  })
}

/**
 * Removes everything a previous import added, and nothing else.
 *
 * `source: "import"` is the whole reason this can exist — it is the only thing
 * distinguishing sixty imported rows from sixty typed ones. Projects, tags and
 * settings are untouched: the project an import attached itself to almost
 * certainly predates it, and deleting a rate the user configured because their
 * import was wrong would be its own small disaster.
 *
 * HARD delete, unlike every other delete in this product, and the exception is
 * the point. The reason to undo an import is to run a better one, and
 * `createImpl` dedupes on `clientKey` WITHOUT regard to `deletedAt` — so a
 * soft-deleted row silently turns the retry into a no-op, reporting "replayed"
 * for entries the user can no longer see. An undo that quietly prevents the
 * thing it exists to enable is worse than no undo. The rows are reconstructible
 * from the file they came from, which is what makes the hard delete affordable
 * here and nowhere else.
 *
 * The entryTags join rows go FIRST, so a run that exhausts its budget partway
 * leaves the index describing rows that still exist rather than rows that are
 * gone — the same ordering, for the same reason, as `maintenance.purgeUser`.
 *
 * Bounded, and reports what is left, so the caller loops rather than hitting
 * the transaction ceiling on a large import.
 */
export const undoImport = internalMutation({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), remaining: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 200
    const rows = await ctx.db
      .query("timeEntries")
      .withIndex("by_user_started", (q) => q.eq("userId", args.userId))
      .collect()
    const imported = rows.filter((r) => r.source === "import")

    let deleted = 0
    for (const row of imported.slice(0, limit)) {
      const joins = await ctx.db
        .query("entryTags")
        .withIndex("by_user_entry", (q) =>
          q.eq("userId", args.userId).eq("entryId", row._id)
        )
        .collect()
      for (const join of joins) await ctx.db.delete(join._id)

      await ctx.db.delete(row._id)
      deleted++
    }
    return { deleted, remaining: imported.length - deleted }
  },
})
