# Offline Outbox and Cached Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chroneli keeps working with no network — every entry, project, tag and settings write, and every cached read — and syncs, in order, when the connection returns, surviving reloads and offline boots.

**Architecture:** One persistent outbox (IndexedDB) that journals every offline-capable mutation before sending it through Convex one at a time, rewriting placeholder ids as producers resolve. One optimistic function per mutation, run against both Convex's store and a TanStack-cache adapter. A snapshot layer in the TanStack `queryFn` serves the last result of any query when the socket is down. A hand-built service worker boots the shell offline.

**Tech Stack:** TanStack Start/Router/Query 1.16x/5.101, Convex 1.43 with `@convex-dev/react-query`, `idb-keyval` 6.3, `fake-indexeddb` 6.2 (tests), Vitest 4 (projects `unit`/`dom`/`convex`), Tailwind 4, shadcn.

Spec: `docs/superpowers/specs/2026-09-03-offline-outbox-design.md`.

## Global Constraints

- Read `CLAUDE.md`, `DESIGN.md` §2 Named Rules and `convex/_generated/ai/guidelines.md` before touching visual or Convex code.
- Nothing under `src/components/` may import `api`, `useConvexMutation` or `convexQuery` (`eslint.config.js` enforces it). Components take data and writes as props.
- The palette is closed: no new colour tokens. State is never carried by colour alone (The Over-Determined State Rule). Status surfaces use `role="status"`.
- Placeholder ids are `optimistic:<key>` from `src/lib/optimistic-id.ts`. Never send one to a mutation.
- Run `pnpm typecheck` and the tests before every commit. `pnpm typecheck` runs both tsconfigs.
- **Lint your own files with `pnpm eslint <paths you touched>`, never by reading the tail of `pnpm lint`.** The whole-repo run exits 1 on a clean tree from 209 pre-existing errors in the gitignored vendored directories `ds-bundle/` and `design-sync/`, and a real error in your own file scrolls past above them. Two tasks shipped six lint errors this way.
- **Type-only imports are top-level, never inline.** `import type { A, B } from "./x"` on its own line — not `import { c, type A } from "./x"`. `import/consistent-type-specifier-style` enforces it, and the code blocks in this plan predate the rule being noticed, so fix the form as you transcribe them.
- Do not run bare `pnpm test`: all three vitest projects at once has a known flake (~11 convex tests time out; they pass alone). Run `pnpm vitest run --project unit --project dom`, `pnpm vitest run --project convex`, or a single file.
- Commit after every task. Commit messages follow the repo's `type(scope): sentence` style and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tests: pure modules → `src/**/*.test.ts` (node, project `unit`); React → `src/**/*.test.tsx` (jsdom, project `dom`); Convex functions → `convex/*.test.ts` (project `convex`). Run one file with `pnpm vitest run <path>`.
- The dev server is `pnpm dev` on port 3100 (memory: always that port). The service worker is production-only; do not register it in dev.

---

## File map

New:
- `src/lib/offline/op-types.ts` — `Op`, `OutboxSnapshot`, `OutboxStore`, `OpKind` types.
- `src/lib/offline/placeholders.ts` — deep rewrite / scan of placeholder ids in args.
- `src/lib/offline/outbox-store-memory.ts`, `src/lib/offline/outbox-store-idb.ts` — journal stores.
- `src/lib/offline/tanstack-local-store.ts` — `OptimisticLocalStore` over a `QueryClient`.
- `src/lib/offline/outbox.ts` — the engine (enqueue, coalesce, drain, rewrite, drop).
- `src/lib/offline/rejections.ts` — which rejections are retryable.
- `src/lib/offline/web-lock.ts` — Web Locks wrapper with a fallback.
- `src/lib/offline/optimistic-entries.ts`, `optimistic-classifiers.ts`, `optimistic-settings.ts` — the optimistic functions, moved out of hooks.
- `src/lib/offline/op-kinds.ts` — the registry: kind name → ref, label, optimistic, placeholder rules.
- `src/lib/offline/create-outbox.ts` — wires store, adapter, Convex sender, lock.
- `src/lib/offline/outbox-provider.tsx` — React context, `useOutbox`, `useOutboxMutation`, `usePendingCount`, `useOutboxEvents`.
- `src/lib/offline/online.ts`, `src/lib/offline/use-online-status.ts` — the online predicate and hook.
- `src/lib/offline/query-snapshots.ts` — snapshot store, writer, wrapped `queryFn`.
- `src/lib/offline/remembered-auth.ts` — the signed-in flag for offline boots.
- `src/lib/offline/clear-local-data.ts` — sign-out cleanup.
- `src/lib/offline/offline-copy.ts` — the sentences shown for offline-disabled controls.
- `src/lib/offline/register-sw.ts` — production registration.
- `src/hooks/use-convex-pages.ts` — TanStack-cached pagination for `listPage`.
- `src/components/shell/sync-status.tsx` — the status line.
- `src/components/shell/offline-pending.tsx` — the `_authed` pending component.
- `src/sw/routing.ts`, `src/sw/index.ts`, `vite.sw.config.ts` — the service worker.
- `convex/projects.test.ts`.
- `docs/offline.md`.

Modified: `convex/schema.ts`, `convex/projects.ts`, `convex/entries.ts`, `convex/entries.test.ts`, `src/router.tsx`, `src/routes/__root.tsx`, `src/routes/_authed.tsx`, `src/routes/_authed/-timer.tsx`, `src/routes/_authed/-settings.tsx`, `src/routes/_authed/-music-library.tsx`, `src/routes/_authed/invoices_.new.tsx`, `src/hooks/use-entry-mutations.ts`, `src/hooks/use-entry-edit-mutations.ts`, `src/hooks/use-entry-edit-mutations.test.ts`, `src/hooks/use-classifiers.ts`, `src/hooks/use-timer-effects.ts`, `src/lib/auth-client.ts`, `src/components/shell/app-shell.tsx`, `src/components/shell/app-sidebar.tsx`, `package.json`, `docs/desktop.md`.

Deleted: `src/lib/pending-start.ts`.

---

### Task 1: Dependencies and the idempotent project create

**Files:**
- Modify: `package.json`
- Modify: `convex/schema.ts:492-496`
- Modify: `convex/projects.ts:170-220`
- Create: `convex/projects.test.ts`

**Interfaces:**
- Produces: `api.projects.create` accepts optional `clientKey: string` and returns the existing `{ projectId }` when a row with that key exists for the caller. `internal.projects.createAs` accepts the same.

- [ ] **Step 1: Install packages**

```bash
pnpm add idb-keyval@^6.3.0 && pnpm add -D fake-indexeddb@^6.2.5
```

Expected: both appear in `package.json`. If the install fails on disk space (the `C:` cache has been full before, see `src/test-utils/setup-dom.ts`), run `pnpm store prune` and retry.

- [ ] **Step 2: Write the failing Convex test**

Create `convex/projects.test.ts`:

```ts
/// <reference types="vite/client" />
// Projects: the idempotent create the offline outbox replays.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { internal } from "./_generated/api"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

describe("projects.create with a clientKey", () => {
  it("returns the same project when the same key is sent twice", async () => {
    const t = setup()
    const first = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website",
      clientKey: "key-1",
    })
    const second = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website (retry)",
      clientKey: "key-1",
    })
    expect(second.projectId).toBe(first.projectId)
    const rows = await t.query(internal.projects.listAs, { userId: ALICE })
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("Website")
  })

  it("scopes the key to the user, so two users can share one by accident", async () => {
    const t = setup()
    const alice = await t.mutation(internal.projects.createAs, {
      userId: ALICE,
      name: "Website",
      clientKey: "shared",
    })
    const bob = await t.mutation(internal.projects.createAs, {
      userId: BOB,
      name: "Website",
      clientKey: "shared",
    })
    expect(bob.projectId).not.toBe(alice.projectId)
  })

  it("still creates without a key, as every existing caller does", async () => {
    const t = setup()
    const a = await t.mutation(internal.projects.createAs, { userId: ALICE, name: "A" })
    const b = await t.mutation(internal.projects.createAs, { userId: ALICE, name: "B" })
    expect(a.projectId).not.toBe(b.projectId)
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm vitest run convex/projects.test.ts
```

Expected: FAIL — argument validation rejects `clientKey` (not in `createArgs`).

- [ ] **Step 4: Add the field and index to the schema**

In `convex/schema.ts`, inside `projectFields` after `userId: v.string(),` add:

```ts
  /** UUIDv7 minted by the client before the mutation is sent, so a create
   *  replayed from the offline outbox returns the existing row instead of a
   *  second project. Optional: rows created before the outbox have none. */
  clientKey: v.optional(v.string()),
```

And change the `projects` table definition to:

```ts
  projects: defineTable(projectFields)
    .index("by_user_archived_name", ["userId", "archived", "name"])
    .index("by_user_clientKey", ["userId", "clientKey"]),
```

- [ ] **Step 5: Make `createImpl` idempotent**

In `convex/projects.ts`, add to `createArgs` (the const the mutation spreads; find `const createArgs = {`):

```ts
  clientKey: v.optional(v.string()),
```

Add `clientKey?: string` to the `CreateArgs` type beside it. Then replace the body of `createImpl` with:

```ts
async function createImpl(ctx: MutationCtx, userId: string, args: CreateArgs) {
  // Replay branch first, before validation: the row that exists already
  // passed it, and the retry may carry a name the user has since edited.
  if (args.clientKey !== undefined) {
    const replay = await ctx.db
      .query("projects")
      .withIndex("by_user_clientKey", (q) =>
        q.eq("userId", userId).eq("clientKey", args.clientKey)
      )
      .first()
    if (replay !== null) return { projectId: replay._id }
  }

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
    clientKey: args.clientKey,
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
```

- [ ] **Step 6: Run the tests and the typecheck**

```bash
pnpm vitest run convex/projects.test.ts && pnpm typecheck
```

Expected: 3 passed; typecheck clean. If `convex/lib/docs.ts`'s `projectDoc` is used as a `returns` validator somewhere and now complains, it spreads `projectFields` and picks the new optional field up automatically — no change needed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml convex/schema.ts convex/projects.ts convex/projects.test.ts
git commit -m "feat(projects): an idempotent create, keyed like entries, for the outbox to replay"
```

---

### Task 2: `stop` closes only the entry it names

**Files:**
- Modify: `convex/entries.ts` — `stopImpl` and the `stop` / `stopAs` declarations beneath it
- Modify: `convex/entries.test.ts`

**Interfaces:**
- Produces: `api.entries.stop` and `internal.entries.stopAs` accept an optional `entryId: v.id("timeEntries")`. Given one, only that entry is closed, and only while it is still running. Omitted, behaviour is exactly as it is today — every running entry closes at `endedAt ?? now`.

**Why an id rather than a timestamp guard.** The outbox replays a stop carrying the instant the user pressed it, which can land after another device has started something new. From the timestamps alone that is indistinguishable from a backwards clock — the case `convex/entries.test.ts`'s "never produces an end at or before the start" pins, because a timer that can never be stopped is the worst failure in the product. The name is what tells them apart: it says which timer the user was actually looking at. This was found during implementation; an earlier version of this task used a `entry.startedAt >= endedAt` guard and broke that test.

- [ ] **Step 1: Write the failing tests**

Append both inside the existing top-level `describe` in `convex/entries.test.ts`, which already has `setup`, `ALICE`, `key()`, and uses `internal.entries.startAs` / `stopAs` / `getRunningAs`:

```ts
  it("closes only the entry it names, so a replayed stop cannot end a later timer", async () => {
    const t = setup()
    const { entryId: earlier } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    // A second start closes the first and becomes the running one — which is
    // what another device starting something else looks like from here.
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(2) })

    // The stop the first device queued while offline, naming the entry it was
    // looking at, arriving now.
    const result = await t.mutation(internal.entries.stopAs, {
      userId: ALICE,
      entryId: earlier,
      endedAt: Date.now(),
    })

    expect(result.stoppedEntryIds).toEqual([])
    expect(
      await t.query(internal.entries.getRunningAs, { userId: ALICE })
    ).not.toBeNull()
  })

  it("stops the entry it names when that entry is the running one", async () => {
    const t = setup()
    const { entryId } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })

    const result = await t.mutation(internal.entries.stopAs, { userId: ALICE, entryId })

    expect(result.stoppedEntryIds).toEqual([entryId])
    expect(await t.query(internal.entries.getRunningAs, { userId: ALICE })).toBeNull()
  })

  it("discards only the entry it names, so a replayed discard cannot delete a later timer", async () => {
    const t = setup()
    const { entryId: earlier } = await t.mutation(internal.entries.startAs, {
      userId: ALICE,
      clientKey: key(1),
    })
    await t.mutation(internal.entries.startAs, { userId: ALICE, clientKey: key(2) })

    await t.mutation(internal.entries.discardRunningAs, { userId: ALICE, entryId: earlier })

    expect(
      await t.query(internal.entries.getRunningAs, { userId: ALICE })
    ).not.toBeNull()
  })
```

- [ ] **Step 2: Run them to verify they fail**

```bash
pnpm vitest run convex/entries.test.ts -t "only the entry it names"
```

Expected: FAIL on argument validation — `entryId` is not in `stopAs`'s args.

- [ ] **Step 3: Take the name in `stopImpl`**

In `convex/entries.ts`, replace `stopImpl` and the two declarations under it with:

```ts
async function stopImpl(
  ctx: MutationCtx,
  userId: string,
  endedAt: number | undefined,
  entryId: Id<"timeEntries"> | undefined
) {
  const now = Date.now()
  const running = await runningEntries(ctx, userId)

  /*
   * A stop that NAMES an entry closes that entry and nothing else.
   *
   * The offline outbox replays a stop carrying the instant the user pressed
   * it, which can arrive after another device has started something new.
   * Against the timestamps alone that is the same shape as a backwards clock
   * — the case the test above insists must still stop the timer, because a
   * timer that can never be stopped is the worst failure this product has.
   * There is no telling them apart from the numbers. The name does it: it
   * says which timer the user was looking at.
   *
   * Filtering `running` rather than fetching by id is what keeps ownership
   * intact for free — `runningEntries` is already scoped to `userId`, so a
   * name belonging to somebody else matches nothing rather than needing its
   * own check that a later edit could drop.
   */
  const targets =
    entryId === undefined ? running : running.filter((entry) => entry._id === entryId)

  const stoppedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of targets) {
    if (await closeEntry(ctx, entry, endedAt ?? now, now)) {
      stoppedEntryIds.push(entry._id)
    }
  }
  return { stoppedEntryIds, serverNow: now }
}

const stopArgs = {
  endedAt: v.optional(v.number()),
  /** Which timer this stop is for. Absent means "whatever is running", which
   *  is every caller that is looking at the live server state. */
  entryId: v.optional(v.id("timeEntries")),
}

export const stop = mutation({
  args: stopArgs,
  returns: stopReturns,
  handler: async (ctx, args) =>
    await stopImpl(ctx, await requireUserId(ctx), args.endedAt, args.entryId),
})

export const stopAs = internalMutation({
  args: { ...stopArgs, userId: v.string() },
  returns: stopReturns,
  handler: async (ctx, args) => await stopImpl(ctx, args.userId, args.endedAt, args.entryId),
})
```

Leave `stopImpl`'s existing doc comment above it in place — its "never refuses, and is a no-op when nothing is" argument still holds, and a named stop that matches nothing is exactly such a no-op.

- [ ] **Step 3b: The same name on `discardRunning`**

`discardRunning` carries the identical hazard and is worse when it bites: it DELETES rather than closes, so a discard replayed after another device started something takes a live timer with it. Give it the same optional name. Find `discardRunningImpl` in `convex/entries.ts`, add the parameter, and filter the running entries it acts on exactly as `stopImpl` now does:

```ts
async function discardRunningImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries"> | undefined
) {
  // … whatever the existing body reads the running entries into, then the
  // same one-line narrowing stopImpl uses, for the same reason and with the
  // same ownership argument — `runningEntries` is already scoped to userId:
  //
  //   const targets =
  //     entryId === undefined ? running : running.filter((e) => e._id === entryId)
  //
  // and the existing delete loop runs over `targets`.
}
```

Read the existing `discardRunningImpl` and adapt it in place rather than rewriting it — keep its current doc comment, its return shape, and whatever it does per entry. Then thread the argument through both declarations:

```ts
const discardArgs = {
  /** Which timer to discard. Absent means "whatever is running" — see the
   *  note in `stopImpl` for why a replayed discard has to say. */
  entryId: v.optional(v.id("timeEntries")),
}

