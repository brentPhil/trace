# Toggl-Style Entry List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Chroneli's entry log into a Toggl-style day list with clearer day boundaries, larger titles, aligned totals, contextual multi-selection, and atomic batch deletion with Undo.

**Architecture:** `EntryLog` owns one temporary set of selected entry IDs and passes a controlled selection interface through `DayList` to day, sitting, and entry checkboxes. A pure selection module defines checked/indeterminate behavior, while one shared CSS grid aligns every row and day total. New Convex `removeMany`/`restoreMany` mutations reuse the existing soft-delete rules in one transaction, and the existing edit-mutation hook applies one optimistic cache update and one Undo toast for the whole set.

**Tech Stack:** React 19, TypeScript 6, Convex 1.43, TanStack Router, Tailwind CSS 4, Base UI, Vitest 4, Testing Library.

**Spec:** [docs/superpowers/specs/2026-08-14-toggl-style-entry-list-design.md](../specs/2026-08-14-toggl-style-entry-list-design.md)

## Global Constraints

- Read `convex/_generated/ai/guidelines.md` before editing any file under `convex/`.
- Use checkboxes, not radio controls. A sitting or day checkbox represents every underlying entry ID.
- Selection remains local UI state and resets on reload. Do not add schema fields or settings.
- A day select-all action targets only entries currently loaded for that day. Loading another page does not silently select new rows.
- Batch delete and restore must each be one authenticated Convex transaction. Never issue a client loop of single-entry mutations.
- Keep deletion soft, keep the existing running-entry closing rule, and preserve all ownership checks.
- Preserve every existing note, inline edit, classifier, resume, duplicate, single-delete, grouping, pagination, and sticky-header behavior.
- Use Chroneli's existing Darkroom tokens. Cold light remains reserved for a running timer; brass remains reserved for money.
- The title uses the existing `text-base font-medium` scale. Durations stay monospaced/tabular and share one fixed column.
- Do not install a checkbox, state-management, or animation dependency.
- Do not run Convex code generation for this change. `convex/_generated/api.d.ts` imports the whole `entries` module and already exposes new exports by type; that file has a pre-existing unrelated modification which must remain untouched.
- Run the focused test after each red/green cycle. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` before final completion.

---

## File Structure

### New files

- `src/lib/entry-selection.ts` — pure set operations and checked/indeterminate derivation.
- `src/lib/entry-selection.test.ts` — unit contract for selection semantics.
- `src/components/entries/selection-checkbox.tsx` — accessible native checkbox with synchronized indeterminate state and contextual visibility.
- `src/components/entries/selection-checkbox.test.tsx` — DOM contract for checked, mixed, and reveal states.
- `src/components/entries/bulk-entry-actions.tsx` — selected count, Delete, and Clear controls only.
- `src/components/entries/bulk-entry-actions.test.tsx` — action bar labels and events.
- `convex/entries.removeMany.test.ts` — transaction, authorization, idempotency, and running-entry tests.

### Modified files

- `convex/entries.ts` — shared many-ID normalization plus public/internal `removeMany` and `restoreMany` mutations.
- `src/hooks/use-entry-edit-mutations.ts` — optimistic multi-drop and multi-restore.
- `src/hooks/use-entry-edit-mutations.test.ts` — cache behavior for multiple IDs.
- `src/hooks/use-entry-actions.ts` — one batch-delete action, one toast, one Undo.
- `src/components/entries/entry-row.tsx` — controlled checkbox, larger title, shared grid columns.
- `src/components/entries/sitting-row.tsx` — controlled aggregate checkbox and number-only disclosure.
- `src/components/entries/day-list.tsx` — day checkbox, aggregate state derivation, stronger day separation, aligned header total.
- `src/components/entries/day-list.test.tsx` — day/sitting/member selection and disclosure/layout tests.
- `src/components/entries/entry-log.tsx` — selection owner, pruning, Escape behavior, batch orchestration, announcements, focus recovery.
- `src/components/entries/entry-log.test.tsx` — selection lifecycle, exact delete set, failure, and clear behavior.
- `src/styles.css` — one shared entry-log grid and hover-capable contextual reveal rule.

---

### Task 1: Pure selection semantics and the shared checkbox

**Files:**
- Create: `src/lib/entry-selection.ts`
- Create: `src/lib/entry-selection.test.ts`
- Create: `src/components/entries/selection-checkbox.tsx`
- Create: `src/components/entries/selection-checkbox.test.tsx`

**Interfaces:**
- Produces `SelectionState = "unchecked" | "checked" | "indeterminate"`.
- Produces `selectionState(ids, selectedIds): SelectionState`.
- Produces `toggleSelection(selectedIds, ids): Set<Id<"timeEntries">>`.
- Produces `pruneSelection(selectedIds, liveIds): Set<Id<"timeEntries">>`.
- Produces `SelectionCheckbox`, used by Tasks 4 and 5.

- [ ] **Step 1: Write failing pure-function tests**

Create `src/lib/entry-selection.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  pruneSelection,
  selectionState,
  toggleSelection,
} from "./entry-selection"
import type { Id } from "../../convex/_generated/dataModel"

const id = (value: string) => value as Id<"timeEntries">
const A = id("a")
const B = id("b")
const C = id("c")

describe("entry selection", () => {
  it("is unchecked when none of the represented ids are selected", () => {
    expect(selectionState([A, B], new Set([C]))).toBe("unchecked")
  })

  it("is checked when every represented id is selected", () => {
    expect(selectionState([A, B], new Set([A, B, C]))).toBe("checked")
  })

  it("is indeterminate when only some represented ids are selected", () => {
    expect(selectionState([A, B], new Set([A]))).toBe("indeterminate")
  })

  it("selects all ids when the target is unchecked", () => {
    expect([...toggleSelection(new Set([C]), [A, B])]).toEqual([C, A, B])
  })

  it("clears all represented ids when the target is checked or mixed", () => {
    expect([...toggleSelection(new Set([A, B, C]), [A, B])]).toEqual([C])
    expect([...toggleSelection(new Set([A, C]), [A, B])]).toEqual([C])
  })

  it("deduplicates represented ids", () => {
    expect([...toggleSelection(new Set(), [A, A, B])]).toEqual([A, B])
  })

  it("prunes ids that are no longer live", () => {
    expect([...pruneSelection(new Set([A, B, C]), [A, C])]).toEqual([A, C])
  })
})
```

- [ ] **Step 2: Run the unit test and verify red**

Run: `npx vitest run src/lib/entry-selection.test.ts`  
Expected: FAIL because `entry-selection.ts` does not exist.

- [ ] **Step 3: Implement the pure selection module**

Create `src/lib/entry-selection.ts`:

```ts
import type { Id } from "../../convex/_generated/dataModel"

