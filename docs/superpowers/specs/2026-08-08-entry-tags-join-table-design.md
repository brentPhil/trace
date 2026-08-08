# The `entryTags` join table

*2026-08-08*

## The problem

`tags.removeImpl` refused to delete a tag while any live entry carried it —
the same contract as `projects.remove`, and for the same reason: no dangling
reference means entries need no denormalised copy of the tag name, which is what
makes a rename fix every historical row.

Projects can prove that cheaply. `by_user_project` indexes the reference, so the
check reads only the entries filed against that one project. Tags could not:
Convex cannot index array membership, and an entry carries its tags as a
`tagIds` array. Proving a tag unused therefore meant reading **every entry in
the account**, and an unbounded `.collect()` over a long history exceeds the
per-transaction byte limit.

The scan was bounded at `ENTRY_SCAN_LIMIT` (2,000) to avoid that. Because the
bound could not be filtered by tag, saturating it had to be treated as "cannot
prove this is unused" — a refusal. The consequence, documented honestly on
`removeImpl` but still a real defect:

> once an account passes 2,000 entries, tag deletion refuses for **every** tag,
> permanently — including a tag created that morning and used on nothing.

Renaming still worked. Deleting simply stopped.

## The change

Add the index Convex would not build.

```ts
entryTags: defineTable({
  userId: v.string(),
  entryId: v.id("timeEntries"),
  tagId: v.id("tags"),
})
  .index("by_user_tag", ["userId", "tagId"])
  .index("by_user_entry", ["userId", "entryId"]),
```

`userId` leads both indexes, matching the schema's existing rule that ownership
is a key prefix rather than a filter someone can forget.

**A row exists exactly when a live entry carries the tag.** There is deliberately
no `deletedAt` column: liveness in a column would put a filter back *after* the
index, and the whole point is that the first row found is the answer. It also
preserves the existing tested rule that a tag carried only by trashed entries is
still deletable.

`tagIds` stays on `timeEntries`. Every entry render, `titleSuggestions` and the
autocomplete inheritance read it. This table is an index beside it, not a
replacement.

### One writer

`convex/entryTags.ts` is the sole writer. `syncEntryTags` **reconciles** — it
reads the entry's current rows and makes the table equal the given list. Three
properties fall out, all load-bearing:

- Retagging cannot leave a stale row. A stale row protects its tag forever on
  the strength of an entry that no longer carries it — a refusal the user could
  never act on, because the entry they'd be sent to fix is already correct.
- Calling it twice equals calling it once, which is what makes the backfill
  re-runnable.
- `[]` expresses "no longer live", so soft-delete needs no separate code path
  (`dropEntryTags` is a named alias for that call).

Call sites in `convex/entries.ts`:

| Path | Passes |
|---|---|
| `startImpl` after insert (not on the replay early-return) | `tagIds` |
| `createImpl` after insert (not on replay) | `tagIds` |
| `updateImpl`, only when `tagIds` was in the patch | the normalised list |
| `removeImpl`, only when it actually deletes | `null` → drop |
| `discardRunningImpl`, per discarded entry | `null` → drop |
| `restoreImpl`, only when it actually restores | `entry.tagIds` |

`stopImpl` and `editTimeImpl` change neither liveness nor tags, so they do not
call it. `maintenance.purgeUser` drains `entryTags` first, so a purge that runs
out of budget partway leaves the index describing rows that still exist rather
than rows that are gone.

### `tags.removeImpl`

```ts
const carrying = await ctx.db
  .query("entryTags")
  .withIndex("by_user_tag", (q) => q.eq("userId", userId).eq("tagId", tag._id))
  .take(ENTRY_SCAN_LIMIT + 1)
```

Finding nothing now **proves** the tag is unused. The saturation refusal is
deleted outright — there is no longer a case where the code cannot answer.

The `take` that remains bounds the **count**, not the answer. It reports how many
entries to go and fix, matching `projects.remove` including its "At least N"
wording once the number is a floor rather than a total. A join row is a userId
and two ids, so 2,001 of them is a rounding error against the byte ceiling — and
unlike the old scan, hitting this bound can only make a refusal vaguer, never
turn an unused tag into a refused one.

`ENTRY_SCAN_LIMIT` keeps one value for both callers, but its docstring now says
plainly that it means different things to each: a byte-safety limit for
`projects.remove`, a display cap for `tags.remove`.

