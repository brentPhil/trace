import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { MAX_DURATION_MS } from "./lib/duration"
import { ENTRY_SCAN_LIMIT } from "./lib/scan"
import { projectDoc } from "./lib/docs"
import { DEFAULT_PROJECT_COLOR, isProjectColor, suggestProjectColor } from "./lib/palette"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MAX_NAME_LENGTH = 120

/**
 * The most a project can be worth per hour: 1,000,000.00 of whatever currency
 * the user has set.
 *
 * A ceiling rather than no ceiling, for the same reason MAX_NAME_LENGTH exists
 * — past some point the input is a typo, and a typo that lands is permanent.
 *
 * DERIVED rather than chosen, so the arithmetic invariant behind it is
 * executable instead of a sentence in a comment. `rangeSummaryImpl` in
 * convex/entries.ts accumulates `durationMs * hourlyRateCents` as an integer,
 * and a single entry is capped at 24h (DURATION_TOO_LONG) — so one entry's
 * term stays inside JavaScript's 9.007e15 exact-integer range exactly when the
 * rate is at or below `MAX_SAFE_INTEGER / MAX_DURATION_MS`, which is
 * 104,249,991. The product ceiling of 1,000,000.00 is lower and is what
 * actually binds; writing the other bound down is what stops a future change
 * to `MAX_DURATION_MS` silently invalidating it. Three files, one invariant,
 * and now only one of them states it.
 *
 * WHAT THIS DOES NOT COVER, said plainly because the previous version of this
 * comment read as though it did. The bound is per ENTRY. `rangeSummaryImpl`
 * SUMS that term over every row in a range — up to `SUMMARY_SCAN_LIMIT` of
 * them — and the sum has no such ceiling. It leaves the exact-integer range
 * once one query's billable time passes about 25 hours at the maximum rate, or
 * about 25,000 hours at a more plausible 1,000.00 an hour.
 *
 * That is not a live bug, and the reason is worth recording rather than
 * rediscovering. Past 2^53 the sum is not garbage, it is QUANTISED: the error
 * is bounded by roughly one unit in the last place per addition, and the total
 * is divided by 3,600,000 before being rounded to a cent. Even at the absurd
 * ceiling — `SUMMARY_SCAN_LIMIT` entries of 24 hours each at the maximum rate,
 * a range worth 120 billion — that is single-digit cents against a figure of
 * 1.2e13 cents. At any plausible magnitude it is orders of magnitude under the
 * half-cent that could flip the rounded total, which is the same residual the
 * rounding rule in convex/entries.ts already accepts by name.
 */
export const MAX_RATE_CENTS = Math.min(
  100_000_000,
  Math.floor(Number.MAX_SAFE_INTEGER / MAX_DURATION_MS)
)

/**
 * Validates an hourly rate server-side.
 *
 * Mirrors the `weekStartDay` range check in convex/settings.ts, and exists for
 * the same reason: `v.number()` is not a validator of MEANING. Convex carries
 * every IEEE-754 double, non-finite ones included, and `parseMoney` runs only
 * in the browser — so a direct mutation call could store NaN. That one value
 * then poisoned an entire range on /reports: `billableCentsExact` goes NaN,
 * `Math.round(NaN)` is NaN, the `v.number()` RETURN validator accepts it, and
 * every other project's correctly-computed money renders as "$NaN" until
 * somebody works out which project to clear. `Infinity` did the same in a
 * different glyph, and a negative silently subtracted from the total.
 *
 * `undefined` and `null` are not rates and are not checked here: they mean
 * "not supplied" and "clear it" respectively, which the callers handle.
 */