type EntryId = Id<"timeEntries">

export type SelectionState = "unchecked" | "checked" | "indeterminate"

const unique = (ids: Iterable<EntryId>): Array<EntryId> => [...new Set(ids)]

export function selectionState(
  ids: Iterable<EntryId>,
  selectedIds: ReadonlySet<EntryId>
): SelectionState {
  const represented = unique(ids)
  if (represented.length === 0) return "unchecked"
  const selectedCount = represented.filter((entryId) => selectedIds.has(entryId)).length
  if (selectedCount === 0) return "unchecked"
  if (selectedCount === represented.length) return "checked"
  return "indeterminate"
}

export function toggleSelection(
  selectedIds: ReadonlySet<EntryId>,
  ids: Iterable<EntryId>
): Set<EntryId> {
  const represented = unique(ids)
  const next = new Set(selectedIds)
  const selecting = selectionState(represented, selectedIds) === "unchecked"
  for (const entryId of represented) {
    if (selecting) next.add(entryId)
    else next.delete(entryId)
  }
  return next
}

export function pruneSelection(
  selectedIds: ReadonlySet<EntryId>,
  liveIds: Iterable<EntryId>
): Set<EntryId> {
  const live = new Set(liveIds)
  return new Set([...selectedIds].filter((entryId) => live.has(entryId)))
}
```

- [ ] **Step 4: Run the pure test and verify green**

Run: `npx vitest run src/lib/entry-selection.test.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing checkbox DOM tests**

Create `src/components/entries/selection-checkbox.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SelectionCheckbox } from "./selection-checkbox"

afterEach(cleanup)

describe("SelectionCheckbox", () => {
  it("synchronizes native and accessible mixed state", () => {
    render(<SelectionCheckbox label="Select Tuesday" state="indeterminate" onToggle={() => {}} />)
    const checkbox = screen.getByRole("checkbox", { name: "Select Tuesday" }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed")
  })

  it("calls back with the originating input", () => {
    const onToggle = vi.fn()
    render(<SelectionCheckbox label="Select entry" state="unchecked" onToggle={onToggle} />)
    const checkbox = screen.getByRole("checkbox", { name: "Select entry" })
    fireEvent.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith(checkbox)
  })

  it("marks only an unchecked contextual control for hover reveal", () => {
    const { rerender } = render(
      <SelectionCheckbox contextual label="Select entry" state="unchecked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).toContain("entry-selection-contextual")
    rerender(
      <SelectionCheckbox contextual label="Select entry" state="checked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).not.toContain("entry-selection-contextual")
  })
})
```

- [ ] **Step 6: Run the checkbox test and verify red**

Run: `npx vitest run src/components/entries/selection-checkbox.test.tsx`  
Expected: FAIL because `SelectionCheckbox` does not exist.

- [ ] **Step 7: Implement the checkbox**

Create `src/components/entries/selection-checkbox.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { SelectionState } from "@/lib/entry-selection"

export function SelectionCheckbox({
  label,
  state,
  onToggle,
  contextual = false,
  className,
}: {
  label: string
  state: SelectionState
  onToggle: (origin: HTMLInputElement) => void
  contextual?: boolean
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = state === "indeterminate"
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      aria-checked={state === "indeterminate" ? "mixed" : undefined}
      checked={state === "checked"}
      onChange={(event) => onToggle(event.currentTarget)}
      className={cn(
        "size-4 shrink-0 rounded-sm border border-edge-raised bg-ground accent-current",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        "transition-opacity motion-reduce:transition-none",
        contextual && state === "unchecked" && "entry-selection-contextual",
        className
      )}
    />
  )
}
```

- [ ] **Step 8: Run both focused tests**