export const discardRunning = mutation({
  args: discardArgs,
  returns: discardReturns,
  handler: async (ctx, args) =>
    await discardRunningImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const discardRunningAs = internalMutation({
  args: { ...discardArgs, userId: v.string() },
  returns: discardReturns,
  handler: async (ctx, args) => await discardRunningImpl(ctx, args.userId, args.entryId),
})
```

- [ ] **Step 4: Run the whole file**

```bash
pnpm vitest run convex/entries.test.ts
```

Expected: every test passes, including "never produces an end at or before the start, even with a backwards clock" and "is a no-op the second time", both of which call `stopAs` with no `entryId` and must be untouched by this change.

- [ ] **Step 5: Commit**

```bash
git add convex/entries.ts convex/entries.test.ts
git commit -m "feat(entries): a stop or discard names the timer it is for, so a replayed one cannot take a later entry"
```

---

### Task 3: Op types and placeholder rewriting

**Files:**
- Create: `src/lib/offline/op-types.ts`
- Create: `src/lib/offline/placeholders.ts`
- Test: `src/lib/offline/placeholders.test.ts`

**Interfaces:**
- Produces: `Op`, `OutboxSnapshot`, `EMPTY_SNAPSHOT`, `OutboxStore`, `OpKind<Args, Result>`, `OpLocal`; `rewritePlaceholders<T>(value: T, resolved: Record<string,string>): T`; `unresolvedPlaceholders(value: unknown, resolved): string[]`.

- [ ] **Step 1: Write the types**

Create `src/lib/offline/op-types.ts`:

```ts
import type { FunctionReference } from "convex/server"
import type { OptimisticLocalStore } from "convex/browser"

/** Extra data an op carries for its optimistic update only — never sent. */
export type OpLocal = Record<string, unknown>

/** One journaled write intent. Persisted as-is, so keep it JSON-plain. */
export type Op = {
  /** UUIDv7, so ops sort in the order they were made. */
  id: string
  /** A key of `OP_KINDS`. */
  kind: string
  /** The mutation's args, possibly holding placeholder ids. */
  args: Record<string, unknown>
  local?: OpLocal
  enqueuedAt: number
  /** Handed to Convex and not yet acknowledged. Reset on load: a reload
   *  loses Convex's in-memory queue, so an in-flight op must be re-sent. */
  inFlight: boolean
}

export type OutboxSnapshot = {
  ops: Op[]
  /** placeholder id → real id, kept while any pending op still mentions it. */
  resolved: Record<string, string>
}

export const EMPTY_SNAPSHOT: OutboxSnapshot = { ops: [], resolved: {} }

/** The journal. `update` must apply `fn` atomically against the stored value. */
export interface OutboxStore {
  read(): Promise<OutboxSnapshot>
  update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot>
}

/**
 * What the outbox knows about one mutation.
 *
 * `optimistic` is THE optimistic function for the mutation: it runs against
 * the TanStack adapter at enqueue and again as Convex's `optimisticUpdate`
 * when the op is sent. It must be idempotent — it is re-applied on every
 * boot and on every Convex transition.
 */
export type OpKind<Args extends Record<string, unknown>, Result> = {
  ref: FunctionReference<"mutation", "public", Args, Result>
  /** Sentence fragment for a toast: "Retitling an entry". */
  label: string
  optimistic?: (store: OptimisticLocalStore, args: Args, local: OpLocal | undefined) => void
  /** The placeholder id this op puts on screen before the server answers. */
  mints?: (args: Args) => string
  /** Where the real id for that placeholder lands in the result. */
  minted?: (result: Result) => string
  /** What the caller is handed straight away. */
  immediate: (args: Args, now: number) => Result
  /** Two consecutive unsent ops with equal keys collapse into one. */
  coalesceKey?: (args: Args) => string
  /**
   * How a collapse combines the two ops' args.
   *
   * Default (false/absent) is REPLACE, which is right when the args are the
   * whole value — a retitle carries the complete title, so the later one is
   * the answer. MERGE is for a patch of independent fields: two settings
   * saves, one setting the currency and one the timezone, must not lose the
   * currency because the timezone was typed second.
   */
  coalesceMerge?: boolean
  /** Older than this, and not followed by one of `closedBy`, the op is dropped. */
  staleAfterMs?: number
  closedBy?: ReadonlyArray<string>
}
```

- [ ] **Step 2: Write the failing placeholder test**

Create `src/lib/offline/placeholders.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { rewritePlaceholders, unresolvedPlaceholders } from "./placeholders"

const resolved = { "optimistic:p1": "projects:real1", "optimistic:e1": "entries:real1" }

describe("rewritePlaceholders", () => {
  it("replaces placeholder strings anywhere in the args", () => {
    const args = {
      entryId: "optimistic:e1",
      projectId: "optimistic:p1",
      tagIds: ["tags:t1", "optimistic:p1"],
      nested: { keep: "optimistic:unknown", n: 3, flag: true, nil: null },
    }
    expect(rewritePlaceholders(args, resolved)).toEqual({
      entryId: "entries:real1",
      projectId: "projects:real1",
      tagIds: ["tags:t1", "projects:real1"],
      nested: { keep: "optimistic:unknown", n: 3, flag: true, nil: null },
    })
  })

  it("returns the same reference when nothing changes", () => {
    const args = { title: "hello", n: 1 }
    expect(rewritePlaceholders(args, resolved)).toBe(args)
    const nested = { a: ["x"], b: { c: "y" } }
    expect(rewritePlaceholders(nested, resolved)).toBe(nested)
  })

  it("leaves a string that names a prototype property alone", () => {
    // Every string in the args reaches the lookup, not only placeholder-shaped
    // ones, and a plain object answers for its prototype. An entry really can
    // be titled "constructor".
    const args = { title: "constructor", note: "toString", tags: ["__proto__"] }
    expect(rewritePlaceholders(args, resolved)).toBe(args)
  })
})

describe("unresolvedPlaceholders", () => {
  it("lists placeholders with no real id yet, once each", () => {
    const args = { a: "optimistic:x", b: ["optimistic:x", "optimistic:e1"], c: "plain" }
    expect(unresolvedPlaceholders(args, resolved)).toEqual(["optimistic:x"])
  })

  it("is empty for plain args", () => {
    expect(unresolvedPlaceholders({ title: "x", ids: ["a"] }, {})).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm vitest run src/lib/offline/placeholders.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/lib/offline/placeholders.ts`:

```ts
import { isOptimisticId } from "@/lib/optimistic-id"

/**
 * Placeholder ids inside mutation args.
 *
 * An op made offline may name an id the server has not minted yet — the
 * project created a moment earlier, the entry started an hour ago. The
 * outbox learns the real id when the producing op is acknowledged and
 * rewrites every later op before sending it. These two walkers are that
 * rewrite and its precondition. Pure; no Convex, no DOM.
 */

function walk(value: unknown, onString: (s: string) => string): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const next = onString(value)
    return { value: next, changed: next !== value }
  }
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const r = walk(item, onString)
      if (r.changed) changed = true
      return r.value
    })
    return { value: changed ? next : value, changed }
  }
  if (typeof value === "object" && value !== null) {
    let changed = false
    const next: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const r = walk(item, onString)
      if (r.changed) changed = true
      next[key] = r.value
    }
    return { value: changed ? next : value, changed }
  }
  return { value, changed: false }
}

/** Replaces every resolved placeholder. Same reference back when nothing changed. */
export function rewritePlaceholders<T>(value: T, resolved: Record<string, string>): T {
  // `Object.hasOwn`, not `resolved[s] ?? s`. This callback sees EVERY string
  // in the args, not only placeholder-shaped ones, and a plain object answers
  // for its prototype: an entry titled "constructor" or a project named
  // "toString" would look up a function and splice it into the args, which
  // then goes to a mutation that takes strings. Found in review.
  return walk(value, (s) => (Object.hasOwn(resolved, s) ? resolved[s] : s)).value as T
}

/** Placeholders present in `value` that `resolved` cannot answer, in order, once each. */
export function unresolvedPlaceholders(value: unknown, resolved: Record<string, string>): string[] {
  const found: string[] = []
  walk(value, (s) => {
    if (isOptimisticId(s) && resolved[s] === undefined && !found.includes(s)) found.push(s)
    return s
  })
  return found
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm vitest run src/lib/offline/placeholders.test.ts
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/offline/op-types.ts src/lib/offline/placeholders.ts src/lib/offline/placeholders.test.ts
git commit -m "feat(offline): op types, and the placeholder rewrite the outbox sends through"
```

---

### Task 4: Journal stores (memory and IndexedDB)

**Files:**
- Create: `src/lib/offline/outbox-store-memory.ts`
- Create: `src/lib/offline/outbox-store-idb.ts`
- Test: `src/lib/offline/outbox-store.test.ts`

**Interfaces:**
- Produces: `class MemoryOutboxStore implements OutboxStore`; `class IdbOutboxStore implements OutboxStore` (constructor `(dbName = "chroneli-offline")`); `createOutboxStore(): OutboxStore` (IDB when available, else memory).

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/outbox-store.test.ts`:

```ts
import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { IdbOutboxStore } from "./outbox-store-idb"
import { EMPTY_SNAPSHOT } from "./op-types"
import type { Op, OutboxStore } from "./op-types"

function op(id: string): Op {
  return { id, kind: "entries.setTitle", args: { title: id }, enqueuedAt: 1, inFlight: false }
}

const stores: Array<[string, () => OutboxStore]> = [
  ["memory", () => new MemoryOutboxStore()],
  ["indexeddb", () => new IdbOutboxStore(`test-${Math.random()}`)],
]

describe.each(stores)("%s outbox store", (_name, make) => {
  it("starts empty", async () => {
    expect(await make().read()).toEqual(EMPTY_SNAPSHOT)
  })

  it("applies updates atomically and in order", async () => {
    const store = make()
    await Promise.all([
      store.update((s) => ({ ...s, ops: [...s.ops, op("a")] })),
      store.update((s) => ({ ...s, ops: [...s.ops, op("b")] })),
    ])
    const snap = await store.read()
    expect(snap.ops.map((o) => o.id)).toEqual(["a", "b"])
  })

  it("keeps the resolved map", async () => {
    const store = make()
    await store.update((s) => ({ ...s, resolved: { "optimistic:x": "real" } }))
    expect((await store.read()).resolved).toEqual({ "optimistic:x": "real" })
  })
})

it("indexeddb persists across store instances of the same name", async () => {
  const name = `persist-${Math.random()}`
  await new IdbOutboxStore(name).update((s) => ({ ...s, ops: [op("a")] }))
  expect((await new IdbOutboxStore(name).read()).ops).toHaveLength(1)
})

it("a memory read sees an update that was never awaited", async () => {
  const store = new MemoryOutboxStore()
  void store.update((s) => ({ ...s, ops: [op("a")] }))
  expect((await store.read()).ops).toHaveLength(1)
})

it("degrades to memory when IndexedDB is present but refuses", async () => {
  // Safari's private mode: the API is there, opening a database is refused.
  // The refusal cannot surface in the constructor — `createStore` is lazy —
  // so the store has to absorb it on first use.
  const realOpen = indexedDB.open
  indexedDB.open = (() => {
    throw new Error("refused")
  }) as typeof indexedDB.open
  try {
    const store = new IdbOutboxStore(`refused-${Math.random()}`)
    // Resolves rather than rejecting: this is the "never a thrown boot" claim.
    expect(await store.read()).toEqual(EMPTY_SNAPSHOT)
    await store.update((s) => ({ ...s, ops: [op("a")] }))
    expect((await store.read()).ops).toHaveLength(1)
  } finally {
    indexedDB.open = realOpen
  }
})

it("keeps what was already journaled when a transaction fails after reading it", async () => {
  // The dangerous half of degrading. idb-keyval runs the updater after a
  // SUCCESSFUL read, so a transaction that aborts on the write has already
  // shown us the queue — and a fallback that started empty would drop it.
  const name = `late-failure-${Math.random()}`
  const store = new IdbOutboxStore(name)
  await store.update((s) => ({ ...s, ops: [op("a")] }))

  const realOpen = indexedDB.open
  let calls = 0
  indexedDB.open = ((...args: Parameters<typeof realOpen>) => {
    // Let the read-side open through, then refuse, so the failure lands
    // after the updater has seen the stored queue.
    calls += 1
    if (calls > 1) throw new Error("aborted")
    return realOpen.apply(indexedDB, args)
  }) as typeof indexedDB.open
  try {
    const after = await store.update((s) => ({ ...s, ops: [...s.ops, op("b")] }))
    expect(after.ops.map((o) => o.id)).toEqual(["a", "b"])
  } finally {
    indexedDB.open = realOpen
  }
})

it("a throwing updater reaches the caller and does not degrade the store", async () => {
  // A bug in `fn` is not a storage failure. Treating it as one would trade a
  // transient bug for a session with no durability at all.
  const store = new IdbOutboxStore(`throwing-${Math.random()}`)
  await store.update((s) => ({ ...s, ops: [op("a")] }))

  await expect(
    store.update(() => {
      throw new Error("caller bug")
    })
  ).rejects.toThrow("caller bug")

  // Still on IndexedDB, still holding the op — not silently in memory.
  expect((await store.read()).ops.map((o) => o.id)).toEqual(["a"])
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run src/lib/offline/outbox-store.test.ts
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement both stores**

Create `src/lib/offline/outbox-store-memory.ts`:

```ts
import { EMPTY_SNAPSHOT } from "./op-types"
import type { OutboxSnapshot, OutboxStore } from "./op-types"

/** Tests, SSR, and a browser whose IndexedDB refuses (private mode). */
export class MemoryOutboxStore implements OutboxStore {
  private snapshot: OutboxSnapshot
  private chain: Promise<unknown> = Promise.resolve()

  /** `initial` is for the degrade path in outbox-store-idb.ts: when IndexedDB
   *  fails mid-transaction it has already read the queue, and starting the
   *  fallback empty would drop every op that was on it. */
  constructor(initial: OutboxSnapshot = EMPTY_SNAPSHOT) {
    this.snapshot = initial
  }

  /** Joins the chain, so a read issued after an un-awaited update still sees
   *  it. Returning `this.snapshot` bare would hand back the pre-update value
   *  and give the two stores different observable behaviour. */
  async read(): Promise<OutboxSnapshot> {
    await this.chain
    return this.snapshot
  }

  update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
    // Serialised, so two concurrent updates compose rather than clobber —
    // the same guarantee idb-keyval's `update` gives inside one transaction.
    const next = this.chain.then(() => {
      this.snapshot = fn(this.snapshot)
      return this.snapshot
    })
    this.chain = next.catch(() => undefined)
    return next
  }
}
```

Create `src/lib/offline/outbox-store-idb.ts`:

```ts
import { createStore, get, update } from "idb-keyval"
import { EMPTY_SNAPSHOT } from "./op-types"
import { MemoryOutboxStore } from "./outbox-store-memory"
import type { OutboxSnapshot, OutboxStore } from "./op-types"

const KEY = "outbox.v1"

/**
 * The journal, in IndexedDB.
 *
 * One key holding the whole snapshot: the queue is short (a day offline is
 * tens of ops, not thousands) and a single value makes `update` atomic for
 * free — idb-keyval runs the updater inside one readwrite transaction, so
 * two tabs enqueuing at once cannot lose each other's op.
 */
export class IdbOutboxStore implements OutboxStore {
  private readonly store
  /** Set once IndexedDB has refused, and used for the rest of the session. */
  private fallback: MemoryOutboxStore | null = null

  constructor(dbName = "chroneli-offline") {
    this.store = createStore(dbName, "outbox")
  }

  async read(): Promise<OutboxSnapshot> {
    if (this.fallback !== null) return await this.fallback.read()
    try {
      return (await get<OutboxSnapshot>(KEY, this.store)) ?? EMPTY_SNAPSHOT
    } catch {
      // Nothing was read, so there is nothing to carry across.
      return await this.degrade(EMPTY_SNAPSHOT).read()
    }
  }

  async update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
    if (this.fallback !== null) return await this.fallback.update(fn)

    /*
     * Two things have to be got right here, and the obvious `try { … } catch {
     * degrade() }` gets both wrong. idb-keyval runs the updater INSIDE the
     * transaction's `onsuccess`, after a successful read, and only then puts
     * and waits on the transaction — so a failure can land either side of the
     * caller's `fn` having already run against real data.
     *
     *   `seen` is what the transaction managed to read. A transaction that
     *   aborts AFTER that point (quota, or Safari dropping the connection —
     *   idb-keyval's own source comments on it) must not take the queue with
     *   it: degrading to an EMPTY fallback would silently discard every op
     *   already journaled, which is the exact loss this whole file exists to
     *   prevent.
     *
     *   `fnError` separates the caller's bug from a storage failure. They
     *   arrive as the same rejection, and treating an exception thrown by
     *   `fn` as "IndexedDB is broken" would trade one transient bug for a
     *   session with no durability at all.
     */
    let seen: OutboxSnapshot = EMPTY_SNAPSHOT
    let fnThrew = false
    let fnError: unknown

    try {
      let result: OutboxSnapshot = EMPTY_SNAPSHOT
      await update<OutboxSnapshot>(
        KEY,
        (current) => {
          seen = current ?? EMPTY_SNAPSHOT
          try {
            result = fn(seen)
          } catch (error) {
            fnThrew = true
            fnError = error
            throw error
          }
          return result
        },
        this.store
      )
      return result
    } catch {
      if (fnThrew) throw fnError
      return await this.degrade(seen).update(fn)
    }
  }

  /**
   * IndexedDB is there but will not store anything — Safari's private mode
   * refuses the open — so carry on in memory for the rest of the session.
   *
   * THE FACTORY BELOW CANNOT DO THIS. `createStore` is lazy: it builds a
   * closure and does not touch `indexedDB.open()` until the first read or
   * write, so a constructor-time try/catch guards nothing and the refusal
   * arrives later as a rejected promise. Degrading here is what makes "never
   * a thrown boot" true rather than merely intended. Found in review.
   *
   * The cost is honest and unavoidable: in a browser that will not store
   * anything, nothing survives a reload. Within the session the outbox still
   * works, which is strictly better than a boot that throws.
   *
   * `seed` is whatever IndexedDB had told us before it failed — see `update`.
   */
  private degrade(seed: OutboxSnapshot): MemoryOutboxStore {
    this.fallback ??= new MemoryOutboxStore(seed)
    return this.fallback
  }
}

/** IndexedDB when the runtime has one, else memory. A runtime that HAS one
 *  and refuses it is handled by `degrade` above, not here. */
