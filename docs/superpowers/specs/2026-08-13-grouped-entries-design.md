# Grouped entries, and the billable default the timer bar was dropping

**Date:** 2026-08-13
**Status:** implemented; **partly superseded**

> **Read [2026-08-13-sitting-as-the-unit-design.md](2026-08-13-sitting-as-the-unit-design.md) before acting on Part 1.**
> Shipping this revealed that two entries sharing a title usually carry the
> *same* note, not different ones — the opposite of the assumption Part 1 is
> built on, and the reason the parent row changed. The parent
> row is no longer read-only, it no longer shows `"N of M noted"`, and it now
> carries tags and a billable mark. The grouping key, the day scope, the
> `groupEntries` setting and the parent's span are unchanged.

Two changes, folded into one spec at the user's request. They share no files, but
they were raised in the same conversation and both concern what the log and the
timer bar claim about an entry.

1. **Grouped entries.** Repeated work on one title collapses into a single log
   row carrying a count, a span and a total, expandable to the entries beneath
   it — the Toggl affordance, adapted to a product where every entry also
   carries prose.
2. **The billable default.** Picking a project whose `billableByDefault` is set
   does not light the billable toggle in the timer bar, and — worse — the timer
   bar's explicit `billable: false` means the project's default is never applied
   at all on the app's primary start path.

---

## Part 1 — Grouped entries

### The tension this design is built around

PRODUCT.md states two things that pull against collapsing rows together:

> **Defensible by default.** […] The product never silently rounds, merges, or
> guesses on the user's behalf.

> **The note is the product.** Hours are commodity; what got done is the reason
> this exists.

Toggl can collapse entries freely because a Toggl entry holds nothing but a
label and a duration. Here, each entry carries a note — and two entries sharing
a title usually carry *different* notes, because that is the intended workflow.
Collapsing them naively hides the one thing the product exists to capture.

The resolution is that grouping is a **disclosure, not a merge**. No entry is
rewritten, combined, or re-keyed. Nothing new is stored. The parent row is a
rendering of rows that remain individually present, individually editable, and
individually reachable one click away — and the parent carries the day header's
`"1 of 2 noted"` phrasing so that a missing note stays *visible* rather than
becoming *absent*, which is the distinction PRODUCT.md draws.

### Decisions

