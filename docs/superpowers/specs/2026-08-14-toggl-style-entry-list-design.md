# Toggl-style entry list and batch deletion

**Date:** 2026-08-14  
**Status:** approved for implementation

## Goal

Make the time-entry log scan and behave like Toggl Track's list without losing
Chroneli's notes, inline editing, grouped sittings, or quiet visual character.
The change has five visible outcomes:

1. grouped-sitting disclosures show their count without a chevron;
2. days read as clearly separated full-width sections;
3. entry titles are larger and easier to scan;
4. entries, sittings, and whole days can be selected for batch deletion; and
5. every day total aligns exactly with the durations beneath it.

The reference is Toggl's information hierarchy and interaction model, not a
pixel-for-pixel copy of its colors or typography. Existing Chroneli tokens and
the Darkroom design system remain authoritative.

## Decisions

| Question | Decision |
| --- | --- |
| Selection control | Checkboxes, not radios, because multiple records may be selected |
| Row checkbox visibility | Contextual on hover/focus; persistent once selected; always visible on non-hover/touch input |
| Day checkbox | Always visible; selects every loaded record in that day |
| Sitting checkbox | One parent checkbox represents every underlying entry |
| Partial selection | Indeterminate state on day and sitting checkboxes |
| Bulk actions | Sticky compact bar with selected count, Delete, and Clear selection |
| Delete behavior | Immediate soft delete with one Undo; no confirmation dialog |
| Delete consistency | One atomic Convex mutation for the complete selected set |
| Selection lifetime | Local UI state only; resets on reload |
| Disclosure | Number-only button; no chevron icon |
| Title scale | Existing 1rem medium-weight title token |
| Duration alignment | Shared fixed trailing column for day totals, sitting totals, and entry durations |

## Layout and visual hierarchy

### Shared row grid

Day headers, sitting rows, and entry rows use the same horizontal geometry:

```text
[selection] [count, when grouped] [title / note / classifiers] [time range] [duration] [row actions]
```

The implementation may use CSS grid or shared width tokens, but there must be
one source of truth for the trailing columns. The duration column is fixed,
right-aligned, monospaced, and tabular. The day total occupies that same column
and right edge. Action space remains reserved so hover-revealed controls do not
move the duration.

The selection column is also permanently reserved. Hiding an unselected row's
checkbox changes opacity/visibility, not layout, so titles never jump when the
pointer enters a row or selection begins.

On narrow screens, secondary information disappears in this order: tags,
project detail where already permitted by existing responsive rules, then the
time range. The selection control, title, and duration remain reachable and
aligned. Because touch devices have no reliable hover, row checkboxes are
visible when the primary pointer cannot hover.

### Day sections

Each day is a distinct edge-to-edge section. A stronger full-width separator
and the existing deliberate inter-day breathing room make the boundary visible
before the label is read. This replaces the current low-contrast transition
without introducing cards or nested surfaces.

The day header remains sticky and contains:

- an always-visible checkbox;
- the day label and existing noted count;
- the day total in the shared duration column.

The checkbox is checked when every entry ID in the day is selected,
indeterminate when only some are selected, and unchecked otherwise. Toggling a
checked or indeterminate day clears that day's IDs; toggling an unchecked day
selects all of them.

### Entry and sitting rows

Entry titles move from the current small row size to the established `1rem`,
medium-weight title scale. Notes remain smaller and muted, preserving the
title/note hierarchy and existing expanded-note mode.

An unselected entry checkbox appears when its row is hovered or contains
keyboard focus. Once checked it remains visible. The checkbox itself is a real
focusable control with an entry-specific accessible name.

A grouped sitting reserves the existing count position, but its disclosure is
a number-only button. `aria-expanded`, `aria-controls`, and the current
Show/Hide accessible labels preserve the disclosure semantics without a visual
chevron.

The sitting checkbox is separate from the disclosure count. Selecting the
parent selects every member entry, including members hidden while collapsed.
When expanded, every member's checkbox reflects the same underlying ID set, so
selection cannot disagree between parent and children. A partial member
selection makes the parent indeterminate.