export function createOutboxStore(): OutboxStore {
  if (typeof indexedDB === "undefined") return new MemoryOutboxStore()
  return new IdbOutboxStore()
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm vitest run src/lib/offline/outbox-store.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/outbox-store-memory.ts src/lib/offline/outbox-store-idb.ts src/lib/offline/outbox-store.test.ts
git commit -m "feat(offline): the outbox journal, in IndexedDB with a memory fallback"
```

---

### Task 5: The TanStack local-store adapter

**Files:**
- Create: `src/lib/offline/tanstack-local-store.ts`
- Test: `src/lib/offline/tanstack-local-store.test.ts`

**Interfaces:**
- Produces: `class TanStackLocalStore implements OptimisticLocalStore` with constructor `(queryClient: QueryClient)`.
- Consumes: query keys of the shape `["convexQuery", <function name>, <args>]` produced by `convexQuery()` from `@convex-dev/react-query`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/tanstack-local-store.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { anyApi } from "convex/server"
import { TanStackLocalStore } from "./tanstack-local-store"

// `anyApi` mints references by path — the same thing `api` does in this
// project's generated file. The adapter must key by NAME, not identity.
const listRange = anyApi.entries.listRange
const getRunning = anyApi.entries.getRunning

function key(name: string, args: unknown) {
  return ["convexQuery", name, args]
}

describe("TanStackLocalStore", () => {
  it("reads and writes a query by function name and args", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:getRunning", {}), null)
    expect(store.getQuery(getRunning, {})).toBeNull()
    store.setQuery(getRunning, {}, { _id: "x" })
    expect(client.getQueryData(key("entries:getRunning", {}))).toEqual({ _id: "x" })
  })

  it("lists every cached instance of a function with its args, skipping 'skip'", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:listRange", { fromMs: 0, toMs: 10 }), [1])
    client.setQueryData(key("entries:listRange", { fromMs: 10, toMs: 20 }), [2])
    client.setQueryData(key("entries:listRange", "skip"), undefined)
    client.setQueryData(key("entries:getRunning", {}), null)
    const all = store.getAllQueries(listRange)
    expect(all).toEqual([
      { args: { fromMs: 0, toMs: 10 }, value: [1] },
      { args: { fromMs: 10, toMs: 20 }, value: [2] },
    ])
  })

  it("ignores a write of undefined, which TanStack would drop anyway", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:getRunning", {}), null)
    store.setQuery(getRunning, {}, undefined)
    expect(client.getQueryData(key("entries:getRunning", {}))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run src/lib/offline/tanstack-local-store.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/offline/tanstack-local-store.ts`:

```ts
import { getFunctionName } from "convex/server"
import type { QueryClient } from "@tanstack/react-query"
import type { OptimisticLocalStore } from "convex/browser"
import type { FunctionArgs, FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server"

/**
 * Convex's `OptimisticLocalStore` interface, over the TanStack cache.
 *
 * Convex's own store only patches queries it has loaded from the server, so
 * on an offline boot it has nothing to patch. This lets the SAME optimistic
 * function each mutation already has run against what is actually on screen
 * — the TanStack cache, restored from snapshots — which is also what gets
 * persisted. One function, two stores; never two functions.
 *
 * Keys follow `convexQuery()` from @convex-dev/react-query exactly:
 * `["convexQuery", <canonical function name>, <args>]`. `findAll` matches the
 * two-element prefix, which is how every page of `listPage` is found by name.
 */
export class TanStackLocalStore implements OptimisticLocalStore {
  constructor(private readonly queryClient: QueryClient) {}

  getQuery<Query extends FunctionReference<"query">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): undefined | FunctionReturnType<Query> {
    const queryArgs = args[0] ?? {}
    return this.queryClient.getQueryData(["convexQuery", getFunctionName(query), queryArgs])
  }

  getAllQueries<Query extends FunctionReference<"query">>(
    query: Query
  ): Array<{ args: FunctionArgs<Query>; value: undefined | FunctionReturnType<Query> }> {
    const name = getFunctionName(query)
    return this.queryClient
      .getQueryCache()
      .findAll({ queryKey: ["convexQuery", name] })
      .filter((q) => q.queryKey[2] !== "skip")
      .map((q) => ({
        args: q.queryKey[2] as FunctionArgs<Query>,
        value: q.state.data as undefined | FunctionReturnType<Query>,
      }))
  }

  setQuery<Query extends FunctionReference<"query">>(
    query: Query,
    args: FunctionArgs<Query>,
    value: undefined | FunctionReturnType<Query>
  ): void {
    // `setQueryData(key, undefined)` is a no-op in TanStack; say so here
    // rather than letting a caller believe it unset something.
    if (value === undefined) return
    this.queryClient.setQueryData(["convexQuery", getFunctionName(query), args], value)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm vitest run src/lib/offline/tanstack-local-store.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/offline/tanstack-local-store.ts src/lib/offline/tanstack-local-store.test.ts
git commit -m "feat(offline): Convex's optimistic-store interface over the TanStack cache"
```

---

### Task 6: The outbox engine

**Files:**
- Create: `src/lib/offline/outbox.ts`
- Create: `src/lib/offline/rejections.ts`
- Create: `src/lib/offline/web-lock.ts`
- Test: `src/lib/offline/outbox.test.ts`, `src/lib/offline/rejections.test.ts`

**Interfaces:**
- Produces:
  - `class Outbox` with `load(): Promise<void>`, `enqueue<K extends string>(kind: K, args, local?): Promise<{ op: Op; result: unknown; settled: Promise<unknown> }>`, `pending(): number`, `subscribe(listener: (e: OutboxEvent) => void): () => void`, `kick(): void`.
  - `type OutboxEvent = { type: "changed"; pending: number } | { type: "dropped"; op: Op; reason: "rejected" | "stale" | "orphaned"; error?: unknown }`.
  - `type Sender = (op: Op, args: Record<string, unknown>) => Promise<unknown>`; `type Lock = <T>(fn: () => Promise<T>) => Promise<T>`.
  - `isRetryableRejection(error: unknown): boolean`; `webLock(name: string): Lock`.
- Consumes: Task 3 types and placeholder helpers.

- [ ] **Step 1: Write the rejection test and helper**

Create `src/lib/offline/rejections.test.ts`:

```ts
import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"
import { isRetryableRejection } from "./rejections"

describe("isRetryableRejection", () => {
  it("keeps an op the server refused only for want of a session", () => {
    const error = new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in." })
    expect(isRetryableRejection(error)).toBe(true)
  })

  it("drops every other refusal", () => {
    expect(isRetryableRejection(new ConvexError({ code: "TOO_LONG", message: "x" }))).toBe(false)
    expect(isRetryableRejection(new Error("ArgumentValidationError"))).toBe(false)
    expect(isRetryableRejection("nope")).toBe(false)
  })
})
```

Create `src/lib/offline/rejections.ts`:

```ts
import { traceErrorCode } from "@shared/codes"

/**
 * Convex's mutation promise does not reject for a lost network — it waits.
 * It rejects when the server refused. Almost every refusal is final (the
 * title was too long; the entry is gone), so the op is dropped and reported.
 * The one that is not: no session. That resolves itself when the token is
 * refreshed, and dropping recorded time for it would be the product's worst
 * failure.
 */
export function isRetryableRejection(error: unknown): boolean {
  return traceErrorCode(error) === "UNAUTHENTICATED"
}
```

Create `src/lib/offline/web-lock.ts`:

```ts
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * One sender across tabs.
 *
 * Two tabs both draining would hand the same op to two Convex clients. Ops
 * are idempotent, so that is waste rather than corruption, but it is also
 * two toasts for one refusal. The Web Locks API is in every engine this app
 * runs in (WebView2, WKWebView 15.4+); where it is absent the lock is a
 * no-op and single-tab behaviour is unchanged.
 */
export function webLock(name: string): Lock {
  return async (fn) => {
    if (typeof navigator !== "undefined" && navigator.locks !== undefined) {
      return navigator.locks.request(name, fn)
    }
    return fn()
  }
}
```

Run: `pnpm vitest run src/lib/offline/rejections.test.ts` → 2 passed.

- [ ] **Step 2: Write the failing outbox test**

Create `src/lib/offline/outbox.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { anyApi } from "convex/server"
import { Outbox, type OutboxEvent, type Sender } from "./outbox"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { optimisticIdFor } from "@/lib/optimistic-id"
import type { Op, OpKind } from "./op-types"

/*
 * A tiny kind registry standing in for op-kinds.ts. `create` mints a
 * placeholder and resolves it; `retitle` depends on it; `title` coalesces;
 * `start` goes stale unless a `stop` follows.
 */
type CreateArgs = { clientKey: string; name: string }
type RetitleArgs = { id: string; title: string }

const kinds: Record<string, OpKind<any, any>> = {
  create: {
    ref: anyApi.things.create,
    label: "Creating a thing",
    immediate: (args: CreateArgs) => ({ id: optimisticIdFor(args.clientKey) }),
    mints: (args: CreateArgs) => optimisticIdFor(args.clientKey),
    minted: (result: { id: string }) => result.id,
  },
  retitle: {
    ref: anyApi.things.retitle,
    label: "Retitling a thing",
    immediate: () => null,
    coalesceKey: (args: RetitleArgs) => args.id,
  },
  start: {
    ref: anyApi.things.start,
    label: "Starting",
    immediate: () => null,
    staleAfterMs: 1_000,
    closedBy: ["stop"],
  },
  stop: { ref: anyApi.things.stop, label: "Stopping", immediate: () => null },
  settings: {
    ref: anyApi.things.settings,
    label: "Saving settings",
    immediate: () => null,
    coalesceKey: () => "settings",
    coalesceMerge: true,
  },
}

type Harness = {
  outbox: Outbox
  sent: Array<{ kind: string; args: Record<string, unknown> }>
  events: OutboxEvent[]
  applied: Op[]
  resolveSend: (value: unknown) => void
  rejectSend: (error: unknown) => void
  now: { value: number }
}

function harness(opts: { manual?: boolean; retryable?: (e: unknown) => boolean } = {}): Harness {
  const sent: Harness["sent"] = []
  const events: OutboxEvent[] = []
  const applied: Op[] = []
  const now = { value: 1_000 }
  let pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null

  const send: Sender = (op, args) => {
    sent.push({ kind: op.kind, args })
    if (!opts.manual) {
      if (op.kind === "create") return Promise.resolve({ id: `real:${args.clientKey}` })
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject }
    })
  }

  const outbox = new Outbox({
    store: new MemoryOutboxStore(),
    kinds,
    send,
    applyLocal: (op) => applied.push(op),
    retryable: opts.retryable ?? (() => false),
    now: () => now.value,
    newId: (() => {
      let n = 0
      return () => `op-${++n}`
    })(),
  })
  outbox.subscribe((e) => events.push(e))
  return {
    outbox,
    sent,
    events,
    applied,
    now,
    resolveSend: (v) => pending?.resolve(v),
    rejectSend: (e) => pending?.reject(e),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("Outbox", () => {
  it("applies the optimistic update at once and hands the caller the immediate result", async () => {
    const h = harness({ manual: true })
    const { result } = await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    expect(result).toEqual({ id: "optimistic:k1" })
    expect(h.applied.map((o) => o.kind)).toEqual(["create"])
    expect(h.outbox.pending()).toBe(1)
  })

  it("sends in order, one at a time, and removes acknowledged ops", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {})
    await h.outbox.enqueue("stop", {})
    await flush()
    expect(h.sent).toHaveLength(1)
    h.resolveSend(null)
    await flush()
    expect(h.sent).toHaveLength(2)
    h.resolveSend(null)
    await flush()
    expect(h.outbox.pending()).toBe(0)
  })

  it("rewrites a dependent's placeholder with the id the producer returned", async () => {
    const h = harness()
    await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await h.outbox.enqueue("retitle", { id: "optimistic:k1", title: "B" })
    await flush()
    expect(h.sent[1].args).toEqual({ id: "real:k1", title: "B" })
  })

  it("resolves `settled` with the server's answer", async () => {
    const h = harness()
    const { settled } = await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await expect(settled).resolves.toEqual({ id: "real:k1" })
  })

  it("coalesces consecutive unsent ops on the same target", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // occupies the sender
    await flush()
    await h.outbox.enqueue("retitle", { id: "x", title: "a" })
    await h.outbox.enqueue("retitle", { id: "x", title: "ab" })
    await h.outbox.enqueue("retitle", { id: "y", title: "other" })
    expect(h.outbox.pending()).toBe(3)
    h.resolveSend(null)
    await flush()
    expect(h.sent[1].args).toEqual({ id: "x", title: "ab" })
  })

  it("merges a coalesced patch's args when the kind asks for it", async () => {
    // The default collapse REPLACES, which is right for a retitle: the later
    // op carries the whole title. A settings save carries one field of many,
    // so replacing would lose the currency because the timezone was typed
    // second.
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // occupies the sender
    await flush()
    await h.outbox.enqueue("settings", { currency: "EUR" })
    await h.outbox.enqueue("settings", { timezone: "UTC" })
    expect(h.outbox.pending()).toBe(2)
    h.resolveSend(null)
    await flush()
    expect(h.sent[1].args).toEqual({ currency: "EUR", timezone: "UTC" })
  })

  it("drops a refused op, reports it, and drops what depended on it", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await h.outbox.enqueue("retitle", { id: "optimistic:k1", title: "B" })
    await h.outbox.enqueue("stop", {})
    await flush()
    h.rejectSend(new Error("TOO_LONG"))
    await flush()
    await flush()
    const dropped = h.events.filter((e) => e.type === "dropped")
    expect(dropped.map((e) => e.type === "dropped" && [e.op.kind, e.reason])).toEqual([
      ["create", "rejected"],
      ["retitle", "orphaned"],
    ])
    expect(h.sent.map((s) => s.kind)).toEqual(["create", "stop"])
  })

  it("keeps a retryable refusal in place and waits for a kick", async () => {
    const h = harness({ manual: true, retryable: () => true })
    await h.outbox.enqueue("stop", {})
    await flush()
    h.rejectSend(new Error("UNAUTHENTICATED"))
    await flush()
    expect(h.outbox.pending()).toBe(1)
    expect(h.sent).toHaveLength(1)
    h.outbox.kick()
    await flush()
    expect(h.sent).toHaveLength(2)
  })

  it("drops a stale start that nothing closes, and keeps one that a stop follows", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // block the sender
    await flush()
    await h.outbox.enqueue("start", {})
    h.now.value += 5_000
    h.resolveSend(null)
    await flush()
    await flush()
    expect(h.events.some((e) => e.type === "dropped" && e.reason === "stale")).toBe(true)

    const h2 = harness({ manual: true })
    await h2.outbox.enqueue("stop", {})
    await flush()
    await h2.outbox.enqueue("start", {})
    await h2.outbox.enqueue("stop", {})
    h2.now.value += 5_000
    h2.resolveSend(null)
    await flush()
    expect(h2.sent.map((s) => s.kind)).toEqual(["stop", "start"])
  })

  it("re-applies every op and resets in-flight flags on load", async () => {
    const store = new MemoryOutboxStore()
    await store.update((s) => ({
      ...s,
      ops: [{ id: "op-9", kind: "stop", args: {}, enqueuedAt: 0, inFlight: true }],
    }))
    const applied: Op[] = []
    const outbox = new Outbox({
      store,
      kinds,
      send: () => new Promise(() => {}),
      applyLocal: (op) => applied.push(op),
      retryable: () => false,
    })
    await outbox.load()
    expect(applied.map((o) => o.id)).toEqual(["op-9"])
    expect((await store.read()).ops[0].inFlight).toBe(false)
    expect(outbox.pending()).toBe(1)
  })

  it("notifies pending-count changes", async () => {
    const h = harness()
    await h.outbox.enqueue("stop", {})
    await flush()
    const counts = h.events.filter((e) => e.type === "changed").map((e) => e.type === "changed" && e.pending)
    expect(counts[0]).toBe(1)
    expect(counts[counts.length - 1]).toBe(0)
  })

  vi.useRealTimers()
})
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm vitest run src/lib/offline/outbox.test.ts
```

Expected: FAIL — `./outbox` not found.

- [ ] **Step 4: Implement the engine**

Create `src/lib/offline/outbox.ts`:

```ts
import { newClientKey } from "@/lib/client-key"
import { rewritePlaceholders, unresolvedPlaceholders } from "./placeholders"
import type { Op, OpKind, OpLocal, OutboxSnapshot, OutboxStore } from "./op-types"
import type { Lock } from "./web-lock"

export type OutboxEvent =
  | { type: "changed"; pending: number }
  | { type: "dropped"; op: Op; reason: "rejected" | "stale" | "orphaned"; error?: unknown }

export type Sender = (op: Op, args: Record<string, unknown>) => Promise<unknown>

export type OutboxOptions = {
  store: OutboxStore
  kinds: Record<string, OpKind<any, any>>
  /** Hands one op to Convex. Resolves on ack; rejects on refusal; WAITS on no network. */
  send: Sender
  /** Runs the op's optimistic function against the TanStack adapter. */
  applyLocal: (op: Op) => void
  retryable: (error: unknown) => boolean
  lock?: Lock
  now?: () => number
  newId?: () => string
}

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void }

/**
 * The persistent outbox.
 *
 * Every offline-capable mutation goes through `enqueue`, online or not: the
 * op is journaled FIRST, its optimistic update applied, then the drain hands
 * ops to Convex one at a time in order. Sequential sending is what makes
 * placeholder rewriting sound — a producer always precedes its dependents —
 * and it costs nothing a solo tracker can feel.
 *
 * `send` never rejects for a lost network (Convex waits), so a drain that is
 * "stuck" is exactly a drain that is offline. It resumes when the socket does.
 */
export class Outbox {
  private readonly store: OutboxStore
  private readonly kinds: Record<string, OpKind<any, any>>
  private readonly send: Sender
  private readonly applyLocal: (op: Op) => void
  private readonly retryable: (error: unknown) => boolean
  private readonly lock: Lock
  private readonly now: () => number
  private readonly newId: () => string

  private listeners = new Set<(event: OutboxEvent) => void>()
  private settlers = new Map<string, Deferred>()
  private pendingCount = 0
  private draining = false
  private kicked = false

  constructor(options: OutboxOptions) {
    this.store = options.store
    this.kinds = options.kinds
    this.send = options.send
    this.applyLocal = options.applyLocal
    this.retryable = options.retryable
    this.lock = options.lock ?? (async (fn) => await fn())
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? (() => newClientKey())
  }

  /** Read the journal, put every op back on screen, and start sending. */
  async load(): Promise<void> {
    const snap = await this.store.update((s) => ({
      ...s,
      ops: s.ops.map((op) => ({ ...op, inFlight: false })),
    }))
    for (const op of snap.ops) this.applyLocal(op)
    this.setPending(snap.ops.length)
    this.kick()
  }

  async enqueue(
    kind: string,
    args: Record<string, unknown>,
    local?: OpLocal
  ): Promise<{ op: Op; result: unknown; settled: Promise<unknown> }> {
    const def = this.kinds[kind]
    if (def === undefined) throw new Error(`Unknown op kind: ${kind}`)

    const op: Op = {
      id: this.newId(),
      kind,
      args,
      ...(local !== undefined ? { local } : {}),
      enqueuedAt: this.now(),
      inFlight: false,
    }

    let replaced: Op | undefined
    const snap = await this.store.update((s) => {
      const last = s.ops[s.ops.length - 1]
      const key = def.coalesceKey?.(args)
      if (
        last !== undefined &&
        !last.inFlight &&
        last.kind === kind &&
        key !== undefined &&
        this.kinds[last.kind]?.coalesceKey?.(last.args) === key
      ) {
        replaced = last
        return {
          ...s,
          ops: [
            ...s.ops.slice(0, -1),
            {
              ...op,
              id: last.id,
              enqueuedAt: last.enqueuedAt,
              // REPLACE by default; MERGE for a patch of independent fields.
              // See `coalesceMerge` on OpKind for why both are needed.
              args: def.coalesceMerge === true ? { ...last.args, ...args } : args,
            },
          ],
        }
      }
      return { ...s, ops: [...s.ops, op] }
    })

    const stored = snap.ops[snap.ops.length - 1]
    // A coalesced op inherits the earlier op's `settled` — the caller that
    // awaited the first keystroke still gets the answer for the last one.
    const settled = new Promise<unknown>((resolve, reject) => {
      if (replaced !== undefined && this.settlers.has(replaced.id)) {
        const prior = this.settlers.get(replaced.id)!
        this.settlers.set(stored.id, {
          resolve: (v) => {
            prior.resolve(v)
            resolve(v)
          },
          reject: (e) => {
            prior.reject(e)
            reject(e)
          },
        })
      } else {
        this.settlers.set(stored.id, { resolve, reject })
      }
    })
    settled.catch(() => undefined)

    this.applyLocal(stored)
    this.setPending(snap.ops.length)
    this.kick()
    return { op: stored, result: def.immediate(args, this.now()), settled }
  }

  pending(): number {
    return this.pendingCount
  }

  subscribe(listener: (event: OutboxEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Start a drain, or ask a running one to go round again. */
  kick(): void {
    if (this.draining) {
      this.kicked = true
      return
    }
    this.draining = true
    void this.lock(() => this.drain()).finally(() => {
      this.draining = false
      if (this.kicked) {
        this.kicked = false
        this.kick()
      }
    })
  }

  private async drain(): Promise<void> {
    for (;;) {
      const snap = await this.store.read()
      this.setPending(snap.ops.length)
      const op = snap.ops[0]
      if (op === undefined) return
      const def = this.kinds[op.kind]

      if (def === undefined) {
        await this.drop(op, "rejected", new Error(`Unknown op kind: ${op.kind}`))
        continue
      }

      if (this.isStale(op, def, snap)) {
        await this.drop(op, "stale")
        continue
      }

      if (unresolvedPlaceholders(op.args, snap.resolved).length > 0) {
        // Its producer came earlier in the queue and is gone without
        // resolving, so this op names a thing that never came to exist.
        await this.drop(op, "orphaned")
        continue
      }

      const args = rewritePlaceholders(op.args, snap.resolved)
      await this.store.update((s) => ({
        ...s,
        ops: s.ops.map((o) => (o.id === op.id ? { ...o, inFlight: true } : o)),
      }))

      let result: unknown
      try {
        result = await this.send(op, args)
      } catch (error) {
        if (this.retryable(error)) {
          await this.store.update((s) => ({
            ...s,
            ops: s.ops.map((o) => (o.id === op.id ? { ...o, inFlight: false } : o)),
          }))
          return
        }
        await this.drop(op, "rejected", error)
        continue
      }

      const next = await this.store.update((s) => {
        const ops = s.ops.filter((o) => o.id !== op.id)
        const resolved = { ...s.resolved }
        if (def.mints !== undefined && def.minted !== undefined) {
          resolved[def.mints(op.args)] = def.minted(result)
        }
        return { ops, resolved: pruneResolved(resolved, ops) }
      })
      this.settlers.get(op.id)?.resolve(result)
      this.settlers.delete(op.id)
      this.setPending(next.ops.length)
    }
  }

  private isStale(op: Op, def: OpKind<any, any>, snap: OutboxSnapshot): boolean {
    if (def.staleAfterMs === undefined) return false
    if (this.now() - op.enqueuedAt <= def.staleAfterMs) return false
    const closers = def.closedBy ?? []
    const index = snap.ops.findIndex((o) => o.id === op.id)
    return !snap.ops.slice(index + 1).some((o) => closers.includes(o.kind))
  }

  private async drop(op: Op, reason: "rejected" | "stale" | "orphaned", error?: unknown): Promise<void> {
    const next = await this.store.update((s) => {
      const ops = s.ops.filter((o) => o.id !== op.id)
      return { ops, resolved: pruneResolved(s.resolved, ops) }
    })
    this.settlers.get(op.id)?.reject(error ?? new Error(reason))
    this.settlers.delete(op.id)
    this.emit({ type: "dropped", op, reason, ...(error !== undefined ? { error } : {}) })
    this.setPending(next.ops.length)
  }

  private setPending(count: number): void {
    if (count === this.pendingCount) return
    this.pendingCount = count
    this.emit({ type: "changed", pending: count })
  }

  private emit(event: OutboxEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

/** Forget a placeholder once no pending op mentions it. */
function pruneResolved(resolved: Record<string, string>, ops: Op[]): Record<string, string> {
  const text = JSON.stringify(ops.map((o) => o.args))
  const kept: Record<string, string> = {}
  for (const [placeholder, real] of Object.entries(resolved)) {
    if (text.includes(placeholder)) kept[placeholder] = real
  }
  return kept
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
pnpm vitest run src/lib/offline/outbox.test.ts src/lib/offline/rejections.test.ts
```

Expected: all pass. If the "notifies pending-count changes" test's first count is `1` but the enqueue emitted before `setPending` — it emits after the store update, so the first `changed` is 1. If `drain` reads a stale count, note `setPending` is called at the top of each loop as well.

- [ ] **Step 6: Commit**

```bash
git add src/lib/offline/outbox.ts src/lib/offline/outbox.test.ts src/lib/offline/rejections.ts src/lib/offline/rejections.test.ts src/lib/offline/web-lock.ts
git commit -m "feat(offline): the outbox engine — journal, coalesce, rewrite, drain, drop"
```

---

### Task 7: Move the optimistic functions into pure modules

**Files:**
- Create: `src/lib/offline/optimistic-entries.ts`
- Create: `src/lib/offline/optimistic-classifiers.ts`
- Create: `src/lib/offline/optimistic-settings.ts`
- Test: `src/lib/offline/optimistic-classifiers.test.ts`, `src/lib/offline/optimistic-settings.test.ts`
- Modify: `src/hooks/use-entry-mutations.ts`, `src/hooks/use-entry-edit-mutations.ts` (only to import the moved helpers; the hook API is unchanged in this task)

**Interfaces:**
- Produces (all `(store: OptimisticLocalStore, args, local?) => void`):
  - entries: `optimisticStart`, `optimisticStop`, `optimisticDiscard`, `optimisticSetTitle`, `optimisticUpdate`, `optimisticUpdateMany`, `optimisticEditTime`, `optimisticRemove`, `optimisticRemoveMany`, `optimisticRestore` (local `{ entry }`), `optimisticRestoreMany` (local `{ entries }`), `optimisticCreate`; plus the moved helpers `optimisticEntry`, `patchEverywhere`, `dropEverywhere`, `moveEverywhere`, `insertEverywhere`.
  - classifiers: `optimisticProjectCreate`, `optimisticProjectUpdate`, `optimisticProjectSetArchived`, `optimisticProjectRemove`, `optimisticTagEnsure`, `optimisticTagRename`, `optimisticTagRemove`.
  - settings: `optimisticSettingsUpdate`.

- [ ] **Step 1: Create `optimistic-entries.ts` by moving code**

Create `src/lib/offline/optimistic-entries.ts`. Move, VERBATIM including their comments, from `src/hooks/use-entry-edit-mutations.ts`: `patchEverywhere`, `dropEverywhere`, `moveEverywhere`, `insertEverywhere` (and its `insertAtPosition` import), the `type Entry = Doc<"timeEntries">` alias; and from `src/hooks/use-entry-mutations.ts`: `optimisticEntry` (with its comment). Then export them and append the per-mutation functions:

```ts
import { insertAtPosition } from "convex/react"
import { applyTimeEdit } from "@shared/entryTimes"
import { optimisticIdFor } from "@/lib/optimistic-id"
import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { TimeEdit } from "@shared/entryTimes"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { OpLocal } from "./op-types"

export type Entry = Doc<"timeEntries">

// … optimisticEntry, patchEverywhere, dropEverywhere, moveEverywhere,
//   insertEverywhere: moved here verbatim, each now `export`ed …

type StartArgs = {
  clientKey: string
  title?: string
  startedAt?: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

export function optimisticStart(store: OptimisticLocalStore, args: StartArgs): void {
  store.setQuery(
    api.entries.getRunning,
    {},
    optimisticEntry({
      clientKey: args.clientKey,
      title: args.title ?? "",
      startedAt: args.startedAt ?? Date.now(),
      billable: args.billable ?? false,
      projectId: args.projectId,
      tagIds: args.tagIds ?? [],
    })
  )
}

export function optimisticStop(store: OptimisticLocalStore): void {
  store.setQuery(api.entries.getRunning, {}, null)
}

export const optimisticDiscard = optimisticStop

export function optimisticSetTitle(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries">; title: string }
): void {
  const running = store.getQuery(api.entries.getRunning, {})
  if (running != null && running._id === args.entryId) {
    store.setQuery(api.entries.getRunning, {}, { ...running, title: args.title })
  }
}

type UpdateFields = {
  title?: string
  note?: string
  projectId?: Id<"projects"> | null
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

function applyUpdateFields(entry: Entry, args: UpdateFields): Entry {
  return {
    ...entry,
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.note !== undefined
      ? { note: args.note.trim() === "" ? undefined : args.note.trim() }
      : {}),
    ...(args.billable !== undefined ? { billable: args.billable } : {}),
    ...(args.projectId !== undefined ? { projectId: args.projectId ?? undefined } : {}),
    ...(args.tagIds !== undefined ? { tagIds: args.tagIds } : {}),
  }
}

export function optimisticUpdate(
  store: OptimisticLocalStore,
  args: UpdateFields & { entryId: Id<"timeEntries"> }
): void {
  patchEverywhere(store, args.entryId, (entry) => applyUpdateFields(entry, args))
}

export function optimisticUpdateMany(
  store: OptimisticLocalStore,
  args: UpdateFields & { entryIds: Array<Id<"timeEntries">> }
): void {
  for (const entryId of args.entryIds) {
    patchEverywhere(store, entryId, (entry) => applyUpdateFields(entry, args))
  }
}

export function optimisticEditTime(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries">; field: TimeEdit["field"]; value: number }
): void {
  const now = Date.now()
  const write = args.field === "day" ? moveEverywhere : patchEverywhere
  write(store, args.entryId, (entry) => {
    const result = applyTimeEdit(
      { startedAt: entry.startedAt, endedAt: entry.endedAt, durationMs: entry.durationMs },
      { field: args.field, value: args.value },
      now
    )
    return result.ok ? { ...entry, ...result.times } : entry
  })
}

export function optimisticRemove(
  store: OptimisticLocalStore,
  args: { entryId: Id<"timeEntries"> }
): void {
  dropEverywhere(store, args.entryId)
}

export function optimisticRemoveMany(
  store: OptimisticLocalStore,
  args: { entryIds: Array<Id<"timeEntries">> }
): void {
  for (const entryId of new Set(args.entryIds)) dropEverywhere(store, entryId)
}

/** `local.entry` is the snapshot the undo toast held; the args carry only an id. */
export function optimisticRestore(
  store: OptimisticLocalStore,
  _args: { entryId: Id<"timeEntries"> },
  local: OpLocal | undefined
): void {
  const entry = local?.entry as Entry | undefined
  if (entry !== undefined) insertEverywhere(store, entry)
}

export function optimisticRestoreMany(
  store: OptimisticLocalStore,
  _args: { entryIds: Array<Id<"timeEntries">> },
  local: OpLocal | undefined
): void {
  const entries = (local?.entries as Entry[] | undefined) ?? []
  for (const entry of entries) insertEverywhere(store, entry)
}

type CreateArgs = {
  clientKey: string
  title?: string
  note?: string
  startedAt: number
  endedAt: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/** A completed entry, on screen before the server has it. New: `create` had no
 *  optimistic update before the outbox, and offline it needs one. */
export function optimisticCreate(store: OptimisticLocalStore, args: CreateArgs): void {
  const base = optimisticEntry({
    clientKey: args.clientKey,
    title: args.title ?? "",
    startedAt: args.startedAt,
    billable: args.billable ?? false,
    projectId: args.projectId,
    tagIds: args.tagIds ?? [],
  })
  const note = args.note?.trim()
  insertEverywhere(store, {
    ...base,
    note: note === undefined || note === "" ? undefined : note,
    endedAt: args.endedAt,
    durationMs: args.endedAt - args.startedAt,
  })
}
```

Extend the moved `optimisticEntry` to accept `projectId` and `tagIds` (it currently hard-codes `tagIds: []` and omits `projectId`): add `projectId?: Id<"projects">; tagIds: Array<Id<"tags">>` to its parameter type and spread them into the row.

- [ ] **Step 2: Point the hooks at the moved helpers**

In `src/hooks/use-entry-edit-mutations.ts` delete the moved functions and the `insertAtPosition` import, and add `import { dropEverywhere, insertEverywhere, moveEverywhere, patchEverywhere } from "@/lib/offline/optimistic-entries"`. In `src/hooks/use-entry-mutations.ts` delete `optimisticEntry` and import it from the same module. Behaviour is unchanged.

Run `pnpm vitest run src/hooks && pnpm typecheck` → green.

- [ ] **Step 3: Write the failing classifier test**

Create `src/lib/offline/optimistic-classifiers.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { TanStackLocalStore } from "./tanstack-local-store"
import {
  optimisticProjectCreate,
  optimisticProjectRemove,
  optimisticProjectSetArchived,
  optimisticProjectUpdate,
  optimisticTagEnsure,
  optimisticTagRemove,
  optimisticTagRename,
} from "./optimistic-classifiers"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

const PROJECTS = ["convexQuery", "projects:list", {}]
const TAGS = ["convexQuery", "tags:list", {}]

function project(overrides: Partial<Doc<"projects">> = {}): Doc<"projects"> {
  return {
    _id: "p1" as Id<"projects">,
    _creationTime: 1,
    userId: "u",
    name: "Website",
    color: "slate",
    archived: false,
    billableByDefault: false,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }
}

function tag(overrides: Partial<Doc<"tags">> = {}): Doc<"tags"> {
  return { _id: "t1" as Id<"tags">, _creationTime: 1, userId: "u", name: "ops", updatedAt: 1, deletedAt: null, ...overrides }
}

function setup() {
  const client = new QueryClient()
  client.setQueryData(PROJECTS, [project()])
  client.setQueryData(TAGS, [tag()])
  return { client, store: new TanStackLocalStore(client) }
}

describe("projects", () => {
  it("create inserts a placeholder row sorted by name", () => {
    const { client, store } = setup()
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    const rows = client.getQueryData<Doc<"projects">[]>(PROJECTS)!
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Website"])
    expect(rows[0]._id).toBe("optimistic:k")
  })

  it("create is idempotent", () => {
    const { client, store } = setup()
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)).toHaveLength(2)
  })

  it("update patches, null clears the rate", () => {
    const { client, store } = setup()
    optimisticProjectUpdate(store, { projectId: "p1" as Id<"projects">, name: "Site", hourlyRateCents: null })
    const [row] = client.getQueryData<Doc<"projects">[]>(PROJECTS)!
    expect(row.name).toBe("Site")
    expect(row.hourlyRateCents).toBeUndefined()
  })

  it("setArchived flips the flag; remove drops the row", () => {
    const { client, store } = setup()
    optimisticProjectSetArchived(store, { projectId: "p1" as Id<"projects">, archived: true })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)![0].archived).toBe(true)
    optimisticProjectRemove(store, { projectId: "p1" as Id<"projects"> })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)).toEqual([])
  })
})

describe("tags", () => {
  it("ensure adds a placeholder only when the name is new, case-insensitively", () => {
    const { client, store } = setup()
    optimisticTagEnsure(store, { name: "OPS" })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)).toHaveLength(1)
    optimisticTagEnsure(store, { name: "  design " })
    const rows = client.getQueryData<Doc<"tags">[]>(TAGS)!
    expect(rows.map((r) => r.name)).toEqual(["design", "ops"])
    expect(rows[0]._id).toBe("optimistic:tag:design")
  })

  it("rename and remove", () => {
    const { client, store } = setup()
    optimisticTagRename(store, { tagId: "t1" as Id<"tags">, name: "operations" })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)![0].name).toBe("operations")
    optimisticTagRemove(store, { tagId: "t1" as Id<"tags"> })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)).toEqual([])
  })
})
```

- [ ] **Step 4: Run it to verify it fails, then implement**

```bash
pnpm vitest run src/lib/offline/optimistic-classifiers.test.ts
```

Create `src/lib/offline/optimistic-classifiers.ts`:

```ts
import { optimisticIdFor } from "@/lib/optimistic-id"
import { DEFAULT_PROJECT_COLOR } from "@shared/palette"
import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

type Project = Doc<"projects">
type Tag = Doc<"tags">

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name)

/** The tag placeholder is keyed by the normalised name, because `ensure` is
 *  get-or-create by name and two ensures of "ops" must mint ONE placeholder. */
export function tagPlaceholder(name: string): string {
  return optimisticIdFor(`tag:${name.trim().toLowerCase()}`)
}

export function optimisticProjectCreate(
  store: OptimisticLocalStore,
  args: { clientKey: string; name: string; color?: string; billableByDefault?: boolean; hourlyRateCents?: number }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  const _id = optimisticIdFor(args.clientKey) as unknown as Id<"projects">
  if (list.some((p) => p._id === _id)) return
  const now = Date.now()
  const row: Project = {
    _id,
    _creationTime: now,
    userId: "",
    clientKey: args.clientKey,
    name: args.name.trim(),
    color: args.color ?? DEFAULT_PROJECT_COLOR,
    archived: false,
    billableByDefault: args.billableByDefault ?? false,
    hourlyRateCents: args.hourlyRateCents,
    updatedAt: now,
    deletedAt: null,
  }
  store.setQuery(api.projects.list, {}, [...list, row].sort(byName))
}

export function optimisticProjectUpdate(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects">; name?: string; color?: string; billableByDefault?: boolean; hourlyRateCents?: number | null }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(
    api.projects.list,
    {},
    list
      .map((p) =>
        p._id !== args.projectId
          ? p
          : {
              ...p,
              ...(args.name !== undefined ? { name: args.name.trim() } : {}),
              ...(args.color !== undefined ? { color: args.color } : {}),
              ...(args.billableByDefault !== undefined ? { billableByDefault: args.billableByDefault } : {}),
              ...(args.hourlyRateCents !== undefined
                ? { hourlyRateCents: args.hourlyRateCents ?? undefined }
                : {}),
            }
      )
      .sort(byName)
  )
}

export function optimisticProjectSetArchived(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects">; archived: boolean }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(
    api.projects.list,
    {},
    list.map((p) => (p._id === args.projectId ? { ...p, archived: args.archived } : p))
  )
}

export function optimisticProjectRemove(
  store: OptimisticLocalStore,
  args: { projectId: Id<"projects"> }
): void {
  const list = store.getQuery(api.projects.list, {})
  if (list === undefined) return
  store.setQuery(api.projects.list, {}, list.filter((p) => p._id !== args.projectId))
}

export function optimisticTagEnsure(store: OptimisticLocalStore, args: { name: string }): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  const clean = args.name.trim()
  if (list.some((t) => t.name.toLowerCase() === clean.toLowerCase())) return
  const now = Date.now()
  const row: Tag = {
    _id: tagPlaceholder(clean) as unknown as Id<"tags">,
    _creationTime: now,
    userId: "",
    name: clean,
    updatedAt: now,
    deletedAt: null,
  }
  store.setQuery(api.tags.list, {}, [...list, row].sort(byName))
}

export function optimisticTagRename(
  store: OptimisticLocalStore,
  args: { tagId: Id<"tags">; name: string }
): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  store.setQuery(
    api.tags.list,
    {},
    list.map((t) => (t._id === args.tagId ? { ...t, name: args.name.trim() } : t)).sort(byName)
  )
}

export function optimisticTagRemove(store: OptimisticLocalStore, args: { tagId: Id<"tags"> }): void {
  const list = store.getQuery(api.tags.list, {})
  if (list === undefined) return
  store.setQuery(api.tags.list, {}, list.filter((t) => t._id !== args.tagId))
}
```

Check `convex/lib/palette.ts` exports `DEFAULT_PROJECT_COLOR` (it is imported by `convex/projects.ts` from `./lib/palette`, so it does). Check `projects.list`/`tags.list` sort order in `listImpl` of each file; if the server sorts differently from `localeCompare` on `name`, match it.

Run: `pnpm vitest run src/lib/offline/optimistic-classifiers.test.ts` → all pass.

- [ ] **Step 5: Settings**

Create `src/lib/offline/optimistic-settings.test.ts`:

```ts
import { QueryClient } from "@tanstack/react-query"
import { expect, it } from "vitest"
import { TanStackLocalStore } from "./tanstack-local-store"
import { optimisticSettingsUpdate } from "./optimistic-settings"

const KEY = ["convexQuery", "settings:get", {}]

it("patches only the fields sent, and null clears the default rate", () => {
  const client = new QueryClient()
  client.setQueryData(KEY, { timezone: "UTC", currency: "USD", defaultHourlyRateCents: 5000, logoUrl: null })
  const store = new TanStackLocalStore(client)
  optimisticSettingsUpdate(store, { currency: "EUR", defaultHourlyRateCents: null })
  expect(client.getQueryData(KEY)).toEqual({ timezone: "UTC", currency: "EUR", logoUrl: null })
})
```

Create `src/lib/offline/optimistic-settings.ts`:

```ts
import { api } from "../../../convex/_generated/api"
import type { OptimisticLocalStore } from "convex/browser"
import type { FunctionArgs } from "convex/server"

type UpdateArgs = FunctionArgs<typeof api.settings.update>

export function optimisticSettingsUpdate(store: OptimisticLocalStore, args: UpdateArgs): void {
  const current = store.getQuery(api.settings.get, {})
  if (current === undefined) return
  const next: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    // `null` means clear — the three-state shape `settings.update` documents.
    if (value === null) delete next[key]
    else next[key] = value
  }
  store.setQuery(api.settings.get, {}, next as typeof current)
}
```

Run: `pnpm vitest run src/lib/offline/optimistic-settings.test.ts` → pass.

- [ ] **Step 6: Full suite, typecheck, lint, commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
git add src/lib/offline src/hooks/use-entry-mutations.ts src/hooks/use-entry-edit-mutations.ts
git commit -m "refactor(offline): the optimistic functions live in pure modules, one per mutation"
```

---

### Task 8: The op-kind registry

**Files:**
- Create: `src/lib/offline/op-kinds.ts`
- Test: `src/lib/offline/op-kinds.test.ts`

**Interfaces:**
- Produces: `OP_KINDS` (a `const` object), `type OpKindName = keyof typeof OP_KINDS`, `type ArgsOf<K>`, `type ResultOf<K>`, `STALE_START_MS = 24 * 60 * 60 * 1000`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/op-kinds.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { getFunctionName } from "convex/server"
import { OP_KINDS, STALE_START_MS } from "./op-kinds"

describe("OP_KINDS", () => {
  it("names every kind after the Convex function it sends", () => {
    for (const [name, def] of Object.entries(OP_KINDS)) {
      expect(getFunctionName(def.ref)).toBe(name.replace(".", ":"))
      expect(def.label.length).toBeGreaterThan(0)
    }
  })

  it("mints and resolves come in pairs", () => {
    for (const def of Object.values(OP_KINDS)) {
      expect(def.mints === undefined).toBe(def.minted === undefined)
    }
  })

  it("start goes stale after a day unless closed", () => {
    expect(OP_KINDS["entries.start"].staleAfterMs).toBe(STALE_START_MS)
    expect(OP_KINDS["entries.start"].closedBy).toEqual([
      "entries.stop",
      "entries.discardRunning",
      "entries.start",
    ])
  })

  it("start's immediate result carries the placeholder the optimistic row uses", () => {
    const r = OP_KINDS["entries.start"].immediate({ clientKey: "k", title: "" }, 5)
    expect(r).toEqual({ entryId: "optimistic:k", stoppedEntryIds: [], serverNow: 5, replayed: false })
  })
})
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Create `src/lib/offline/op-kinds.ts`:

```ts
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

function kind<Ref extends FunctionReference<"mutation", "public">>(
  def: OpKind<FunctionArgs<Ref>, FunctionReturnType<Ref>> & { ref: Ref }
) {
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
      serverNow: now,
      replayed: false,
    }),
    staleAfterMs: STALE_START_MS,
    closedBy: ["entries.stop", "entries.discardRunning", "entries.start"],
  }),
  "entries.stop": kind({
    ref: api.entries.stop,
    label: "Stopping the timer",
    optimistic: entries.optimisticStop,
    immediate: (_args, now) => ({ stoppedEntryIds: [], serverNow: now }),
  }),
  "entries.discardRunning": kind({
    ref: api.entries.discardRunning,
    label: "Discarding the timer",
    optimistic: entries.optimisticDiscard,
    immediate: nothing,
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
    immediate: nothing,
  }),
  "entries.remove": kind({
    ref: api.entries.remove,
    label: "Deleting an entry",
    optimistic: entries.optimisticRemove,
    immediate: nothing,
  }),
  "entries.removeMany": kind({
    ref: api.entries.removeMany,
    label: "Deleting entries",
    optimistic: entries.optimisticRemoveMany,
    immediate: nothing,
  }),
  "entries.restore": kind({
    ref: api.entries.restore,
    label: "Restoring an entry",
    optimistic: entries.optimisticRestore,
    immediate: nothing,
  }),
  "entries.restoreMany": kind({
    ref: api.entries.restoreMany,
    label: "Restoring entries",
    optimistic: entries.optimisticRestoreMany,
    immediate: nothing,
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
    optimistic: classifiers.optimisticProjectCreate,
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
export type ArgsOf<K extends OpKindName> = FunctionArgs<(typeof OP_KINDS)[K]["ref"]>
export type ResultOf<K extends OpKindName> = FunctionReturnType<(typeof OP_KINDS)[K]["ref"]>
```

If `api.projects.remove`, `api.projects.setArchived`, `api.tags.rename`, `api.tags.remove` or `api.entries.discardRunning`'s return types are not `null`, adjust the `immediate` for that kind to build a value of the right shape (read the `returns:` validator in the Convex file). If `projects.create`'s `clientKey` is typed optional, the `as string` casts above stay.

`settings.update` carries `coalesceMerge: true` above, and that is load-bearing rather than decorative: the default collapse replaces the earlier op's args, which would lose the currency when the timezone is typed second. The engine and its test for both behaviours land in Task 6; here you only set the flag.

- [ ] **Step 3: Run, typecheck, commit**

```bash
pnpm vitest run src/lib/offline && pnpm typecheck
git add src/lib/offline
git commit -m "feat(offline): the op-kind registry — one entry per mutation the outbox carries"
```

---

### Task 9: Wiring: `createOutbox`, the provider, and the hooks

**Files:**
- Create: `src/lib/offline/create-outbox.ts`
- Create: `src/lib/offline/outbox-provider.tsx`
- Modify: `src/hooks/use-entry-mutations.ts`, `src/hooks/use-entry-edit-mutations.ts`, `src/hooks/use-entry-edit-mutations.test.ts`, `src/hooks/use-classifiers.ts`, `src/hooks/use-timer-effects.ts`, `src/routes/_authed.tsx`, `src/routes/_authed/-settings.tsx`
- Delete: `src/lib/pending-start.ts`

**Interfaces:**
- Produces: `OutboxProvider`, `useOutbox(): Outbox`, `useOutboxMutation<K extends OpKindName>(kind: K): (args: ArgsOf<K>, local?: OpLocal) => Promise<{ result: ResultOf<K>; settled: Promise<ResultOf<K>> }>`, `usePendingCount(): number`, `useOutboxEvents(listener: (e: OutboxEvent) => void): void`.
- Consumes: `Outbox` (Task 6), `OP_KINDS` (Task 8), `TanStackLocalStore` (Task 5), `createOutboxStore` (Task 4).

- [ ] **Step 1: `createOutbox`**

Create `src/lib/offline/create-outbox.ts`:

```ts
import { Outbox } from "./outbox"
import { OP_KINDS } from "./op-kinds"
import { createOutboxStore } from "./outbox-store-idb"
import { isRetryableRejection } from "./rejections"
import { TanStackLocalStore } from "./tanstack-local-store"
import { webLock } from "./web-lock"
import type { ConvexReactClient } from "convex/react"
import type { QueryClient } from "@tanstack/react-query"
import type { OpKind } from "./op-types"

/**
 * The one place the outbox meets Convex and TanStack.
 *
 * `send` is `convexClient.mutation` with the kind's optimistic function as
 * Convex's own `optimisticUpdate`; `applyLocal` is the same function against
 * the TanStack adapter. Same function, two stores — see the adapter's note.
 */
export function createOutbox(convexClient: ConvexReactClient, queryClient: QueryClient): Outbox {
  const adapter = new TanStackLocalStore(queryClient)
  const kinds = OP_KINDS as unknown as Record<string, OpKind<any, any>>
  return new Outbox({
    store: createOutboxStore(),
    kinds,
    send: (op, args) => {
      const def = kinds[op.kind]
      const optimistic = def.optimistic
      return convexClient.mutation(
        def.ref,
        args,
        optimistic === undefined
          ? {}
          : { optimisticUpdate: (store) => optimistic(store, args, op.local) }
      )
    },
    applyLocal: (op) => {
      const def = kinds[op.kind]
      try {
        def.optimistic?.(adapter, op.args, op.local)
      } catch {
        // A patch against a cache shape that has since changed must never
        // stop the boot. The server's answer is on its way regardless.
      }
    },
    retryable: isRetryableRejection,
    lock: webLock("chroneli-outbox"),
  })
}
```

- [ ] **Step 2: The provider and hooks**

Create `src/lib/offline/outbox-provider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import { useConvex, useConvexAuth } from "convex/react"
import { useQueryClient } from "@tanstack/react-query"
import { createOutbox } from "./create-outbox"
import type { ReactNode } from "react"
import type { Outbox, OutboxEvent } from "./outbox"
import type { ArgsOf, OpKindName, ResultOf } from "./op-kinds"
import type { OpLocal } from "./op-types"

const OutboxContext = createContext<Outbox | null>(null)

/**
 * Mounted once, under the authed layout: ops belong to a signed-in user, and
 * the drain needs a session. Loads the journal on mount and kicks the drain
 * whenever the socket connects, the browser comes online, or auth arrives.
 */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { isAuthenticated } = useConvexAuth()
  const outbox = useMemo(() => createOutbox(convex, queryClient), [convex, queryClient])

  useEffect(() => {
    void outbox.load()
    const kick = () => outbox.kick()
    const unsubscribe = convex.subscribeToConnectionState((state) => {
      if (state.isWebSocketConnected) kick()
    })
    window.addEventListener("online", kick)
    return () => {
      unsubscribe()
      window.removeEventListener("online", kick)
    }
  }, [outbox, convex])

  useEffect(() => {
    if (isAuthenticated) outbox.kick()
  }, [isAuthenticated, outbox])

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>
}

export function useOutbox(): Outbox {
  const outbox = useContext(OutboxContext)
  if (outbox === null) throw new Error("useOutbox must be used under <OutboxProvider>")
  return outbox
}

/**
 * The replacement for `useConvexMutation(ref).withOptimisticUpdate(fn)`.
 *
 * Stable across renders (so no `useLatest`), resolves as soon as the op is
 * journaled, and never rejects — refusals arrive through `useOutboxEvents`.
 * `settled` is the server's eventual answer for the callers that need it
 * (`start` records `serverNow` from it).
 */
export function useOutboxMutation<K extends OpKindName>(kind: K) {
  const outbox = useOutbox()
  return useCallback(
    async (args: ArgsOf<K>, local?: OpLocal) => {
      const { result, settled } = await outbox.enqueue(kind, args as Record<string, unknown>, local)
      return { result: result as ResultOf<K>, settled: settled as Promise<ResultOf<K>> }
    },
    [outbox, kind]
  )
}

export function usePendingCount(): number {
  const outbox = useOutbox()
  return useSyncExternalStore(
    (onChange) => outbox.subscribe((e) => e.type === "changed" && onChange()),
    () => outbox.pending(),
    () => 0
  )
}

export function useOutboxEvents(listener: (event: OutboxEvent) => void): void {
  const outbox = useOutbox()
  useEffect(() => outbox.subscribe(listener), [outbox, listener])
}
```

- [ ] **Step 3: Rewrite `use-entry-mutations.ts`**

Replace the file's body (keep the header comment about one optimistic mechanism, rewritten to say the mechanism is now the outbox):

```ts
import { useCallback } from "react"
import { useOutboxMutation } from "@/lib/offline/outbox-provider"
import { recordServerNow } from "@/lib/clock"
import { newClientKey } from "@/lib/client-key"
import type { Doc, Id } from "../../convex/_generated/dataModel"

export function useEntryMutations() {
  const startOp = useOutboxMutation("entries.start")
  const stopOp = useOutboxMutation("entries.stop")
  const discardOp = useOutboxMutation("entries.discardRunning")
  const setTitleOp = useOutboxMutation("entries.setTitle")

  /**
   * Starts tracking. Journaled before anything else happens — the outbox is
   * what `pending-start` used to be, for every write rather than this one.
   */
  const start = useCallback(
    async (
      input: {
        title?: string
        startedAt?: number
        projectId?: Id<"projects">
        tagIds?: Array<Id<"tags">>
        billable?: boolean
      } = {}
    ) => {
      const { result, settled } = await startOp({
        clientKey: newClientKey(),
        title: input.title ?? "",
        startedAt: input.startedAt ?? Date.now(),
        projectId: input.projectId,
        tagIds: input.tagIds,
        billable: input.billable,
      })
      void settled.then((r) => recordServerNow(r.serverNow)).catch(() => undefined)
      return result
    },
    [startOp]
  )

  const resume = useCallback(
    async (entry: Doc<"timeEntries">) =>
      await start({
        title: entry.title,
        projectId: entry.projectId,
        tagIds: entry.tagIds,
        billable: entry.billable,
      }),
    [start]
  )

  /**
   * `endedAt` is recorded NOW: a stop replayed hours later must close the
   * entry at the moment the user pressed it, not at the moment it synced.
   *
   * `entryId` is what makes that safe — see `stopImpl` in convex/entries.ts.
   * It may be an `optimistic:` placeholder when the start has not landed yet,
   * which is exactly what the outbox rewrites once that start resolves.
   */
  const stop = useCallback(
    async (entryId?: Id<"timeEntries">) => {
      const { result, settled } = await stopOp({ entryId, endedAt: Date.now() })
      void settled.then((r) => recordServerNow(r.serverNow)).catch(() => undefined)
      return result
    },
    [stopOp]
  )

  const discard = useCallback(
    async (entryId?: Id<"timeEntries">) => (await discardOp({ entryId })).result,
    [discardOp]
  )

  const setTitle = useCallback(
    async (entryId: Id<"timeEntries">, title: string) => {
      await setTitleOp({ entryId, title })
    },
    [setTitleOp]
  )

  return { start, resume, stop, discard, setTitle }
}
```

**The callers must supply the name.** `TimerBarActions.stop` is typed `() => Promise<…>` and the bar calls it with no argument, so the id is supplied where the running entry is in scope rather than by widening the component's contract. In `src/routes/_authed.tsx`, inside `AuthedShell`, change the two call sites to close over `running`:

```tsx
      stop: () => entryMutations.stop(running?._id),
```

in the `timerActions` memo (add `running` to its dependency array), and in the `RunawayBanner` props:

```tsx
            onStop={() => void entryMutations.stop(running?._id).catch(report)}
```

`discardRunning` in the same file becomes `entryMutations.discard(running?._id)`. A `running` of `null` leaves the id undefined, which is the old "stop whatever is running" behaviour — correct, because a user can only press stop when the bar is showing them a timer.

Keep the moved `optimisticEntry` import out of this file (it no longer needs it). Delete `src/lib/pending-start.ts` and its test if one exists. In `src/hooks/use-timer-effects.ts` delete `useReplayPendingStart` and its imports (`useEntryMutations`, `readPendingStart`, `shouldReplay`). In `src/routes/_authed.tsx` delete `useReplayPendingStart(running)` and its import.

- [ ] **Step 4: Rewrite the edit hook's mutation bindings**

In `src/hooks/use-entry-edit-mutations.ts` replace every `useLatest(useConvexMutation(...).withOptimisticUpdate(...))` and the `pendingRestore` ref with outbox bindings, keeping every exported wrapper's signature:

```ts
import { useCallback } from "react"
import { useOutboxMutation } from "@/lib/offline/outbox-provider"
import { newClientKey } from "@/lib/client-key"
import type { TimeEdit } from "@shared/entryTimes"
import type { Doc, Id } from "../../convex/_generated/dataModel"

type Entry = Doc<"timeEntries">

export function useEntryEditMutations() {
  const updateOp = useOutboxMutation("entries.update")
  const updateManyOp = useOutboxMutation("entries.updateMany")
  const editTimeOp = useOutboxMutation("entries.editTime")
  const removeOp = useOutboxMutation("entries.remove")
  const removeManyOp = useOutboxMutation("entries.removeMany")
  const restoreOp = useOutboxMutation("entries.restore")
  const restoreManyOp = useOutboxMutation("entries.restoreMany")
  const createOp = useOutboxMutation("entries.create")

  const update = useCallback(
    async (args: {
      entryId: Id<"timeEntries">
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateOp(args)
    },
    [updateOp]
  )

  const updateMany = useCallback(
    async (args: {
      entryIds: Array<Id<"timeEntries">>
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateManyOp(args)
    },
    [updateManyOp]
  )

  const editTime = useCallback(
    async (entryId: Id<"timeEntries">, field: TimeEdit["field"], value: number) =>
      (await editTimeOp({ entryId, field, value })).result,
    [editTimeOp]
  )

  const remove = useCallback(
    async (entryId: Id<"timeEntries">) => (await removeOp({ entryId })).result,
    [removeOp]
  )

  const removeMany = useCallback(
    async (entryIds: Array<Id<"timeEntries">>) =>
      (await removeManyOp({ entryIds: [...new Set(entryIds)] })).result,
    [removeManyOp]
  )

  /** Undo. The snapshot rides on the op as `local`, so a restore journaled
   *  offline can still put the row back on screen after a reload. */
  const restore = useCallback(
    async (entry: Entry) => (await restoreOp({ entryId: entry._id }, { entry })).result,
    [restoreOp]
  )

  const restoreMany = useCallback(
    async (entries: Array<Entry>) => {
      const unique = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
      return (await restoreManyOp({ entryIds: unique.map((e) => e._id) }, { entries: unique })).result
    },
    [restoreManyOp]
  )

  const create = useCallback(
    async (args: {
      title?: string
      note?: string
      startedAt: number
      endedAt: number
      projectId?: Id<"projects">
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => (await createOp({ clientKey: newClientKey(), ...args })).result,
    [createOp]
  )

  return { update, updateMany, editTime, remove, removeMany, restore, restoreMany, create }
}
```

Keep the file's header comment about `listRange`/`listPage`, moved to `optimistic-entries.ts` if it is not already there.

- [ ] **Step 5: Update the hook test's mock**

In `src/hooks/use-entry-edit-mutations.test.ts`, replace the `vi.hoisted` block and the `vi.mock("@convex-dev/react-query", …)` block with:

```ts
const { setActiveStore, getActiveStore } = vi.hoisted(() => {
  let activeStore: OptimisticLocalStore | undefined
  return {
    setActiveStore: (store: OptimisticLocalStore) => {
      activeStore = store
    },
    getActiveStore: () => activeStore,
  }
})

/**
 * The hook now binds through `useOutboxMutation`, so that is the seam. The
 * mock runs the kind's REAL optimistic function (from op-kinds.ts) against
 * the fake store, which is exactly what the outbox does on enqueue.
 */
vi.mock("@/lib/offline/outbox-provider", async () => {
  const { OP_KINDS } = await import("@/lib/offline/op-kinds")
  return {
    useOutboxMutation: (kind: keyof typeof OP_KINDS) => async (args: unknown, local?: unknown) => {
      const def = OP_KINDS[kind] as unknown as {
        optimistic?: (store: OptimisticLocalStore, args: unknown, local: unknown) => void
        immediate: (args: unknown, now: number) => unknown
      }
      const store = getActiveStore()
      if (store !== undefined) def.optimistic?.(store, args, local)
      const result = def.immediate(args, Date.now())
      return { result, settled: Promise.resolve(result) }
    },
  }
})
```

Remove now-unused identifiers (`registerOptimisticUpdate`, `invokeOptimisticUpdate`, the `OptimisticUpdateFn` type if unused). Keep `sameQuery`, the fake store and every `it(...)`. Run:

```bash
pnpm vitest run src/hooks/use-entry-edit-mutations.test.ts
```

Expected: every existing case passes. A case that asserted the mutation was CALLED with specific args (a `vi.fn` expectation on the mocked mutate) no longer has that fn; replace such an assertion with one on the fake store's contents, which is what the case was protecting.

- [ ] **Step 6: Classifiers and settings**

In `src/hooks/use-classifiers.ts` replace the body of `useClassifierMutations`:

```ts
export function useClassifierMutations() {
  const createProjectOp = useOutboxMutation("projects.create")
  const updateProjectOp = useOutboxMutation("projects.update")
  const setArchivedOp = useOutboxMutation("projects.setArchived")
  const removeProjectOp = useOutboxMutation("projects.remove")
  const ensureTagOp = useOutboxMutation("tags.ensure")
  const renameTagOp = useOutboxMutation("tags.rename")
  const removeTagOp = useOutboxMutation("tags.remove")

  const createProject = useCallback(
    async (input: { name: string; color?: string; billableByDefault?: boolean; hourlyRateCents?: number }) =>
      (await createProjectOp({ clientKey: newClientKey(), ...input })).result,
    [createProjectOp]
  )

  const updateProject = useCallback(
    async (input: {
      projectId: Id<"projects">
      name?: string
      color?: string
      billableByDefault?: boolean
      hourlyRateCents?: number | null
    }) => (await updateProjectOp(input)).result,
    [updateProjectOp]
  )

  const setArchived = useCallback(
    async (projectId: Id<"projects">, archived: boolean) =>
      (await setArchivedOp({ projectId, archived })).result,
    [setArchivedOp]
  )

  const removeProject = useCallback(
    async (projectId: Id<"projects">) => (await removeProjectOp({ projectId })).result,
    [removeProjectOp]
  )

  /** Get-or-create. The picker's flow is "type a word, press Enter". */
  const ensureTag = useCallback(
    async (name: string) => (await ensureTagOp({ name })).result,
    [ensureTagOp]
  )

  const renameTag = useCallback(
    async (tagId: Id<"tags">, name: string) => (await renameTagOp({ tagId, name })).result,
    [renameTagOp]
  )

  const removeTag = useCallback(
    async (tagId: Id<"tags">) => (await removeTagOp({ tagId })).result,
    [removeTagOp]
  )

  return { createProject, updateProject, setArchived, removeProject, ensureTag, renameTag, removeTag }
}
```

Add `import { useOutboxMutation } from "@/lib/offline/outbox-provider"` and `import { newClientKey } from "@/lib/client-key"`; drop `useConvexMutation` and `useLatest` imports if now unused.

In `src/routes/_authed/-settings.tsx`: replace `const update = useLatest(useConvexMutation(api.settings.update))` with `const update = useOutboxMutation("settings.update")` and `save` with:

```ts
  const save = (patch: Parameters<typeof update>[0]) => {
    // Never rejects: a refusal reaches the user through the outbox's toast.
    void update(patch)
  }
```

Also replace `useLatest(useConvexMutation(api.projects.create))` at `-settings.tsx:167` with `useClassifierMutations().createProject` from `@/hooks/use-classifiers` and adapt its one call site to `createProject({ name })` returning `{ projectId }`.

- [ ] **Step 7: Mount the provider**

In `src/routes/_authed.tsx`, inside `AuthedLayout`, wrap `MusicProvider` in `OutboxProvider`:

```tsx
  return (
    <OutboxProvider>
      <MusicProvider …>
        <AuthedShell />
      </MusicProvider>
    </OutboxProvider>
  )
```

Add `import { OutboxProvider } from "@/lib/offline/outbox-provider"`.

- [ ] **Step 8: Full verification and commit**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Then start the app (`pnpm dev`, port 3100), sign in, start/stop/retitle a timer, create a project, and confirm in DevTools → Application → IndexedDB → `chroneli-offline/outbox` that ops appear and clear. Commit:

```bash
git add -A src/hooks src/lib/offline src/routes/_authed.tsx src/routes/_authed/-settings.tsx
git rm src/lib/pending-start.ts
git commit -m "feat(offline): every entry, project, tag and settings write goes through the outbox"
```

---

### Task 10: Online status, the status line, and drop reporting

**Files:**
- Create: `src/lib/offline/online.ts`, `src/lib/offline/online.test.ts`
- Create: `src/lib/offline/use-online-status.ts`
- Create: `src/components/shell/sync-status.tsx`, `src/components/shell/sync-status.test.tsx`
- Modify: `src/routes/_authed.tsx`

**Interfaces:**
- Produces: `isOffline(state: { isWebSocketConnected: boolean; hasEverConnected: boolean; connectionRetries: number }, navigatorOnline: boolean): boolean`; `useOnlineStatus(): boolean`; `SyncStatus({ offline, pending }: { offline: boolean; pending: number })`.

- [ ] **Step 1: The predicate, test first**

Create `src/lib/offline/online.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isOffline } from "./online"

const connected = { isWebSocketConnected: true, hasEverConnected: true, connectionRetries: 0 }

describe("isOffline", () => {
  it("is offline when the browser says so, whatever the socket thinks", () => {
    expect(isOffline(connected, false)).toBe(true)
  })
  it("is online while connected", () => {
    expect(isOffline(connected, true)).toBe(false)
  })
  it("is offline once a previously good socket has dropped and retried", () => {
    expect(isOffline({ ...connected, isWebSocketConnected: false, connectionRetries: 1 }, true)).toBe(true)
  })
  it("gives a fresh boot two tries before calling it offline", () => {
    const fresh = { isWebSocketConnected: false, hasEverConnected: false, connectionRetries: 0 }
    expect(isOffline(fresh, true)).toBe(false)
    expect(isOffline({ ...fresh, connectionRetries: 1 }, true)).toBe(false)
    expect(isOffline({ ...fresh, connectionRetries: 2 }, true)).toBe(true)
  })
})
```

Create `src/lib/offline/online.ts`:

```ts
/**
 * "Can a write reach the server right now?"
 *
 * Two witnesses, because each lies in its own way: `navigator.onLine` is
 * true on a Wi-Fi network with no internet, and the Convex socket is closed
 * for the first few hundred milliseconds of every boot. The browser saying
 * offline is final. Otherwise a socket that WAS connected and has dropped is
 * offline on its first failed retry, while a socket that has never connected
 * gets two tries before the status line says anything.
 */
export function isOffline(
  state: { isWebSocketConnected: boolean; hasEverConnected: boolean; connectionRetries: number },
  navigatorOnline: boolean
): boolean {
  if (!navigatorOnline) return true
  if (state.isWebSocketConnected) return false
  return state.hasEverConnected ? state.connectionRetries > 0 : state.connectionRetries >= 2
}
```

Create `src/lib/offline/use-online-status.ts`:

```ts
import { useSyncExternalStore } from "react"
import { useConvexConnectionState } from "convex/react"
import { isOffline } from "./online"

function subscribeNavigator(onChange: () => void) {
  window.addEventListener("online", onChange)
  window.addEventListener("offline", onChange)
  return () => {
    window.removeEventListener("online", onChange)
    window.removeEventListener("offline", onChange)
  }
}

/** True when a write can reach the server. Needs the Convex provider above it. */
export function useOnlineStatus(): boolean {
  const state = useConvexConnectionState()
  const navigatorOnline = useSyncExternalStore(
    subscribeNavigator,
    () => navigator.onLine,
    () => true
  )
  return !isOffline(state, navigatorOnline)
}
```

Run `pnpm vitest run src/lib/offline/online.test.ts` → 4 passed.

- [ ] **Step 2: The status line, test first**

Create `src/components/shell/sync-status.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SyncStatus } from "./sync-status"

describe("SyncStatus", () => {
  it("renders nothing when online with nothing pending", () => {
    const { container } = render(<SyncStatus offline={false} pending={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("says offline and how many changes are waiting", () => {
    render(<SyncStatus offline pending={3} />)
    expect(screen.getByRole("status")).toHaveTextContent("Offline. 3 changes will sync when you're back.")
  })

  it("says syncing while online with pending changes", () => {
    render(<SyncStatus offline={false} pending={1} />)
    expect(screen.getByRole("status")).toHaveTextContent("Syncing 1 change…")
  })

  it("confirms briefly once the count returns to zero", () => {
    vi.useFakeTimers()
    const { rerender, container } = render(<SyncStatus offline={false} pending={2} />)
    rerender(<SyncStatus offline={false} pending={0} />)
    expect(screen.getByRole("status")).toHaveTextContent("All changes saved.")
    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(container).toBeEmptyDOMElement()
    vi.useRealTimers()
  })
})
```

`toBeEmptyDOMElement` is not in this project's matchers (see `src/test-utils/setup-dom.ts`); use `expect(container.innerHTML).toBe("")` instead.

Create `src/components/shell/sync-status.tsx`:

```tsx
import { useEffect, useRef, useState } from "react"
import { CloudOff, RefreshCw, Check } from "lucide-react"
import { cn } from "@/lib/utils"

const SAVED_FOR_MS = 2_000

/**
 * The outbox, said out loud.
 *
 * Same register as `RunawayBanner`: `role="status"`, never colour alone — a
 * glyph and a sentence carry the state (The Over-Determined State Rule).
 * Not an error surface: being offline is ordinary, and a change waiting to
 * sync is the product working as promised, not failing.
 */
export function SyncStatus({ offline, pending }: { offline: boolean; pending: number }) {
  const [justSaved, setJustSaved] = useState(false)
  const previous = useRef(pending)

  useEffect(() => {
    if (previous.current > 0 && pending === 0 && !offline) {
      setJustSaved(true)
      const timer = setTimeout(() => setJustSaved(false), SAVED_FOR_MS)
      previous.current = pending
      return () => clearTimeout(timer)
    }
    previous.current = pending
  }, [pending, offline])

  const changes = `${pending} ${pending === 1 ? "change" : "changes"}`

  let content: { Icon: typeof CloudOff; text: string; spin?: boolean } | null = null
  if (offline) {
    content = {
      Icon: CloudOff,
      text: pending === 0 ? "Offline. Changes will sync when you're back." : `Offline. ${changes} will sync when you're back.`,
    }
  } else if (pending > 0) {
    content = { Icon: RefreshCw, text: `Syncing ${changes}…`, spin: true }
  } else if (justSaved) {
    content = { Icon: Check, text: "All changes saved." }
  }

  if (content === null) return null
  const { Icon, text, spin } = content
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 border-b border-border bg-card px-4 py-1.5 text-sm",
        "text-muted-foreground"
      )}
    >
      <Icon aria-hidden="true" className={cn("size-4", spin && "animate-spin motion-reduce:animate-none")} />
      <span>{text}</span>
    </div>
  )
}
```

Run `pnpm vitest run src/components/shell/sync-status.test.tsx` → 4 passed.

- [ ] **Step 3: Wire into the shell and report drops**

In `src/routes/_authed.tsx`'s `AuthedShell`, after `const report = …`, add:

```tsx
  const online = useOnlineStatus()
  const pending = usePendingCount()
  useOutboxEvents(
    useCallback(
      (event) => {
        if (event.type !== "dropped") return
        const label = OP_KINDS[event.op.kind as OpKindName]?.label ?? "A change"
        const why =
          event.reason === "stale"
            ? "was started more than a day ago while offline, so it wasn't resumed."
            : event.reason === "orphaned"
              ? "depended on something that didn't save."
              : `didn't save: ${errorMessage(event.error)}`
        toasts.add({ title: `${label} ${why}`, priority: "high", timeout: 8_000 })
      },
      [toasts]
    )
  )
```

Imports: `useCallback` from react, `useOnlineStatus` from `@/lib/offline/use-online-status`, `usePendingCount, useOutboxEvents` from `@/lib/offline/outbox-provider`, `OP_KINDS` and `type OpKindName` from `@/lib/offline/op-kinds`.

Render `<SyncStatus offline={!online} pending={pending} />` inside the `timer` fragment, after `<RunawayBanner … />`. Import it from `@/components/shell/sync-status`.

- [ ] **Step 4: Verify in the browser, commit**

Run the app, open DevTools → Network → Offline. The status line must appear; start a timer and retitle it; the line must count the changes. Go back online; the line must say "Syncing…" then "All changes saved." and IndexedDB `outbox` must empty.

```bash
pnpm test && pnpm typecheck && pnpm lint
git add src/lib/offline src/components/shell/sync-status.tsx src/components/shell/sync-status.test.tsx src/routes/_authed.tsx
git commit -m "feat(offline): the shell says when it is offline, what is waiting, and what did not save"
```

---

### Task 11: Cached reads: the query snapshot layer

**Files:**
- Create: `src/lib/offline/query-snapshots.ts`, `src/lib/offline/query-snapshots.test.ts`
- Modify: `src/router.tsx`

**Interfaces:**
- Produces: `interface SnapshotStore { read(hash): Promise<Snapshot|undefined>; write(hash, snap): Promise<void>; prune(olderThanMs): Promise<void>; clear(): Promise<void> }`; `MemorySnapshotStore`; `IdbSnapshotStore`; `createSnapshotStore()`; `isConvexQueryKey(key: readonly unknown[]): boolean`; `attachSnapshotWriter(cache: QueryCache, store, debounceMs?): () => void`; `snapshotQueryFn(inner, store, hashFn, isConnected): QueryFunction`; `SNAPSHOT_MAX_AGE_MS`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/offline/query-snapshots.test.ts`:

```ts
import "fake-indexeddb/auto"
import { QueryClient, hashKey } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import {
  IdbSnapshotStore,
  MemorySnapshotStore,
  attachSnapshotWriter,
  isConvexQueryKey,
  snapshotQueryFn,
} from "./query-snapshots"
import type { QueryFunction, QueryFunctionContext } from "@tanstack/react-query"

const KEY = ["convexQuery", "settings:get", {}]
const ctx = (queryKey: readonly unknown[]) =>
  ({ queryKey, signal: new AbortController().signal, meta: undefined }) as unknown as QueryFunctionContext

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("isConvexQueryKey", () => {
  it("accepts convex query keys and rejects skipped ones", () => {
    expect(isConvexQueryKey(KEY)).toBe(true)
    expect(isConvexQueryKey(["convexQuery", "x", "skip"])).toBe(false)
    expect(isConvexQueryKey(["other"])).toBe(false)
  })
})

describe("snapshotQueryFn", () => {
  it("serves the snapshot while disconnected and the network when connected", async () => {
    const store = new MemorySnapshotStore()
    await store.write(hashKey(KEY), { data: { timezone: "UTC" }, updatedAt: 1 })
    const inner: QueryFunction = async () => ({ timezone: "fresh" })
    let connected = false
    const fn = snapshotQueryFn(inner, store, hashKey, () => connected)
    expect(await fn(ctx(KEY))).toEqual({ timezone: "UTC" })
    connected = true
    expect(await fn(ctx(KEY))).toEqual({ timezone: "fresh" })
  })

  it("falls through to the network when there is no snapshot", async () => {
    const inner: QueryFunction = async () => "net"
    const fn = snapshotQueryFn(inner, new MemorySnapshotStore(), hashKey, () => false)
    expect(await fn(ctx(KEY))).toBe("net")
  })
})

describe("attachSnapshotWriter", () => {
  it("writes successful convex results, debounced, and ignores other keys", async () => {
    const client = new QueryClient()
    const store = new MemorySnapshotStore()
    const detach = attachSnapshotWriter(client.getQueryCache(), store, 10)
    client.setQueryData(KEY, { a: 1 })
    client.setQueryData(KEY, { a: 2 })
    client.setQueryData(["other"], 1)
    await wait(30)
    expect((await store.read(hashKey(KEY)))?.data).toEqual({ a: 2 })
    expect(await store.read(hashKey(["other"]))).toBeUndefined()
    detach()
  })
})

describe("IdbSnapshotStore", () => {
  it("round-trips, prunes by age, and clears", async () => {
    const store = new IdbSnapshotStore(`snap-${Math.random()}`)
    await store.write("old", { data: 1, updatedAt: 100 })
    await store.write("new", { data: 2, updatedAt: 1_000 })
    await store.prune(500)
    expect(await store.read("old")).toBeUndefined()
    expect((await store.read("new"))?.data).toBe(2)
    await store.clear()
    expect(await store.read("new")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Create `src/lib/offline/query-snapshots.ts`:

```ts
import { clear, createStore, del, entries, get, set } from "idb-keyval"
import type { QueryCache, QueryFunction, QueryKey } from "@tanstack/react-query"

export type Snapshot = { data: unknown; updatedAt: number }

export interface SnapshotStore {
  read(hash: string): Promise<Snapshot | undefined>
  write(hash: string, snapshot: Snapshot): Promise<void>
  /** Drops snapshots whose `updatedAt` is before `olderThanMs`. */
  prune(olderThanMs: number): Promise<void>
  clear(): Promise<void>
}

/** Thirty days: long enough for last month's report, short enough to bound the store. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export class MemorySnapshotStore implements SnapshotStore {
  private map = new Map<string, Snapshot>()
  async read(hash: string) {
    return this.map.get(hash)
  }
  async write(hash: string, snapshot: Snapshot) {
    this.map.set(hash, snapshot)
  }
  async prune(olderThanMs: number) {
    for (const [hash, snap] of this.map) if (snap.updatedAt < olderThanMs) this.map.delete(hash)
  }
  async clear() {
    this.map.clear()
  }
}

export class IdbSnapshotStore implements SnapshotStore {
  private readonly store
  constructor(dbName = "chroneli-offline") {
    this.store = createStore(dbName, "query-snapshots")
  }
  async read(hash: string) {
    return await get<Snapshot>(hash, this.store)
  }
  async write(hash: string, snapshot: Snapshot) {
    await set(hash, snapshot, this.store)
  }
  async prune(olderThanMs: number) {
    for (const [hash, snap] of await entries<string, Snapshot>(this.store)) {
      if (snap.updatedAt < olderThanMs) await del(hash, this.store)
    }
  }
  async clear() {
    await clear(this.store)
  }
}

export function createSnapshotStore(): SnapshotStore {
  try {
    if (typeof indexedDB === "undefined") return new MemorySnapshotStore()
    return new IdbSnapshotStore()
  } catch {
    return new MemorySnapshotStore()
  }
}

export function isConvexQueryKey(key: readonly unknown[]): boolean {
  return key[0] === "convexQuery" && key[2] !== "skip"
}

/**
 * The read side of offline.
 *
 * NOT TanStack's persistQueryClient: that hydrates every persisted key at
 * boot, and @convex-dev/react-query opens a live subscription for every query
 * added to the cache, so hundreds of old report ranges would go live on every
 * reconnect. This answers only what is asked: while the socket is down, a
 * query with a snapshot resolves from it at once; Convex marks its queries
 * never-stale so nothing refetches; and the subscription the cache opened
 * replaces the snapshot the moment the socket delivers.
 */
export function snapshotQueryFn(
  inner: QueryFunction,
  store: SnapshotStore,
  hashFn: (key: QueryKey) => string,
  isConnected: () => boolean
): QueryFunction {
  return async (context) => {
    if (isConvexQueryKey(context.queryKey) && !isConnected()) {
      const snapshot = await store.read(hashFn(context.queryKey))
      if (snapshot !== undefined) return snapshot.data
    }
    return await inner(context)
  }
}

/** Write-through of every successful Convex result, debounced per key. */
export function attachSnapshotWriter(
  cache: QueryCache,
  store: SnapshotStore,
  debounceMs = 300
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return
    if (!isConvexQueryKey(event.query.queryKey)) return
    const { queryHash } = event.query
    const existing = timers.get(queryHash)
    if (existing !== undefined) clearTimeout(existing)
    timers.set(
      queryHash,
      setTimeout(() => {
        timers.delete(queryHash)
        const { data, dataUpdatedAt } = event.query.state
        if (data === undefined) return
        void store.write(queryHash, { data, updatedAt: dataUpdatedAt }).catch(() => undefined)
      }, debounceMs)
    )
  })
  return () => {
    unsubscribe()
    for (const timer of timers.values()) clearTimeout(timer)
  }
}
```

Note: `QueryCache`'s `queryHash` is computed with the client's `queryKeyHashFn` — Convex's `hashFn()` in this app — so the writer's key and `snapshotQueryFn`'s `hashFn(queryKey)` agree as long as `router.tsx` passes the same function to both.

Run `pnpm vitest run src/lib/offline/query-snapshots.test.ts` → all pass.

- [ ] **Step 3: Wire into `router.tsx`**

Replace the `QueryClient` construction with:

```ts
  const hashFn = convexQueryClient.hashFn()
  const snapshots = typeof document === "undefined" ? new MemorySnapshotStore() : createSnapshotStore()
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryKeyHashFn: hashFn,
        queryFn: snapshotQueryFn(
          convexQueryClient.queryFn(),
          snapshots,
          hashFn,
          () => convexQueryClient.convexClient.connectionState().isWebSocketConnected
        ),
      },
    },
  })
  convexQueryClient.connect(queryClient)
  if (typeof document !== "undefined") {
    attachSnapshotWriter(queryClient.getQueryCache(), snapshots)
    void snapshots.prune(Date.now() - SNAPSHOT_MAX_AGE_MS)
  }
