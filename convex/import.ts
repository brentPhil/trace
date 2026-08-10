import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import { createImpl } from "./entries"
import { traceError } from "./errors"
import type { MutationCtx } from "./_generated/server"

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
    projectName: v.optional(v.string()),
    billable: v.optional(v.boolean()),
    entries: v.array(importedEntry),
  },
  returns: v.object({
    inserted: v.number(),
    replayed: v.number(),
    projectId: v.union(v.id("projects"), v.null()),
  }),
  handler: async (ctx, args) => {
    if (args.entries.length === 0) {
      traceError("EMPTY_IMPORT", "Nothing to import.")
    }

    const projectId =
      args.projectName === undefined
        ? null
        : await ensureProject(ctx, args.userId, args.projectName, args.billable ?? false)

    let inserted = 0
    let replayed = 0
    for (const entry of args.entries) {
      const result = await createImpl(ctx, args.userId, {
        clientKey: entry.clientKey,
        title: entry.title,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        projectId: projectId ?? undefined,
        billable: args.billable,
        source: "import",
      })
      if (result.replayed) replayed++
      else inserted++
    }

    return { inserted, replayed, projectId }
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
 * `source: "import"` is the whole reason this can exist. Soft-deletes, like
 * every other delete in the product, so an import undone in haste is still
 * recoverable — and so the undo cannot outrun the entryTags rows that point at
 * these entries.
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
    const imported = rows.filter((r) => r.source === "import" && r.deletedAt === null)

    const now = Date.now()
    let deleted = 0
    for (const row of imported.slice(0, limit)) {
      await ctx.db.patch(row._id, { deletedAt: now, updatedAt: now })
      deleted++
    }
    return { deleted, remaining: imported.length - deleted }
  },
})
