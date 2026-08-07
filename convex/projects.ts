import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { DEFAULT_PROJECT_COLOR, isProjectColor, suggestProjectColor } from "./lib/palette"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MAX_NAME_LENGTH = 120

/*
 * Projects.
 *
 * Same shape as convex/entries.ts: a `*Impl` taking an explicit userId, a
 * public wrapper that derives it from the session, and an internal wrapper for
 * tests. `userId` never appears in a public args validator.
 */

async function allProjects(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Array<Doc<"projects">>> {
  const rows = await ctx.db
    .query("projects")
    .withIndex("by_user_archived_name", (q) => q.eq("userId", userId))
    .collect()
  return rows.filter((row) => row.deletedAt === null)
}

function checkName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === "") traceError("TOO_LONG", "A project needs a name.")
  if (trimmed.length > MAX_NAME_LENGTH) {
    traceError("TOO_LONG", `Keep the name under ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

function checkColor(color: string | undefined, fallback: string): string {
  if (color === undefined) return fallback
  if (!isProjectColor(color)) {
    // Validated server-side as well as in the picker: a colour outside the
    // palette has no style anywhere in the app, so it would render as an
    // invisible swatch for the life of the project.
    traceError("TOO_LONG", "That is not one of the project colours.")
  }
  return color
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * Every project, archived ones included.
 *
 * The archived ones are NOT filtered here, because last year's entries still
 * have to render their project's name and colour, and the log has no other
 * source for them. The pickers filter for themselves — that is a question about
 * what you can newly assign, which is different from what exists.
 */
async function listImpl(ctx: QueryCtx, userId: string): Promise<Array<Doc<"projects">>> {
  const rows = await allProjects(ctx, userId)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const list = query({
  args: {},
  handler: async (ctx) => await listImpl(ctx, await requireUserId(ctx)),
})

export const listAs = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await listImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const createArgs = {
  name: v.string(),
  color: v.optional(v.string()),
  billableByDefault: v.optional(v.boolean()),
  hourlyRateCents: v.optional(v.number()),
}

type CreateArgs = {
  name: string
  color?: string
  billableByDefault?: boolean
  hourlyRateCents?: number
}

/**
 * Creates a project.
 *
 * A duplicate name is ALLOWED. Two clients can genuinely be called "Website
 * redesign", and refusing the second one means a user with a real reason to
 * create it has to invent a fake distinguishing suffix. The colour and the
 * creation order tell them apart, and a rename is one edit away.
 */
async function createImpl(ctx: MutationCtx, userId: string, args: CreateArgs) {
  const name = checkName(args.name)
  const existing = await allProjects(ctx, userId)
  const color = checkColor(
    args.color,
    suggestProjectColor(existing.map((row) => row.color))
  )

  const now = Date.now()
  const projectId = await ctx.db.insert("projects", {
    userId,
    name,
    color,
    archived: false,
    billableByDefault: args.billableByDefault ?? false,
    hourlyRateCents: args.hourlyRateCents,
    updatedAt: now,
    deletedAt: null,
  })
  return { projectId }
}

const createReturns = v.object({ projectId: v.id("projects") })

export const create = mutation({
  args: createArgs,
  returns: createReturns,
  handler: async (ctx, args) => await createImpl(ctx, await requireUserId(ctx), args),
})

export const createAs = internalMutation({
  args: { ...createArgs, userId: v.string() },
  returns: createReturns,
  handler: async (ctx, { userId, ...args }) => await createImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

const updateArgs = {
  projectId: v.id("projects"),
  name: v.optional(v.string()),
  color: v.optional(v.string()),
  billableByDefault: v.optional(v.boolean()),
  hourlyRateCents: v.optional(v.union(v.number(), v.null())),
}

type UpdateArgs = {
  projectId: Id<"projects">
  name?: string
  color?: string
  billableByDefault?: boolean
  hourlyRateCents?: number | null
}

/**
 * Edits a project.
 *
 * Changing `billableByDefault` does NOT touch existing entries. Inheritance
 * happens once, at the moment an entry is created; re-applying it here would
 * silently rewrite the billable flag on work that has already been invoiced.
 * The same rule as `entries.update` not re-inheriting on a project change.
 */
async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const project = await getOwned(ctx, userId, "projects", args.projectId)

  const patch: Partial<Doc<"projects">> = { updatedAt: Date.now() }
  if (args.name !== undefined) patch.name = checkName(args.name)
  if (args.color !== undefined) patch.color = checkColor(args.color, project.color)
  if (args.billableByDefault !== undefined) {
    patch.billableByDefault = args.billableByDefault
  }
  if (args.hourlyRateCents !== undefined) {
    patch.hourlyRateCents = args.hourlyRateCents ?? undefined
  }

  await ctx.db.patch(project._id, patch)
  return null
}

export const update = mutation({
  args: updateArgs,
  returns: v.null(),
  handler: async (ctx, args) => await updateImpl(ctx, await requireUserId(ctx), args),
})

export const updateAs = internalMutation({
  args: { ...updateArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, ...args }) => await updateImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

/**
 * Archive, never delete.
 *
 * The finished-client case, which is the common one. An archived project keeps
 * every entry that references it and keeps rendering its name in the log; it
 * simply stops being offered for new work. This is why `remove` below is rare
 * enough to be allowed to refuse.
 */
async function setArchivedImpl(
  ctx: MutationCtx,
  userId: string,
  projectId: Id<"projects">,
  archived: boolean
) {
  const project = await getOwned(ctx, userId, "projects", projectId)
  await ctx.db.patch(project._id, { archived, updatedAt: Date.now() })
  return null
}

const setArchivedArgs = { projectId: v.id("projects"), archived: v.boolean() }

export const setArchived = mutation({
  args: setArchivedArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setArchivedImpl(ctx, await requireUserId(ctx), args.projectId, args.archived),
})

export const setArchivedAs = internalMutation({
  args: { ...setArchivedArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setArchivedImpl(ctx, args.userId, args.projectId, args.archived),
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

/**
 * Deletes a project, and REFUSES while any live entry references it.
 *
 * This refusal is what makes the whole data model work. Because a project
 * cannot vanish out from under an entry, entries need no denormalised copy of
 * the project name — which means renaming a project correctly updates every
 * historical row and every past report, and an invoice from March stays
 * reproducible. A dangling reference simply cannot occur.
 *
 * Archive is the answer the user actually wants nine times out of ten, and the
 * error says so. Deliberately NOT cascading: silently deleting the reference on
 * a hundred entries is a data loss the user did not ask for and cannot undo
 * from here.
 */
async function removeImpl(ctx: MutationCtx, userId: string, projectId: Id<"projects">) {
  const project = await getOwned(ctx, userId, "projects", projectId)

  const referencing = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", project._id)
    )
    .collect()
  const live = referencing.filter((entry) => entry.deletedAt === null)

  if (live.length > 0) {
    traceError(
      "IN_USE",
      `${live.length} ${live.length === 1 ? "entry uses" : "entries use"} this project. Archive it instead — the entries keep their history.`,
      { count: live.length }
    )
  }

  await ctx.db.patch(project._id, { deletedAt: Date.now(), updatedAt: Date.now() })
  return null
}

export const remove = mutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await removeImpl(ctx, await requireUserId(ctx), args.projectId),
})

export const removeAs = internalMutation({
  args: { projectId: v.id("projects"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await removeImpl(ctx, args.userId, args.projectId),
})

export { DEFAULT_PROJECT_COLOR }