```

Import `MemorySnapshotStore, SNAPSHOT_MAX_AGE_MS, attachSnapshotWriter, createSnapshotStore, snapshotQueryFn` from `@/lib/offline/query-snapshots`. Export the store for sign-out: add `snapshots` to the router context type and the `context: { queryClient, convexQueryClient, snapshots }` object, and add `snapshots: SnapshotStore` to the `createRootRouteWithContext<…>()` generic in `__root.tsx`.

- [ ] **Step 4: Verify, commit**

Run the app, open /reports for a range, then DevTools → Network → Offline → reload. Expected: the browser cannot load the page yet (no service worker until Task 13) — so instead verify this way: go offline WITHOUT reloading, navigate client-side to /projects (visited earlier in the session) — it renders. Then `pnpm test && pnpm typecheck && pnpm lint` and commit:

```bash
git add src/lib/offline/query-snapshots.ts src/lib/offline/query-snapshots.test.ts src/router.tsx src/routes/__root.tsx
git commit -m "feat(offline): the last result of every query, served from IndexedDB while the socket is down"
```

---

### Task 12: The timer log reads through the TanStack cache

**Files:**
- Create: `src/hooks/use-convex-pages.ts`, `src/hooks/use-convex-pages.test.tsx`
- Modify: `src/routes/_authed/-timer.tsx:18,376-379,899-900`

**Interfaces:**
- Produces: `useConvexPages<Item>(query, baseArgs | "skip", numItems): { results: Item[]; status: "LoadingFirstPage" | "LoadingMore" | "CanLoadMore" | "Exhausted"; loadMore: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/use-convex-pages.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { anyApi } from "convex/server"
import { describe, expect, it } from "vitest"
import { useConvexPages } from "./use-convex-pages"
import type { ReactNode } from "react"

const listPage = anyApi.entries.listPage
const page = (cursor: string | null) => [
  "convexQuery",
  "entries:listPage",
  { fromMs: 0, toMs: 10, paginationOpts: { numItems: 2, cursor, id: 1 } },
]

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: () => new Promise(() => {}), staleTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("useConvexPages", () => {
  it("loads the first page, then chains cursors as pages arrive", () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useConvexPages(listPage, { fromMs: 0, toMs: 10 }, 2), { wrapper })
    expect(result.current.status).toBe("LoadingFirstPage")

    act(() => {
      client.setQueryData(page(null), { page: [1, 2], isDone: false, continueCursor: "c1" })
    })
    expect(result.current.results).toEqual([1, 2])
    expect(result.current.status).toBe("CanLoadMore")

    act(() => result.current.loadMore())
    expect(result.current.status).toBe("LoadingMore")

    act(() => {
      client.setQueryData(page("c1"), { page: [3], isDone: true, continueCursor: "end" })
    })
    expect(result.current.results).toEqual([1, 2, 3])
    expect(result.current.status).toBe("Exhausted")
  })

  it("is exhausted and empty when skipped", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useConvexPages(listPage, "skip", 2), { wrapper })
    expect(result.current.results).toEqual([])
    expect(result.current.status).toBe("Exhausted")
  })

  it("starts over at one page when the range changes", () => {
    const { client, wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ toMs }) => useConvexPages(listPage, { fromMs: 0, toMs }, 2),
      { wrapper, initialProps: { toMs: 10 } }
    )
    act(() => {
      client.setQueryData(page(null), { page: [1, 2], isDone: false, continueCursor: "c1" })
    })
    act(() => result.current.loadMore())
    rerender({ toMs: 20 })
    expect(result.current.status).toBe("LoadingFirstPage")
  })
})
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Create `src/hooks/use-convex-pages.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import type { FunctionReference, PaginationResult } from "convex/server"

type LogStatus = "LoadingFirstPage" | "LoadingMore" | "CanLoadMore" | "Exhausted"

/**
 * Pagination that lives in the TanStack cache.
 *
 * `usePaginatedQuery` from convex/react keeps its pages in Convex's client
 * only, which the snapshot layer never sees — so the log was the one surface
 * with nothing to show offline. This holds a page count and subscribes to one
 * `convexQuery(listPage, …)` per page, chaining each page's cursor from the
 * previous page's `continueCursor`. Each page is its own cache entry, so it is
 * snapshotted, restored, and patched by the optimistic functions that already
 * walk `listPage` by name.
 *
 * `id: 1` in `paginationOpts` mirrors what `usePaginatedQuery` sends, which
 * is what `insertAtPosition` groups pages by.
 *
 * Starts at ONE page on every mount, deliberately: a restored second page's
 * cursor was minted against an older first page, and after new entries land
 * the two no longer meet. Older pages load again when asked for.
 */
export function useConvexPages<
  Query extends FunctionReference<"query", "public", any, PaginationResult<any>>,
>(
  query: Query,
  baseArgs: Omit<Query["_args"], "paginationOpts"> | "skip",
  numItems: number
): {
  results: Array<Query["_returnType"]["page"][number]>
  status: LogStatus
  loadMore: () => void
} {
  const queryClient = useQueryClient()
  const [pageCount, setPageCount] = useState(1)
  const baseKey = JSON.stringify(baseArgs)
  useEffect(() => setPageCount(1), [baseKey])

  // Chain as far as loaded pages allow: a page's args need the previous
  // page's cursor, which is only known once that page is in the cache.
  const pages = useMemo(() => {
    if (baseArgs === "skip") return []
    const list: Array<Record<string, unknown>> = []
    let cursor: string | null = null
    for (let i = 0; i < pageCount; i++) {
      const args = { ...(baseArgs as Record<string, unknown>), paginationOpts: { numItems, cursor, id: 1 } }
      list.push(args)
      const data = queryClient.getQueryData<PaginationResult<unknown>>(convexQuery(query, args as any).queryKey)
      if (data === undefined) break
      cursor = data.continueCursor
    }
    return list
    // baseKey stands in for baseArgs; pageCount and the cache drive the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey, pageCount, numItems, query, queryClient])

  const queries = useQueries({
    queries: pages.map((args) => ({ ...convexQuery(query, args as any) })),
  })

  const loaded = queries.map((q) => q.data as PaginationResult<unknown> | undefined)
  const results = loaded.flatMap((p) => p?.page ?? []) as Array<Query["_returnType"]["page"][number]>
  const last = loaded[loaded.length - 1]

  let status: LogStatus
  if (baseArgs === "skip") status = "Exhausted"
  else if (loaded[0] === undefined) status = "LoadingFirstPage"
  else if (loaded.length < pageCount || last === undefined) status = "LoadingMore"
  else if (last.isDone) status = "Exhausted"
  else status = "CanLoadMore"

  const loadMore = useCallback(() => {
    setPageCount((count) => count + 1)
  }, [])

  return { results, status, loadMore }
}
```