Existing title/time editing, note editing, classifier pickers, billable toggle,
resume, duplicate, single-row delete, and grouped-sitting expansion remain
functional. Clicking a checkbox must not trigger any row editor or disclosure.

## Selection model

`EntryLog` owns a `Set<Id<"timeEntries">>` containing selected entry IDs. It is
the correct boundary because it sees all rendered day groups and already owns
log-wide actions, while `DayList`, `SittingRow`, and `EntryRow` should remain
renderable from fixtures.

`EntryLog` derives the set of currently rendered live IDs from `groups`. When
reactive data, pagination, or filtering removes an ID from the rendered log,
that stale selection is pruned before a delete can be issued. Loading more rows
does not implicitly select them: a day select-all action selects the entries
represented by the day at the moment the user invokes it.

`DayList` receives selection state and callbacks rather than owning a second
set. For each visual item it computes the IDs represented by that item:

- a lone entry represents `[entry._id]`;
- a sitting represents all `sitting.entries` IDs; and
- a day represents all `group.entries` IDs.

A small pure helper should determine `unchecked`, `checked`, or `indeterminate`
from a represented ID array and the selected set. This keeps the three checkbox
levels on one definition and makes the behavior independently testable.

## Bulk-action bar

When selection is non-empty, a compact sticky action bar appears without
moving the list. It contains:

- `N records selected`, where `N` counts underlying entries rather than visual
  sitting rows;
- a destructive `Delete` action; and
- `Clear selection`.

The bar follows the existing semantic z-index scale and does not cover the last
record: the scroll container receives enough conditional end padding to keep
the final row visible above it. Focus moves predictably after an action. Clear
selection returns focus to the most recent selection control when that control
still exists; after Delete, focus moves to the Undo action in the toast or the
nearest stable list control.

## Atomic deletion and Undo

Batch deletion adds explicit `removeMany` and `restoreMany` operations rather
than firing the existing single-record mutation repeatedly. A loop of client
requests could partially succeed and would create competing Undo windows; one
Convex mutation provides the required all-or-nothing transaction.

`removeMany` accepts a non-empty validated array of time-entry IDs. The handler:

1. derives the authenticated user on the server;
2. resolves every requested entry and verifies ownership before completing;
3. applies the same soft-delete and running-entry closing rules as `remove`;
4. writes all changes in the same transaction; and
5. returns the IDs actually removed.

The shared delete implementation must keep `remove` and `removeMany` on the
same rules rather than duplicating behavior. Convex transaction rollback means
an authorization, validation, or write failure leaves the complete selection
unchanged.

`restoreMany` is the matching authenticated transaction. It restores the
complete deleted set using the same completion and time-normalization behavior
as the current single-entry `restore`. The client captures the selected entry
snapshots before deletion, both for an accurate toast and for the existing
optimistic-cache restoration pattern.

The optimistic update removes all selected rows from every relevant paginated
list cache as one operation and updates the running-entry query if needed. One
toast reports `Deleted N records` with one Undo action. Undo restores the entire
set; a failure on delete or restore raises the existing high-priority error
message. Selection clears only after the delete request is accepted for
execution, and a failed delete restores or retains a usable selection so the
user can retry.

No hard delete is introduced. No selection state is written to Convex.

## Accessibility and interaction details

- Every checkbox has a visible focus indicator and an accessible name that
  identifies its entry, sitting, or day.
- Native checkbox semantics expose checked and indeterminate states; the DOM
  `indeterminate` property is synchronized after render.
- The number-only sitting disclosure retains `aria-expanded` and
  `aria-controls`.
- Bulk-selection changes are announced through the existing announcer/live
  region without announcing every member ID.
- Hover-only visibility never makes a control pointer-only: `:focus-visible`,
  `:focus-within`, selected state, and non-hover media conditions reveal it.
- Delete and Clear selection are keyboard operable, and Escape clears the
  current selection when focus is within the log or action bar.
- Color is not the only selected-state indicator; the checkbox mark and
  accessible state carry the meaning.

