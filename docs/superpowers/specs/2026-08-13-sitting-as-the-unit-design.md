# The sitting as the unit

**Date:** 2026-08-13
**Supersedes parts of:** [2026-08-13-grouped-entries-design.md](2026-08-13-grouped-entries-design.md)

## The observation

Grouped entries shipped, and the first real sitting it drew looked like this:

```
∨ 2  [B-CB-343] Fixing Logbook 12-hour clock time input   2 of 2 noted  3:34 PM – 5:58 PM  1:24:00
     [B-CB-343] Fixing Logbook 12-hour clock time input
     Fixed the 12-hour clock hours field across every Logbook time entry…   5:00 PM – 5:58 PM  0:58:00
     [B-CB-343] Fixing Logbook 12-hour clock time input
     Fixed the 12-hour clock hours field across every Logbook time entry…   3:34 PM – 4:00 PM  0:26:00
```

The same note, twice. Nothing in this product copies a note — `resume`,
`onDuplicate` and title-autocomplete all exclude it deliberately, and each says
why. `use-entry-mutations.ts:146` on resume: "The note describes what happened
during that specific interval, so copying it forward would put a false account
on a block of time nobody has done yet." `use-entry-actions.ts:130` on
duplicate, making the same point about a second row.

So it was typed twice, by hand. That disproves an assumption the grouped-entries
spec rested on:

> two entries sharing a title usually carry *different* notes, because that is
> the intended workflow

For one ticket worked in two sittings, the account of what got done is one
account. The entries are two because the timer stopped, not because the work
divided.

## The principle

**The sitting is the unit of work; the entries under it are the unit of time.**

Grouping remains a disclosure and not a merge — nothing is rewritten behind the
user's back, nothing new is stored, and every entry keeps its own times. What
changes is where *classification* lives. Times are per-entry facts. The note,
the project, the tags and the billable flag are facts about the work, and the
work is the sitting.

## What this supersedes

| Grouped-entries decision | Now |
| --- | --- |
| Parent row abilities: *"Disclosure and resume only. No edits."* | The parent is the editor for note, project, tags and billable |
| *"Why no tags or billable mark on the parent"* — both can differ, a mark meaning "some of these" means nothing | Both appear on the parent. Nothing stays mixed once touched |
| Parent carries `"1 of 2 noted"` so a missing note stays visible | Parent carries the note itself, or `+ add note` |
| *"this feature adds no new mutations"* | One new mutation, `entries.updateMany` |

The grouped-entries spec's other decisions stand unchanged: the grouping key,
the day scope, the `groupEntries` setting and its default, collapsed-initially,
and the parent's earliest-start-to-latest-end span.

## Decisions

| Question | Decision |
| --- | --- |
| Where a note is stored | Per entry, exactly as today |
| Where a note is written | For a sitting, the parent only — child rows show no note and no add-note control. A lone entry keeps its own note, exactly as today |
| Parent's note display | Exactly the string the editor opens with |
| Members' notes differ | Joined oldest-first; the user edits down |
| Saving a note | Writes that text to every member, atomically |
| Grouping turned off | No parents exist, so every row is a plain row that shows and edits its own note, exactly as before this change. A sitting written through the parent reads as the same note on each of its rows, honestly |
| Project on the parent | Writes through to every member |
| Project bills by default | Sends `billable: true` for every member, client-derived |
| Project does not bill by default | Sends no `billable` at all; each member's flag is untouched |
| Tags on the parent | The union. Editing writes the edited set to all members |
| Billable on the parent | Lit only when *every* member is billable |
| Title on the parent | Out of scope |

### Why storage stays per-entry

Three things in the shipped code read a note off an entry, and moving notes onto
groups breaks each:

- `convex/lib/entryFilter.ts` — the `no-note` filter preset tests `entry.note`.
  Group-owned notes would report every row of a fully-noted day as unnoted.
- `entry-row.tsx` — titles are editable inline. The group key is trimmed title
  plus `projectId`, so retitling one member moves it out of its group. A note
  keyed to the group would be orphaned against a title nothing matches, from one
  ordinary click.
- The `groupEntries` setting can be turned off, which would make group-owned
  prose unreachable.

Per-entry storage costs nothing: the user still writes once and sees once,
because that is enforced by the UI rather than by the schema. The PDF export,
invoice line items, the `no-note` chip and the note sheet all keep working
untouched.

### Why nothing is joined destructively

`PRODUCT.md` calls the note the reason the product exists. A group whose members
carry genuinely different prose must never resolve that by picking a winner
behind the user's back, because the losing text is exactly what the product is
for. Joining oldest-first puts every word on screen before anything is written,
and the user edits down to what they meant. The first save of such a group is
the only moment prose changes, and it changes in front of them.

### Why billable only ever turns on

Task 5 established that an entry which already exists never re-inherits its
project's billable default. `convex/projects.ts` gives the reason — doing so
"destroys the record of a decision" — and `convex/entries.edit.test.ts` guards
it by name: *"does not re-inherit billable when the project changes"*.

Setting a project on a sitting is a project change on existing entries, so that
rule applies. It reconciles in two moves:

1. **The client derives and sends `billable` explicitly**, exactly as
   `timer-bar.tsx` now does for the idle bar. The server still never re-derives,
   so the invariant holds literally rather than by interpretation, and what the
   `$` shows is provably what was written.
2. **Inheritance only ever turns billable on.** A billable-by-default project
   marks every member billable; a non-billable project leaves every flag alone.
   Adding a billable mark destroys no decision. Removing one would.

A user who wants a sitting un-billed clicks the parent's own toggle, which is an
explicit act with an undo behind it — not an inference drawn from a project.

## Behaviour

**The parent row** carries the note under its title, styled as a plain row's and
honouring the existing full-notes / clipped mode, plus a project picker, tag
picker and billable toggle. Expanding reveals every child with its own times,
project dot, billable mark, tags and controls — but no note line and no
add-note affordance.

**One rule for the parent's note line:** it is exactly the string the editor
would open with. Zero distinct member notes renders `+ add note`; one renders
it; two or more renders them joined oldest-first, clipped like any other note.
There is no display state to learn that is not also an editing state.

**`"N of M noted"` comes off the parent.** It existed so a missing note stayed
*visible rather than absent*. With one note per sitting the count can only read
`0 of N` or `N of N`, and `+ add note` states absence more directly. The day
header's own count is unaffected — it counts entries, and is still exact.

## Architecture

### `entries.updateMany`

One new Convex mutation, taking the field set `entries.update` already takes:

```ts
{ entryIds: Array<Id<"timeEntries">>, note?, projectId?, tagIds?, billable? }
```

It loops the existing per-entry impls rather than restating ownership checks or
trimming. Convex mutations are transactions, so a sitting is written all-or-
nothing: one write, one optimistic update, one undo toast. A partial failure
would leave members disagreeing — the exact state this design exists to
eliminate — so atomicity is the requirement, not a nicety.

Two bulk mutations differing only in which fields they carry would be a seam
with nothing behind it, which is why the note path and the classification path
are one function.

`entries.update` and `entries.setNote` are untouched on the server — both stay,
and `entries.setNote` is still covered by `convex/entries.edit.test.ts`. Plain
rows' non-note edits (title, project, tags, billable) and the calendar popover
keep calling `entries.update` exactly as before, genuinely unchanged.

The note sheet's own path is where this drifts from the plan above: with a
one-member target and a many-member target now sharing one `onSave`, the sheet
always calls `updateMany` — including for a lone entry, where that is
`entries.update`'s note-writing semantics applied to a one-element list, not
`entries.setNote`. The two are behaviourally equivalent — both `normaliseNote`,
both length-check — so a plain row's note keeps working, just not literally
"exactly as they do." One path replaced two, which is the better shape now
that both existed side by side.

### Client

`useEntryEditMutations` gains `updateMany`, mirroring its single-entry
neighbours including the optimistic update — `patchEverywhere` per id, with the
same `undefined`-not-`""` note normalisation, so the noted counts do not flicker
while the mutation is in flight.

`group-sittings.ts` gains the derived fields the parent needs, as pure functions
beside the existing aggregates: the distinct member notes joined oldest-first,
the tag union, and whether every member is billable.

`NoteSheet` is reused unchanged. Only its `onSave` differs — one id from a row,
many from a sitting.

## Out of scope

- **Editing the title from the parent.** Renaming through the group is the one
  rename that cannot split a sitting, which makes it genuinely attractive, but it
  interacts with the group key and deserves its own design.
- **Reconciling members automatically.** Nothing rewrites a group the user has
  not touched. A group with differing notes stays that way until they open it.

## Testing

- `group-sittings.test.ts`: the joined-notes string, the tag union, and the
  all-billable flag, over groups that agree, disagree, and have no notes at all.
- Convex tests for `updateMany`, including the authorization case — ids
  belonging to another user are refused and the whole transaction rolls back,
  leaving no partially-written sitting.
- Component tests: the parent's pickers write through to every member; child
  rows render no note line; a billable-by-default project marks all members
  billable; a non-billable project leaves every flag untouched.
- `convex/entries.edit.test.ts` stays green **and unedited**, the same tripwire
  Task 5 used. Needing to change it means the implementation re-derived on the
  server and went further than this design allows.

## Risks

**The first save of a mixed group is a real edit.** A user who opens a sitting
whose members carry different prose sees them joined, and saving normalises all
members to what they leave behind. This is intended and visible, but it is the
one moment this feature changes prose.

**The undo toast is a true inverse only for the ordinary case.** `handleDismiss`
captures `previous = target.note` — the joined string the sheet opened with —
and undo writes that back to every member. For the case this feature exists to
serve, the same note typed twice, `previous` equals what every member already
held, so undo genuinely restores it. For a GENUINELY mixed sitting, `previous`
is already the join: undo can put the joined text back, but it cannot restore
which words belonged to which member — that split was lost the moment the save
went out, not the moment undo runs. The text is recoverable; the pre-edit
per-member division is not.

**The parent becomes the densest row in the product** — disclosure, title, note,
project, tags, billable, span, total and resume. The layout needs to survive
that at narrow widths, where a plain row already wraps.