If `Query["_args"]`/`Query["_returnType"]` do not typecheck against this project's generated references, use `FunctionArgs<Query>` and `FunctionReturnType<Query>` from `convex/server` instead.

Run `pnpm vitest run src/hooks/use-convex-pages.test.tsx` → 3 passed. Note: `useQueries` re-renders when a page's data is set with `setQueryData`; the test relies on that.

- [ ] **Step 3: Use it on Timer**

In `src/routes/_authed/-timer.tsx`: remove `import { usePaginatedQuery } from "convex/react"`, add `import { useConvexPages } from "@/hooks/use-convex-pages"`, and replace the `usePaginatedQuery` call with:

```ts
  const { results, status, loadMore } = useConvexPages(
    api.entries.listPage,
    range === null ? logRange : "skip",
    PAGE_SIZE
  )
```

and `onLoadMore={() => loadMore(PAGE_SIZE)}` with `onLoadMore={loadMore}`.

- [ ] **Step 4: Verify and commit**

Run the app. The log must render, "Load earlier entries" must append a page, and deleting/undoing a row must still patch the log. Then:

```bash
pnpm test && pnpm typecheck && pnpm lint
git add src/hooks/use-convex-pages.ts src/hooks/use-convex-pages.test.tsx src/routes/_authed/-timer.tsx
git commit -m "feat(timer): the log paginates through the TanStack cache, so it has a snapshot offline"
```

