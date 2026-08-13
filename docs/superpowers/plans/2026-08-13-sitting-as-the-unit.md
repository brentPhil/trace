# The sitting as the unit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a sitting the place its note, project, tags and billable flag are read and written, so one piece of work carries one account of itself.

**Architecture:** Storage does not move — every field stays on the entry it is on today. "Write once" is enforced by the UI: the parent row becomes the only editor for a grouped sitting, its child rows lose their note line, and one new Convex mutation (`entries.updateMany`) applies a single change to every member inside one transaction. The derived values the parent displays (joined note, tag union, all-billable) are pure functions in `group-sittings.ts`.

**Tech Stack:** React 19, TanStack Router, Convex, Vitest + Testing Library, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-08-13-sitting-as-the-unit-design.md](../specs/2026-08-13-sitting-as-the-unit-design.md)

## Global Constraints

- **`convex/entries.edit.test.ts` must stay green AND UNEDITED.** In particular *"does not re-inherit billable when the project changes"*. Needing to change that file means the implementation re-derived `billable` on the server and went further than this design allows. Revert and re-read.
- **Billable inheritance only ever turns billable ON.** A project with `billableByDefault: true` sends `billable: true` for every member. A project with `billableByDefault: false` sends no `billable` field at all.
- **The client derives `billable` and sends it explicitly.** Never omit the field and let the server infer it. What the `$` shows must provably be what was written.
- **No prose is resolved behind the user's back.** Members with differing notes are joined oldest-first and shown before anything is written.
- **`entries.update`, `entries.setNote` and `EntryRow`'s single-entry paths are untouched.** Plain rows, the calendar popover and the timer bar keep working exactly as they do.
- **Check every new or edited file for a UTF-8 BOM and raw NUL bytes before committing.** Three such artifacts appeared on the previous branch, and a fourth appeared in this plan document while it was being written. Where a NUL belongs in a string, write the six-character escape `\u0000`, never the byte.

  Use this check, and **not** `grep -P '\x00'`:

  ```bash
  for f in "$@"; do
    if [ "$(wc -c < "$f")" -ne "$(tr -d '\000' < "$f" | wc -c)" ]; then echo "NUL BYTES: $f"; fi
    if [ "$(head -c3 "$f")" = "$(printf '\357\273\277')" ]; then echo "BOM: $f"; fi
  done
  ```

  `grep -qP '\x00'` **reports a file full of NUL bytes as clean.** PCRE cannot match NUL in the subject, and grep's binary short-circuit suppresses the result rather than reporting it. That command was the artifact check used throughout the previous branch, and it gave false confidence every time. Counting bytes before and after `tr -d` is the check that actually works.
- Run `npm test` and `npm run typecheck` before each commit. Both must be clean.

---

### Task 1: The sitting's derived fields

**Files:**
- Modify: `src/lib/group-sittings.ts`
- Test: `src/lib/group-sittings.test.ts`

**Interfaces:**
- Consumes: nothing. Pure functions over the existing `Entry` type.
- Produces: `joinNotes(entries: Array<Entry>): string`, `tagUnion(entries: Array<Entry>): Array<Id<"tags">>`, and two new fields on the `sitting` variant of `LogItem` — `tagIds: Array<Id<"tags">>` and `allBillable: boolean`. Tasks 4, 5 and 6 rely on all four names.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/group-sittings.test.ts`:

```ts
describe("joinNotes", () => {
  it("returns one note unchanged when every member wrote the same thing", () => {
    // The case that prompted this whole design: one ticket, two sittings, one
    // account of what got done, typed twice by hand.
    const same = "Fixed the 12-hour clock hours field."
    expect(
      joinNotes([
        makeEntry({ startedAt: 200, note: same }),
        makeEntry({ startedAt: 100, note: same }),
      ])
    ).toBe(same)
  })

  it("joins distinct notes oldest-first, so nothing is resolved unseen", () => {
    expect(
      joinNotes([
        makeEntry({ startedAt: 200, note: "Then the tests." }),
        makeEntry({ startedAt: 100, note: "First the parser." }),
      ])
    ).toBe("First the parser.\n\nThen the tests.")
  })

  it("skips members with no note rather than leaving blank paragraphs", () => {
    expect(
      joinNotes([
        makeEntry({ startedAt: 300, note: "Second." }),
        makeEntry({ startedAt: 200, note: "   " }),
        makeEntry({ startedAt: 100, note: "First." }),
      ])
    ).toBe("First.\n\nSecond.")
  })

  it("is empty when nobody wrote anything, which is what renders + add note", () => {
    expect(joinNotes([makeEntry({ note: undefined }), makeEntry({ note: "" })])).toBe("")
  })

  it("counts a repeated note once however many members carry it", () => {
    // Otherwise opening a three-sitting group would offer the same paragraph
    // three times and ask the user to delete two of them.
    const same = "Same account."
    expect(
      joinNotes([
        makeEntry({ startedAt: 300, note: same }),
        makeEntry({ startedAt: 200, note: same }),
        makeEntry({ startedAt: 100, note: same }),
      ])
    ).toBe(same)
  })
})

describe("tagUnion", () => {
  it("is every tag any member carries, without duplicates", () => {
    // A SET CLAIM, deliberately order-independent: this test is about coverage
    // and dedup. Order is pinned once, in the sitting-level test below, where
    // it is a stated decision rather than a by-product of the loop direction.
    //
    // CORRECTED DURING EXECUTION. This assertion originally read
    // `.toEqual([TAG_A, TAG_B, TAG_C])`, which contradicted both the
    // implementation in Step 3 and the sitting-level test below — the fixtures
    // tie on `startedAt`, so it was silently asserting insertion order while
    // its neighbour asserted oldest-first. The implementer stopped rather than
    // pick one, which was correct.
    const union = tagUnion([
      makeEntry({ tagIds: [TAG_A, TAG_B] }),
      makeEntry({ tagIds: [TAG_B, TAG_C] }),
    ])
    expect([...union].sort()).toEqual([TAG_A, TAG_B, TAG_C].sort())
  })

  it("is empty for members that carry none", () => {
    expect(tagUnion([makeEntry({ tagIds: [] }), makeEntry({ tagIds: [] })])).toEqual([])
  })
})