Run: `npx vitest run src/lib/entry-selection.test.ts src/components/entries/selection-checkbox.test.tsx`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/entry-selection.ts src/lib/entry-selection.test.ts src/components/entries/selection-checkbox.tsx src/components/entries/selection-checkbox.test.tsx
git commit -m "feat(entries): define multi-selection semantics"
```

---

### Task 2: Atomic Convex batch delete and restore

**Files:**
- Modify: `convex/entries.ts` in the existing `remove / restore` section around line 1855.
- Create: `convex/entries.removeMany.test.ts`

**Interfaces:**
- Consumes existing `removeImpl` and `restoreImpl` rules.
- Produces public `api.entries.removeMany({ entryIds })` and `api.entries.restoreMany({ entryIds })`.
- Produces internal `internal.entries.removeManyAs` and `restoreManyAs` for `convex-test`.
- Returns `{ removedEntryIds }` / `{ restoredEntryIds }`, deduplicated and in first-requested order.

- [ ] **Step 1: Write the failing Convex tests**

Create `convex/entries.removeMany.test.ts` using the existing fixture style from `entries.updateMany.test.ts`. Include these cases:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)
const ALICE = "user_alice"
const BOB = "user_bob"

async function insertEntry(t: ReturnType<typeof setup>, userId: string, key: string, running = false) {
  const startedAt = Date.parse("2026-08-14T09:00:00Z")
  return await t.run(async (ctx) =>
    await ctx.db.insert("timeEntries", {
      userId,
      clientKey: key,
      title: key,
      startedAt,
      endedAt: running ? null : startedAt + 3_600_000,
      durationMs: running ? null : 3_600_000,
      tagIds: [],
      billable: false,
      source: "web",
      updatedAt: startedAt,
      deletedAt: null,
    })
  )
}

async function expectCode(promise: Promise<unknown>, code: string) {
  try { await promise } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe("entries.removeMany / restoreMany", () => {
  it("soft-deletes and restores the complete owned set", async () => {
    const t = setup()
    const ids = [await insertEntry(t, ALICE, "a"), await insertEntry(t, ALICE, "b")]
    const removed = await t.mutation(internal.entries.removeManyAs, { userId: ALICE, entryIds: ids })
    expect(removed.removedEntryIds).toEqual(ids)
    for (const entryId of ids) {
      expect((await t.run((ctx) => ctx.db.get(entryId)))?.deletedAt).not.toBeNull()
    }

    const restored = await t.mutation(internal.entries.restoreManyAs, { userId: ALICE, entryIds: ids })
    expect(restored.restoredEntryIds).toEqual(ids)
    for (const entryId of ids) {
      expect((await t.run((ctx) => ctx.db.get(entryId)))?.deletedAt).toBeNull()
    }
  })

  it("deduplicates ids and remains idempotent", async () => {
    const t = setup()
    const entryId = await insertEntry(t, ALICE, "a")
    expect(
      await t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [entryId, entryId],
      })
    ).toEqual({ removedEntryIds: [entryId] })
    expect(
      await t.mutation(internal.entries.removeManyAs, { userId: ALICE, entryIds: [entryId] })
    ).toEqual({ removedEntryIds: [] })
  })

  it("rolls the whole delete back when one id is foreign", async () => {
    const t = setup()
    const mine = await insertEntry(t, ALICE, "mine")
    const theirs = await insertEntry(t, BOB, "theirs")
    await expectCode(
      t.mutation(internal.entries.removeManyAs, {
        userId: ALICE,
        entryIds: [mine, theirs],
      }),
      "NOT_FOUND"
    )
    expect((await t.run((ctx) => ctx.db.get(mine)))?.deletedAt).toBeNull()
  })

  it("rolls the whole restore back when one id is foreign", async () => {
    const t = setup()
    const mine = await insertEntry(t, ALICE, "mine")
    const theirs = await insertEntry(t, BOB, "theirs")
    await t.mutation(internal.entries.removeManyAs, {
      userId: ALICE,
      entryIds: [mine],
    })
    await t.mutation(internal.entries.removeManyAs, {
      userId: BOB,
      entryIds: [theirs],
    })

    await expectCode(
      t.mutation(internal.entries.restoreManyAs, {
        userId: ALICE,
        entryIds: [mine, theirs],
      }),
      "NOT_FOUND"
    )
    expect((await t.run((ctx) => ctx.db.get(mine)))?.deletedAt).not.toBeNull()
  })

  it("closes a running entry before deleting it", async () => {
    const t = setup()
    const entryId = await insertEntry(t, ALICE, "running", true)
    await t.mutation(internal.entries.removeManyAs, { userId: ALICE, entryIds: [entryId] })
    const row = await t.run((ctx) => ctx.db.get(entryId))
    expect(row?.endedAt).not.toBeNull()
    expect(row?.durationMs).not.toBeNull()
    expect(row?.deletedAt).not.toBeNull()
  })

  it("rejects empty and unauthenticated selections", async () => {
    const t = setup()
    await expectCode(
      t.mutation(internal.entries.removeManyAs, { userId: ALICE, entryIds: [] }),
      "EMPTY_SELECTION"
    )
    await expectCode(
      t.mutation(internal.entries.restoreManyAs, { userId: ALICE, entryIds: [] }),
      "EMPTY_SELECTION"
    )
    await expectCode(t.mutation(api.entries.removeMany, { entryIds: [] }), "UNAUTHENTICATED")
    await expectCode(t.mutation(api.entries.restoreMany, { entryIds: [] }), "UNAUTHENTICATED")
  })
})
```

- [ ] **Step 2: Run the Convex test and verify red**

Run: `npx vitest run convex/entries.removeMany.test.ts`  
Expected: FAIL because the four mutations do not exist.

- [ ] **Step 3: Add a shared ID normalizer and batch implementations**

In `convex/entries.ts`, keep `removeImpl` and `restoreImpl` as the single-entry rule. Add after `restoreImpl`:

```ts
function uniqueEntryIds(entryIds: Array<Id<"timeEntries">>): Array<Id<"timeEntries">> {
  return [...new Set(entryIds)]
}

async function removeManyImpl(
  ctx: MutationCtx,
  userId: string,
  entryIds: Array<Id<"timeEntries">>
) {
  if (entryIds.length === 0) {
    traceError("EMPTY_SELECTION", "removeMany needs at least one entry.")
  }
  const removedEntryIds: Array<Id<"timeEntries">> = []
  for (const entryId of uniqueEntryIds(entryIds)) {
    const result = await removeImpl(ctx, userId, entryId)
    removedEntryIds.push(...result.removedEntryIds)
  }
  return { removedEntryIds }
}

async function restoreManyImpl(
  ctx: MutationCtx,
  userId: string,
  entryIds: Array<Id<"timeEntries">>
) {
  if (entryIds.length === 0) {
    traceError("EMPTY_SELECTION", "restoreMany needs at least one entry.")
  }
  const restoredEntryIds: Array<Id<"timeEntries">> = []
  for (const entryId of uniqueEntryIds(entryIds)) {
    const result = await restoreImpl(ctx, userId, entryId)
    restoredEntryIds.push(...result.restoredEntryIds)
  }
  return { restoredEntryIds }
}
```

Convex rolls the whole mutation back if a later `removeImpl`/`restoreImpl` throws, so serial reuse of the existing ownership rule remains atomic.

- [ ] **Step 4: Export public and internal mutations**

Use one validator object for both operations:

```ts
const entryIdsArgs = { entryIds: v.array(v.id("timeEntries")) }

export const removeMany = mutation({
  args: entryIdsArgs,
  returns: removeReturns,
  handler: async (ctx, args) =>
    await removeManyImpl(ctx, await requireUserId(ctx), args.entryIds),
})

export const removeManyAs = internalMutation({
  args: { ...entryIdsArgs, userId: v.string() },
  returns: removeReturns,
  handler: async (ctx, args) => await removeManyImpl(ctx, args.userId, args.entryIds),
})

export const restoreMany = mutation({
  args: entryIdsArgs,
  returns: restoreReturns,
  handler: async (ctx, args) =>
    await restoreManyImpl(ctx, await requireUserId(ctx), args.entryIds),
})

export const restoreManyAs = internalMutation({
  args: { ...entryIdsArgs, userId: v.string() },
  returns: restoreReturns,
  handler: async (ctx, args) => await restoreManyImpl(ctx, args.userId, args.entryIds),
})
```

- [ ] **Step 5: Run focused Convex tests and typecheck**

Run: `npx vitest run convex/entries.removeMany.test.ts convex/entries.test.ts`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit 0. Confirm `git status --short convex/_generated/api.d.ts` still shows only the pre-existing modification and no generated command was run.

- [ ] **Step 6: Commit without the generated file**

```bash
git add convex/entries.ts convex/entries.removeMany.test.ts
git commit -m "feat(entries): delete and restore selections atomically"
```

---

### Task 3: Optimistic batch actions and one Undo