---

### Task 13: Booting offline: service worker, remembered auth, pending screen

**Files:**
- Create: `src/sw/routing.ts`, `src/sw/routing.test.ts`, `src/sw/index.ts`, `vite.sw.config.ts`
- Create: `src/lib/offline/register-sw.ts`, `src/lib/offline/remembered-auth.ts`, `src/lib/offline/remembered-auth.test.ts`
- Create: `src/components/shell/offline-pending.tsx`
- Modify: `package.json` (build script), `src/routes/__root.tsx`, `src/routes/_authed.tsx`, `tsconfig.json`

**Interfaces:**
- Produces: `decide(request: { url: string; method: string; mode: string }, origin: string): "bypass" | "navigation" | "asset" | "public"`; `registerServiceWorker(): void`; `readRememberedAuth(): boolean`, `writeRememberedAuth(v: boolean): void`, `clearRememberedAuth(): void`; `OfflinePending()`.

- [ ] **Step 1: Routing decisions, test first**

Create `src/sw/routing.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { decide } from "./routing"

const ORIGIN = "https://chroneli.com"
const req = (path: string, extra: Partial<{ method: string; mode: string; origin: string }> = {}) => ({
  url: `${extra.origin ?? ORIGIN}${path}`,
  method: extra.method ?? "GET",
  mode: extra.mode ?? "cors",
})

describe("decide", () => {
  it("bypasses writes, other origins, auth, server functions and itself", () => {
    expect(decide(req("/timer", { method: "POST" }), ORIGIN)).toBe("bypass")
    expect(decide(req("/x", { origin: "https://accomplished-shrimp-747.convex.cloud" }), ORIGIN)).toBe("bypass")
    expect(decide(req("/api/auth/get-session"), ORIGIN)).toBe("bypass")
    expect(decide(req("/_serverFn/abc"), ORIGIN)).toBe("bypass")
    expect(decide(req("/sw.js"), ORIGIN)).toBe("bypass")
  })
  it("treats navigations, hashed assets and public files distinctly", () => {
    expect(decide(req("/timer", { mode: "navigate" }), ORIGIN)).toBe("navigation")
    expect(decide(req("/assets/index-abc123.js"), ORIGIN)).toBe("asset")
    expect(decide(req("/manifest.json"), ORIGIN)).toBe("public")
    expect(decide(req("/music/track.mp3"), ORIGIN)).toBe("public")
  })
})
```