describe("a sitting's derived classification", () => {
  const sittingOf = (items: Array<LogItem>) => {
    const found = items.find((item) => item.kind === "sitting")
    if (found === undefined || found.kind !== "sitting") throw new Error("no sitting")
    return found
  }

  it("is billable only when every member is", () => {
    // A mark meaning "some of these" means nothing, so mixed reads unlit and
    // one click on the parent makes it uniform.
    const mixed = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, billable: true }),
        makeEntry({ title: "Retainer", startedAt: 100, billable: false }),
      ])
    )
    expect(mixed.allBillable).toBe(false)

    const both = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, billable: true }),
        makeEntry({ title: "Retainer", startedAt: 100, billable: true }),
      ])
    )
    expect(both.allBillable).toBe(true)
  })

  it("carries the tag union so the parent's picker opens on it", () => {
    const sitting = sittingOf(
      toLogItems([
        makeEntry({ title: "Retainer", startedAt: 200, tagIds: [TAG_A] }),
        makeEntry({ title: "Retainer", startedAt: 100, tagIds: [TAG_B] }),
      ])
    )
    expect(sitting.tagIds).toEqual([TAG_B, TAG_A])
  })
})
```

Add the tag id constants near the top of the file, beside the existing fixtures:

```ts
const TAG_A = "jd7taga" as unknown as Id<"tags">
const TAG_B = "jd7tagb" as unknown as Id<"tags">
const TAG_C = "jd7tagc" as unknown as Id<"tags">
```

> **Resolve against the real file before writing.** This file already has an entry factory and an `Id` import; use whatever they are actually called rather than assuming `makeEntry`. If the factory does not accept `note`, `tagIds` or `billable` overrides, extend the factory — do NOT change `group-sittings.ts` to suit the test. Read the existing `describe` blocks and match their fixture style.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/group-sittings.test.ts`
Expected: FAIL — `joinNotes is not defined`, `tagUnion is not defined`, and `allBillable`/`tagIds` undefined on the sitting.

- [ ] **Step 3: Add the two pure functions**

In `src/lib/group-sittings.ts`, after `sittingKey`:

```ts
/**
 * Every distinct note in a sitting, oldest first, as one editable string.
 *
 * NOTHING IS RESOLVED BEHIND THE USER. A sitting whose members carry different
 * prose must never pick a winner on their behalf — the losing text is the one
 * thing PRODUCT.md says the product exists for. So every word goes on screen
 * and the user edits down to what they meant, which makes the first save of a
 * mixed group the only moment prose changes, and it changes in front of them.
 *
 * DISTINCT, not merely concatenated: the ordinary case is the same account
 * typed twice, and offering it back twice would be asking the user to tidy up
 * after a duplication they did not cause.
 *
 * Oldest first because that is the order the work happened in, and it is the
 * order a person rereading their own day expects to find it in — the input
 * array is newest-first, so this reverses it.
 */
export function joinNotes(entries: Array<Entry>): string {
  const seen = new Set<string>()
  const notes: Array<string> = []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const note = (entries[index].note ?? "").trim()
    if (note === "" || seen.has(note)) continue
    seen.add(note)
    notes.push(note)
  }

  // A blank line between them, matching the paragraph break a note is written
  // with in the textarea — see `note-sheet.tsx` on Enter inserting a newline.
  return notes.join("\n\n")
}

/**
 * Every tag any member carries, in the order first met scanning oldest first.
 *
 * A UNION rather than an intersection, because the parent's picker opens on
 * this and then writes what it is given back to every member: an intersection
 * would silently strip a tag off the member that had it the moment the picker
 * was opened and closed.
 */
export function tagUnion(entries: Array<Entry>): Array<Id<"tags">> {
  const seen = new Set<string>()
  const tagIds: Array<Id<"tags">> = []

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    for (const tagId of entries[index].tagIds) {
      if (seen.has(tagId)) continue
      seen.add(tagId)
      tagIds.push(tagId)
    }
  }

  return tagIds
}
```

Add the `Id` import at the top of the file:

```ts
import type { Id } from "../../convex/_generated/dataModel"
```

> Check the existing import in a neighbouring file under `src/lib/` for the exact relative depth before writing this line.

- [ ] **Step 4: Add the two fields to the sitting**

In the `LogItem` type, after `notedCount`:

```ts
      /**
       * The tag union — see `tagUnion`. The parent's picker opens on this, and
       * what it writes goes to every member.
       */
      tagIds: Array<Id<"tags">>
      /**
       * Every member is billable.
       *
       * ALL, not any. The parent's `$` is a claim about the sitting, and a mark
       * meaning "some of these" is a mark that means nothing. A mixed group
       * reads unlit, and one click on the parent makes it uniform.
       */
      allBillable: boolean
```

In `toLogItems`, add to the accumulator loop and the returned object:

```ts
    let totalMs = 0
    let notedCount = 0
    let allBillable = true
    let fromMs = first.startedAt
    let toMs = endOf(first)

    for (const member of members) {
      totalMs += member.durationMs ?? 0
      if ((member.note ?? "").trim() !== "") notedCount += 1
      if (!member.billable) allBillable = false
      if (member.startedAt < fromMs) fromMs = member.startedAt
      const end = endOf(member)
      if (end > toMs) toMs = end
    }

    return {
      kind: "sitting",
      key,
      entries: members,
      totalMs,
      notedCount,
      tagIds: tagUnion(members),
      allBillable,
      fromMs,
      toMs,
    }
```

**`notedCount` stays for now, and Task 5 deletes it.** It is still computed here so this task's own tests stay meaningful, and `day-list.test.tsx` still asserts it today. PRE-FLIGHT AMENDMENT (approved before execution): Task 5 removes the field, its accumulator and its assertions in the same commit that stops rendering it, so nothing dead is left behind and the deletion sits with the change that made it dead. Do NOT remove it in this task.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/group-sittings.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Full suite, typecheck, artifact scan**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no output, exit 0.
Run the NUL/BOM check from Global Constraints over: `src/lib/group-sittings.ts src/lib/group-sittings.test.ts` — Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/lib/group-sittings.ts src/lib/group-sittings.test.ts
git commit -m "feat(sittings): the derived note, tags and billable a parent row needs"
```

---

### Task 2: `entries.updateMany`

**Files:**
- Modify: `convex/entries.ts` (after the existing `update` / `updateAs` exports, around line 1685)
- Test: `convex/entries.edit.test.ts` is **read-only** for this task. Write new tests in `convex/entries.updateMany.test.ts`.

**Interfaces:**
- Consumes: the existing `updateImpl(ctx, userId, args: UpdateArgs)` and `updateArgs` validator object, both already in `convex/entries.ts`.
- Produces: `api.entries.updateMany` taking `{ entryIds: Array<Id<"timeEntries">>, title?, note?, projectId?, tagIds?, billable? }` and returning `null`. Task 3 calls it.

**Constraint:** this task adds a mutation and changes nothing else. `update`, `updateAs`, `setNote` and `setNoteAs` keep their exact current behaviour.

- [ ] **Step 1: Write the failing tests**

Create `convex/entries.updateMany.test.ts`:

```ts
/// <reference types="vite/client" />
// The bulk edit behind a sitting's parent row.
//
// Separate from entries.edit.test.ts, which is deliberately untouched by this
// feature: that file guards the invariant that an entry which already exists
// never re-inherits its project's billable default, and this mutation must not
// be able to break it. Keeping the new tests out of that file keeps the
// tripwire honest.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api } from "./_generated/api"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")