| Question | Decision |
| --- | --- |
| Grouping key | Trimmed title + `projectId`, compared exactly, **case included** |
| Group scope | Within a single day; a group never crosses a day boundary |
| On/off | `userSettings.groupEntries`, **on** by default |
| Initial state | Collapsed; expansion is per-group, in memory, resets on reload |
| Parent row abilities | Disclosure and resume only. No edits. |
| Parent time column | Earliest start – latest end (Toggl's rendering) |

**Why case-sensitive.** `"Fixing dropdowns"` and `"fixing dropdowns"` stay
separate rows. Case-folding is a guess about intent, and the user can see the
two titles differ. This follows "never guesses on the user's behalf" literally.

**Why within a day.** Every day header's total stays the exact sum of what is
under it, and the group's span is a real span within one date. It also keeps the
log identical on `/timer` and `/reports`, which `day-list.tsx` states as an
invariant: *"This is the only list view in the product. Every 'report' is this
same view with a filter applied."*

**Why the parent cannot edit.** Duration and start/end have no meaning for a
group — editing `3:09:07` would have to pick a member to absorb the change — and
a note written on a parent would have to be copied onto N entries or stored
nowhere. Restricting the parent to disclosure and resume also means this feature
adds **no new mutations**: the entire write layer, `useEntryActions` included,
is untouched.

**Why no tags or billable mark on the parent.** Both can differ between
members, the parent cannot edit either, and a mark meaning "some of these" means
nothing. They stay on the child rows. Project is safe to show because it is part
of the key.

### Known consequence, recorded rather than hidden

The parent's span can exceed its total by the size of the gaps between
sittings. In the reference screenshot, `5:21 PM – 9:00 PM` is 3h39m of wall
clock against a total of `3:09:07`, the difference being a 30-minute gap.

This was raised explicitly and Toggl's rendering was chosen anyway, on the
grounds that the span answers "when in the day was this" at a glance and the
**total is the only figure that ever reaches an invoice**. Recorded here so that
a future reader finds a decision rather than a bug.

### Architecture

```
convex/schema.ts      userSettings.groupEntries?: boolean    (optional, additive)
convex/settings.ts    SETTINGS_DEFAULTS.groupEntries = true
        │
src/lib/group-sittings.ts    toLogItems(entries) -> Array<LogItem>   ← new, pure
        │
src/components/entries/day-list.tsx      grouped ? toLogItems(…) : flat
        ├── entry-row.tsx        (UNCHANGED — renders a row, and every child)
        └── sitting-row.tsx      (new — the parent)
```

Three approaches were considered:

- **Extend `groupByDay` itself.** Rejected. Its `DayGroup.entries` contract
  ("completed entries only, the rows the log renders") is load-bearing for the
  calendar, both pages, and `EntryLog`'s live-note lookup. Changing that shape
  touches every consumer for a concern only the log's rendering has.
- **A server-side grouped query.** Rejected. It would buy correct groups across
  a pagination boundary, at the cost of paginating over groups — a page of 50
  groups is an unbounded number of entries — plus a second aggregation path
  competing with `rangeBreakdownImpl`, whose stated purpose is "one scan, one
  ledger type, one rounding rule".
- **A new pure module composed inside `DayList`.** Chosen.

On the pagination boundary the rejected option would have fixed: a group grows
as further pages arrive, which is exactly what day headers already do.
`group-entries.ts` claims that as a feature — *"headers are derived from the
rows present, not fetched alongside them"* — and grouping inherits the property
rather than fighting it.

### `src/lib/group-sittings.ts`

```ts
export type LogItem =
  | { kind: "row"; entry: Entry }
  | {
      kind: "sitting"
      key: string
      entries: Array<Entry>   // newest first
      totalMs: number
      notedCount: number
      fromMs: number          // earliest startedAt
      toMs: number            // latest end
    }

export function toLogItems(entries: Array<Entry>): Array<LogItem>
```

Input is one day's completed entries as `groupByDay` leaves them: newest first.

Key is `` `${title.trim()}\0${projectId ?? ""}` ``. The NUL separator follows
the precedent already set in `rangeBreakdownImpl` (`convex/entries.ts`, the
`weekStart\0projectId\0title` bucket) and for the same reason: the last segment
is a user-supplied title that may contain any printable character.

Rules:

- **Singletons are never wrapped.** A key with one member emits `kind: "row"`,
  so a day of unique titles renders byte-identical to today's log and the count
  badge never appears beside a lone entry.
- **Untitled entries never group.** `title.trim() === ""` always emits
  `kind: "row"`. Two blank-titled entries on one project would otherwise
  collapse behind an empty label — two separate pieces of unaccounted work
  hidden under nothing.
- **Order is anchored at each key's newest member**, and members stay newest
  first inside the group.

Aggregates: `totalMs` sums `durationMs`; `notedCount` counts members whose
trimmed note is non-empty; `fromMs` is the minimum `startedAt`; `toMs` is the
maximum end, read as `endedAt ?? startedAt + (durationMs ?? 0)` so the function
is total even though `groupByDay` only ever hands it completed rows.

### `DayList` and `SittingRow`

`DayList` gains `grouped?: boolean`, defaulting to **`false`** — so every
existing fixture, test and caller renders unchanged until a page opts in.

These are two different defaults and both are deliberate, so they are not a
contradiction: the **component prop** defaults off, which keeps the component
honest in isolation and leaves every existing test asserting today's flat log;
the **user setting** defaults on, and the two pages pass it in. A reader who
finds only the prop should not conclude the feature ships disabled.

Expansion lives in `DayList` as a `Set<string>` keyed by `` `${day}\0${key}` ``.
In-memory by decision: it resets on reload. Holding it here means it survives a
range change on `/timer`, which keeps `EntryLog` mounted deliberately so note
drafts are not lost.

`src/components/entries/sitting-row.tsx` renders, left to right:

- the count badge, as a `button` carrying `aria-expanded` and `aria-controls`,
  labelled "Show grouped entries" / "Hide grouped entries" — the wording from
  the reference screenshot's tooltip;
- the title, static text;
- the project dot and name, read-only (the editable picker is on the children);
- `"1 of 2 noted"`, reusing the day header's exact phrasing;
- the span, via `formatTimeRange(fromMs, toMs, timeZone, use12Hour)` from
  `src/lib/format-time.ts` — the same helper the row's time popover renders
  through, so a group's times and its children's times are formatted by one
  function and cannot drift on 12/24-hour or zone;
- the total, via `formatTotal(totalMs, display)`;
- Play.

`SittingRow` therefore takes `timeZone`, `use12Hour` and `display`, all three of
which `DayList` already holds and passes to `EntryRow`.

Children render inside a container whose `id` matches `aria-controls`, indented,
and are absent from the DOM when collapsed.

Play resumes the **newest** member. `useEntryActions`'s resume already copies
title, project, tags and billable off the entry it is given, so that is already
exactly "start this again" — no new action is needed.

### Settings plumbing

`userSettings.groupEntries: v.optional(v.boolean())`, optional and additive
exactly as `currency` and `pdfIncludeNotes` are, with `settings.get` falling
back through `?? SETTINGS_DEFAULTS.groupEntries` rather than requiring a
backfill. A checkbox in `settings.tsx` beside the other display preferences, and
`grouped={settings.groupEntries}` threaded from `/timer` and `/reports` through
`EntryLog` into `DayList`.

Default **on**, unlike `pdfIncludeNotes`. The safe-default argument that governs
that flag does not apply here: `pdfIncludeNotes` puts private prose into an
artefact that goes to a client, whereas grouping changes only how rows are drawn
on the user's own screen and is reversible in one click.

---

## Part 2 — The billable default the timer bar was dropping

### What is actually broken

Inheritance exists server-side and is intentional. `convex/entries.ts`, in both
`startImpl` and the manual-create path:

```ts
// Inherited from the project unless the caller said otherwise, so a
// billable client's work is billable without the user remembering.
billable: args.billable ?? project?.billableByDefault ?? false,
```

The timer bar defeats it. `staged.billable` initialises to `false`, and
`applyClassification({ projectId })` never consults the project — so the toggle
stays dark. Both idle write paths then pass `billable: staged.billable`:

- `onToggle`'s start branch (`src/components/timer/timer-bar.tsx`, the `start`
  call), and