Create `src/sw/routing.ts`:

```ts
export type Decision = "bypass" | "navigation" | "asset" | "public"

const BYPASS_PREFIXES = ["/api/", "/_serverFn/"]

/**
 * What the service worker does with one request. Pure, so it is testable
 * without a worker: the worker in ./index.ts only carries these out.
 */
export function decide(
  request: { url: string; method: string; mode: string },
  origin: string
): Decision {
  if (request.method !== "GET") return "bypass"
  const url = new URL(request.url)
  if (url.origin !== origin) return "bypass"
  if (url.pathname === "/sw.js") return "bypass"
  if (BYPASS_PREFIXES.some((p) => url.pathname.startsWith(p))) return "bypass"
  if (request.mode === "navigate") return "navigation"
  if (url.pathname.startsWith("/assets/")) return "asset"
  return "public"
}
```

Run `pnpm vitest run src/sw/routing.test.ts` → 2 passed.

- [ ] **Step 2: The worker**

Create `src/sw/index.ts`:

```ts
/// <reference lib="webworker" />
import { decide } from "./routing"

declare const self: ServiceWorkerGlobalScope

const CACHE = "chroneli-v1"
const SHELL_KEY = "/__shell"

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chroneli · Offline</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:14px system-ui,sans-serif;background:#0a0a0a;color:#fafafa}main{max-width:32rem;padding:2rem;text-align:center}p{color:#a1a1aa}</style></head><body><main><h1>You're offline</h1><p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online. The timer page usually has.</p><p><a href="/timer" style="color:inherit">Go to the timer</a></p></main></body></html>`

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name)
      await self.clients.claim()
    })()
  )
})

