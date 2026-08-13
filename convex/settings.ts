import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { traceError } from "./errors"
import { checkRate } from "./projects"
import { isValidTimeZone } from "./lib/day"
import { isValidCurrency } from "./lib/money"
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
  /** ISO 4217. Governs the symbol, placement and decimal count everywhere a
   *  rate or a billable amount is shown — see convex/lib/money.ts. USD by
   *  default because that is the actual default most users will want, not
   *  because it is safe to assume: it is surfaced in /settings precisely so a
   *  user whose currency is not USD (e.g. because their timezone is
   *  `Asia/Singapore`) can say so. */
  currency: string
  /** The account's fallback hourly rate, in cents, or absent when nobody has
   *  set one. See the schema — absent is not zero. */
  defaultHourlyRateCents?: number
  /** Print each row's entry notes in the exported PDF report. See the schema
   *  for why the default is off. */
  pdfIncludeNotes: boolean
}

export const SETTINGS_DEFAULTS: Settings = {
  timezone: "UTC",
  weekStartDay: 1, // Monday. Assuming Sunday is wrong for most of the world.
  durationDisplay: "hms",
  timeFormat: "24",
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: true,
  currency: "USD",
  pdfIncludeNotes: false,
}

async function readSettings(ctx: QueryCtx | MutationCtx, userId: string) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first()
}

const settingsReturns = v.object({
  timezone: v.string(),
  defaultHourlyRateCents: v.optional(v.number()),
  weekStartDay: v.number(),
  durationDisplay: v.union(v.literal("hms"), v.literal("decimal")),
  timeFormat: v.union(v.literal("12"), v.literal("24")),
  runawayThresholdMs: v.number(),
  tabTitleClock: v.boolean(),
  currency: v.string(),
  pdfIncludeNotes: v.boolean(),
})

async function getImpl(ctx: QueryCtx, userId: string): Promise<Settings> {
  const row = await readSettings(ctx, userId)
  if (row === null) return SETTINGS_DEFAULTS
  return {
    timezone: row.timezone,
    defaultHourlyRateCents: row.defaultHourlyRateCents,
    weekStartDay: row.weekStartDay,
    durationDisplay: row.durationDisplay,
    timeFormat: row.timeFormat,
    runawayThresholdMs: row.runawayThresholdMs,
    tabTitleClock: row.tabTitleClock,
    // `?? SETTINGS_DEFAULTS.currency`, not `row.currency`: a row written
    // before this column existed has no opinion, and that is a valid, common
    // state rather than one worth a backfill migration.
    currency: row.currency ?? SETTINGS_DEFAULTS.currency,
    // Same additive-column fallback as `currency` above.
    pdfIncludeNotes: row.pdfIncludeNotes ?? SETTINGS_DEFAULTS.pdfIncludeNotes,
  }
}

/**
 * The account's fallback hourly rate, or null when nobody has set one.
 *
 * Its own tiny reader so `entries.rangeSummary` can price billable time that no
 * project rate covers without pulling the whole settings row's meaning into
 * that file — and so there is one place that turns "field absent" into "null",
 * which is the shape the rate resolution in convex/entries.ts branches on.
 */
export async function defaultRateCents(
  ctx: QueryCtx,
  userId: string
): Promise<number | null> {
  const row = await readSettings(ctx, userId)
  return row?.defaultHourlyRateCents ?? null
}

/**
 * The user's currency, or the default when nobody has opened /settings.
 *
 * Its own tiny reader for the same reason `defaultRateCents` is one:
 * `invoices.createFromRangeImpl` needs to SNAPSHOT this onto an invoice at
 * creation (`invoiceFields.currency`) without pulling the whole settings row's
 * meaning into that file, and without a second, hand-copied fallback to
 * `SETTINGS_DEFAULTS.currency` drifting from this one.
 */
export async function currencyOf(ctx: QueryCtx, userId: string): Promise<string> {
  const row = await readSettings(ctx, userId)
  return row?.currency ?? SETTINGS_DEFAULTS.currency
}

export const get = query({
  args: {},
  returns: settingsReturns,
  handler: async (ctx) => await getImpl(ctx, await requireUserId(ctx)),
})

export const getAs = internalQuery({
  args: { userId: v.string() },
  returns: settingsReturns,
  handler: async (ctx, args) => await getImpl(ctx, args.userId),
})