- the idle duration popover's `createCompleted`.

Because that is *always* a boolean, `args.billable ?? …` short-circuits and the
project default is **never reached**. Every timer started from the bar is
non-billable regardless of the project. `ManualEntryDialog` passes no `billable`
at all, so inheritance does work there — that asymmetry is the evidence that the
bar is the defect, not the rule.

### What is deliberately NOT changing

`convex/entries.edit.test.ts` contains a test named *"does not re-inherit
billable when the project changes"*, whose comment reads: *"Inheritance is a
convenience at creation. Re-applying it here would silently reverse a decision
the user made on this specific entry."* `convex/projects.ts` argues the same at
length — *"a rate is a PRICE and the billable flag is a FACT […] an old billable
flag destroys the record of a decision, and no old number restores it."*

That invariant stands. The fix is **client-side only**: no mutation, validator
or handler changes, and that test stays green untouched. Changing the project on
an entry that already exists — in the log, or on the entry currently running —
still does not re-derive its billable flag.

The scope is therefore: **the idle timer bar, where no entry exists yet**. There
is no stored decision to reverse, so lighting the toggle is not a rewrite; it is
the bar telling the truth about what Start is about to do.

### The change

`TimerBar` gains one piece of state beside `staged`:

```ts
const [billableDecided, setBillableDecided] = useState(false)
```

In `applyClassification`, on the `running === null` branch only:

- `change.billable !== undefined` marks billable decided. The user's own click
  wins from then on, and no later project change disturbs it.
- `change.projectId !== undefined && !billableDecided` derives
  `billableByDefault` from `projects` — already a `TimerBar` prop, so no new
  plumbing — and merges it in alongside the project. **Clearing** the project
  derives back to `false`, because the value only ever existed on the project's
  account.
- `takeSuggestion` sets all four fields and marks billable decided. A suggestion
  carries the flag the user last used for that exact title, which is a real
  prior decision rather than a default.

Both `setStaged({ projectId: null, tagIds: [], billable: false })` resets — one
after a successful start, one after the idle popover creates a completed entry —
also reset `billableDecided`.

**The client derives for display and sends the derived value**, rather than
omitting `billable` and letting the server's `??` apply. One derivation, so what
the `$` shows is provably what gets written; two would let a stale cached project
disagree with the server. The `??` chain stays correct for its other callers —
the manual dialog and `import` — and stops being dead code for the bar.

Fixing `staged` rather than either call site is deliberate: both idle write paths
read it, so one fix covers Start and the idle duration popover together.

---

## Testing

**`src/lib/group-sittings.test.ts`** (new, pure)

- Two entries, same title, same project → one sitting with `entries.length === 2`.
- Same title, **different** project → two rows, not a sitting.
- Titles differing only in case → two rows.
- A key with one member → `kind: "row"`, no badge-bearing sitting constructed.
- Two untitled entries on one project → two rows.
- Order: a sitting sits where its newest member sat; members stay newest first.
- Aggregates: `totalMs`, `notedCount`, `fromMs`, `toMs` over a mixed day,
  including the gapped case where `toMs - fromMs > totalMs`.

**`src/components/entries/day-list.test.tsx`** (extend)

- `grouped={false}` renders what it renders today (guards the default).
- Badge appears only at n ≥ 2.
- The badge button flips `aria-expanded`, and children are absent from the DOM
  while collapsed.
- The parent shows "1 of 2 noted" for a group with one noted member.

**`src/components/timer/timer-bar.test.tsx`** (extend)

- Picking a project with `billableByDefault: true` lights `$`, and Start sends
  `billable: true`.
- Toggling `$` off first, then picking a billable project, leaves it off and
  sends `false`.
- Clearing the project after inheriting clears `$`.
- Taking a suggestion carrying `billable: false` for a billable-by-default
  project leaves it `false`.
- The idle duration popover's `createCompleted` sends the same inherited value
  Start would.

**`convex/settings.test.ts`** (extend)

- `groupEntries` reads `true` when the stored row predates the column.

**`convex/entries.edit.test.ts`** — unchanged, and must stay green. It is the
guard on the invariant Part 2 deliberately does not touch.
