import { traceError } from "./errors"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/**
 * The tables whose rows belong to exactly one user.
 *
 * `userSettings` and `recapDays` are excluded deliberately: they are looked up
 * BY user rather than by id, so there is never an id from the client to verify.
 */
const OWNED_TABLES = ["timeEntries", "projects", "tags"] as const
type OwnedTable = (typeof OWNED_TABLES)[number]

/** Every owned row carries these two, whatever else it holds. */
type OwnedFields = { userId: string; deletedAt: number | null }

/**
 * Loads a row and asserts the caller owns it, in one call.
 *
 * Every id that arrives from a client goes through here. The point is that
 * "fetch" and "check the owner" cannot be separated, so there is no version of
 * this code where someone writes the fetch and forgets the check.
 *
 * A row that does not exist, is soft-deleted, or belongs to another user all
 * raise the same NOT_FOUND. Distinguishing them would tell a caller whether a
 * given id exists in someone else's data.
 *
 * Note that `table` also types `id`, so passing an Id<"projects"> while naming
 * "tags" is a compile error rather than a runtime surprise.
 */
export async function getOwned<T extends OwnedTable>(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  table: T,
  id: Id<T>
): Promise<Doc<T>> {
  return await load(ctx, userId, table, id, false)
}

/**
 * The same ownership check, but a soft-deleted row is returned rather than
 * treated as missing.
 *
 * Exists for exactly two callers — `remove` and `restore` — and is named at
 * length so it cannot be reached for absent-mindedly. Undo is impossible
 * without it: `getOwned` hides the very rows restore has to find, so a delete
 * would be irreversible and a double-fired delete would raise NOT_FOUND on a
 * row the user is looking at.
 *
 * The OWNERSHIP check is not relaxed, only the deleted check. Someone else's
 * deleted row is still NOT_FOUND.
 */
export async function getOwnedIncludingDeleted<T extends OwnedTable>(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  table: T,
  id: Id<T>
): Promise<Doc<T>> {
  return await load(ctx, userId, table, id, true)
}

async function load<T extends OwnedTable>(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  table: T,
  id: Id<T>,
  includeDeleted: boolean
): Promise<Doc<T>> {
  const row = await ctx.db.get(id)
  if (row === null) {
    traceError("NOT_FOUND", `That ${label(table)} no longer exists.`)
  }

  // Narrowed rather than inferred: `Doc<T>` is unresolved while T is generic,
  // so TypeScript cannot see that every table in OWNED_TABLES provably carries
  // both of these fields. It does — the schema is the proof — but the compiler
  // needs the round trip through `unknown` to accept it.
  const owned = row as unknown as OwnedFields
  const hidden = owned.deletedAt !== null && !includeDeleted
  if (owned.userId !== userId || hidden) {
    traceError("NOT_FOUND", `That ${label(table)} no longer exists.`)
  }

  return row
}

/**
 * The same check without loading — for the case where an id was supplied only
 * to be written as a reference (an entry's projectId, say) and the row itself
 * is not needed.
 */
export async function assertOwned<T extends OwnedTable>(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  table: T,
  id: Id<T>
): Promise<void> {
  await getOwned(ctx, userId, table, id)
}

function label(table: OwnedTable): string {
  switch (table) {
    case "timeEntries":
      return "entry"
    case "projects":
      return "project"
    case "tags":
      return "tag"
  }
}