## Component boundaries

```text
EntryLog
  owns selectedIds and bulk-delete orchestration
  |
  +-- BulkEntryActions
  |     selected count, Delete, Clear selection
  |
  +-- DayList
        derives day/sitting/row checkbox states
        |
        +-- SittingRow
        |     sitting checkbox + number-only disclosure
        |
        +-- EntryRow
              contextual entry checkbox

useEntryActions / useEntryEditMutations
  expose atomic removeMany + restoreMany with optimistic updates and Undo

convex/entries.ts
  shared authenticated soft-delete/restore helpers
  public removeMany + restoreMany mutations
```

`BulkEntryActions` is separate because its responsibility and focus behavior
are log-wide. Checkbox rendering may be a focused shared component if that is
the smallest way to keep indeterminate handling, accessible labels, and reveal
styles identical across all three levels.

## Error and edge-case behavior

- Empty selection never calls the backend.
- Duplicate IDs are normalized before mutation.
- IDs no longer present in the rendered groups are pruned before deletion.
- If a selected entry changes title, day, project, or sitting membership while
  remaining rendered, its ID stays selected and the new visual parent derives
  the correct state.
- Collapsing or expanding a sitting never changes selection.
- Changing filters may reduce or clear selection as selected IDs leave the
  rendered result; hidden filtered records are never silently deleted.
- A running entry, if selectable on a surface that renders it, follows the
  existing `remove` rule: it is closed with a real end time and soft-deleted in
  the same transaction.
- Backend failure leaves the list and totals consistent through optimistic
  rollback and presents one high-priority error, not one error per record.
- Single-entry deletion remains available and keeps its current title-specific
  Undo toast.

## Testing

### Pure selection tests

- no represented IDs selected -> unchecked;
- every represented ID selected -> checked;
- some represented IDs selected -> indeterminate;
- toggling a checked or indeterminate group clears all represented IDs;
- toggling an unchecked group selects all represented IDs; and
- duplicate/stale IDs are normalized or pruned as specified.

### Component tests

- day checkbox selects and clears every entry in that day;
- partial day selection renders an indeterminate day checkbox;
- sitting checkbox selects hidden members while collapsed;
- expanding a selected sitting shows every member checked;
- partial member selection renders an indeterminate sitting checkbox;
- row checkbox is retained in layout, contextual on hover/focus, persistent
  when selected, and visible under non-hover conditions;
- selected count reports underlying records, not visual rows;
- Clear selection clears all checkbox levels;
- Delete sends the exact deduplicated live IDs and clears selection on success;
- the action bar exposes correct names, keyboard order, Escape behavior, and
  enough scroll padding not to obscure the last row;
- sitting disclosure renders the number with no chevron while preserving its
  accessible expanded state;
- day headers and rows share the duration-column contract; and
- entry titles use the established title scale at desktop and narrow widths.

Existing grouped-sitting, note, inline-edit, classifier, resume, duplicate, and
single-delete tests must remain green.

### Hook and optimistic-cache tests

- `removeMany` removes all selected IDs from every loaded paginated page in
  one optimistic pass;
- rollback restores all rows after a rejected mutation;
- `restoreMany` re-inserts the complete snapshot without duplicates; and
- a selected running entry updates the running query consistently.

### Convex tests

- all owned live entries are soft-deleted atomically;
- the mutation rejects an empty selection;
- duplicate IDs do not cause duplicate work;
- a missing or foreign-owned ID aborts the entire mutation with no partial
  writes;
- an already-deleted entry is handled idempotently under the shared rule;
- a running entry is closed and deleted under the existing semantics;
- `restoreMany` restores the complete set atomically; and
- unauthenticated calls are refused.

## Out of scope

- Persisting selection across reloads or routes.
- Selecting entries that have not been loaded by pagination.
- New bulk actions besides Delete.
- Replacing Chroneli's colors, typefaces, note model, or classifier controls
  with Toggl's.
- Changing sitting grouping keys or storing a sitting as a backend document.
- Hard deletion or a trash-management screen.