**Files:**
- Modify: `src/hooks/use-entry-edit-mutations.ts`
- Modify: `src/hooks/use-entry-edit-mutations.test.ts`
- Modify: `src/hooks/use-entry-actions.ts`

**Interfaces:**
- Produces `removeMany(entryIds)` and `restoreMany(entries)` from `useEntryEditMutations`.
- Produces `onRemoveMany(entries): Promise<boolean>` on `EntryActions`.
- `true` means deletion succeeded and the caller may clear selection; `false` means the action already reported failure and selection should remain usable.

- [ ] **Step 1: Extend the hook test fake and write failing multi-ID tests**

In `src/hooks/use-entry-edit-mutations.test.ts`, add a `listRange` record to the fake store and tests that drive the registered optimistic callbacks through the real hook:

```ts
it("drops every selected entry from loaded paginated pages", async () => {
  const fromMs = 1_699_999_000_000
  const toMs = 1_700_100_000_000
  const first = makeEntry({ _id: "first" as Id<"timeEntries"> })
  const second = makeEntry({ _id: "second" as Id<"timeEntries"> })
  const pages = makeTwoPageSubscription(fromMs, toMs)
  pages[0].value?.page.push(first, second)
  setActiveStore(makeFakeLocalStore(pages))

  const { removeMany } = renderMutationsHook()
  await removeMany([first._id, second._id])

  expect(countCopies(pages, first._id)).toBe(0)
  expect(countCopies(pages, second._id)).toBe(0)
})

it("restores every snapshot once across paginated pages", async () => {
  const fromMs = 1_699_999_000_000
  const toMs = 1_700_100_000_000
  const first = makeEntry({ _id: "first" as Id<"timeEntries">, startedAt: fromMs + 2_000 })
  const second = makeEntry({ _id: "second" as Id<"timeEntries">, startedAt: fromMs + 3_000 })
  const pages = makeTwoPageSubscription(fromMs, toMs)
  setActiveStore(makeFakeLocalStore(pages))

  const { restoreMany } = renderMutationsHook()
  await restoreMany([first, second])

  expect(countCopies(pages, first._id)).toBe(1)
  expect(countCopies(pages, second._id)).toBe(1)
})
```

- [ ] **Step 2: Run the hook test and verify red**

Run: `npx vitest run src/hooks/use-entry-edit-mutations.test.ts`  
Expected: FAIL because `removeMany` and `restoreMany` are absent.

- [ ] **Step 3: Register optimistic mutations**

In `use-entry-edit-mutations.ts`, beside `removeMutation` and `restoreMutation`:

```ts
const removeManyMutation = useLatest(
  useConvexMutation(api.entries.removeMany).withOptimisticUpdate((localStore, args) => {
    for (const entryId of new Set(args.entryIds)) dropEverywhere(localStore, entryId)
  })
)

const restoreManyMutation = useLatest(
  useConvexMutation(api.entries.restoreMany).withOptimisticUpdate((localStore, args) => {
    for (const entryId of new Set(args.entryIds)) {
      const entry = pendingRestore.current.get(entryId)
      if (entry !== undefined) insertEverywhere(localStore, entry)
    }
  })
)
```

Reuse the existing `pendingRestore` map for single and batch Undo. Define callbacks:

```ts
const removeMany = useCallback(
  async (entryIds: Array<Id<"timeEntries">>) =>
    await removeManyMutation({ entryIds: [...new Set(entryIds)] }),
  [removeManyMutation]
)

const restoreMany = useCallback(
  async (entries: Array<Entry>) => {
    const uniqueEntries = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
    for (const entry of uniqueEntries) pendingRestore.current.set(entry._id, entry)
    try {
      return await restoreManyMutation({ entryIds: uniqueEntries.map((entry) => entry._id) })
    } finally {
      for (const entry of uniqueEntries) pendingRestore.current.delete(entry._id)
    }
  },
  [restoreManyMutation]
)
```

Return both functions from the hook.

- [ ] **Step 4: Add one batch action and Undo toast**

Extend `EntryActions` in `use-entry-actions.ts`:

```ts
onRemoveMany: (entries: Array<Entry>) => Promise<boolean>
```

Destructure `removeMany` and `restoreMany` from `useEntryEditMutations`, then add:

```ts
const onRemoveMany = useCallback(
  async (entries: Array<Entry>): Promise<boolean> => {
    const uniqueEntries = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
    if (uniqueEntries.length === 0) return false
    try {
      await removeMany(uniqueEntries.map((entry) => entry._id))
    } catch (thrown) {
      toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
      return false
    }

    toastWithUndo(toasts, {
      title: `Deleted ${uniqueEntries.length} ${uniqueEntries.length === 1 ? "record" : "records"}`,
      undo: () => restoreMany(uniqueEntries),
    })
    return true
  },
  [removeMany, restoreMany, toasts]
)
```

Add `onRemoveMany` to the memoized returned object and dependency list.

- [ ] **Step 5: Keep action behavior at the existing integration boundary**

There is no direct `use-entry-actions.test.ts`. Do not build a second
toast-manager harness solely for this callback. Task 6 covers success, failure,
and retained selection through `EntryLog` by mocking `actions.onRemoveMany`;
this task's focused test covers the real optimistic mutation callbacks.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run src/hooks/use-entry-edit-mutations.test.ts`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-entry-edit-mutations.ts src/hooks/use-entry-edit-mutations.test.ts src/hooks/use-entry-actions.ts
git commit -m "feat(entries): add optimistic batch delete with undo"
```

---

### Task 4: Shared row geometry and Toggl-style visual hierarchy

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/entries/entry-row.tsx`
- Modify: `src/components/entries/sitting-row.tsx`
- Modify: `src/components/entries/day-list.tsx`
- Modify: `src/components/entries/day-list.test.tsx`

**Interfaces:**
- Produces the shared classes `entry-log-grid`, `entry-log-content`, `entry-log-time`, `entry-log-duration`, and `entry-log-actions`.
- Produces number-only `SittingRow` disclosure with unchanged accessible labels.
- Does not add selection state yet; Task 5 places controls into the reserved leading column.

- [ ] **Step 1: Write failing visual-contract tests**

Extend `day-list.test.tsx`:

```tsx
it("renders a number-only sitting disclosure", () => {
  renderLog(true)
  const disclosure = screen.getByRole("button", { name: "Show grouped entries" })
  expect(disclosure.textContent).toBe("2")
  expect(disclosure.querySelector("svg")).toBeNull()
})

it("uses one duration column for the day, sitting, and entry", () => {
  const { container } = renderLog(true)
  const durations = container.querySelectorAll(".entry-log-duration")
  expect(durations.length).toBeGreaterThanOrEqual(3)
  for (const duration of durations) {
    expect(duration.parentElement?.className).toContain("entry-log-grid")
  }
})

it("renders entry titles at the title scale", () => {
  renderLog(false)
  const title = screen.getByRole("button", { name: /Description:/ })
  expect(title.className).toContain("text-base")
})

it("draws a stronger full-width boundary before later days", () => {
  const yesterdayEntry = makeEntry({
    _id: "yesterday" as unknown as Doc<"timeEntries">["_id"],
    title: "Yesterday's work",
    startedAt: -86_400_000,
    endedAt: -82_800_000,
    durationMs: 3_600_000,
  })
  const { container } = render(
    <DayList
      groups={[
        groups[0],
        {
          day: "2026-08-08",
          label: "Yesterday",
          entries: [yesterdayEntry],
          notedCount: 0,
          totalMs: 3_600_000,
          billableMs: 0,
          runningCount: 0,
        },
      ]}
      timeZone="UTC"
      use12Hour={false}
      weekStartDay={0}
      projects={[]}
      tags={[]}
      actions={noActions}
    />
  )
  const sections = container.querySelectorAll("section[data-day-group]")
  expect(sections[1].className).toContain("border-t")
  expect(sections[1].className).toContain("border-edge")
})
```

Adjust `renderLog` to return Testing Library's render result if it currently discards it.

- [ ] **Step 2: Run the test and verify red**

Run: `npx vitest run src/components/entries/day-list.test.tsx`  
Expected: FAIL on the chevron, grid classes, title size, and separator.

- [ ] **Step 3: Define one responsive grid in `styles.css`**

Add after the base layer:

```css
/* One geometry for day headers, sitting rows and entry rows. The day total and
 * every row duration occupy the same named column, so alignment is structural
 * rather than three matching width guesses. */
.entry-log-grid {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) 8.5rem 4.5rem 4rem;
  grid-template-areas: "select content time duration actions";
  column-gap: 0.5rem;
  align-items: start;
}
.entry-log-select { grid-area: select; align-self: center; }
.entry-log-content { grid-area: content; min-width: 0; }
.entry-log-time { grid-area: time; align-self: center; text-align: right; }
.entry-log-duration { grid-area: duration; align-self: center; width: 4.5rem; text-align: right; }
.entry-log-actions { grid-area: actions; align-self: center; width: 4rem; }

@media (max-width: 639px) {
  .entry-log-grid {
    grid-template-columns: 1rem minmax(0, 1fr) 4.5rem 4rem;
    grid-template-areas: "select content duration actions";
  }
  .entry-log-time { display: none; }
}

/* Defaults visible for touch/non-hover devices. Only a precise hover-capable
 * pointer gets the quieter contextual state. Keyboard focus always reveals. */
@media (hover: hover) and (pointer: fine) {
  .entry-selection-contextual { opacity: 0; }
  .group:hover .entry-selection-contextual,
  .group:focus-within .entry-selection-contextual,
  .entry-selection-contextual:focus-visible { opacity: 1; }
}
```

- [ ] **Step 4: Convert `EntryRow` to the grid**

Change the inner wrapper class from its current flex classes to:

```tsx
className="entry-log-grid min-h-(--entry-row-height) w-full px-4"
```

Insert this as its first child:

```tsx
<span aria-hidden="true" className="entry-log-select" />
```

Add `entry-log-content` to the current title/note column and pass
`textClassName="text-base"` to `EditableTitle`. Cut the complete classifier
`<div className="flex shrink-0 items-center gap-0.5">` (all three pickers) from
the trailing cluster and paste it after the billable mark in the title line.
Preserve every picker prop and reveal class byte-for-byte.

Wrap the unchanged `EntryTimePopover` in `<div className="entry-log-time">`.
Wrap the unchanged `EditableDuration` in
`<div className="entry-log-duration">`. Change the current row-action wrapper
class to:

```tsx
className="entry-log-actions flex items-center justify-end gap-0.5"
```

The two `RowButton` children remain unchanged.

- [ ] **Step 5: Convert `SittingRow` and remove the chevron**

Remove `ChevronDown` and `ChevronRight` imports. The disclosure remains a real button with the existing `aria-expanded`, `aria-controls`, and label, but its only visible child is:

```tsx
<span className="tabular">{sitting.entries.length}</span>
```

Use the shared grid. Reserve the leading selection span, put the number button at the start of `entry-log-content`, keep title/note/classifiers in the remaining content, then place range, total, and Play in their named columns. The sitting total wrapper must carry `entry-log-duration`; the Play wrapper must carry `entry-log-actions` even though it contains one action.

- [ ] **Step 6: Convert the day header and strengthen day separation**

Add `data-day-group={group.day}` to each section. Apply `border-t-2 border-edge` to every section after the first, while keeping passive row dividers at `border-edge-soft`. Keep `--day-group-gap` and sticky positioning.

The header inner wrapper becomes the same grid:

```tsx
<div className="entry-log-grid w-full items-baseline px-4">
  <span aria-hidden="true" className="entry-log-select" />
  <div className="entry-log-content flex min-w-0 items-baseline gap-2">
    <h2 className="text-sm font-medium">{group.label}</h2>
    {group.entries.length === 0 ? null : (
      <span className="text-xs text-muted-foreground">
        {group.notedCount} of {group.entries.length} noted
      </span>
    )}
  </div>
  <span aria-hidden="true" className="entry-log-time" />
  <span suppressHydrationWarning className="entry-log-duration text-base font-semibold tabular text-muted-foreground">
    {formatTotal(group.totalMs, display)}
  </span>
  <span aria-hidden="true" className="entry-log-actions" />
</div>
```

Update `LogSkeleton` to use the same grid with empty leading/action cells and a duration skeleton in `entry-log-duration`, preventing a layout shift when content arrives.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npx vitest run src/components/entries/day-list.test.tsx`  
Expected: PASS, including existing grouped-sitting tests.  
Run: `npm run typecheck`  
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/styles.css src/components/entries/entry-row.tsx src/components/entries/sitting-row.tsx src/components/entries/day-list.tsx src/components/entries/day-list.test.tsx
git commit -m "feat(entries): align the Toggl-style day list"
```

---

### Task 5: Controlled entry, sitting, and day selection

**Files:**
- Modify: `src/components/entries/entry-row.tsx`
- Modify: `src/components/entries/sitting-row.tsx`
- Modify: `src/components/entries/day-list.tsx`
- Modify: `src/components/entries/day-list.test.tsx`