const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"
const HOUR = 3_600_000

/** Two completed entries on one title, oldest first in wall-clock terms. */
async function twoSittings(t: ReturnType<typeof setup>, userId: string) {
  const base = Date.parse("2026-08-13T09:00:00Z")
  const ids: Array<Id<"timeEntries">> = []
  for (const offset of [0, 3 * HOUR]) {
    ids.push(
      await t.run(async (ctx) =>
        await ctx.db.insert("timeEntries", {
          userId,
          title: "[B-CB-343] Fixing the clock input",
          startedAt: base + offset,
          endedAt: base + offset + HOUR,
          durationMs: HOUR,
          tagIds: [],
          billable: false,
          source: "web",
          updatedAt: 0,
          deletedAt: null,
        })
      )
    )
  }
  return ids
}

describe("entries.updateMany", () => {
  it("writes one note to every member", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)
    const asAlice = t.withIdentity({ subject: ALICE })

    await asAlice.mutation(api.entries.updateMany, {
      entryIds: ids,
      note: "Fixed the 12-hour clock hours field.",
    })

    const rows = await t.run(async (ctx) =>
      await Promise.all(ids.map((id) => ctx.db.get(id)))
    )
    for (const row of rows) {
      expect(row?.note).toBe("Fixed the 12-hour clock hours field.")
    }
  })

  it("writes project, tags and billable together in one call", async () => {
    // The parent sends them together when a billable-by-default project is
    // picked, so they have to land together.
    const t = setup()
    const ids = await twoSittings(t, ALICE)
    const asAlice = t.withIdentity({ subject: ALICE })
    const projectId = await t.run(async (ctx) =>
      await ctx.db.insert("projects", {
        userId: ALICE,
        name: "Sealogs",
        color: "amber",
        billableByDefault: true,
        archived: false,
        updatedAt: 0,
        deletedAt: null,
      })
    )

    await asAlice.mutation(api.entries.updateMany, {
      entryIds: ids,
      projectId,
      billable: true,
    })

    const rows = await t.run(async (ctx) =>
      await Promise.all(ids.map((id) => ctx.db.get(id)))
    )
    for (const row of rows) {
      expect(row?.projectId).toBe(projectId)
      expect(row?.billable).toBe(true)
    }
  })

  it("refuses the whole call when one id belongs to someone else", async () => {
    /*
     * THE REASON THIS IS ONE MUTATION RATHER THAN A CLIENT LOOP. A partial
     * write leaves a sitting whose members disagree, which is the exact state
     * this feature exists to eliminate — and there would be no single undo to
     * get back from it. Convex mutations are transactions, so the guard is
     * structural rather than a convention this handler has to remember.
     */
    const t = setup()
    const mine = await twoSittings(t, ALICE)
    const theirs = await twoSittings(t, BOB)
    const asAlice = t.withIdentity({ subject: ALICE })

    await expect(
      asAlice.mutation(api.entries.updateMany, {
        entryIds: [...mine, theirs[0]],
        note: "Should not land anywhere.",
      })
    ).rejects.toThrow()

    // Not "most of them" — none of them.
    const rows = await t.run(async (ctx) =>
      await Promise.all(mine.map((id) => ctx.db.get(id)))
    )
    for (const row of rows) {
      expect(row?.note).toBeUndefined()
    }
  })

  it("refuses an unauthenticated call", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)

    await expect(
      t.mutation(api.entries.updateMany, { entryIds: ids, note: "No." })
    ).rejects.toThrow()
  })

  it("accepts a single id, so a lone entry needs no second path", async () => {
    const t = setup()
    const ids = await twoSittings(t, ALICE)
    const asAlice = t.withIdentity({ subject: ALICE })

    await asAlice.mutation(api.entries.updateMany, {
      entryIds: [ids[0]],
      note: "Just this one.",
    })

    const rows = await t.run(async (ctx) =>
      await Promise.all(ids.map((id) => ctx.db.get(id)))
    )
    expect(rows[0]?.note).toBe("Just this one.")
    expect(rows[1]?.note).toBeUndefined()
  })

  it("rejects an empty id list rather than succeeding at nothing", async () => {
    // A no-op that reports success is how a broken caller stays broken.
    const t = setup()
    const asAlice = t.withIdentity({ subject: ALICE })

    await expect(
      asAlice.mutation(api.entries.updateMany, { entryIds: [], note: "Nowhere." })
    ).rejects.toThrow()
  })
})
```

> **Resolve against the real file before writing.** Read `convex/entries.edit.test.ts` for this project's actual `convexTest` idioms — how identity is attached, whether there is a shared entry-insert helper worth importing instead of `twoSittings`, and the exact required columns on `timeEntries` and `projects`. Match them. The schema is the authority on which fields are required; if an insert above is missing one, add it rather than loosening the schema. If the project uses `expectCode(promise, code)` for refusals, use that instead of `rejects.toThrow()` and pass the code the ownership guard actually raises.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run convex/entries.updateMany.test.ts`
Expected: FAIL — `api.entries.updateMany` does not exist.

- [ ] **Step 3: Write the mutation**

In `convex/entries.ts`, immediately after the `updateAs` export:

```ts
// ---------------------------------------------------------------------------
// updateMany — one change, every member of a sitting
// ---------------------------------------------------------------------------

const updateManyArgs = {
  // `updateArgs` minus `entryId`, which becomes the array below. Spelled out
  // rather than derived, because a validator built by subtraction is one a
  // reader has to reconstruct in their head.
  entryIds: v.array(v.id("timeEntries")),
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  projectId: v.optional(v.union(v.id("projects"), v.null())),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

/**
 * Applies one change to every entry in a sitting.
 *
 * ONE MUTATION RATHER THAN A CLIENT LOOP, and the reason is failure rather
 * than round trips. A loop that writes three members and then refuses the
 * fourth leaves a sitting whose members disagree — the exact state grouping's
 * single note exists to eliminate — with no one undo to get back from. A Convex
 * mutation is a transaction, so "all of them or none" is structural here rather
 * than something this handler has to be careful about.
 *
 * `updateImpl` per id, NOT a reimplementation: ownership, the title check,
 * project ownership, tag normalisation and the tag join rows all stay in the
 * one place they already live. That also means every refusal `update` can
 * raise, this raises, with the same code.
 *
 * NOTHING HERE DERIVES `billable`. The caller sends it explicitly or not at
 * all — see `timer-bar.tsx` on why the client owns that derivation, and
 * `entries.edit.test.ts`'s "does not re-inherit billable when the project
 * changes" for the invariant that would otherwise break.
 */
async function updateManyImpl(
  ctx: MutationCtx,
  userId: string,
  { entryIds, ...fields }: { entryIds: Array<Id<"timeEntries">> } & Omit<UpdateArgs, "entryId">
) {
  if (entryIds.length === 0) {
    throw traceError("BAD_REQUEST", "updateMany needs at least one entry.")
  }

  for (const entryId of entryIds) {
    await updateImpl(ctx, userId, { entryId, ...fields })
  }

  return null
}

export const updateMany = mutation({
  args: updateManyArgs,
  returns: v.null(),
  handler: async (ctx, args) => await updateManyImpl(ctx, await requireUserId(ctx), args),
})

export const updateManyAs = internalMutation({
  args: { ...updateManyArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, ...args }) => await updateManyImpl(ctx, userId, args),
})
```

> **Resolve against the real file.** `traceError("BAD_REQUEST", …)` is a guess at this codebase's error helper. Read `convex/lib/codes.ts` and how a neighbouring handler in `convex/entries.ts` raises an argument refusal, and use that exact call and an existing code. Do not invent a new error code. `updateManyAs` mirrors `updateAs`; if no internal variant is needed by any caller, drop it rather than exporting something unused.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run convex/entries.updateMany.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the invariant this must not break**

Run: `npx vitest run convex/entries.edit.test.ts`
Expected: PASS, unchanged.

Run: `git status --short convex/entries.edit.test.ts`
Expected: no output. If that file is modified, the implementation went further than this design allows — revert it and re-read the Global Constraints.

- [ ] **Step 6: Full suite, typecheck, artifact scan**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no output, exit 0. This runs `tsc -p convex` too.
Run the NUL/BOM check from Global Constraints over: `convex/entries.ts convex/entries.updateMany.test.ts` — Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add convex/entries.ts convex/entries.updateMany.test.ts
git commit -m "feat(entries): updateMany, so a sitting is written all at once or not at all"
```

---

### Task 3: The client's `updateMany`

**Files:**
- Modify: `src/hooks/use-entry-edit-mutations.ts`
- Test: `src/hooks/use-entry-edit-mutations.test.ts` if it exists; otherwise this task's proof is Task 6's component tests and no test file is created.

**Interfaces:**
- Consumes: `api.entries.updateMany` (Task 2), and the existing `patchEverywhere(localStore, entryId, patch)` in this file.
- Produces: `updateMany(args: { entryIds: Array<Id<"timeEntries">>; title?: string; note?: string; projectId?: Id<"projects"> | null; tagIds?: Array<Id<"tags">>; billable?: boolean }): Promise<void>` on the object `useEntryEditMutations()` returns. Tasks 5 and 6 call it.

- [ ] **Step 1: Add the mutation with its optimistic update**

In `src/hooks/use-entry-edit-mutations.ts`, beside the existing `updateMutation`:

```ts
  const updateManyMutation = useLatest(
    useConvexMutation(api.entries.updateMany).withOptimisticUpdate((localStore, args) => {
      // `patchEverywhere` per id, so a sitting's members move together in the
      // same commit rather than one row at a time. The patch body is the same
      // one `update` applies — kept identical deliberately, because two
      // spellings of "what this write does locally" is how the log and the
      // server start disagreeing about a note.
      for (const entryId of args.entryIds) {
        patchEverywhere(localStore, entryId, (entry) => ({
          ...entry,
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.note !== undefined
            ? { note: args.note.trim() === "" ? undefined : args.note.trim() }
            : {}),
          ...(args.billable !== undefined ? { billable: args.billable } : {}),
          ...(args.projectId !== undefined
            ? { projectId: args.projectId ?? undefined }
            : {}),
          ...(args.tagIds !== undefined ? { tagIds: args.tagIds } : {}),
        }))
      }
    })
  )
```

And beside the existing `update` callback:

```ts
  const updateMany = useCallback(
    async (args: {
      entryIds: Array<Id<"timeEntries">>
      title?: string
      note?: string
      projectId?: Id<"projects"> | null
      tagIds?: Array<Id<"tags">>
      billable?: boolean
    }) => {
      await updateManyMutation(args)
    },
    [updateManyMutation]
  )
```

Add `updateMany` to this hook's return object, beside `update`.

> **Resolve against the real file.** Read the existing `update` callback and its return statement and match them exactly — argument style, `useLatest` usage, and where in the returned object it sits. The `undefined`-not-`""` note normalisation above is load-bearing: it matches the server so the "N of M noted" counts do not flicker while the mutation is in flight.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: PASS — nothing calls `updateMany` yet, so this proves the addition broke nothing.

- [ ] **Step 4: Artifact scan and commit**

Run the NUL/BOM check from Global Constraints over: `src/hooks/use-entry-edit-mutations.ts` — Expected: no output.

```bash
git add src/hooks/use-entry-edit-mutations.ts
git commit -m "feat(entries): the client half of updateMany, optimistic across every member"
```

---

### Task 4: `NoteSheet` takes a target, not an entry

**Files:**
- Modify: `src/components/entries/note-sheet.tsx`
- Modify: `src/components/entries/entry-log.tsx`
- Test: `src/components/entries/note-sheet.test.tsx`

**Interfaces:**
- Consumes: `joinNotes` (Task 1), `updateMany` (Task 3).
- Produces: an exported `NoteTarget` type and a changed `NoteSheet` prop contract:

```ts
export type NoteTarget = {
  /** Every entry this note will be written to. One for a row, many for a sitting. */
  entryIds: Array<Id<"timeEntries">>
  /** Stable identity, for re-seeding and for the in-memory draft map. */
  key: string
  title: string
  note: string
  totalMs: number
}
```

with `onSave: (entryIds: Array<Id<"timeEntries">>, note: string) => Promise<void>`. Task 6 builds targets for sittings.

**Why this task exists separately:** the sheet is the only place a note is written, and it currently hard-codes "a note belongs to one entry" in four places — the seeding effect, the draft map key, the save call and the undo path. Changing all four alongside a new row component would make a failure ambiguous about which half broke.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/entries/note-sheet.test.tsx`:

```tsx
describe("a note written for a whole sitting", () => {
  const TARGET: NoteTarget = {
    entryIds: [ID_A, ID_B],
    key: "2026-08-13\u0000[B-CB-343] Fixing the clock input",
    title: "[B-CB-343] Fixing the clock input",
    note: "First the parser.\n\nThen the tests.",
    totalMs: 5_040_000,
  }

  it("opens on every member's prose joined, not on one member's", () => {
    // Nothing is resolved behind the user: both accounts are on screen before
    // anything is written, and they edit down to what they meant.
    const onSave = vi.fn(async () => {})
    render(<NoteSheet target={TARGET} open onOpenChange={() => {}} onSave={onSave} />)

    expect(screen.getByLabelText("Note").textContent).toBe(
      "First the parser.\n\nThen the tests."
    )
  })

  it("saves to every member in one call", () => {
    const onSave = vi.fn(async () => {})
    render(<NoteSheet target={TARGET} open onOpenChange={() => {}} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "One account." } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith([ID_A, ID_B], "One account.")
  })

  it("still writes a lone entry through the same path", () => {
    // A row is a one-member target. One code path, so the sheet cannot behave
    // differently depending on where it was opened from.
    const onSave = vi.fn(async () => {})
    render(
      <NoteSheet
        target={{ ...TARGET, entryIds: [ID_A], key: ID_A, note: "Just this." }}
        open
        onOpenChange={() => {}}
        onSave={onSave}
      />
    )

    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Edited." } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith([ID_A], "Edited.")
  })
})
```

> **Resolve against the real file before writing.** The accessible name of the textarea and of the save control are guesses. Read the existing tests in `note-sheet.test.tsx` and use whatever they use to reach both. If this file does not exist, read `note-sheet.tsx` for the real `aria-label`s and create the file following the conventions of `day-list.test.tsx`. `ID_A` / `ID_B` should follow the id-casting style already used in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/entries/note-sheet.test.tsx`
Expected: FAIL — `NoteSheet` does not accept a `target` prop.

- [ ] **Step 3: Change the prop contract**

In `src/components/entries/note-sheet.tsx`, replace the `entry` prop with `target`:

```tsx
/**
 * What a note is being written for.
 *
 * A TARGET RATHER THAN AN ENTRY, because a note now belongs to a piece of work
 * and a piece of work can be several entries — see the sitting-as-the-unit
 * spec. A row builds a one-member target, so there is exactly one path through
 * this component and it cannot behave differently depending on where it was
 * opened from.
 */
export type NoteTarget = {
  /** Every entry this note will be written to. One for a row, many for a sitting. */
  entryIds: Array<Id<"timeEntries">>
  /**
   * Stable identity for re-seeding and for the `drafts` map.
   *
   * NOT the first entry's id: a sitting's membership changes when a member is
   * retitled out of it, and keying on a member would hand the user back a draft
   * written for a different set of rows.
   */
  key: string
  title: string
  note: string
  totalMs: number
}

export function NoteSheet({
  target,
  open,
  onOpenChange,
  onSave,
}: {
  target: NoteTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Passed in, not reached for — see TimerBarActions on why. */
  onSave: (entryIds: Array<Id<"timeEntries">>, note: string) => Promise<void>
}) {
```

Then replace the four uses inside the component:

- the seeding effect keys on `target.key` rather than `entry._id`, and seeds from `target.note`:

```tsx
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    const id = open ? (target?.key ?? null) : null
    if (seededFor.current === id) return
    seededFor.current = id
    if (id !== null) setValue(drafts.get(id) ?? target?.note ?? "")
    setError(null)
  }, [open, target?.key, target?.note])
```

- the null guard becomes `if (target === null) return null`
- `const title = target.title.trim()` and `const duration = formatCompactDuration(target.totalMs)`
- every `onSave(entry._id, …)` becomes `onSave(target.entryIds, …)`, and every `drafts.get/set/delete(entry._id)` becomes `drafts.get/set/delete(target.key)`

> Read the whole file and change **every** occurrence. `elapsedMs` may become an unused import — remove it if so, since `noUnusedLocals` will fail the typecheck otherwise.

- [ ] **Step 4: Update the one existing call site**

In `src/components/entries/entry-log.tsx`, the state and the live lookup become target-shaped:

```tsx
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  const actions: EntryRowActions = {
    ...entryActions,
    onNoteOpen: (entry) => {
      setNoteTarget({
        entryIds: [entry._id],
        key: entry._id,
        title: entry.title,
        note: entry.note ?? "",
        totalMs: entry.durationMs ?? 0,
      })
      setNoteOpen(true)
    },
  }

  // The sheet reads the LIVE rows when they are still found in `groups`,
  // falling back to the snapshot only if every one has since been removed
  // (deleted, or paginated out from under it) — so it stays in sync with edits
  // made elsewhere while it is open, rather than going stale mid-sentence.
  const liveNoteTarget = (() => {
    if (noteTarget === null) return null
    const byId = new Map(
      groups.flatMap((group) => group.entries).map((entry) => [entry._id, entry])
    )
    const live = noteTarget.entryIds
      .map((id) => byId.get(id))
      .filter((entry): entry is Entry => entry !== undefined)
    if (live.length === 0) return noteTarget
    return {
      ...noteTarget,
      note: joinNotes(live),
      totalMs: live.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
    }
  })()
```

and the element:

```tsx
      <NoteSheet
        target={liveNoteTarget}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={(entryIds, note) => updateMany({ entryIds, note })}
      />
```

Replace this file's `setNote` destructure with `updateMany`:

```tsx
  const { updateMany } = useEntryEditMutations()
```

and add the imports for `joinNotes` and the `NoteTarget` type.

`joinNotes` on a one-member target returns that member's trimmed note, so a plain row's behaviour is unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/entries/note-sheet.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Full suite, typecheck, artifact scan**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no output, exit 0.
Run the NUL/BOM check from Global Constraints over: `src/components/entries/note-sheet.tsx src/components/entries/entry-log.tsx src/components/entries/note-sheet.test.tsx` — Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/entries/note-sheet.tsx src/components/entries/entry-log.tsx src/components/entries/note-sheet.test.tsx
git commit -m "refactor(notes): the sheet writes to a piece of work, which may be several entries"
```

---

### Task 5: `SittingRow` becomes the editor

**Files:**
- Create: `src/components/entries/note-line.tsx`
- Modify: `src/components/entries/sitting-row.tsx`
- Modify: `src/components/entries/entry-row.tsx` (extract the note block out; behaviour-preserving)
- Modify: `src/lib/group-sittings.ts` (remove `notedCount`)
- Test: `src/components/entries/day-list.test.tsx` (where `SittingRow` is exercised today), and `src/lib/group-sittings.test.ts` for the `notedCount` removal

