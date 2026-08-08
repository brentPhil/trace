# The entry time popover, and the fourth reconciliation rule

*2026-08-08*

## What it replaces

An entry row carried two inline text fields, start and end (`EditableTimeRange`).
They had two problems.

They were `hidden sm:inline-flex`, so **an entry's times could not be corrected
on a phone at all** — the field simply was not rendered.

And they could not express a **date**. `parseStart` pinned `dayOffset: 0` with a
comment saying that honouring an offset would "silently move the entry to
another day, and therefore out of the total the user is looking at." That
reasoning was right about a *typed time* — 09:15 is not a request to change the
date — but it left the product with no way to fix "I logged this on the wrong
day" short of deleting and re-creating the entry.

A calendar is not silent. The capability arrives with a control that shows what
it is about to do.

## The blocker, and the fourth rule

The obvious implementation does not work. `applyTimeEdit` with `field: "start"`
holds the **end** fixed and recomputes the duration, and `capEditedDuration`
applies the 24-hour ceiling. So "same times, yesterday" via a start edit
produces a ~25-hour entry and is refused with `DURATION_TOO_LONG`. Chaining two
edits (start, then end) hits the same refusal on the first one, and is not
atomic.

So re-dating needed its own rule. It was added **to** `applyTimeEdit` rather
than beside it, because that file is "the sole writer of the time fields on an
entry, which is what makes the durationMs denormalisation safe" — a second
writer next to that sentence would falsify it.

```
Edit start    -> duration recomputes. End does not move.
Edit end      -> duration recomputes. Start does not move.
Edit duration -> END moves. Start is anchored.
Edit day      -> START moves to the new date. DURATION is anchored,
                 so the end travels with it.
```

Anchoring the duration is the load-bearing half: **a date correction must not
change what gets invoiced**, and it must survive a move onto a DST day. It is
also deliberately *not* passed through `capEditedDuration` — the duration is
unchanged, so a runaway timer that legitimately ran for sixty hours stays
movable. The ceiling is for lengths a user types, and nobody typed this one.

`value` is the new **start instant**, resolved by the caller: turning a picked
date into an instant needs a timezone and a DST policy, which live in
`convex/lib/day.ts`, not in the pure time module.

Because `applyTimeEdit` is shared across the wire, the optimistic update comes
free and provably cannot disagree with the server.

**One hole closed on the way.** `editTimeImpl` clamps a future `start` on a
running entry, because a start ahead of the clock renders 0:00:00 forever. `day`
reaches the same field by another name, so it is clamped too — otherwise
re-dating would have been the documented way around a guard the field beside it
enforces.

## The control

`EntryTimePopover` replaces both inline fields, and is visible at every width.

- **START and STOP stay text fields** and keep `parseTimeOfDay`. `0915` and
  `2pm` are why the old fields were quick; a calendar must not cost the fast
  path. They commit through the existing `editTime` start/end.
- **STOP is `…` and non-editable while running**, keeping the existing rule that
  typing an end time is a stop and stopping belongs to the button that says
  Stop. Currently unreachable on this surface — `groupByDay` puts only completed
  entries in `entries`, so the log never draws a running row — but the component
  is typed generally and the branch has to be total.
- **The grid starts on `weekStartDay`** from userSettings, so the calendar and
  the week totals agree about where a week begins.
- **Padding cells are blank, not the neighbouring months' dates.** A clickable
  31 July under an "August" heading is a date you can select without noticing
  the calendar has moved.
- **The grid is a real `<table>`** with `<th scope="col">`. A date grid *is*
  tabular — the column carries the weekday — and that says so without ARIA.
- The date reads `Fri 7 Aug`, not `08/07`, matching the day headers. `08/07` is
  ambiguous between August 7th and July 8th to half the world.

`monthGrid` is a separate pure module and is tested hard, because a calendar is
wrong in ways nobody notices until a particular month arrives: the leap day, the
month needing a sixth row, the one that fits in four.

## Moving days, and saying so

Re-dating is the only edit that takes a row off the screen it was made on. Two
things follow.

**The optimistic layer needed a new writer.** `patchEverywhere` rewrites a row
wherever it finds it but never evicts one, so a moved entry would sit on the old
day until the server replied. `moveEverywhere` locates the row once, then for
every loaded range drops it, inserts it, or leaves the range alone — the
decision extracted into `rangeAfterMove`, which is pure and where the half-open
boundary lives.

**The user gets a sentence.** "Moved to Fri 7 Aug", with undo, using the same
label as the day headers. Undo carries the original **start instant**, not the
original day: re-deriving it would re-resolve the offset and could land an hour
out across a DST boundary, putting the entry back somewhere it never was.

## Not verified in a browser

Nothing here has been driven in a real browser. The worktree has no
`.env.local`, and the Convex deployment the parent repo points at does not have
these functions — `editTime` with `field: "day"` would be rejected by the
deployed validator until `convex dev` pushes it. Pushing a schema change to a
live deployment is the owner's call, not something to do in passing.

Covered instead: 424 tests across the three projects, including the rule itself
(duration anchored, DST both directions, the >24h case), the mutation, the month
grid, the range arithmetic, and ten DOM tests over the popover — three of which
were confirmed to fail when the behaviour they name is broken.