**Interfaces:**
- Produces `EntrySelectionController`:

```ts
export type EntrySelectionController = {
  selectedIds: ReadonlySet<Id<"timeEntries">>
  onToggle: (entryIds: Array<Id<"timeEntries">>, origin: HTMLInputElement) => void
}
```

- `DayList` gains optional `selection?: EntrySelectionController`; existing direct fixtures may omit it, while both product callers receive it through `EntryLog` in Task 6.
- `EntryRow` and `SittingRow` gain optional controlled `selection` targets rather than owning local state.

- [ ] **Step 1: Write failing controlled-selection tests**

Add a helper in `day-list.test.tsx` that owns selection in a test harness:

```tsx
function SelectableDayList({ shownGroups = groups }: { shownGroups?: Array<DayGroup> }) {
  const [selectedIds, setSelectedIds] = useState<Set<Id<"timeEntries">>>(new Set())
  return (
    <DayList
      groups={shownGroups}
      timeZone="UTC"
      use12Hour={false}
      weekStartDay={0}
      projects={[]}
      tags={[]}
      actions={noActions}
      grouped
      selection={{
        selectedIds,
        onToggle: (entryIds) => setSelectedIds((current) => toggleSelection(current, entryIds)),
      }}
    />
  )
}
```

Tests:

```tsx
it("selects and clears every entry in a day", () => {
  render(<SelectableDayList />)
  const day = screen.getByRole("checkbox", { name: /Select all records for Today/ }) as HTMLInputElement
  fireEvent.click(day)
  expect(day.checked).toBe(true)
  expect((screen.getByRole("checkbox", { name: /Select all 2 records for Crew dropdowns/ }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(day)
  expect(day.checked).toBe(false)
})

it("shows a mixed day and sitting after one member is selected", () => {
  render(<SelectableDayList />)
  fireEvent.click(screen.getByRole("button", { name: "Show grouped entries" }))
  fireEvent.click(screen.getAllByRole("checkbox", { name: /Select Crew dropdowns/ })[0])
  expect((screen.getByRole("checkbox", { name: /Select all records for Today/ }) as HTMLInputElement).indeterminate).toBe(true)
  expect((screen.getByRole("checkbox", { name: /Select all 2 records for Crew dropdowns/ }) as HTMLInputElement).indeterminate).toBe(true)
})

it("selects hidden sitting members while collapsed", () => {
  render(<SelectableDayList />)
  fireEvent.click(screen.getByRole("checkbox", { name: /Select all 2 records for Crew dropdowns/ }))
  fireEvent.click(screen.getByRole("button", { name: "Show grouped entries" }))
  for (const member of screen.getAllByRole("checkbox", { name: /Select Crew dropdowns/ })) {
    expect((member as HTMLInputElement).checked).toBe(true)
  }
})
```

- [ ] **Step 2: Run the test and verify red**

Run: `npx vitest run src/components/entries/day-list.test.tsx`  
Expected: FAIL because no selection props or checkboxes exist.

- [ ] **Step 3: Add controlled selection types and props**

Export `EntrySelectionController` from `day-list.tsx`. Define a small row target type locally in `selection-checkbox.tsx` or `entry-selection.ts`:

```ts
export type SelectionTarget = {
  label: string
  state: SelectionState
  onToggle: (origin: HTMLInputElement) => void
}
```

Add optional `selection?: SelectionTarget` props to `EntryRow` and `SittingRow`. In their reserved `entry-log-select` cell render:

```tsx
{selection === undefined ? null : (
  <SelectionCheckbox
    contextual
    label={selection.label}
    state={selection.state}
    onToggle={selection.onToggle}
  />
)}
```

The sitting checkbox is contextual like a record checkbox. Once selected or mixed, `SelectionCheckbox` keeps it visible.

- [ ] **Step 4: Derive all three levels in `DayList`**

Add optional `selection` to `DayList`. For a lone row:

```tsx
const targetFor = (entries: Array<Entry>, label: string): SelectionTarget | undefined => {
  if (selection === undefined) return undefined
  const entryIds = entries.map((entry) => entry._id)
  return {
    label,
    state: selectionState(entryIds, selection.selectedIds),
    onToggle: (origin) => selection.onToggle(entryIds, origin),
  }
}
```

Pass targets as follows:

```tsx
selection={targetFor(
  [entry],
  `Select ${entry.title.trim() === "" ? "untitled entry" : entry.title.trim()}`
)}
```

```tsx
selection={targetFor(
  item.entries,
  `Select all ${item.entries.length} records for ${item.entries[0].title.trim() || "untitled work"}`
)}
```

In the day header's leading cell, render an always-visible checkbox:

```tsx
{selection === undefined ? null : (
  <SelectionCheckbox
    label={`Select all records for ${group.label}`}
    state={selectionState(group.entries.map((entry) => entry._id), selection.selectedIds)}
    onToggle={(origin) =>
      selection.onToggle(group.entries.map((entry) => entry._id), origin)
    }
  />
)}
```

Pass the same row target to member rows when a sitting expands. Never create separate member selection state.

- [ ] **Step 5: Verify click isolation**

Add a test which clicks the sitting checkbox and asserts `aria-expanded` remains `false`, then clicks the number and asserts selection remains checked. Native controls are siblings, not nested, so no manual event propagation should be needed.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run src/components/entries/day-list.test.tsx src/components/entries/selection-checkbox.test.tsx`  
Expected: PASS.  
Run: `npm run typecheck`  
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/entries/entry-row.tsx src/components/entries/sitting-row.tsx src/components/entries/day-list.tsx src/components/entries/day-list.test.tsx
git commit -m "feat(entries): select rows, sittings, and days"
```

---

### Task 6: Log-owned selection, bulk action bar, focus, and announcements

**Files:**
- Create: `src/components/entries/bulk-entry-actions.tsx`
- Create: `src/components/entries/bulk-entry-actions.test.tsx`
- Modify: `src/components/entries/entry-log.tsx`
- Modify: `src/components/entries/entry-log.test.tsx`

**Interfaces:**
- Consumes `toggleSelection`, `pruneSelection`, `EntrySelectionController`, and `actions.onRemoveMany`.
- Produces the complete product behavior on both `/timer` and `/reports`; neither route needs its own selection state.

- [ ] **Step 1: Write and implement the small presentational action bar**