## The backfill, and why it is gated

`convex/migrations.ts` holds `backfillEntryTags`, an internal mutation that
paginates `timeEntries` 200 at a time and calls `syncEntryTags` per row — live
entries get their rows, soft-deleted ones get theirs dropped. It returns its
cursor rather than looping internally, so one call is one bounded transaction
and a deployment with years of history cannot fail atomically and repair
nothing. `runEntryTagsBackfill` is the operator's loop:

```bash
npx convex run migrations:runEntryTagsBackfill
```

It is idempotent because `syncEntryTags` reconciles, so a restart after a
timeout needs no record of how far it got.

**This is a manual step, and nothing enforces it.** There is no cron and no
`postDeployCommand`; an operator has to run the command above. The gate below is
what makes forgetting safe rather than silently destructive, but it does not
make it self-healing, and the user-facing message deliberately promises no
timeline it cannot keep.

**The gate.** Between the schema landing and the backfill finishing, `entryTags`
is empty — and an empty index reads *exactly* like "nothing carries this tag".
Without a guard, the first person to tidy their tag list in that window deletes
tags a whole history references, and the entries are left pointing at rows that
are gone: precisely the dangling reference the refusal design exists to prevent.

So a `migrationState` row records completion, written only when the final page
reports done, and `tags.removeImpl` refuses until it exists. The check sits
*after* the ownership check, so another user's tag is still `NOT_FOUND` and
migration progress cannot be used to probe for ids that exist.

**A deployment with no entries at all is exempt, and marked complete on the
spot.** The gate's argument is that an empty index cannot be told apart from an
unindexed one; where `timeEntries` is also empty there is nothing to tell apart,
and the table is complete by virtue of covering nothing. Without the exemption
every fresh environment — a new dev instance, a preview branch, a first install
— would start wedged behind a migration over zero rows, which is a worse default
than the problem being guarded. It *records* completion rather than merely
allowing it, so the answer cannot flap: re-deriving emptiness per call would
mean tag deletion worked until the user tracked their first entry and then
silently stopped.

The refusal uses a new `NOT_READY` code rather than `IN_USE`. It says nothing
about the tag, and reading it as "in use" would send the user looking for
entries that do not exist. Renaming is **not** gated — it reaches every entry
through the id the entry already stores and never needed the index.

## Testing

All in `convex/classifiers.test.ts`, per the existing convention.

The consequential change is to the shared `entryOn` helper. It raw-inserted via
`t.run`, which was harmless while `tagIds` was the only link between an entry
and a tag. With the join table it is not: a raw insert writes no join row, so
every "REFUSES to delete a tag in use" test would have been asserting a refusal
against a tag the server could see no use of — passing for the wrong reason, and
then vacuously forever. It now goes through `internal.entries.createAs`, and its
`deleted` case through `entries.removeAs`.

New coverage: a row per tag on create and on start; reconciliation to exactly
the new set on retag; rows dropped on soft-delete and discard; rows restored on
undo; no duplicates on a replayed idempotent create, and no *resurrection* when
that replay follows a delete — which is the case that makes `createImpl`'s early
return load-bearing, since `syncEntryTags` is idempotent and the no-duplicates
test alone would pass without it; backfill over legacy rows, across page
boundaries, skipping trashed entries, and idempotent on a second run; the gate
closed before backfill and while only partly done, open for a deployment with no
history, and staying open once opened; rename ungated; purge draining the table;
the refusal following an entry's tags in both directions; restore re-arming the
refusal; and cross-user isolation.

Two tests carry the headline. The boundary test that used to assert *"refuses to
delete an unused tag once the account exceeds the scan limit"* is **inverted** —
it now deletes. And a new one puts the only entry carrying the tag at position
2,001, beyond where the old window ever reached, and asserts it is still found:
the sharpest available proof that the lookup is keyed by tag rather than by
position in history.

## Known wrinkles, unchanged by this work

Restoring an entry whose tag was deleted while the entry sat in the trash
re-creates a join row pointing at a soft-deleted tag. This is pre-existing
behaviour — the same sequence already left `tagIds` pointing at a deleted tag —
and it is not made worse here. Fixing it is a question about what restore should
do with vanished classifiers, which is a separate decision.

`convex/_generated/api.d.ts` was edited by hand to add the two new modules,
because `convex codegen` requires a configured deployment and none is available
in this environment. Running `npx convex dev` should reproduce it exactly.