**Interfaces:**
- Consumes: `sitting.tagIds`, `sitting.allBillable` (Task 1); `Classification` from `@/components/timer/timer-bar`.
- Produces: three new required props on `SittingRow` — `tags: Array<Doc<"tags">>`, `onClassify: (change: Partial<Classification>) => void`, `onNoteOpen: () => void` — plus `notesExpanded?: boolean`. Task 6 supplies all four.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/entries/day-list.test.tsx`, in the grouped-entries area:

```tsx
describe("the parent row is the sitting's editor", () => {
  it("writes one note for the whole sitting rather than one per member", () => {
    renderGroupedLog()
    fireEvent.click(screen.getByRole("button", { name: /show grouped entries/i }))

    // The members carry times and controls, but no prose of their own — the
    // duplication this feature exists to remove.
    expect(screen.queryAllByRole("button", { name: /\+ add note/i })).toHaveLength(1)
  })

  it("marks every member billable when the picked project bills by default", () => {
    const onClassify = vi.fn()
    renderSitting({ onClassify })

    fireEvent.click(screen.getByLabelText(/^Project/))
    fireEvent.click(screen.getByRole("option", { name: /Sealogs/ }))

    // Client-derived and sent explicitly, so what the $ shows is what gets
    // written — see timer-bar.tsx for the same rule on the idle bar.
    expect(onClassify).toHaveBeenCalledWith({
      projectId: SEALOGS._id,
      billable: true,
    })
  })

  it("leaves billable alone for a project that does not bill by default", () => {
    // Inheritance only ever turns billable ON. Removing a mark would destroy
    // the record of a decision; adding one destroys nothing.
    const onClassify = vi.fn()
    renderSitting({ onClassify })

    fireEvent.click(screen.getByLabelText(/^Project/))
    fireEvent.click(screen.getByRole("option", { name: /Pro bono/ }))

    expect(onClassify).toHaveBeenCalledWith({ projectId: PRO_BONO._id })
  })

  it("reads unlit while any member is unbillable, and one click makes it uniform", () => {
    const onClassify = vi.fn()
    renderSitting({ onClassify, members: [{ billable: true }, { billable: false }] })

    fireEvent.click(screen.getByLabelText("Not billable"))

    expect(onClassify).toHaveBeenCalledWith({ billable: true })
  })

  it("no longer counts noted members on the parent", () => {
    // With one note per sitting the count could only read 0 of N or N of N,
    // and "+ add note" states absence more directly.
    renderGroupedLog()
    expect(screen.queryByText(/of 2 noted/)).toBeNull()
  })
})
```

> **Resolve against the real file before writing.** `renderGroupedLog` and `renderSitting` are stand-ins for whatever this file already uses to render a grouped day — read its existing grouped-entries `describe` and reuse its fixtures and helpers rather than adding parallel ones. The project trigger is matched by prefix (`/^Project/`) deliberately: `ProjectPicker` labels it `"Project"` only while nothing is selected and `Project: <name>` afterwards, so an exact match breaks the moment a project is set. Suggestion-style lists in this codebase need `mouseDown`, but `PickerList` options are real `onClick` buttons — verify which applies before assuming.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: FAIL — `SittingRow` has no pickers and still renders "2 of 2 noted".

- [ ] **Step 3: Rewrite the component's doc comment**

The current comment states the opposite of what this component now does, and a wrong comment in this codebase is worse than none:

```tsx
/**
 * Several sittings at one piece of work, and the place that work is edited.
 *
 * THE SITTING IS THE UNIT OF WORK; THE ENTRIES UNDER IT ARE THE UNIT OF TIME.
 * The note, the project, the tags and the billable flag are facts about the
 * work, so they live here and write through to every member at once. Times are
 * per-entry facts, so they stay on the member rows — and duration is absent
 * from this row for the reason it always was: editing a total would have to
 * pick a member to absorb the change.
 *
 * THIS ROW USED TO BE READ-ONLY. It changed because shipping grouping showed
 * the assumption underneath it was wrong: two entries sharing a title usually
 * carry the SAME note, typed twice by hand, because nothing in this product
 * copies a note forward. See
 * docs/superpowers/specs/2026-08-13-sitting-as-the-unit-design.md.
 *
 * Still a disclosure and not a merge. Nothing is stored here, nothing is
 * rewritten behind the user, and every member remains individually present with
 * its own times one click away.
 */