First write `bulk-entry-actions.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { BulkEntryActions } from "./bulk-entry-actions"

afterEach(cleanup)

it("reports underlying records and exposes delete and clear", () => {
  const onDelete = vi.fn()
  const onClear = vi.fn()
  render(<BulkEntryActions count={3} deleting={false} onDelete={onDelete} onClear={onClear} />)
  expect(screen.getByText("3 records selected")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Delete selected records" }))
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
  expect(onDelete).toHaveBeenCalledTimes(1)
  expect(onClear).toHaveBeenCalledTimes(1)
})
```

Then create `bulk-entry-actions.tsx`:

```tsx
import { Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function BulkEntryActions({
  count,
  deleting,
  onDelete,
  onClear,
}: {
  count: number
  deleting: boolean
  onDelete: () => void
  onClear: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="Selected entry actions"
      className="flex items-center gap-3 rounded-lg border border-edge-raised bg-surface-raised px-3 py-2"
    >
      <span className="text-sm font-medium">
        {count} {count === 1 ? "record" : "records"} selected
      </span>
      <Button
        variant="destructive"
        size="sm"
        disabled={deleting}
        aria-label="Delete selected records"
        onClick={onDelete}
      >
        <Trash2 /> Delete
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClear}>
        <X />
      </Button>
    </div>
  )
}
```

Run: `npx vitest run src/components/entries/bulk-entry-actions.test.tsx`  
Expected: PASS after implementation.

- [ ] **Step 2: Write failing `EntryLog` selection lifecycle tests**

Extend `entry-log.test.tsx`. Add this render helper beside the existing `groups`
fixture, reusing the file's real `groups`, `timeZone`, and display values:

```tsx
const renderEntryLog = ({
  shownGroups = groups,
  actions = { ...noEntryActions, onRemoveMany: vi.fn().mockResolvedValue(true) },
}: {
  shownGroups?: Array<DayGroup>
  actions?: EntryActions
} = {}) =>
  render(
    <Toast.Provider>
      <EntryLog
        groups={shownGroups}
        timeZone="UTC"
        use12Hour={false}
        weekStartDay={0}
        actions={actions}
        grouped
      />
      <ToastViewport />
    </Toast.Provider>
  )
```

Import `EntryActions` and `DayGroup` as types. Then add:

```tsx
it("deletes the exact live selected entries and clears selection on success", async () => {
  const onRemoveMany = vi.fn().mockResolvedValue(true)
  const actions = { ...noEntryActions, onRemoveMany } as EntryActions
  renderEntryLog({ actions })
  fireEvent.click(screen.getByRole("checkbox", { name: /Select all records for Today/ }))
  const expectedIds = groups[0].entries.map((entry) => entry._id)
  expect(screen.getByText(`${expectedIds.length} records selected`)).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Delete selected records" }))
  await waitFor(() => expect(onRemoveMany).toHaveBeenCalledTimes(1))
  expect(onRemoveMany.mock.calls[0][0].map((entry: Entry) => entry._id)).toEqual(expectedIds)
  await waitFor(() => expect(screen.queryByRole("toolbar", { name: "Selected entry actions" })).toBeNull())
})

it("keeps a failed selection available for retry", async () => {
  const onRemoveMany = vi.fn().mockResolvedValue(false)
  renderEntryLog({ actions: { ...noEntryActions, onRemoveMany } })
  fireEvent.click(screen.getByRole("checkbox", { name: /Select all records for Today/ }))
  fireEvent.click(screen.getByRole("button", { name: "Delete selected records" }))
  await waitFor(() => expect(onRemoveMany).toHaveBeenCalled())
  expect(screen.getByRole("toolbar", { name: "Selected entry actions" })).toBeTruthy()
  expect((screen.getByRole("checkbox", { name: /Select all records for Today/ }) as HTMLInputElement).checked).toBe(true)
})

it("clears selection with the toolbar and Escape", () => {
  renderEntryLog()
  const day = screen.getByRole("checkbox", { name: /Select all records for Today/ })
  fireEvent.click(day)
  fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
  expect((day as HTMLInputElement).checked).toBe(false)
  fireEvent.click(day)
  fireEvent.keyDown(screen.getByRole("region", { name: "Time entries" }), { key: "Escape" })
  expect((day as HTMLInputElement).checked).toBe(false)
})
```

- [ ] **Step 3: Run `EntryLog` tests and verify red**

Run: `npx vitest run src/components/entries/entry-log.test.tsx`  
Expected: FAIL because `EntryLog` does not own selection or render the toolbar.

- [ ] **Step 4: Add the selection owner and stale-ID pruning**

Add imports for `useEffect`, `useMemo`, `useRef`, `useState`, `useAnnounce`,
`toggleSelection`, `pruneSelection`, `cn`, `BulkEntryActions`,
`EntrySelectionController`, and `Id<"timeEntries">`. At the top of `EntryLog`:

```tsx
const [selectedIds, setSelectedIds] = useState<Set<Id<"timeEntries">>>(new Set())
const [deleting, setDeleting] = useState(false)
const lastSelectionControl = useRef<HTMLInputElement | null>(null)
const logRef = useRef<HTMLDivElement>(null)
const announce = useAnnounce()

const liveEntries = useMemo(() => groups.flatMap((group) => group.entries), [groups])
const liveIds = useMemo(() => liveEntries.map((entry) => entry._id), [liveEntries])
const liveById = useMemo(
  () => new Map(liveEntries.map((entry) => [entry._id, entry])),
  [liveEntries]
)
const selectedLiveIds = pruneSelection(selectedIds, liveIds)
```

Synchronize stale pruning against the memoized live-ID array:

```tsx
useEffect(() => {
  setSelectedIds((current) => pruneSelection(current, liveIds))
}, [liveIds])
```

Build the controller:

```tsx
const selection: EntrySelectionController = {
  selectedIds: selectedLiveIds,
  onToggle: (entryIds, origin) => {
    lastSelectionControl.current = origin
    setSelectedIds((current) => {
      const next = toggleSelection(pruneSelection(current, liveIds), entryIds)
      announce(`${next.size} ${next.size === 1 ? "record" : "records"} selected`)
      return next
    })
  },
}
```

Pass `selection={selection}` to `DayList`.

- [ ] **Step 5: Add clear, delete, focus recovery, and Escape**

Wrap `DayList` and the toolbar in:

```tsx
<div
  ref={logRef}
  role="region"
  aria-label="Time entries"
  tabIndex={-1}
  onKeyDown={(event) => {
    if (event.key !== "Escape" || selectedLiveIds.size === 0) return
    event.preventDefault()
    setSelectedIds(new Set())
    announce("Selection cleared")
  }}
  className={cn("relative", selectedLiveIds.size > 0 && "pb-20")}
>
```