async function networkFirstNavigation(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
      await cache.put(request, response.clone())
      // The last good page doubles as the shell for a URL never cached.
      await cache.put(SHELL_KEY, response.clone())
    }
    return response
  } catch {
    return (
      (await cache.match(request)) ??
      (await cache.match(SHELL_KEY)) ??
      new Response(OFFLINE_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    )
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  if (hit !== undefined) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(request)
  const refresh = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  if (hit !== undefined) return hit
  const fresh = await refresh
  if (fresh !== undefined) return fresh
  return new Response("", { status: 504 })
}

self.addEventListener("fetch", (event) => {
  const decision = decide(event.request, self.location.origin)
  if (decision === "bypass") return
  if (decision === "navigation") event.respondWith(networkFirstNavigation(event.request))
  else if (decision === "asset") event.respondWith(cacheFirst(event.request))
  else event.respondWith(staleWhileRevalidate(event.request))
})
```

Create `vite.sw.config.ts`:

```ts
import { defineConfig } from "vite"

/**
 * The service worker is built by a SECOND Vite invocation into the client
 * output, because vite-plugin-pwa does not run under TanStack Start's build
 * (TanStack/router#4988) and a worker cannot be a chunk of the app bundle.
 * Runs after `vite build`; `emptyOutDir: false` keeps the app's output.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
    lib: {
      entry: "src/sw/index.ts",
      formats: ["iife"],
      name: "sw",
      fileName: () => "sw.js",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
```

In `package.json` change `"build": "vite build"` to `"build": "vite build && vite build -c vite.sw.config.ts"`. In `tsconfig.json` add `"WebWorker"` to `compilerOptions.lib`.

Create `src/lib/offline/register-sw.ts`:

```ts
/** Production only: in dev a worker would serve stale modules over HMR. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined)
}

export async function clearServiceWorkerCaches(): Promise<void> {
  if (typeof caches === "undefined") return
  for (const name of await caches.keys()) await caches.delete(name)
}
```

Run `pnpm build` and confirm `dist/client/sw.js` exists and `dist/client/assets/` is intact.

- [ ] **Step 3: Remembered auth, test first**

Create `src/lib/offline/remembered-auth.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { clearRememberedAuth, readRememberedAuth, writeRememberedAuth } from "./remembered-auth"

// jsdom is not available in the unit project; a minimal localStorage stands in.
const backing = new Map<string, string>()
beforeEach(() => {
  backing.clear()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  }
})

describe("remembered auth", () => {
  it("defaults to signed out", () => {
    expect(readRememberedAuth()).toBe(false)
  })
  it("remembers, and forgets", () => {
    writeRememberedAuth(true)
    expect(readRememberedAuth()).toBe(true)
    clearRememberedAuth()
    expect(readRememberedAuth()).toBe(false)
  })
})
```

Create `src/lib/offline/remembered-auth.ts`:

```ts
const KEY = "chroneli.rememberedAuth.v1"

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * The root route asks the server for a token on every navigation. Offline,
 * that call throws, and the only honest answer is the last one the server
 * gave — which is what this remembers. It is a UX guard, not a security
 * boundary: every Convex function still checks the session itself.
 */
export function readRememberedAuth(): boolean {
  try {
    return storage()?.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function writeRememberedAuth(signedIn: boolean): void {
  try {
    if (signedIn) storage()?.setItem(KEY, "1")
    else storage()?.removeItem(KEY)
  } catch {
    // ignore
  }
}

export function clearRememberedAuth(): void {
  writeRememberedAuth(false)
}
```

Run `pnpm vitest run src/lib/offline/remembered-auth.test.ts` → 2 passed.

- [ ] **Step 4: The root route tolerates an unreachable server**

In `src/routes/__root.tsx` replace `beforeLoad` with:

```ts
  beforeLoad: async (ctx) => {
    let token: string | null
    try {
      token = await getAuth()
    } catch (error) {
      // On the server there is no "unreachable": rethrow. In the browser a
      // thrown server function means the fetch itself failed — offline, or
      // the site is down — and the last answer stands. A server that answers
      // "no token" never lands here; that is a null below, not a throw.
      if (typeof window === "undefined") throw error
      return { isAuthenticated: readRememberedAuth(), token: null, bootedOffline: true }
    }

    if (token) {
      ctx.context.convexQueryClient.serverHttpClient?.setAuth(token)
    }
    if (typeof window !== "undefined") writeRememberedAuth(!!token)

    return { isAuthenticated: !!token, token, bootedOffline: false }
  },
```

In `RootComponent` add, before the `return`:

```ts
  useEffect(() => {
    registerServiceWorker()
  }, [])

  // An offline boot has no session (the auth fetch failed too), so the socket
  // stays paused. Once the network is back, a reload is the shortest path to
  // a real session; the outbox and the snapshots both survive it.
  useEffect(() => {
    if (!context.bootedOffline) return
    const reload = () => window.location.reload()
    window.addEventListener("online", reload)
    return () => window.removeEventListener("online", reload)
  }, [context.bootedOffline])
```

Imports: `useEffect` from react, `registerServiceWorker` from `@/lib/offline/register-sw`, `readRememberedAuth, writeRememberedAuth` from `@/lib/offline/remembered-auth`.

- [ ] **Step 5: The pending screen**

Create `src/components/shell/offline-pending.tsx`:

```tsx
import { LogSkeleton } from "@/components/entries/day-list"

/**
 * What the authed layout shows while a loader waits.
 *
 * Online, a loader waits for a round trip and the skeleton is the honest
 * picture. Offline, a loader waits for a query that has no snapshot — a page
 * never opened on this device — and it will wait forever, so the sentence
 * has to say so rather than let a skeleton promise something that is not
 * coming. Takes `offline` as a prop: components do not read connection
 * state, routes do.
 */
export function OfflinePending({ offline }: { offline: boolean }) {
  if (!offline) return <LogSkeleton />
  return (
    <div role="status" className="px-4 py-8 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">You're offline.</p>
      <p>This page hasn't been opened on this device yet, so there is nothing to show until you're back online.</p>
    </div>
  )
}
```

In `src/routes/_authed.tsx` add to the route options:

```ts
  pendingComponent: AuthedPending,
```

and the component (a route file may read connection state):

```tsx
function AuthedPending() {
  const online = useOnlineStatus()
  return <OfflinePending offline={!online} />
}
```

`useOnlineStatus` needs the Convex provider, which `__root.tsx` renders above every route — so it is available here.

- [ ] **Step 6: Verify the offline boot, commit**

```bash
pnpm build && pnpm preview
```

Open the preview URL, sign in, open /timer, then DevTools → Application → Service Workers must list `sw.js` activated. Network → Offline → reload: the timer page must render from cache with the status line reading Offline. Navigate to a never-visited route: the pending screen must say the page has not been opened on this device. Back online: the page reloads and syncs.

```bash
pnpm test && pnpm typecheck && pnpm lint
git add src/sw vite.sw.config.ts package.json tsconfig.json src/lib/offline/register-sw.ts src/lib/offline/remembered-auth.ts src/lib/offline/remembered-auth.test.ts src/components/shell/offline-pending.tsx src/routes/__root.tsx src/routes/_authed.tsx
git commit -m "feat(offline): the app boots with no network — a service worker, a remembered session, an honest pending screen"
```

---

### Task 14: Online-only surfaces and sign-out cleanup

**Files:**
- Create: `src/lib/offline/offline-copy.ts`, `src/lib/offline/clear-local-data.ts`
- Modify: `src/lib/auth-client.ts`, `src/components/shell/app-shell.tsx`, `src/components/shell/app-sidebar.tsx`, `src/routes/_authed.tsx`, `src/routes/_authed/invoices_.new.tsx`, `src/routes/_authed/-settings.tsx`, `src/routes/_authed/-music-library.tsx`

- [ ] **Step 1: The sentences and the cleanup**

Create `src/lib/offline/offline-copy.ts`:

```ts
/** What an offline-disabled control says. Sentences, beside the control, never a hidden button. */
export const OFFLINE_INVOICE_REASON =
  "You're offline. Raising an invoice needs a connection, so its number is unique."
export const OFFLINE_UPLOAD_REASON = "You're offline. Uploads need a connection."
export const OFFLINE_GOOGLE_REASON = "You're offline. Google Calendar settings need a connection."
export const OFFLINE_SIGN_OUT_REASON = "You're offline. Sign out once you're back online."
export function pendingSignOutReason(pending: number): string {
  return `${pending} ${pending === 1 ? "change is" : "changes are"} still syncing. Sign out once they have saved.`
}
```

Create `src/lib/offline/clear-local-data.ts`:

```ts
import { clearRememberedAuth } from "./remembered-auth"
import { clearServiceWorkerCaches } from "./register-sw"
import type { SnapshotStore } from "./query-snapshots"

/**
 * Everything offline support keeps on the device, gone at sign-out.
 *
 * The outbox is NOT cleared here: sign-out is refused while it holds
 * anything (see the shell), so by the time this runs it is empty.
 */
export async function clearLocalData(snapshots: SnapshotStore): Promise<void> {
  clearRememberedAuth()
  await Promise.all([snapshots.clear().catch(() => undefined), clearServiceWorkerCaches().catch(() => undefined)])
}
```

In `src/lib/auth-client.ts` change `signOutAndLeave` to accept the cleanup:

```ts
export async function signOutAndLeave(before: () => Promise<void> = async () => undefined, to = "/") {
  await before()
  await authClient.signOut({
    fetchOptions: { onSuccess: () => window.location.assign(to) },
  })
}
```

Update every caller (`grep -rn "signOutAndLeave(" src`): the authed shell passes `() => clearLocalData(snapshots)` where `snapshots` comes from `Route.useRouteContext()` (add it to the destructure beside `sidebarOpen`); other callers keep the default.

- [ ] **Step 2: Sign-out with a reason**

Thread a new prop `signOutDisabledReason: string | null` through `AppShell` → `AppSidebar` → `ProfileMenu`. In `ProfileMenu`'s sign-out `Button` add `disabled={signOutDisabledReason !== null}` and render the reason beneath it when non-null:

```tsx
            {signOutDisabledReason !== null ? (
              <p className="px-2 pb-1 text-xs text-muted-foreground">{signOutDisabledReason}</p>
            ) : null}
```

In `AuthedShell`, compute:

```ts
  const signOutDisabledReason = !online
    ? OFFLINE_SIGN_OUT_REASON
    : pending > 0
      ? pendingSignOutReason(pending)
      : null
```

and pass it to `<AppShell signOutDisabledReason={signOutDisabledReason} …>`, with `onSignOut={() => void signOutAndLeave(() => clearLocalData(snapshots))}`.

- [ ] **Step 3: Invoices, uploads, Google**

`src/routes/_authed/invoices_.new.tsx`: add `const online = useOnlineStatus()` and change the `disabledReason` line to:

```ts
  const disabledReason = online
    ? invoiceDisabledReason(breakdown, isPlaceholderData, lines.length)
    : OFFLINE_INVOICE_REASON
```

`src/routes/_authed/-settings.tsx`: add `const online = useOnlineStatus()`; wrap the two sections' contents:

```tsx
        <Section
          title="Invoice logo"
          hint={online ? "Invoices already raised keep the logo they were made with." : OFFLINE_UPLOAD_REASON}
        >
          <fieldset disabled={!online} className="contents">
            <InvoiceLogoSection … />
          </fieldset>
        </Section>

        <Section
          title="Google Calendar"
          hint={online ? "Chroneli only ever reads. Nothing is written back, and no meeting starts a timer on its own." : OFFLINE_GOOGLE_REASON}
        >
          <fieldset disabled={!online} className="contents">
            <GoogleCalendarSection … />
          </fieldset>
        </Section>
```

A disabled `<fieldset>` disables every native control inside it, which is what the shadcn buttons and inputs are underneath. If Base UI's `Button` renders a non-native element anywhere in these sections, add `aria-disabled` via the section's own props instead.

`src/routes/_authed/-music-library.tsx`: add `const online = useOnlineStatus()`, change `disabled={busy}` on the file input to `disabled={busy || !online}`, the `cn(… busy && "pointer-events-none opacity-50")` to `(busy || !online) && "pointer-events-none opacity-50"`, and render beneath the control when offline:

```tsx
        {!online ? <p className="text-xs text-muted-foreground">{OFFLINE_UPLOAD_REASON}</p> : null}
```

Import `useOnlineStatus` from `@/lib/offline/use-online-status` and the sentences from `@/lib/offline/offline-copy` in each route.

- [ ] **Step 4: Verify, commit**

Run the app; go offline; confirm the Create invoice button is disabled with the offline sentence, both settings sections are inert with their hints changed, the music upload is inert with its sentence, and sign out is disabled with its reason; back online with pending changes, sign out shows the pending reason until they clear.

```bash
pnpm test && pnpm typecheck && pnpm lint
git add src/lib/offline src/lib/auth-client.ts src/components/shell src/routes
git commit -m "feat(offline): online-only controls say why they are waiting, and sign-out clears the device"
```

---

### Task 15: Documentation

**Files:**
- Create: `docs/offline.md`
- Modify: `docs/desktop.md:48-63`

- [ ] **Step 1: Write `docs/offline.md`**

Cover, in this order and in the register of `docs/desktop.md`: what works offline and what does not; the outbox (journal, order, placeholders, coalescing, rejections, stale starts, one sender per origin); one optimistic function two stores; the snapshot layer and why not persistQueryClient; the log's pagination hook and the one-page-on-boot rule; the service worker's routing table and the build step; the auth fallback and the reload-on-reconnect; sign-out cleanup; how to test offline locally (`pnpm build && pnpm preview`, DevTools Offline); the macOS WKWebView risk. Link the spec.

- [ ] **Step 2: Update the desktop doc**

Replace the "Offline, or chroneli.com down" section's body with: the site now registers a service worker, so a window opened offline after at least one online visit gets the cached shell rather than the engine's error page, and writes made there sync when the network returns; the tray's Start still reaches a page that loaded. Add: "Verified on Windows (WebView2). NOT yet verified on macOS: WKWebView's service-worker support for a remote origin is the open question, and until someone checks it on a Mac the desktop app should not be described as offline-capable there."

- [ ] **Step 3: Commit**

```bash
git add docs/offline.md docs/desktop.md
git commit -m "docs(offline): how offline works, and what the desktop app can and cannot promise"
```

---

## Self-review

**Spec coverage.** §1 outbox → Tasks 3, 4, 6, 8, 9. Dependencies/placeholders → 3, 6. Coalescing → 6, 8. Rejections/UNAUTHENTICATED → 6. Stale starts → 6, 8. `stop` carries `endedAt` → 9 (hook) and 2 (server rule). Web Lock → 6. §2 one function two stores → 5, 7, 9. §3 snapshots → 11; the log → 12. §4 service worker, auth fallback, reload, pending screen → 13; macOS risk → 15. §5 online-only surfaces and sign-out → 14. §6 server changes → 1, 2. §8 status line → 10. §9 tests → in every task.

**Type consistency.** `useOutboxMutation` returns `{ result, settled }` (Task 9) and every hook destructures it that way. `OpKind.immediate(args, now)` (Task 3) matches Task 8's registry and Task 6's `def.immediate(args, this.now())`. `coalesceMerge` is added to `OpKind` in Task 8 and consumed in `Outbox.enqueue`. `OutboxEvent.reason` is `"rejected" | "stale" | "orphaned"` in Tasks 6 and 10. `SnapshotStore` is created in Task 11 and consumed by `clearLocalData` in Task 14 through the router context added in Task 11.

**Known judgement calls left to the implementer.** `projects.list`/`tags.list` server sort order (Task 7 Step 4 note); return types of the `null`-returning mutations (Task 8 note); whether Base UI's Button honours a disabled fieldset (Task 14 note).