```

- [ ] **Step 3b: Remove `notedCount` (pre-flight amendment)**

Nothing reads it once the parent stops rendering the count. Delete the field from the `sitting` variant of `LogItem`, the `let notedCount = 0` accumulator and its `if` in `toLogItems`, the `notedCount,` key in the returned object, and every assertion about it in `group-sittings.test.ts` and `day-list.test.tsx`. `npm run typecheck` is the check that none were missed.

- [ ] **Step 4: Add the props**

```tsx
  sitting,
  timeZone,
  use12Hour,
  projects,
  tags,
  display,
  expanded,
  notesExpanded = false,
  onToggle,
  onResume,
  onClassify,
  onNoteOpen,
  controls,
}: {
  sitting: Sitting
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  display: DurationDisplay
  expanded: boolean
  /** Forwarded from the page, exactly as `EntryRow` takes it. */
  notesExpanded?: boolean
  onToggle: () => void
  /** Resumes the NEWEST member — see `DayList`, which supplies it. */
  onResume: () => void
  /** Applies a classifier change to EVERY member. See `DayList`. */
  onClassify: (change: Partial<Classification>) => void
  onNoteOpen: () => void
  controls: string
}) {
```

- [ ] **Step 5: Derive billable when a project is picked**

Inside the component, above the return:

```tsx
  const note = joinNotes(sitting.entries)
  const hasNote = note !== ""

  /*
   * A PROJECT'S DEFAULT, APPLIED ONLY UPWARDS.
   *
   * `startImpl` reads `args.billable ?? project?.billableByDefault` for a NEW
   * entry, and these entries already exist — so the server rule that an
   * existing entry never re-inherits still holds, and holds literally: the
   * derivation happens here and travels as an explicit `billable`, which is the
   * same shape `timer-bar.tsx` uses and for the same reason. What the `$` shows
   * is provably what was written.
   *
   * ONLY EVER ON. A billable-by-default project marks every member billable; a
   * project that does not bill by default sends no `billable` at all and leaves
   * each member's flag alone. Adding a mark destroys no decision. Removing one
   * would — see convex/projects.ts on exactly that.
   */
  const chooseProject = (projectId: Id<"projects"> | null) => {
    const picked = projects.find((project) => project._id === projectId) ?? null
    onClassify(
      picked?.billableByDefault === true
        ? { projectId, billable: true }
        : { projectId }
    )
  }
```

- [ ] **Step 6: Replace the static cluster with controls**

Replace the `ProjectDot`, the "n of m noted" span, and nothing else, with:

```tsx
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectPicker
              projects={projects}
              value={newest.projectId ?? null}
              onCreate={onCreateProject}
              onChange={chooseProject}
              className="max-w-[8rem]"
              nameClassName="hidden md:inline"
            />
            <TagPicker
              tags={tags}
              value={sitting.tagIds}
              onCreate={onCreateTag}
              onChange={(tagIds) => onClassify({ tagIds })}
              className="hidden sm:inline-flex"
            />
            <BillableToggle
              value={sitting.allBillable}
              onChange={(billable) => onClassify({ billable })}
              className="hidden sm:inline-flex"
            />
          </div>
```

and add the note beneath the title.

**PRE-FLIGHT AMENDMENT (approved before execution).** The plan originally said to copy `entry-row.tsx:195-274` verbatim. Extract it instead, because ~80 lines of duplicated JSX carrying the WCAG target reasoning and the Hatch Rule would be two copies to keep in step by hand.

Create `src/components/entries/note-line.tsx`:

```tsx
/**
 * A note as the log draws it: the prose itself, or the hatch inviting one.
 *
 * EXTRACTED FROM `EntryRow` rather than copied into `SittingRow`, because the
 * two comments below are the kind that go stale in one copy and not the other
 * — and a note rendered two different ways in one list is exactly the drift
 * this component exists to prevent. A row passes its own note; a sitting passes
 * every member's, joined.
 */
export function NoteLine({
  note,
  notesExpanded,
  onOpen,
}: {
  /** Already trimmed and, for a sitting, already joined. */
  note: string
  notesExpanded: boolean
  onOpen: () => void
}) {
```

Move the whole block at `entry-row.tsx:195-274` into it unchanged — both branches, every comment, every class. Its comments explain the fixed 20px slot, the `touch-target` placement and the Hatch Rule; they apply to both callers unchanged. `EntryRow` then renders:

```tsx
            <NoteLine
              note={note}
              notesExpanded={notesExpanded}
              onOpen={() => actions.onNoteOpen(entry)}
            />
```

and `SittingRow` renders the same element with `note` from Step 5 and `onOpen={onNoteOpen}`.

This is a behaviour-preserving move for `EntryRow`: its existing tests must pass untouched. If any needs editing, the move changed something it should not have.

This means the title and note need the same column wrapper `EntryRow` gives them. Read `entry-row.tsx` around the title for that structure and mirror it.


Add `onCreateProject` and `onCreateTag` to the prop block, typed as `EntryRowActions`' are.

> **The parent is now the densest row in the product** — badge, title, note, project, tags, billable, span, total, resume. The spec names this as a risk. Check it at `sm` and below; if the span or the tag picker has to drop at narrow widths, drop them the way `EntryRow` already does (`hidden sm:inline`) rather than letting the row wrap.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: PASS.

- [ ] **Step 8: Full suite, typecheck, artifact scan**

Run: `npm test` — Expected: PASS. Some pre-existing grouped-entries assertions about "n of m noted" will fail here; update them, since removing that text is a deliberate part of this task.
Run: `npm run typecheck` — Expected: no output, exit 0.
Run the NUL/BOM check from Global Constraints over: `src/components/entries/sitting-row.tsx src/components/entries/day-list.test.tsx` — Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add src/components/entries/sitting-row.tsx src/components/entries/day-list.test.tsx
git commit -m "feat(sittings): the parent row edits the work, not just discloses it"
```

---

### Task 6: Wire it, and take the note off child rows

**Files:**
- Modify: `src/components/entries/day-list.tsx`
- Modify: `src/components/entries/entry-row.tsx`
- Modify: `src/components/entries/entry-log.tsx`
- Test: `src/components/entries/day-list.test.tsx`

**Interfaces:**
- Consumes: everything Tasks 1–5 produce.
- Produces: `EntryRow` gains `showNote?: boolean` (default `true`); `EntryRowActions` gains `onSittingClassify: (entries: Array<Entry>, change: Partial<Classification>) => void` and `onSittingNoteOpen: (entries: Array<Entry>) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/entries/day-list.test.tsx`:

```tsx
describe("a sitting's members carry time, not prose", () => {
  it("renders no note line on a member row", () => {
    renderGroupedLog()
    fireEvent.click(screen.getByRole("button", { name: /show grouped entries/i }))

    // Both members are on screen with their own times...
    expect(screen.getByText("5:00 PM – 5:58 PM")).toBeTruthy()
    expect(screen.getByText("3:34 PM – 4:00 PM")).toBeTruthy()
    // ...and exactly one note control between them, on the parent.
    expect(screen.queryAllByRole("button", { name: /add note|Fixed the/i })).toHaveLength(1)
  })

  it("still renders the note on a lone entry", () => {
    // A row that is not part of a sitting is untouched by any of this.
    renderUngroupedLog()
    expect(screen.getByRole("button", { name: /\+ add note/i })).toBeTruthy()
  })

  it("hands every member to the classify action", () => {
    const onSittingClassify = vi.fn()
    renderGroupedLog({ onSittingClassify })

    fireEvent.click(screen.getByLabelText("Not billable"))

    expect(onSittingClassify).toHaveBeenCalledWith(
      [expect.objectContaining({ _id: NEWEST_ID }), expect.objectContaining({ _id: OLDEST_ID })],
      { billable: true }
    )
  })
})
```

> **Resolve against the real file.** Reuse the fixtures and render helpers the grouped-entries tests in this file already have. The time strings above must match what `formatTimeRange` actually produces for the fixture — `formatClock` never pads the hour in this codebase, so `2:00:00` not `02:00:00`, and the same care applies to AM/PM rendering.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: FAIL — members still render their own notes.

- [ ] **Step 3: Give `EntryRow` a way to omit its note**

In `src/components/entries/entry-row.tsx`, add to the props:

```tsx
  /**
   * Whether this row carries its own note.
   *
   * FALSE FOR A SITTING'S MEMBERS, and only there. The note belongs to the
   * piece of work rather than to each interval of it, so the parent carries it
   * and the members carry times — see `sitting-row.tsx`. Defaults true, so
   * every other caller in the product is unaffected and a row rendered without
   * thinking about this still behaves the way it always has.
   *
   * The row is SHORTER without the slot, deliberately: the fixed 20px box
   * exists to stop a day of mixed written/empty notes rippling, and a member
   * row has no note to be mixed about.
   */
  showNote?: boolean
```

Destructure it with `showNote = true`, and wrap the note block (`entry-row.tsx:195-274`, the whole `<div>` holding both states) in `showNote ? ( … ) : null`.

- [ ] **Step 4: Wire `DayList`**

In `src/components/entries/day-list.tsx`, pass the new props to `SittingRow`:

```tsx
                  <SittingRow
                    sitting={item}
                    timeZone={timeZone}
                    use12Hour={use12Hour}
                    projects={projects}
                    tags={tags}
                    display={display}
                    expanded={isOpen}
                    notesExpanded={notesExpanded}
                    onToggle={() => toggle(stateKey)}
                    onResume={() => actions.onResume(item.entries[0])}
                    onClassify={(change) => actions.onSittingClassify(item.entries, change)}
                    onNoteOpen={() => actions.onSittingNoteOpen(item.entries)}
                    onCreateProject={actions.onCreateProject}
                    onCreateTag={actions.onCreateTag}
                    controls={panelId}
                  />
```

and render the members without notes. The `row` helper takes the entry today; give it a second argument:

```tsx
                      {item.entries.map((entry) => row(entry, false))}
```

with `row` becoming `(entry: Entry, showNote = true) => …` and forwarding `showNote={showNote}` to `EntryRow`.

- [ ] **Step 5: Wire `EntryLog`**

In `src/components/entries/entry-log.tsx`, add the two sitting actions beside `onNoteOpen`:

```tsx
    onSittingClassify: (entries, change) => {
      void updateMany({
        entryIds: entries.map((entry) => entry._id),
        ...change,
        // `projectId` is already `Id | null` in `Classification`, which is the
        // shape `updateMany` takes — null clears, absent leaves alone.
      }).catch(() => {
        // Same reasoning as the row's own classify: never interrupt the reader
        // to report that a tag did not stick.
      })
    },
    onSittingNoteOpen: (entries) => {
      setNoteTarget({
        entryIds: entries.map((entry) => entry._id),
        // The day is not available here, and does not need to be: a sitting
        // cannot cross a day boundary, so title + project is unique within the
        // set of entries this log is rendering.
        key: `sitting\u0000${entries[0].title.trim()}\u0000${entries[0].projectId ?? ""}`,
        title: entries[0].title,
        note: joinNotes(entries),
        totalMs: entries.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
      })
      setNoteOpen(true)
    },
```

Add both to the `EntryRowActions` type in `entry-row.tsx`.

> `\u0000` is the **escape**, not a raw NUL byte. Typing the byte itself makes the file read as binary to `grep` and is invisible in an editor — it has already happened once on this feature.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: PASS.

- [ ] **Step 7: Full suite, typecheck, artifact scan**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: no output, exit 0.
Run the NUL/BOM check from Global Constraints over: `src/components/entries/day-list.tsx src/components/entries/entry-row.tsx src/components/entries/entry-log.tsx src/components/entries/day-list.test.tsx` — Expected: no output.

- [ ] **Step 8: Confirm the invariant one last time**

Run: `npx vitest run convex/entries.edit.test.ts && git status --short convex/entries.edit.test.ts`
Expected: PASS, and no output from `git status`.

- [ ] **Step 9: Verify it in the browser**

`npx convex dev` must be running, or `settings.get` and the new mutation will fail against a stale deployment.

1. Open `/timer`. Start and stop the same title twice, with no project.
2. Write a note on the group. Confirm it appears once on the parent and that expanding shows two members with times and no note line.
3. Collapse, reload, expand. Confirm the note survived on both members.
4. Pick a project that bills by default. Confirm the `$` lights immediately and every member reads billable when expanded.
5. Pick a project that does not bill by default. Confirm no member's `$` goes out.
6. Turn off "Group a day's repeats" in `/settings`. Confirm both rows show the same note and each is editable on its own again.

- [ ] **Step 10: Commit**

```bash
git add src/components/entries/day-list.tsx src/components/entries/entry-row.tsx src/components/entries/entry-log.tsx src/components/entries/day-list.test.tsx
git commit -m "feat(log): the sitting carries the prose, its members carry the time"
```

---

## Self-Review

**Spec coverage.**

| Spec decision | Task |
| --- | --- |
| Note stored per entry, unchanged | 2 (server), 3 (client) — no schema change anywhere |
| Written on the parent only | 4 (sheet takes a target), 5 (parent's note control), 6 (members lose theirs) |
| Parent's display == the editor's opening string | 1 (`joinNotes`), 5 (parent renders it) |
| Differing notes joined oldest-first | 1 |
| Saving writes to every member atomically | 2 |
| Lone entry keeps its own note | 6 (`showNote` defaults true) |
| Grouping off — every row edits its own note | 6 (no parents exist, `showNote` stays true) |
| Project writes through to every member | 5, 6 |
| Billable inheritance, on only, client-derived | 5 (`chooseProject`) |
| Tag union | 1 (`tagUnion`), 5 (picker opens on it) |
| Billable lit only when all members are | 1 (`allBillable`), 5 |
| `"N of M noted"` off the parent | 5 |
| Title not editable from the parent | Out of scope in the spec; no task touches it |
| `entries.updateMany` reusing `updateImpl` | 2 |
| `entries.edit.test.ts` green and unedited | 2 step 5, 6 step 8, and Global Constraints |

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Five steps flag an assumption about an existing harness — the `group-sittings.test.ts` entry factory, this project's Convex error helper and test idioms, `note-sheet.test.tsx`'s accessible names, `day-list.test.tsx`'s grouped-entries fixtures, and `formatTimeRange`'s exact output — and each says how to resolve it against the real file while forbidding changing the component to suit the test.

**Type consistency.** `joinNotes` and `tagUnion` are named identically in Tasks 1, 4, 5 and 6. `NoteTarget`'s five fields are the same in Task 4's definition and Task 6's construction. `updateMany`'s argument object is the same shape in Task 2 (`updateManyArgs`), Task 3 (the client callback) and Tasks 4 and 6 (call sites). `Partial<Classification>` is the change type in `SittingRow.onClassify` (Task 5), `EntryRowActions.onSittingClassify` (Task 6) and `EntryLog`'s handler (Task 6). `showNote` is the prop name in Tasks 3, 4 and 6.

**Ordering.** 1 → 5 (derived fields before the row that renders them). 2 → 3 → 4 and 6 (server, then client, then callers). 5 → 6 (the row before its wiring). Tasks 1 and 2 are independent of each other and could run in parallel.

**Known risk carried from the spec.** The parent becomes the densest row in the product. Task 5 step 6 says to check narrow widths and drop controls the way `EntryRow` already does, but if the row cannot be made to work at `sm`, that is a design problem this plan does not solve and it should stop the task rather than be worked around.