Clear action:

```ts
const clearSelection = () => {
  setSelectedIds(new Set())
  announce("Selection cleared")
  requestAnimationFrame(() => lastSelectionControl.current?.focus())
}
```

Delete action:

```ts
const deleteSelection = async () => {
  const entries = [...selectedLiveIds]
    .map((entryId) => liveById.get(entryId))
    .filter((entry): entry is Entry => entry !== undefined)
  if (entries.length === 0 || deleting) return
  setDeleting(true)
  const deleted = await entryActions.onRemoveMany(entries)
  setDeleting(false)
  if (!deleted) return
  setSelectedIds(new Set())
  announce(`Deleted ${entries.length} ${entries.length === 1 ? "record" : "records"}`)
  requestAnimationFrame(() => logRef.current?.focus())
}
```

Render the persistent bar only for non-empty selection. Use a viewport-fixed wrapper because both Timer and Reports use document scrolling and do not share an inner scroll container; this is the concrete implementation of the approved sticky/persistent behavior:

```tsx
{selectedLiveIds.size === 0 ? null : (
  <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
    <div className="pointer-events-auto">
      <BulkEntryActions
        count={selectedLiveIds.size}
        deleting={deleting}
        onDelete={() => void deleteSelection()}
        onClear={clearSelection}
      />
    </div>
  </div>
)}
```

The conditional `pb-20` prevents the bar from covering the last row. The toast viewport is `z-50`, so a post-delete Undo always layers above this `z-40` bar.

- [ ] **Step 6: Cover stale pruning and underlying sitting counts**

Add tests which rerender `EntryLog` after removing one selected fixture from `groups`, then assert the count falls and `onRemoveMany` never receives the stale ID. Also select a collapsed two-entry sitting and assert the bar says `2 records selected`, not `1`.

- [ ] **Step 7: Run all entry-focused tests**

Run:

```bash
npx vitest run src/lib/entry-selection.test.ts src/components/entries/selection-checkbox.test.tsx src/components/entries/bulk-entry-actions.test.tsx src/components/entries/day-list.test.tsx src/components/entries/entry-log.test.tsx src/hooks/use-entry-edit-mutations.test.ts convex/entries.removeMany.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run complete automated verification**

Run: `npm test` — Expected: PASS.  
Run: `npm run typecheck` — Expected: exit 0.  
Run: `npm run lint` — Expected: exit 0.  
Run: `npm run build` — Expected: exit 0.  
Run: `git diff --check` — Expected: no whitespace errors.

- [ ] **Step 9: Visual and keyboard QA in the running app**

Start the app with `npm run dev` and inspect `/timer` and `/reports` at approximately 1440px, 768px, and 375px widths.

Verify:

1. Day separators read before their labels; sticky headers still work.
2. Day totals, sitting totals, and record durations share the same right edge.
3. Titles are visibly larger without truncating the duration/action columns.
4. A sitting disclosure shows only its number and still toggles from keyboard.
5. Fine-pointer row checkboxes appear on hover/focus and stay visible when selected.
6. At 375px, row checkboxes are visible without hover; time ranges hide before title or duration.
7. Day, sitting, and member selection produce checked and mixed states correctly.
8. Selecting a collapsed sitting counts all members.
9. Delete removes the complete selection, shows one Undo, and restores every row with one click.
10. Clear and Escape clear selection; keyboard focus remains visible and recoverable.
11. The floating bar never covers the last row and the Undo toast appears above it.
12. Existing title, time, duration, project, tag, billable, note, resume, duplicate, single-delete, grouping, load-more, and filters still work.

If a visual defect is found, add the smallest regression test possible before adjusting code, then repeat the focused and full verification commands.

- [ ] **Step 10: Commit**

```bash
git add src/components/entries/bulk-entry-actions.tsx src/components/entries/bulk-entry-actions.test.tsx src/components/entries/entry-log.tsx src/components/entries/entry-log.test.tsx
git commit -m "feat(entries): delete multi-selected records"
```

---

## Self-Review

### Spec coverage

| Approved requirement | Implemented by |
| --- | --- |
| Number-only sitting disclosure | Task 4 |
| Clear full-width day separators | Task 4 |
| Larger 1rem titles | Task 4 |
| Shared day/row duration alignment | Task 4 shared CSS grid |
| Contextual row checkboxes | Tasks 1, 4, 5 |
| Touch-visible and keyboard-visible selection | Tasks 1 and 4 CSS media/focus rules |
| Always-visible day checkbox | Task 5 |
| Sitting selects hidden members | Task 5 |
| Checked and indeterminate states | Tasks 1 and 5 |
| Sticky/persistent selected-count bar | Task 6 |
| Delete and Clear selection | Task 6 |
| One atomic soft delete | Task 2 |
| One Undo restores all | Tasks 2 and 3 |
| Optimistic cache update/rollback | Task 3 |
| Stale selection pruning | Tasks 1 and 6 |
| Selection stays local and clears after success | Task 6 |
| Failure retains usable selection | Tasks 3 and 6 |
| Accessible names, mixed state, announcements, Escape | Tasks 1, 5, and 6 |
| Responsive metadata shedding | Task 4 |
| Existing edit/group/filter behavior retained | Every task's focused regression suite plus Task 6 QA |

### Completeness scan

The plan contains no deferred implementation. All created functions, props,
return types, copy strings, mutations, fixture expectations, and CSS class
names are defined before use.

### Type consistency

- `SelectionState`, `selectionState`, `toggleSelection`, and `pruneSelection` keep the same names across Tasks 1, 5, and 6.
- `EntrySelectionController.onToggle` always takes `(entryIds, origin)`.
- `useEntryEditMutations.removeMany` takes IDs; `restoreMany` takes snapshots; `EntryActions.onRemoveMany` takes snapshots and returns `Promise<boolean>`.
- Convex public/internal batch mutations all take `{ entryIds }` and return the existing `removeReturns`/`restoreReturns` shapes.
- The five shared grid class names are defined once in Task 4 and used identically by entries, sittings, headers, and skeletons.

### Scope check

The backend transaction and frontend list are coupled by one feature boundary: multi-selection cannot ship safely without atomic deletion, and the batch mutation has no independent product surface. One plan is appropriate. No schema, settings, new bulk actions, trash screen, or unloaded-record selection is introduced.
