import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { traceError } from "./errors"
import { isValidTimeZone } from "./lib/day"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/**
 * Defaults for a user who has never opened settings.
 *
 * Timezone is deliberately UTC here rather than a guess: `ensure` seeds the
 * real one from the browser on first authed load. A wrong stored zone silently
 * files entries under the wrong day, so the default has to be the one value
 * that is obviously provisional.
 */
export type Settings = {
  timezone: string
  weekStartDay: number
  /** Declared as the full union, not inferred from the default — otherwise the
   *  type narrows to the one literal the default happens to use. */
  durationDisplay: "hms" | "decimal"
  timeFormat: "12" | "24"
  runawayThresholdMs: number
  tabTitleClock: boolean
  recapMinuteLocal: number
}

export const SETTINGS_DEFAULTS: Settings = {
  timezone: "UTC",
  weekStartDay: 1, // Monday. Assuming Sunday is wrong for most of the world.
  durationDisplay: "hms",
  timeFormat: "24",
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: true,
  recapMinuteLocal: 17 * 60 + 30,
}

async function readSettings(ctx: QueryCtx | MutationCtx, userId: string) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first()
}

export const get = query({
  args: {},
  handler: async (ctx): Promise<Settings> => {
    const userId = await requireUserId(ctx)
    const row = await readSettings(ctx, userId)
    if (row === null) return SETTINGS_DEFAULTS
    return {
      timezone: row.timezone,
      weekStartDay: row.weekStartDay,
      durationDisplay: row.durationDisplay,
      timeFormat: row.timeFormat,
      runawayThresholdMs: row.runawayThresholdMs,
      tabTitleClock: row.tabTitleClock,
      recapMinuteLocal: row.recapMinuteLocal,
    }
  },
})

/**
 * Creates the settings row on first authed load, seeding the timezone from the
 * browser.
 *
 * Called from the authed layout's beforeLoad rather than a loader: TanStack
 * Router runs loaders in PARALLEL across matched routes, so a child loader
 * cannot assume a parent loader has resolved. beforeLoad does chain, and every
 * day boundary downstream depends on this value existing.
 *
 * Idempotent, and never overwrites a zone the user has already got — a laptop
 * carried to another country must not silently re-file last month's invoice.
 */
export const ensure = mutation({
  args: { suggestedTimezone: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    if ((await readSettings(ctx, userId)) !== null) return null

    const suggested = args.suggestedTimezone
    const timezone =
      suggested !== undefined && isValidTimeZone(suggested)
        ? suggested
        : SETTINGS_DEFAULTS.timezone

    await ctx.db.insert("userSettings", {
      userId,
      ...SETTINGS_DEFAULTS,
      timezone,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const update = mutation({
  args: {
    timezone: v.optional(v.string()),
    weekStartDay: v.optional(v.number()),
    durationDisplay: v.optional(v.union(v.literal("hms"), v.literal("decimal"))),
    timeFormat: v.optional(v.union(v.literal("12"), v.literal("24"))),
    runawayThresholdMs: v.optional(v.number()),
    tabTitleClock: v.optional(v.boolean()),
    recapMinuteLocal: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)

    if (args.timezone !== undefined && !isValidTimeZone(args.timezone)) {
      traceError("INVALID_TIMEZONE", `"${args.timezone}" is not a timezone I know.`)
    }
    if (
      args.weekStartDay !== undefined &&
      (!Number.isInteger(args.weekStartDay) ||
        args.weekStartDay < 0 ||
        args.weekStartDay > 6)
    ) {
      traceError("INVALID_TIMEZONE", "Week start day must be 0-6.")
    }

    const row = await readSettings(ctx, userId)
    const patch = { ...args, updatedAt: Date.now() }
    if (row === null) {
      await ctx.db.insert("userSettings", { userId, ...SETTINGS_DEFAULTS, ...patch })
    } else {
      await ctx.db.patch(row._id, patch)
    }
    return null
  },
})
