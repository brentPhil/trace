import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { clientDoc } from "./lib/docs"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MAX_NAME_LENGTH = 100
/* Long enough for a multi-line international address, short enough that a
 * paste accident cannot become a document. */
const MAX_ADDRESS_LENGTH = 500

function checkName(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === "") traceError("TOO_LONG", "A client needs a name.")
  if (trimmed.length > MAX_NAME_LENGTH) {
    traceError("TOO_LONG", `Keep the name under ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

/* NOT trimmed per line, and never collapsed: the block is rendered verbatim on
 * a document, so its internal newlines are the address's shape. Only the
 * surrounding whitespace goes. */
function checkAddress(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > MAX_ADDRESS_LENGTH) {
    traceError("TOO_LONG", `Keep the address under ${MAX_ADDRESS_LENGTH} characters.`)
  }
  return trimmed
}

/*
 * Clients.
 *
 * Same shape as convex/projects.ts: a `*Impl` taking an explicit userId, a
 * public wrapper that derives it from the session, and an internal wrapper for
 * tests. `userId` never appears in a public args validator.
 */

async function allClients(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Array<Doc<"clients">>> {
  const rows = await ctx.db
    .query("clients")
    .withIndex("by_user_archived_name", (q) => q.eq("userId", userId))
    .collect()
  return rows.filter((row) => row.deletedAt === null)
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/**
 * Every client, archived ones included.
 *
 * The archived ones are NOT filtered here, for the same reason as
 * `projects.listImpl`: an invoice raised against a now-finished client must
 * still render its name, and this is the only source for it. The pickers
 * filter for themselves — that is a question about what you can newly bill,
 * which is different from what exists.
 */
async function listImpl(ctx: QueryCtx, userId: string): Promise<Array<Doc<"clients">>> {
  const rows = await allClients(ctx, userId)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const list = query({
  args: {},
  returns: v.array(clientDoc),
  handler: async (ctx) => await listImpl(ctx, await requireUserId(ctx)),
})

export const listAs = internalQuery({
  args: { userId: v.string() },
  returns: v.array(clientDoc),
  handler: async (ctx, args) => await listImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

const createArgs = {
  name: v.string(),
  address: v.string(),
  email: v.optional(v.string()),
}

type CreateArgs = {
  name: string
  address: string
  email?: string
}

async function createImpl(ctx: MutationCtx, userId: string, args: CreateArgs) {
  const name = checkName(args.name)
  const address = checkAddress(args.address)

  const now = Date.now()
  const clientId = await ctx.db.insert("clients", {
    userId,
    name,
    address,
    email: args.email,
    archived: false,
    updatedAt: now,
    deletedAt: null,
  })
  return { clientId }
}

const createReturns = v.object({ clientId: v.id("clients") })

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
  clientId: v.id("clients"),
  name: v.optional(v.string()),
  address: v.optional(v.string()),
  email: v.optional(v.string()),
}

type UpdateArgs = {
  clientId: Id<"clients">
  name?: string
  address?: string
  email?: string
}

async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const client = await getOwned(ctx, userId, "clients", args.clientId)

  const patch: Partial<Doc<"clients">> = { updatedAt: Date.now() }
  if (args.name !== undefined) patch.name = checkName(args.name)
  if (args.address !== undefined) patch.address = checkAddress(args.address)
  if (args.email !== undefined) patch.email = args.email

  await ctx.db.patch(client._id, patch)
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
 * The same rule as `projects.setArchived`, for the same reason: an invoice
 * raised last year must still render the client it was billed to, and
 * archiving keeps that row in place while removing it from pickers for new
 * work.
 */
async function setArchivedImpl(
  ctx: MutationCtx,
  userId: string,
  clientId: Id<"clients">,
  archived: boolean
) {
  const client = await getOwned(ctx, userId, "clients", clientId)
  await ctx.db.patch(client._id, { archived, updatedAt: Date.now() })
  return null
}

const setArchivedArgs = { clientId: v.id("clients"), archived: v.boolean() }

export const setArchived = mutation({
  args: setArchivedArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setArchivedImpl(ctx, await requireUserId(ctx), args.clientId, args.archived),
})

export const setArchivedAs = internalMutation({
  args: { ...setArchivedArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setArchivedImpl(ctx, args.userId, args.clientId, args.archived),
})