/**
 * Creates the settings row on first authed load, seeding the timezone from the
 * browser.
 *
 * MUST BE CALLED FROM THE CLIENT, and only from the client. It is invoked by
 * `useEnsureSettings` in a `useEffect`, which is the one place in a TanStack
 * Start app guaranteed not to run on the server.
 *
 * The plan originally specified `beforeLoad` on the authed layout, reasoning
 * that loaders run in PARALLEL across matched routes while `beforeLoad` chains.
 * That reasoning is correct and the conclusion is still wrong, because
 * `beforeLoad` also runs on the SERVER during SSR — where
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is the SERVER's zone, not
 * the user's. Combined with the idempotency below, the first render would file
 * every future day boundary under the deployment region's clock and nothing
 * would ever correct it. Silent, permanent, and invisible to anyone who happens
 * to deploy in their own timezone.
 *
 * Idempotent, and never overwrites a zone the user has already got — a laptop
 * carried to another country must not silently re-file last month's invoice.
 * That property is what makes the seeding call safe to repeat, and also what
 * makes getting the FIRST one right non-negotiable.
 */
async function ensureImpl(ctx: MutationCtx, userId: string, suggested?: string) {
  if ((await readSettings(ctx, userId)) !== null) return null

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
}

export const ensure = mutation({
  args: { suggestedTimezone: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) =>
    await ensureImpl(ctx, await requireUserId(ctx), args.suggestedTimezone),
})

export const ensureAs = internalMutation({
  args: { suggestedTimezone: v.optional(v.string()), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await ensureImpl(ctx, args.userId, args.suggestedTimezone),
})

const updateArgs = {
  timezone: v.optional(v.string()),
  weekStartDay: v.optional(v.number()),
  durationDisplay: v.optional(v.union(v.literal("hms"), v.literal("decimal"))),
  timeFormat: v.optional(v.union(v.literal("12"), v.literal("24"))),
  runawayThresholdMs: v.optional(v.number()),
  tabTitleClock: v.optional(v.boolean()),
  currency: v.optional(v.string()),
  pdfIncludeNotes: v.optional(v.boolean()),
  /** `null` CLEARS it, `undefined` leaves it alone — the same three-state
   *  shape `projects.update` uses for the same field, because "set it to
   *  nothing" and "do not touch it" are different requests. */
  defaultHourlyRateCents: v.optional(v.union(v.number(), v.null())),
}

type UpdateArgs = {
  timezone?: string
  weekStartDay?: number
  durationDisplay?: "hms" | "decimal"
  timeFormat?: "12" | "24"
  runawayThresholdMs?: number
  tabTitleClock?: boolean
  currency?: string
  pdfIncludeNotes?: boolean
  defaultHourlyRateCents?: number | null
}

async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  if (args.timezone !== undefined && !isValidTimeZone(args.timezone)) {
    traceError("INVALID_TIMEZONE", `"${args.timezone}" is not a timezone I know.`)
  }
  if (
    args.weekStartDay !== undefined &&
    (!Number.isInteger(args.weekStartDay) ||
      args.weekStartDay < 0 ||
      args.weekStartDay > 6)
  ) {
    traceError("INVALID_WEEK_START", "Week start day must be 0-6.")
  }
  if (args.currency !== undefined && !isValidCurrency(args.currency)) {
    // `isValidCurrency` is now membership in `money.SUPPORTED_CURRENCIES` —
    // the same list the /settings dropdown is built from — rather than the
    // shape check it used to be, so this message is finally true. The wording
    // covers both refusals it can produce: a code that does not exist, and a
    // real one this product does not offer because its minor unit is not a
    // hundredth (JPY, KWD, and 37 others).
    traceError(
      "INVALID_CURRENCY",
      `"${args.currency}" is not a currency Chroneli can use. Pick one from the list in Settings.`
    )
  }

  checkRate(args.defaultHourlyRateCents)

  const row = await readSettings(ctx, userId)
  /*
   * `null` has to become `undefined` before it reaches the patch, and the field
   * has to be LIFTED OUT of the spread to do it — a conditional override on top
   * of `...args` still carries `null` in the type, and would store one.
   *
   * A stored null is not the same state as an absent field: the schema's
   * `v.optional(v.number())` rejects it, and it would mean "cleared" and "never
   * set" were two different values in the table for one fact.
   */
  const { defaultHourlyRateCents, ...rest } = args
  const patch = {
    ...rest,
    ...(defaultHourlyRateCents === undefined
      ? {}
      : { defaultHourlyRateCents: defaultHourlyRateCents ?? undefined }),
    updatedAt: Date.now(),
  }
  if (row === null) {
    await ctx.db.insert("userSettings", { userId, ...SETTINGS_DEFAULTS, ...patch })
  } else {
    await ctx.db.patch(row._id, patch)
  }
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