function checkRate(cents: number | null | undefined): void {
  if (cents === undefined || cents === null) return
  if (!Number.isInteger(cents)) {
    // Catches NaN and both infinities as well as 10.5 — `Number.isInteger` is
    // false for all of them, which is exactly the set that must not be stored.
    traceError(
      "INVALID_RATE",
      "A rate has to be a whole number of cents. Type it as an amount, like 10.50."
    )
  }
  if (cents < 0) {
    traceError("INVALID_RATE", "A rate cannot be negative.")
  }
  if (cents > MAX_RATE_CENTS) {
    traceError(
      "INVALID_RATE",
      `That rate looks like a typo — the most a project can be worth is ${MAX_RATE_CENTS / 100} an hour.`
    )
  }
}

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
  returns: v.array(projectDoc),
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
  checkRate(args.hourlyRateCents)
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
 *
 * `hourlyRateCents` DELIBERATELY GOES THE OTHER WAY, and this paragraph exists
 * because the opposite choice is documented one paragraph above and the
 * difference was never stated anywhere.
 *
 * The rate is not copied onto entries. `entries.rangeSummary` reads whatever
 * this field holds AT QUERY TIME, so raising a rate today changes what March
 * was worth, on every report, retroactively and with nothing on screen to say
 * so. That is what Toggl does and it is the behaviour most people expect from
 * a rate that lives on a project rather than on an entry: "my rate is X" is a
 * statement about the client, and a user correcting a typo in it wants the
 * correction to apply, not to have to re-file three months of work.
 *
 * The reason it is safe to differ from `billableByDefault` is that a rate is a
 * PRICE and the billable flag is a FACT. Re-pricing history is arithmetic the
 * user can see and reverse by typing the old number back; rewriting the
 * billable flag destroys the record of a decision, and no old number restores
 * which entries had been marked by hand.
 *
 * The cost is real and accepted: an invoice sent in March is not reproducible
 * from /reports after an April rate change. If that ever needs to stop being
 * true, the fix is to snapshot the rate onto each entry at creation (as
 * `billable` already is) — NOT to add a second, quieter rule here. See the
 * `billableCents` doc in convex/entries.ts, which says the same thing from the
 * reading end.
 */
async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const project = await getOwned(ctx, userId, "projects", args.projectId)
  checkRate(args.hourlyRateCents)

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
 *
 * The scan is BOUNDED. `by_user_project` means only this project's own entries
 * are read rather than the whole account, but that is still every entry ever
 * filed against a client someone has billed for three years, and an unbounded
 * `.collect()` over it eventually exceeds the per-transaction byte limit. The
 * failure would be an internal error on a Delete button — permanent, opaque, and
 * with no action the user could take. A bound turns it into a sentence.
 *
 * Unlike tags, this only needs to know whether ANY live entry exists, so the
 * window is a cheap existence check rather than a full count. Saturating it is
 * itself proof the project is in use: 2,000 entries cannot all be soft-deleted
 * in an account that has not been mass-deleting, and either way the answer the
 * user needs — archive instead — is the same one.
 */
async function removeImpl(ctx: MutationCtx, userId: string, projectId: Id<"projects">) {
  const project = await getOwned(ctx, userId, "projects", projectId)

  const referencing = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_project", (q) =>
      q.eq("userId", userId).eq("projectId", project._id)
    )
    .take(ENTRY_SCAN_LIMIT + 1)
  const saturated = referencing.length > ENTRY_SCAN_LIMIT
  const live = referencing
    .slice(0, ENTRY_SCAN_LIMIT)
    .filter((entry) => entry.deletedAt === null)

  if (live.length > 0) {
    // "at least" once saturated, because the count is then a floor rather than
    // a total, and a precise-looking number that is wrong is worse than a
    // vaguer one that is right.
    const count = saturated ? `At least ${live.length}` : `${live.length}`
    traceError(
      "IN_USE",
      `${count} ${live.length === 1 ? "entry uses" : "entries use"} this project. Archive it instead — the entries keep their history.`,
      { count: live.length }
    )
  }

  // Nothing live in the window, but the window did not reach the end. "It is
  // unused" is not a claim this can make, so it does not make it.
  if (saturated) {
    traceError(
      "IN_USE",
      "This project has too many entries to check. Archive it instead — it disappears from the pickers and every entry keeps its history."
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
