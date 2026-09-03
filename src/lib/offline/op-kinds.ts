import { getSkewMs } from "@/lib/clock"
import { optimisticIdFor } from "@/lib/optimistic-id"
import { api } from "../../../convex/_generated/api"
import * as entries from "./optimistic-entries"
import * as classifiers from "./optimistic-classifiers"
import { optimisticSettingsUpdate } from "./optimistic-settings"
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server"
import type { Id } from "../../../convex/_generated/dataModel"
import type { OpKind } from "./op-types"

/** An unclosed start older than this is not resumed — `pending-start`'s rule. */
export const STALE_START_MS = 24 * 60 * 60 * 1000

/**
 * Checks a kind against its mutation without flattening it.
 *
 * Generic over `Def` rather than annotating the parameter, because an
 * annotation becomes the return type: every kind's `immediate` would read as
 * `… | undefined` even where a function literal was plainly given, and the
 * registry's own test could not call one. This validates and hands the
 * literal type straight back.
 *
 * The `Pick<..., "mints" | "minted" | "closedBy">` in the return type is the
 * other half of that same trade: preserving the literal also means a kind
 * that never writes one of these (most of them) genuinely lacks that key on
 * its inferred type, so `Object.values(OP_KINDS)`/`Object.entries(OP_KINDS)`
 * — as the registry's own tests do, for mints/minted and for closedBy — see a
 * union that doesn't carry them everywhere and the property access stops
 * typechecking. The `Pick` guarantees all three stay present (optional) on
 * every kind without widening anything else `Def` already knows precisely.
 */
function kind<
  TRef extends FunctionReference<"mutation", "public">,
  TDef extends OpKind<FunctionArgs<TRef>, FunctionReturnType<TRef>> & { ref: TRef },
>(
  def: TDef
): TDef & Pick<OpKind<FunctionArgs<TRef>, FunctionReturnType<TRef>>, "mints" | "minted" | "closedBy"> {
  return def
}

const nothing = () => null

/**
 * Every mutation the outbox can carry, keyed `module.function`.
 *
 * Absent by design: invoices (numbers must be unique, so raising one is
 * online-only), uploads, Google, music, `settings.ensure` (idempotent and
 * harmless in Convex's own queue), and every `clients.*` (the client never
 * writes them).
 */
export const OP_KINDS = {
  "entries.start": kind({
    ref: api.entries.start,
    label: "Starting the timer",
    optimistic: entries.optimisticStart,
    mints: (args) => optimisticIdFor(args.clientKey),
    minted: (result) => result.entryId,
    immediate: (args, now) => ({
      entryId: optimisticIdFor(args.clientKey) as unknown as Id<"timeEntries">,
      stoppedEntryIds: [],
      // The best estimate of server time available synchronously. Raw
      // Date.now() here would be a claim that the device clock IS the
      // server's, and a caller feeding it to recordServerNow would zero a
      // skew that had been measured — making a running timer jump. The real
      // answer arrives through settled.
      serverNow: now + getSkewMs(),
      replayed: false,
    }),
    staleAfterMs: STALE_START_MS,
    closedBy: ["entries.stop", "entries.discardRunning", "entries.start"],
  }),
  "entries.stop": kind({
    ref: api.entries.stop,
    label: "Stopping the timer",
    optimistic: entries.optimisticStop,
    // Skew-adjusted for the same reason start's is — see there.
    immediate: (_args, now) => ({ stoppedEntryIds: [], serverNow: now + getSkewMs() }),
  }),
  "entries.discardRunning": kind({
    ref: api.entries.discardRunning,
    label: "Discarding the timer",
    optimistic: entries.optimisticDiscard,
    // Empty is honest — nothing has been discarded on the server yet.
    immediate: () => ({ discardedEntryIds: [] }),
  }),
  "entries.setTitle": kind({
    ref: api.entries.setTitle,
    label: "Retitling an entry",
    optimistic: entries.optimisticSetTitle,
    immediate: nothing,
    coalesceKey: (args) => args.entryId,
  }),
  "entries.update": kind({
    ref: api.entries.update,
    label: "Editing an entry",
    optimistic: entries.optimisticUpdate,
    immediate: nothing,
  }),
  "entries.updateMany": kind({
    ref: api.entries.updateMany,
    label: "Editing entries",
    optimistic: entries.optimisticUpdateMany,
    immediate: nothing,
  }),
  "entries.editTime": kind({
    ref: api.entries.editTime,
    label: "Editing an entry's time",
    optimistic: entries.optimisticEditTime,
    // NO `immediate`. The server returns the RECONCILED times, which cannot
    // be derived from the args alone — the rule needs the entry's current
    // times, and `immediate` is not given them. Every call site discards the
    // result anyway; the optimistic function writes the true values to the
    // cache, which is what the screen renders.
  }),
  "entries.remove": kind({
    ref: api.entries.remove,
    label: "Deleting an entry",
    optimistic: entries.optimisticRemove,
    // Empty is honest: nothing has been removed on the server yet.
    immediate: () => ({ removedEntryIds: [] }),
  }),
  "entries.removeMany": kind({
    ref: api.entries.removeMany,
    label: "Deleting entries",
    optimistic: entries.optimisticRemoveMany,
    immediate: () => ({ removedEntryIds: [] }),
  }),
  "entries.restore": kind({
    ref: api.entries.restore,
    label: "Restoring an entry",
    optimistic: entries.optimisticRestore,
    immediate: () => ({ restoredEntryIds: [] }),
  }),
  "entries.restoreMany": kind({
    ref: api.entries.restoreMany,
    label: "Restoring entries",
    optimistic: entries.optimisticRestoreMany,
    immediate: () => ({ restoredEntryIds: [] }),
  }),
  "entries.create": kind({
    ref: api.entries.create,
    label: "Adding an entry",
    optimistic: entries.optimisticCreate,
    mints: (args) => optimisticIdFor(args.clientKey),
    minted: (result) => result.entryId,
    immediate: (args) => ({
      entryId: optimisticIdFor(args.clientKey) as unknown as Id<"timeEntries">,
      replayed: false,
    }),
  }),
  "projects.create": kind({
    ref: api.projects.create,
    label: "Creating a project",
    /*
     * Wrapped rather than referenced bare, because the mutation's `clientKey`
     * is OPTIONAL — projects created before the outbox existed have none —
     * while the optimistic function needs one to key its placeholder on.
     *
     * A guard here and casts in `mints`/`immediate` below, deliberately, and
     * the difference is what each one can do wrong. This function PAINTS —
     * without a key it would put a row keyed `optimistic:undefined` on screen
     * that the outbox could never resolve, so doing nothing is the honest
     * answer. `mints` and `immediate` only ever run for an op the outbox
     * itself enqueued, and Task 9 mints a key for every one, so their casts
     * describe a boundary that is not crossed rather than a case to handle.
     */
    optimistic: (store, args) => {
      if (args.clientKey === undefined) return
      classifiers.optimisticProjectCreate(store, { ...args, clientKey: args.clientKey })
    },
    mints: (args) => optimisticIdFor(args.clientKey as string),
    minted: (result) => result.projectId,
    immediate: (args) => ({
      projectId: optimisticIdFor(args.clientKey as string) as unknown as Id<"projects">,
    }),
  }),
  "projects.update": kind({
    ref: api.projects.update,
    label: "Editing a project",
    optimistic: classifiers.optimisticProjectUpdate,
    immediate: nothing,
    coalesceKey: (args) => args.projectId,
    // MERGE, for the same reason settings.update does: updateArgs is a patch
    // of independent optionals and /projects sends genuine partials — a
    // colour swatch sends {projectId, color}, the name field sends
    // {projectId, name}. Replacing would drop the colour when the name is
    // edited second.
    coalesceMerge: true,
  }),
  "projects.setArchived": kind({
    ref: api.projects.setArchived,
    label: "Archiving a project",
    optimistic: classifiers.optimisticProjectSetArchived,
    immediate: nothing,
  }),
  "projects.remove": kind({
    ref: api.projects.remove,
    label: "Deleting a project",
    optimistic: classifiers.optimisticProjectRemove,
    immediate: nothing,
  }),
  "tags.ensure": kind({
    ref: api.tags.ensure,
    label: "Adding a tag",
    optimistic: classifiers.optimisticTagEnsure,
    mints: (args) => classifiers.tagPlaceholder(args.name),
    minted: (result) => result.tagId,
    immediate: (args) => ({
      tagId: classifiers.tagPlaceholder(args.name) as unknown as Id<"tags">,
      created: true,
    }),
  }),
  "tags.rename": kind({
    ref: api.tags.rename,
    label: "Renaming a tag",
    optimistic: classifiers.optimisticTagRename,
    immediate: nothing,
    coalesceKey: (args) => args.tagId,
  }),
  "tags.remove": kind({
    ref: api.tags.remove,
    label: "Deleting a tag",
    optimistic: classifiers.optimisticTagRemove,
    immediate: nothing,
  }),
  "settings.update": kind({
    ref: api.settings.update,
    label: "Saving settings",
    optimistic: optimisticSettingsUpdate,
    immediate: nothing,
    coalesceKey: () => "settings",
    // MERGE, not replace: a settings save carries one field of many.
    coalesceMerge: true,
  }),
} as const

export type OpKindName = keyof typeof OP_KINDS
export type ArgsOf<TKind extends OpKindName> = FunctionArgs<(typeof OP_KINDS)[TKind]["ref"]>
export type ResultOf<TKind extends OpKindName> = FunctionReturnType<(typeof OP_KINDS)[TKind]["ref"]>
