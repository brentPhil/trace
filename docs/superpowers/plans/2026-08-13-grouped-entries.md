# Grouped Entries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse repeats of one title+project within a day into a single expandable log row, and fix the timer bar so a project's `billableByDefault` actually reaches the entry it starts.

**Architecture:** A new pure module (`src/lib/group-sittings.ts`) turns a day's entries into rows-or-sittings; `DayList` renders a new `SittingRow` for the grouped ones and the existing untouched `EntryRow` for every child. Grouping is a **disclosure, not a merge** — no new mutations, nothing stored, no entry rewritten. Separately, `TimerBar` derives `staged.billable` from the picked project while idle, which is what makes the server's existing `args.billable ?? project?.billableByDefault` chain reachable from the app's primary start path.

**Tech Stack:** TypeScript, React 19, TanStack Start, Convex, Vitest + Testing Library, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-13-grouped-entries-design.md` — read it before Task 1. It carries the reasoning for every decision below.

## Global Constraints

- **Test command is `npx vitest run <path>`.** `npm test` runs the whole suite (`vitest run`). Typecheck is `npm run typecheck`, which is `tsc --noEmit && tsc --noEmit -p convex` — **both** projects.
- **Convex function syntax is the object form** with `args`, `returns` and `handler`. Read `convex/_generated/ai/guidelines.md` before touching anything under `convex/` — per `CLAUDE.md`, its rules override anything you believe about Convex from training data.
- **`convex/entries.edit.test.ts` must stay green and must not be edited.** Its test *"does not re-inherit billable when the project changes"* guards an invariant this plan deliberately preserves. Nothing in `convex/` changes for the billable fix.
- **Grouping adds no mutations.** If a task seems to need one, stop — the design is wrong, not the code.
- **New settings fields are `v.optional(...)` in the schema and get a `?? SETTINGS_DEFAULTS.x` fallback in `getImpl`.** A row written before the column existed has no opinion; that is a valid state, not one worth a backfill migration.
- **Comment in the house voice.** This codebase explains *why*, in prose, at the point of the decision — often at length, and often naming the bug the code exists to prevent. Match it. Do not add comments that merely restate the code.
- **`\0` in the plan means `"\u0000"`** — write the escape, not a literal NUL byte.

---

### Task 1: `group-sittings.ts` — the pure grouping function

**Files:**
- Create: `src/lib/group-sittings.ts`
- Create: `src/lib/group-sittings.test.ts`

**Interfaces:**
- Consumes: `Entry` from `src/lib/group-entries.ts`; `makeEntry` and `NOW` from `src/test-utils/fixtures.ts`.
- Produces: `type LogItem`, `function toLogItems(entries: Array<Entry>): Array<LogItem>`, `function sittingKey(entry: Entry): string`. Task 2 imports `LogItem` and `toLogItems`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/group-sittings.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { toLogItems } from "@/lib/group-sittings"
import { makeEntry, NOW } from "@/test-utils/fixtures"
import type { LogItem } from "@/lib/group-sittings"
import type { Id } from "../../convex/_generated/dataModel"

/*
 * The unit under test is the whole of the grouping rule, and every case below
 * is a decision from the spec rather than a mechanism: which entries are "the
 * same", which are deliberately left alone, and what the parent row is allowed
 * to claim about its members.
 */

const id = (value: string) => value as unknown as Id<"timeEntries">
const project = (value: string) => value as unknown as Id<"projects">

/**
 * A completed entry whose three time fields AGREE.
 *
 * `makeEntry` defaults to a one-hour block at `NOW`, so overriding `startedAt`
 * alone leaves `endedAt` and `durationMs` describing a different block — which
 * would make the span assertions below pass against arithmetic nobody meant.
 * One helper, so that cannot happen in one case and not another.
 */
function sitting(over: {
  id: string
  title: string
  projectId?: string
  startAt: number
  ms: number
  note?: string
}) {
  return makeEntry({
    _id: id(over.id),
    title: over.title,
    ...(over.projectId === undefined ? {} : { projectId: project(over.projectId) }),
    startedAt: over.startAt,
    endedAt: over.startAt + over.ms,
    durationMs: over.ms,
    note: over.note,
  })
}

const HOUR = 3_600_000

/** Narrows, and names the file and index when it does not. */
function sittingAt(items: Array<LogItem>, at: number) {
  const item = items[at]
  if (item === undefined) throw new Error(`no item at index ${at}`)
  if (item.kind !== "sitting") throw new Error(`items[${at}] is a row, not a sitting`)
  return item
}

function rowAt(items: Array<LogItem>, at: number) {
  const item = items[at]
  if (item === undefined) throw new Error(`no item at index ${at}`)
  if (item.kind !== "row") throw new Error(`items[${at}] is a sitting, not a row`)
  return item
}

describe("toLogItems", () => {
  it("collapses two entries sharing a title and a project", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 4 * HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: 2 * HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("keeps the same title on two projects apart", () => {
    // The key includes the project because this product invoices per client:
    // one title billed to two clients is two different pieces of work.
    const items = toLogItems([
      sitting({ id: "b", title: "Standup", projectId: "p2", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Standup", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    expect(rowAt(items, 0).entry._id).toBe(id("b"))
    expect(rowAt(items, 1).entry._id).toBe(id("a"))
  })

  it("treats a difference of case as a different title", () => {
    // Case-folding is a guess about intent, and the user can see the two
    // titles differ. "Never guesses on the user's behalf", read literally.
    const items = toLogItems([
      sitting({ id: "b", title: "Fixing dropdowns", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "fixing dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
  })

  it("groups on the TRIMMED title, so stray whitespace does not split a sitting", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "  Crew dropdowns ", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("never wraps a lone entry", () => {
    // A badge beside a single row is a claim about a group that does not
    // exist, and a day of unique titles has to render exactly as it does today.
    const items = toLogItems([
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(rowAt(items, 0).entry._id).toBe(id("a"))
  })

  it("never groups untitled entries", () => {
    // Two blank-titled entries would collapse behind an empty label — two
    // separate pieces of unaccounted work hidden under nothing at all.
    const items = toLogItems([
      sitting({ id: "b", title: "   ", projectId: "p1", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    expect(rowAt(items, 0).entry._id).toBe(id("b"))
    expect(rowAt(items, 1).entry._id).toBe(id("a"))
  })

  it("groups entries that share a title and have NO project", () => {
    const items = toLogItems([
      sitting({ id: "b", title: "Admin", startAt: NOW + HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Admin", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(1)
    expect(sittingAt(items, 0).entries).toHaveLength(2)
  })

  it("puts a sitting where its newest member sat, and keeps members newest first", () => {
    // Input arrives newest-first from `groupByDay`. A sitting takes the
    // position of its FIRST occurrence, so the log's ordering is unchanged for
    // every row that is not part of a group.
    const items = toLogItems([
      sitting({ id: "a2", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 4 * HOUR, ms: HOUR }),
      sitting({ id: "b1", title: "Email", projectId: "p1", startAt: NOW + 2 * HOUR, ms: HOUR }),
      sitting({ id: "a1", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(items).toHaveLength(2)
    const group = sittingAt(items, 0)
    expect(group.entries.map((entry) => entry._id)).toEqual([id("a2"), id("a1")])
    expect(rowAt(items, 1).entry._id).toBe(id("b1"))
  })

  it("sums the total, counts the notes, and spans first start to last end", () => {
    const items = toLogItems([
      sitting({
        id: "b",
        title: "Crew dropdowns",
        projectId: "p1",
        startAt: NOW + 4 * HOUR,
        ms: HOUR,
        note: "Finished the assignment modal.",
      }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: 2 * HOUR }),
    ])

    const group = sittingAt(items, 0)
    expect(group.totalMs).toBe(3 * HOUR)
    expect(group.notedCount).toBe(1)
    expect(group.fromMs).toBe(NOW)
    expect(group.toMs).toBe(NOW + 5 * HOUR)
  })

  it("does not count a whitespace-only note as noted", () => {
    // The day header's "n of m noted" nudge means "carries prose", and a
    // spacebar is not prose. Same `.trim()` rule `groupByDay` applies.
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + HOUR, ms: HOUR, note: "   " }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    expect(sittingAt(items, 0).notedCount).toBe(0)
  })

  it("lets the span exceed the total when the sittings do not abut", () => {
    /*
     * RECORDED AS A DECISION, not discovered as a bug. The parent's span is
     * earliest start to latest end, so a gap between sittings makes it wider
     * than the total — 3h of wall clock against 2h tracked, here. Toggl's
     * rendering was chosen knowing this, because the span answers "when in the
     * day was this" and the TOTAL is the only figure that reaches an invoice.
     */
    const items = toLogItems([
      sitting({ id: "b", title: "Crew dropdowns", projectId: "p1", startAt: NOW + 2 * HOUR, ms: HOUR }),
      sitting({ id: "a", title: "Crew dropdowns", projectId: "p1", startAt: NOW, ms: HOUR }),
    ])

    const group = sittingAt(items, 0)
    expect(group.totalMs).toBe(2 * HOUR)
    expect(group.toMs - group.fromMs).toBe(3 * HOUR)
  })

  it("returns nothing for no entries", () => {
    expect(toLogItems([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/group-sittings.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/group-sittings"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/group-sittings.ts`:

```ts
import type { Entry } from "@/lib/group-entries"

/**
 * One line of the log: an entry on its own, or several of them behind a count.
 *
 * A DISCLOSURE, NEVER A MERGE. Nothing here is stored, nothing is rewritten,
 * and every member stays individually present and individually editable one
 * click away. That distinction is the whole reason grouping is allowed to exist
 * in a product whose stated rule is that it "never silently rounds, merges, or
 * guesses on the user's behalf" — see
 * docs/superpowers/specs/2026-08-13-grouped-entries-design.md.
 */
export type LogItem =
  | { kind: "row"; entry: Entry }
  | {
      kind: "sitting"
      /** `title\0projectId`. Stable, and the state key the log expands on. */
      key: string
      /** Two or more, newest first. A one-member sitting is never built. */
      entries: Array<Entry>
      totalMs: number
      /** How many members carry prose — the parent's "n of m noted". */
      notedCount: number
      /** Earliest start. */
      fromMs: number
      /**
       * Latest end.
       *
       * `toMs - fromMs` CAN EXCEED `totalMs`, by the size of the gaps between
       * members, and that is a recorded decision rather than a defect: the span
       * answers "when in the day was this", and `totalMs` is the only figure
       * that ever reaches an invoice.
       */
      toMs: number
    }

/*
 * NUL, for the same reason `rangeBreakdownImpl` uses it in convex/entries.ts:
 * the first segment is a user-supplied title that may contain any printable
 * character, so `:` or `|` as a separator lets one title impersonate another.
 */
const SEP = "\u0000"

/** The two fields that decide whether two entries are the same work. */
export function sittingKey(entry: Entry): string {
  return `${entry.title.trim()}${SEP}${entry.projectId ?? ""}`
}

/**
 * Total even though `groupByDay` only ever hands this completed rows — a
 * function that reads `endedAt!` is one refactor away from being wrong.
 */
function endOf(entry: Entry): number {
  return entry.endedAt ?? entry.startedAt + (entry.durationMs ?? 0)
}

/**
 * One day's entries, with repeats of a title+project folded behind a count.
 *
 * Input is the array `groupByDay` produces: completed entries, newest first.
 * Output preserves that order — a sitting takes the position of its NEWEST
 * member, so every row that is not part of a group stays exactly where it was.
 *
 * Two rules here are decisions rather than mechanism, and both are deliberate:
 *
 *   - A key with ONE member emits `kind: "row"`. A count badge beside a single
 *     entry is a claim about a group that does not exist, and it means a day of
 *     unique titles renders byte-identical to the log this replaces.
 *
 *   - An UNTITLED entry never groups. Two blank-titled entries on one project
 *     would collapse behind an empty label, hiding two separate pieces of
 *     unaccounted work under nothing at all — the opposite of what the log is
 *     for.
 */
export function toLogItems(entries: Array<Entry>): Array<LogItem> {
  const buckets: Array<{ key: string; entries: Array<Entry> }> = []
  const indexByKey = new Map<string, number>()

  for (const entry of entries) {
    if (entry.title.trim() === "") {
      // Its own bucket, never registered in the map, so it can never be joined.
      buckets.push({ key: "", entries: [entry] })
      continue
    }

    const key = sittingKey(entry)
    const at = indexByKey.get(key)
    if (at === undefined) {
      indexByKey.set(key, buckets.length)
      buckets.push({ key, entries: [entry] })
    } else {
      buckets[at].entries.push(entry)
    }
  }

  return buckets.map(({ key, entries: members }) => {
    const first = members[0]
    if (members.length === 1) return { kind: "row", entry: first }

    let totalMs = 0
    let notedCount = 0
    let fromMs = first.startedAt
    let toMs = endOf(first)

    for (const member of members) {
      totalMs += member.durationMs ?? 0
      if ((member.note ?? "").trim() !== "") notedCount += 1
      if (member.startedAt < fromMs) fromMs = member.startedAt
      const end = endOf(member)
      if (end > toMs) toMs = end
    }

    return { kind: "sitting", key, entries: members, totalMs, notedCount, fromMs, toMs }
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/group-sittings.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/group-sittings.ts src/lib/group-sittings.test.ts
git commit -m "feat(log): the rule for when two entries are the same work"
```

---

### Task 2: `SittingRow`, and `DayList` learning to draw it

**Files:**
- Create: `src/components/entries/sitting-row.tsx`
- Modify: `src/components/entries/day-list.tsx` (imports, the `DayList` signature, and the rows container inside the day `<section>`)
- Modify: `src/components/entries/day-list.test.tsx` (append one `describe`)

**Interfaces:**
- Consumes: `LogItem`, `toLogItems` from Task 1; existing `EntryRow`/`EntryRowActions`, `ProjectDot`, `formatTimeRange`, `formatTotal`.
- Produces: `SittingRow` (props below), and `DayList`'s new `grouped?: boolean` prop. Task 4 passes that prop from the two pages.

- [ ] **Step 1: Write the failing test**

Append to `src/components/entries/day-list.test.tsx`:

```ts
/*
 * GROUPED ENTRIES.
 *
 * The feature is a disclosure and not a merge, and these are the properties
 * that make that claim true on screen: the flat log still exists and is the
 * component's default, a badge only ever appears where a group really does,
 * absence of a note is still stated, and every member is reachable.
 */
describe("grouped entries", () => {
  const twice = [
    makeEntry({
      _id: "b" as unknown as Doc<"timeEntries">["_id"],
      title: "Crew dropdowns",
      startedAt: 4_000_000,
      endedAt: 7_600_000,
      durationMs: 3_600_000,
      note: "Finished the assignment modal.",
    }),
    makeEntry({
      _id: "a" as unknown as Doc<"timeEntries">["_id"],
      title: "Crew dropdowns",
      startedAt: 0,
      endedAt: 3_600_000,
      durationMs: 3_600_000,
    }),
  ]

  const groups = [
    {
      day: "2026-08-09",
      label: "Today",
      entries: twice,
      notedCount: 1,
      totalMs: 7_200_000,
      billableMs: 0,
      runningCount: 0,
    },
  ]

  const renderLog = (grouped: boolean, actions: EntryRowActions = noActions) =>
    render(
      <DayList
        groups={groups}
        timeZone="UTC"
        use12Hour={false}
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={actions}
        grouped={grouped}
      />
    )

  it("draws the flat log by default, with no badge and no disclosure", () => {
    // The PROP defaults off even though the user SETTING defaults on. This is
    // what keeps the component honest in isolation, and what lets every test
    // above go on asserting the log this product has always drawn.
    render(
      <DayList
        groups={groups}
        timeZone="UTC"
        use12Hour={false}
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
      />
    )

    expect(screen.queryByLabelText("Show grouped entries")).toBeNull()
    expect(screen.getAllByDisplayValue("Crew dropdowns")).toHaveLength(2)
  })

  it("collapses the repeat behind a count, hiding both rows until asked", () => {
    renderLog(true)

    const toggle = screen.getByLabelText("Show grouped entries")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(toggle.textContent).toContain("2")
    // Not merely hidden: not rendered. Fifty collapsed groups would otherwise
    // mount fifty rows' worth of pickers nobody can see.
    expect(screen.queryAllByDisplayValue("Crew dropdowns")).toHaveLength(0)
  })

  it("states how many of the group carry a note", () => {
    // The day header's own nudge, moved onto the parent. Collapsing rows must
    // not turn a missing note from VISIBLE into ABSENT.
    renderLog(true)
    expect(screen.getByText("1 of 2 noted")).toBeTruthy()
  })

  it("shows the span from first start to last end, and the summed total", () => {
    renderLog(true)
    expect(screen.getByText("00:00 – 02:06")).toBeTruthy()
    expect(screen.getByText("02:00:00")).toBeTruthy()
  })

  it("reveals every member when expanded, and says so", () => {
    renderLog(true)

    fireEvent.click(screen.getByLabelText("Show grouped entries"))

    const toggle = screen.getByLabelText("Hide grouped entries")
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getAllByDisplayValue("Crew dropdowns")).toHaveLength(2)
  })

  it("points aria-controls at the container it actually reveals", () => {
    renderLog(true)
    fireEvent.click(screen.getByLabelText("Show grouped entries"))

    const controls = screen.getByLabelText("Hide grouped entries").getAttribute("aria-controls")
    expect(controls).toBeTruthy()
    expect(document.getElementById(controls!)).not.toBeNull()
  })

  it("resumes the NEWEST member from the parent's play button", () => {
    // The parent has no edits by design, and this is the one write it carries.
    // `useEntryActions`'s resume already copies title, project, tags and
    // billable off the entry it is given, so "the newest one" IS "start this
    // again" with nothing extra to build.
    const onResume = vi.fn()
    renderLog(true, { onResume } as unknown as EntryRowActions)

    fireEvent.click(screen.getByLabelText("Resume Crew dropdowns"))

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(onResume.mock.calls[0][0]._id).toBe("b")
  })

  it("leaves a day of unique titles completely alone", () => {
    const unique = [
      {
        day: "2026-08-09",
        label: "Today",
        entries: [
          makeEntry({ _id: "x" as unknown as Doc<"timeEntries">["_id"], title: "Email" }),
          makeEntry({ _id: "y" as unknown as Doc<"timeEntries">["_id"], title: "Standup" }),
        ],
        notedCount: 0,
        totalMs: 7_200_000,
        billableMs: 0,
        runningCount: 0,
      },
    ]

    render(
      <DayList
        groups={unique}
        timeZone="UTC"
        use12Hour={false}
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        grouped
      />
    )

    expect(screen.queryByLabelText("Show grouped entries")).toBeNull()
    expect(screen.getByDisplayValue("Email")).toBeTruthy()
    expect(screen.getByDisplayValue("Standup")).toBeTruthy()
  })
})
```

Also extend the imports at the top of that file — it currently imports only `afterEach, describe, expect, it` from vitest and has no `fireEvent`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DayList, LogSkeleton } from "@/components/entries/day-list"
import { makeEntry } from "@/test-utils/fixtures"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { Doc } from "../../../convex/_generated/dataModel"
```

> **On `getByDisplayValue`:** a row's title is an `EditableTitle` input, not static text, which is why the child rows are asserted by display value while the parent's title is plain text. If `getByDisplayValue` does not match, open `src/components/entries/editable-fields.tsx` and assert on whatever `EditableTitle` actually renders — do **not** change the component to suit the test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: FAIL — the pre-existing tests pass, and the new `describe` fails on `grouped` not being a prop (`Unable to find a label with the text of: Show grouped entries`).

- [ ] **Step 3: Write `SittingRow`**

Create `src/components/entries/sitting-row.tsx`:

```tsx
import { ChevronDown, ChevronRight, Play } from "lucide-react"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import type { DurationDisplay } from "@/lib/format-total"
import type { LogItem } from "@/lib/group-sittings"
import type { Doc } from "../../../convex/_generated/dataModel"

type Sitting = Extract<LogItem, { kind: "sitting" }>

/**
 * Several sittings at one piece of work, behind a count.
 *
 * DELIBERATELY NOT EDITABLE, unlike every other row in this product. Duration
 * and start/end have no meaning for a group — editing the total would have to
 * pick a member to absorb the change — and a note written here would have to be
 * copied onto every member or stored nowhere. So the parent discloses and
 * resumes, the members carry every edit, and this feature adds no mutations at
 * all.
 *
 * Tags and the billable mark are absent for a related reason: both can differ
 * between members, this row cannot edit either, and a mark meaning "some of
 * these" is a mark that means nothing. The project is shown because it is part
 * of the grouping key, so every member provably shares it.
 */
export function SittingRow({
  sitting,
  timeZone,
  use12Hour,
  projects,
  display,
  expanded,
  onToggle,
  onResume,
  controls,
}: {
  sitting: Sitting
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  display: DurationDisplay
  expanded: boolean
  onToggle: () => void
  /** Resumes the NEWEST member — see `DayList`, which supplies it. */
  onResume: () => void
  /** The `id` of the container this row reveals, for `aria-controls`. */
  controls: string
}) {
  const newest = sitting.entries[0]
  const title = newest.title.trim()
  const project = projects.find((candidate) => candidate._id === newest.projectId) ?? null

  return (
    <div
      className={cn(
        "group border-b border-edge-soft/60",
        "transition-colors hover:bg-surface/60"
      )}
    >
      {/* `px-4` and the row height token, exactly as `EntryRow` and the day
          header use them, so three files that cannot see each other put the
          left edge and the baseline in the same place. */}
      <div className="flex min-h-(--entry-row-height) w-full items-center gap-2 px-4">
        {/*
          THE BADGE IS THE CONTROL, which is what the reference screenshot
          shows: its tooltip is the disclosure's label, not a separate chevron's.
          One target rather than two means the count and the gesture cannot
          drift apart, and the number is the thing the eye is already on.
        */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={controls}
          aria-label={expanded ? "Hide grouped entries" : "Show grouped entries"}
          onClick={onToggle}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-sm border border-edge-soft",
            "px-1.5 py-0.5 text-xs tabular text-muted-foreground",
            "transition-colors hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {expanded ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3" aria-hidden="true" />
          )}
          {sitting.entries.length}
        </button>

        {/* Static text, not an `EditableTitle`. Retitling a group would be a
            write to every member — see this component's own note above. */}
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>

        <div className="flex shrink-0 items-center gap-2">
          <ProjectDot
            project={project}
            className="max-w-[8rem]"
            nameClassName="hidden md:inline"
          />

          {/*
            THE DAY HEADER'S OWN SENTENCE, in the day header's own words.
            Collapsing rows must not turn a missing note from visible into
            absent — that is the one thing this product cannot trade for a
            tidier list.
          */}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {sitting.notedCount} of {sitting.entries.length} noted
          </span>

          <span className="hidden text-xs tabular text-muted-foreground sm:inline">
            {formatTimeRange(sitting.fromMs, sitting.toMs, timeZone, use12Hour)}
          </span>

          {/*
            `formatTotal`, whose contract says decimal applies to TOTALS and
            never to a single entry's own row. A sitting's figure is a sum of
            parts, so it is a total, and it is floored like every other one.
          */}
          <span className="text-base font-semibold tabular text-muted-foreground">
            {formatTotal(sitting.totalMs, display)}
          </span>

          <button
            type="button"
            aria-label={`Resume ${title}`}
            onClick={onResume}
            className={cn(
              "rounded-md p-1.5 text-muted-foreground",
              "opacity-100 sm:opacity-0",
              "transition-[opacity,color] sm:group-hover:opacity-100",
              "hover:text-foreground",
              "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
              "focus-visible:outline-none motion-reduce:transition-none"
            )}
          >
            <Play className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Teach `DayList` to draw it**

In `src/components/entries/day-list.tsx`, replace the import block at the top with:

```tsx
import { useState } from "react"
import { EntryRow } from "@/components/entries/entry-row"
import { SittingRow } from "@/components/entries/sitting-row"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTotal } from "@/lib/format-total"
import { toLogItems } from "@/lib/group-sittings"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { DayGroup } from "@/lib/group-entries"
import type { DurationDisplay } from "@/lib/format-total"
import type { Doc } from "../../../convex/_generated/dataModel"
```

Add `grouped` to the destructured props and to the type, immediately after `notesExpanded`:

```tsx
  notesExpanded = false,
  grouped = false,
}: {
```

…and in the type block, after the `notesExpanded?: boolean` entry:

```tsx
  /**
   * Collapse repeats of one title+project within a day behind a count.
   *
   * DEFAULTS OFF while `userSettings.groupEntries` defaults ON, and both are
   * deliberate: the component stays honest in isolation and every existing
   * caller and test keeps asserting the flat log, while the two pages pass the
   * user's own preference in. A reader who finds only this default should not
   * conclude the feature ships disabled.
   */
  grouped?: boolean
```

Immediately before the `if (groups.length === 0)` guard, add the expansion state:

```tsx
  /*
   * WHICH SITTINGS ARE OPEN, keyed by `day\0key`.
   *
   * In memory and per-tab: a disclosure is a thing the reader is doing right
   * now, not a property of the data, so it resets on reload. It lives HERE
   * rather than in the row so that /timer's deliberate keeping-`EntryLog`-
   * mounted across a change of range (see that page, and `note-sheet.tsx`)
   * carries the open groups through with the note drafts.
   */
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
```

> **Note on hook order:** `useState` must sit **above** the `groups.length === 0` early return. A hook after a conditional return is a hooks-order violation that React will throw on the first render where the log goes from empty to non-empty.

Immediately after `toggle`, add the row helper. **A child of a sitting and an ungrouped row are the same row**, and the nine props saying so must be written once — otherwise the next prop `EntryRow` gains gets added to one call site and not the other, and grouped children quietly stop honouring it:

```tsx
  /*
   * ONE SPELLING OF A ROW, for the two places that draw one: on its own, and
   * as a member of a sitting. They are the same row — a member is not a
   * reduced version of an entry — so the props that say so are written here
   * rather than twice below, where the next one added would land on one call
   * site and silently skip the other.
   */
  const row = (entry: Entry) => (
    <EntryRow
      key={entry._id}
      entry={entry}
      timeZone={timeZone}
      use12Hour={use12Hour}
      weekStartDay={weekStartDay}
      projects={projects}
      tags={tags}
      actions={actions}
      notesExpanded={notesExpanded}
    />
  )
```

This needs `Entry` on the type imports — change the `group-entries` type import to:

```tsx
import type { DayGroup, Entry } from "@/lib/group-entries"
```

Then replace the rows container — currently:

```tsx
          <div className="flex flex-col pb-(--day-group-gap)">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry._id}
                entry={entry}
                timeZone={timeZone}
                use12Hour={use12Hour}
                weekStartDay={weekStartDay}
                projects={projects}
                tags={tags}
                actions={actions}
                notesExpanded={notesExpanded}
              />
            ))}
          </div>
```

with:

```tsx
          <div className="flex flex-col pb-(--day-group-gap)">
            {(grouped
              ? toLogItems(group.entries)
              : group.entries.map((entry) => ({ kind: "row" as const, entry }))
            ).map((item, index) => {
              if (item.kind === "row") return row(item.entry)

              const stateKey = `${group.day}\u0000${item.key}`
              // The DOM id cannot carry the NUL the state key does, and it does
              // not need to be stable across reorderings — only unique on the
              // page while it is rendered.
              const panelId = `sitting-${group.day}-${index}`
              const isOpen = open.has(stateKey)

              return (
                <div key={`sitting-${item.key}`} className="flex flex-col">
                  <SittingRow
                    sitting={item}
                    timeZone={timeZone}
                    use12Hour={use12Hour}
                    projects={projects}
                    display={display}
                    expanded={isOpen}
                    onToggle={() => toggle(stateKey)}
                    // The NEWEST member. `useEntryActions`'s resume copies
                    // title, project, tags and billable off whatever it is
                    // given, so this already IS "start this again".
                    onResume={() => actions.onResume(item.entries[0])}
                    controls={panelId}
                  />
                  {isOpen ? (
                    // Indented, and NOT RENDERED while collapsed rather than
                    // merely hidden: a long log of collapsed groups would
                    // otherwise mount every member's pickers for nobody.
                    <div
                      id={panelId}
                      className="flex flex-col border-l-2 border-edge-soft pl-4"
                    >
                      {item.entries.map(row)}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/entries/day-list.test.tsx`
Expected: PASS — the pre-existing describes plus 8 new tests.

If `"00:00 – 02:06"` fails, read the actual rendered string from the failure message and check it against `formatTimeRange` in `src/lib/format-time.ts` (it uppercases, and the separator is an en dash `–`, not a hyphen). Fix the **expectation**, not the formatter.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS. Nothing else should move — `grouped` defaults off.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/entries/sitting-row.tsx src/components/entries/day-list.tsx src/components/entries/day-list.test.tsx
git commit -m "feat(log): a repeat of one title collapses behind a count"
```

---

### Task 3: `userSettings.groupEntries`

**Files:**
- Modify: `convex/schema.ts` (the `userSettings` table, after `pdfIncludeNotes`)
- Modify: `convex/settings.ts` (`Settings`, `SETTINGS_DEFAULTS`, `settingsReturns`, `getImpl`, `updateArgs`, `UpdateArgs`)
- Modify: `src/test-utils/fixtures.ts` (the `SETTINGS` document)
- Modify: `convex/settings.test.ts` (append one test)

**Interfaces:**
- Produces: `Settings.groupEntries: boolean`, `SETTINGS_DEFAULTS.groupEntries === true`, and `groupEntries` accepted by `api.settings.update`. Task 4 reads `settings.groupEntries` and calls `save({ groupEntries })`.

**Read first:** `convex/_generated/ai/guidelines.md`, per `CLAUDE.md`.

- [ ] **Step 1: Write the failing test**

Append to `convex/settings.test.ts`:

```ts
describe("groupEntries", () => {
  it("reads as true for a row written before the column existed", async () => {
    /*
     * The additive-column contract, and the reason `groupEntries` is
     * `v.optional` in the schema: every existing user has a settings row with
     * no opinion about this field, and that is an ordinary state rather than
     * one worth a backfill migration. Absence has to mean "the default", the
     * same way `currency` and `pdfIncludeNotes` already work.
     */
    const t = setup()
    await t.run(async (ctx) => {
      await ctx.db.insert("userSettings", {
        userId: ALICE,
        timezone: "UTC",
        weekStartDay: 1,
        durationDisplay: "hms",
        timeFormat: "24",
        runawayThresholdMs: 8 * 60 * 60 * 1000,
        tabTitleClock: true,
        updatedAt: Date.now(),
      })
    })

    const settings = await t.query(internal.settings.getAs, { userId: ALICE })
    expect(settings.groupEntries).toBe(true)
  })

  it("can be switched off and back on", async () => {
    const t = setup()
    await t.mutation(internal.settings.updateAs, { userId: ALICE, groupEntries: false })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).groupEntries
    ).toBe(false)

    await t.mutation(internal.settings.updateAs, { userId: ALICE, groupEntries: true })
    expect(
      (await t.query(internal.settings.getAs, { userId: ALICE })).groupEntries
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run convex/settings.test.ts`
Expected: FAIL — `groupEntries` is not in the validator, so `updateAs` rejects with an `ArgumentValidationError`, and `settings.groupEntries` is `undefined`.

- [ ] **Step 3: Add the schema column**

In `convex/schema.ts`, in the `userSettings` table, immediately after the `pdfIncludeNotes` field:

```ts
    /** Collapse repeats of one title+project within a day into one log row.
     *
     *  Optional and additive like `currency` and `pdfIncludeNotes` above — a
     *  row written before this field existed has no opinion, and `settings.get`
     *  falls back to `SETTINGS_DEFAULTS` rather than this needing a backfill.
     *
     *  ON by default, and the difference from `pdfIncludeNotes` is the point:
     *  that flag governs what reaches a CLIENT, so its default has to be the
     *  cautious one. This governs only how rows are drawn on the user's own
     *  screen. Nothing is merged, nothing is stored per group, and every entry
     *  stays individually present and editable one click away — see
     *  docs/superpowers/specs/2026-08-13-grouped-entries-design.md, which
     *  argues that at length against PRODUCT.md's "never silently merges". */
    groupEntries: v.optional(v.boolean()),
```

- [ ] **Step 4: Thread it through `convex/settings.ts`**

Four edits in that file.

`Settings`, after `pdfIncludeNotes`:

```ts
  /** Collapse a day's repeats of one title+project into a single log row. See
   *  the schema for why this default is on where `pdfIncludeNotes` is off. */
  groupEntries: boolean
```

`SETTINGS_DEFAULTS`, after `pdfIncludeNotes: false,`:

```ts
  groupEntries: true,
```

`settingsReturns`, after `pdfIncludeNotes: v.boolean(),`:

```ts
  groupEntries: v.boolean(),
```

`getImpl`'s returned object, after the `pdfIncludeNotes` line:

```ts
    // Same additive-column fallback as `currency` and `pdfIncludeNotes` above.
    groupEntries: row.groupEntries ?? SETTINGS_DEFAULTS.groupEntries,
```

`updateArgs`, after `pdfIncludeNotes: v.optional(v.boolean()),`:

```ts
  groupEntries: v.optional(v.boolean()),
```

`UpdateArgs`, after `pdfIncludeNotes?: boolean`:

```ts
  groupEntries?: boolean
```

- [ ] **Step 5: Add it to the shared route fixture**

In `src/test-utils/fixtures.ts`, in `SETTINGS`, after `pdfIncludeNotes: false,`:

```ts
  groupEntries: true,
```

This is not optional housekeeping. That fixture's own header explains why: it is a whole `settings.get` document, and a route reading a field missing from it fails with an unrelated-looking suspense error rather than naming the field.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run convex/settings.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no output, exit 0. `tsc -p convex` is what catches a `settingsReturns` that disagrees with `getImpl`.

- [ ] **Step 8: Commit**

```bash
git add convex/schema.ts convex/settings.ts convex/settings.test.ts src/test-utils/fixtures.ts
git commit -m "feat(settings): groupEntries, on by default and additive"
```

---

### Task 4: Wire the setting to the two pages

**Files:**
- Modify: `src/routes/_authed/settings.tsx` (add a `Section`, before the "Tab title" one)
- Modify: `src/routes/_authed/timer.tsx` (the `EntryLog` element)
- Modify: `src/routes/_authed/reports.tsx` (the `EntryLog` element)
- Modify: `src/components/entries/entry-log.tsx` (forward the prop)

**Interfaces:**
- Consumes: `DayList`'s `grouped` prop (Task 2); `settings.groupEntries` and `save({ groupEntries })` (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Forward the prop through `EntryLog`**

In `src/components/entries/entry-log.tsx`, add `grouped` to the destructured props after `notesExpanded`, add to the type block:

```tsx
  /** Forwarded to `DayList` — the user's `groupEntries` setting. See there for
   *  why the component's own default is the opposite of the setting's. */
  grouped?: boolean
```

and pass it on the `<DayList>` element, after `notesExpanded={notesExpanded}`:

```tsx
        grouped={grouped}
```

- [ ] **Step 2: Add the Settings control**

In `src/routes/_authed/settings.tsx`, immediately before the `<Section title="Tab title" …>` block:

```tsx
        {/*
          A LONE CHECKBOX, where "Notes in the PDF report" above is a radio
          pair — and the difference is which way the control faces. That one
          governs what reaches a CLIENT, so both outcomes are spelled out
          rather than inferred. This one is a view mode on the user's own
          screen, reversible in one click and visible the moment it changes,
          which is exactly the case `tabTitleClock` below is a checkbox for.
        */}
        <Section
          title="Repeated entries"
          hint="When you start and stop the same task several times in a day, the log can show them as one row with a count, expandable to the individual entries. Nothing is merged: every entry keeps its own times, note and controls, one click away. This changes only what you see — exports, invoices and totals are unaffected."
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.groupEntries}
              onChange={(event) => save({ groupEntries: event.target.checked })}
              // The neutral `--ink` accent every other control on this page
              // uses. NOT `--enlarger`: a checked setting is not a timer
              // running, and the Cold Light Rule reads the two differently.
              className="size-4 accent-[var(--ink)]"
            />
            Group a day&apos;s repeats of the same entry
          </label>
        </Section>
```

- [ ] **Step 3: Pass it from `/timer`**

In `src/routes/_authed/timer.tsx`, on the `<EntryLog>` element, after `notesExpanded={notesExpanded}`:

```tsx
              grouped={settings.groupEntries}
```

- [ ] **Step 4: Pass it from `/reports`**

In `src/routes/_authed/reports.tsx`, on the `<EntryLog>` element, after `display={settings.durationDisplay}`:

```tsx
            grouped={settings.groupEntries}
```

- [ ] **Step 5: Run the route suites**

Run: `npx vitest run src/routes/_authed/-timer.test.tsx src/routes/_authed/-reports.test.tsx src/routes/_authed/-settings.test.tsx`
Expected: PASS. Both route tests mock `EntryLog`, so they assert the page's own wiring rather than the log's rendering.

If `-settings.test.tsx` does not exist, drop it from the command — do not create it in this task.

- [ ] **Step 6: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Verify it in the browser**

Start the dev server and confirm the feature end to end. `npx convex dev` must be running in a separate terminal, or the deployment will be serving functions without `groupEntries` and `settings.get` will fail validation.

1. Open `/timer`. Start and stop a timer twice with the same title, no project.
2. Confirm one row appears with a `2` badge, the day's total unchanged.
3. Click the badge — both entries appear, each with its own times and note control.
4. Open `/settings`, uncheck "Group a day's repeats of the same entry".
5. Return to `/timer` and confirm the flat log is back.

- [ ] **Step 8: Commit**

```bash
git add src/components/entries/entry-log.tsx src/routes/_authed/settings.tsx src/routes/_authed/timer.tsx src/routes/_authed/reports.tsx
git commit -m "feat(log): let the log group, and let the user turn it off"
```

---

### Task 5: The billable default the timer bar was dropping

**Files:**
- Modify: `src/components/timer/timer-bar.tsx` (state beside `staged`, `applyClassification`, `takeSuggestion`, and both `setStaged` resets)
- Modify: `src/components/timer/timer-bar.test.tsx` (give the `Bar` harness a `projects` prop, append one `describe`)

**Interfaces:**
- Consumes: `projects: Array<Doc<"projects">>`, already a `TimerBar` prop.
- Produces: nothing. This task is self-contained and independent of Tasks 1–4.

**Constraint:** nothing under `convex/` changes. `convex/entries.edit.test.ts`'s *"does not re-inherit billable when the project changes"* must stay green and unedited — changing the project on an entry that already exists still does not re-derive its billable flag. The scope is the idle bar, where no entry exists yet and so no stored decision can be reversed.

- [ ] **Step 1: Give the test harness a `projects` prop**

In `src/components/timer/timer-bar.test.tsx`, the `Bar` helper hardcodes `projects={[]}`. Replace the helper with:

```tsx
/** The bar with empty classifier lists — no backend behind any of it. */
function Bar({
  running,
  actions,
  onError,
  use12Hour = true,
  projects = [],
}: {
  running: Doc<"timeEntries"> | null
  actions: TimerBarActions
  onError?: (thrown: unknown) => void
  /** Overridable so a settings change arriving mid-interaction is testable. */
  use12Hour?: boolean
  /** Overridable so a project's `billableByDefault` can be exercised. */
  projects?: Array<Doc<"projects">>
}) {
  return (
    <TimerBar
      running={running}
      actions={actions}
      projects={projects}
      tags={[]}
      timeZone={LONDON}
      use12Hour={use12Hour}
      weekStartDay={1}
      onError={onError}
      onCreateManual={vi.fn(async () => {})}
```

Leave the rest of that element exactly as it is.

- [ ] **Step 2: Write the failing test**

Append to `src/components/timer/timer-bar.test.tsx`:

```tsx
/*
 * THE PROJECT'S OWN DEFAULT, ON THE ENTRY THE BAR IS ABOUT TO WRITE.
 *
 * `startImpl` in convex/entries.ts has always read
 * `args.billable ?? project?.billableByDefault ?? false`, with the comment "so
 * a billable client's work is billable without the user remembering" — and the
 * bar made that line unreachable. It staged `billable: false` and passed it
 * explicitly, so the `??` short-circuited on every timer started from the
 * product's primary surface. `ManualEntryDialog`, which passes no `billable` at
 * all, inherited correctly the whole time; that asymmetry is the evidence the
 * bar was the defect rather than the rule.
 *
 * SCOPED TO THE IDLE BAR. An entry that already exists still does not
 * re-inherit when its project changes — see the test of that name in
 * convex/entries.edit.test.ts, whose invariant this deliberately leaves alone.
 * The difference is that here there is no entry yet, so there is no decision to
 * reverse: lighting the toggle is the bar telling the truth about what Start is
 * about to do.
 */
describe("billable, inherited from the project while idle", () => {
  const billableProject = {
    _id: "jd7billable" as unknown as Id<"projects">,
    _creationTime: 0,
    userId: "u",
    name: "Acme",
    color: "amber",
    billableByDefault: true,
    archived: false,
    updatedAt: 0,
    deletedAt: null,
  } as unknown as Doc<"projects">

  const proBonoProject = {
    ...billableProject,
    _id: "jd7probono" as unknown as Id<"projects">,
    name: "Pro bono",
    billableByDefault: false,
  } as unknown as Doc<"projects">

  /** Opens the picker and chooses a project by name. */
  const pick = (name: string) => {
    fireEvent.click(screen.getByLabelText("Project"))
    fireEvent.click(screen.getByRole("option", { name: new RegExp(name) }))
  }

  it("lights the toggle when the picked project bills by default", async () => {
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[billableProject]} />)

    pick("Acme")
    await vi.advanceTimersByTimeAsync(0)

    // The toggle's own label IS its state — see `BillableToggle`.
    expect(screen.getByLabelText("Billable")).toBeTruthy()
  })

  it("starts the timer billable, which is the whole point", async () => {
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[billableProject]} />)

    pick("Acme")
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ billable: true })
    )
  })

  it("leaves it alone for a project that does not bill by default", async () => {
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[proBonoProject]} />)

    pick("Pro bono")
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ billable: false })
    )
  })

  it("never overrides a choice the user made themselves", async () => {
    // The user's own click is a decision. Inheritance is a convenience, and a
    // convenience does not get to overrule a decision — the same principle
    // convex/projects.ts states for an entry that already exists.
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[proBonoProject]} />)

    fireEvent.click(screen.getByLabelText("Not billable"))
    pick("Pro bono")
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ billable: true })
    )
  })

  it("clears the inherited flag when the project is cleared", async () => {
    // The value only ever existed on the project's account, so it goes when
    // the project does. Choosing the selected project again deselects it —
    // see `ProjectPicker`'s `onChoose`.
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[billableProject]} />)

    pick("Acme")
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByLabelText("Billable")).toBeTruthy()

    pick("Acme")
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByLabelText("Not billable")).toBeTruthy()
  })

  it("lets a suggestion's own flag win over the project's default", async () => {
    // A suggestion carries the flag the user last used for that exact title,
    // which is a real prior decision rather than a default.
    const { actions } = makeActions()
    render(
      <TimerBar
        running={null}
        actions={actions}
        projects={[billableProject]}
        tags={[]}
        suggestions={[
          {
            title: "Acme retainer",
            projectId: billableProject._id,
            tagIds: [],
            billable: false,
          },
        ]}
        timeZone={LONDON}
        use12Hour
        weekStartDay={1}
        onCreateManual={vi.fn(async () => {})}
      />
    )

    fireEvent.change(screen.getByLabelText("What are you working on?"), {
      target: { value: "Acme ret" },
    })
    fireEvent.click(screen.getByRole("option", { name: /Acme retainer/ }))
    fireEvent.click(screen.getByLabelText("Start timer"))
    await vi.advanceTimersByTimeAsync(0)

    expect(actions.start).toHaveBeenCalledWith(
      expect.objectContaining({ billable: false })
    )
  })

  it("carries the inherited flag into the idle popover's completed entry too", async () => {
    // Both idle write paths read `staged`, which is why the fix is there and
    // not at either call site.
    const { actions } = makeActions()
    render(<Bar running={null} actions={actions} projects={[billableProject]} />)

    pick("Acme")
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByLabelText("Billable")).toBeTruthy()
  })
})
```

> **On the last two tests:** the suggestion test and the input's accessible name (`"What are you working on?"`) are guesses at this file's existing harness. Before writing them, read how the file's other suggestion tests drive the input and the suggestion list, and match that. If the accessible name differs, use the real one. If driving suggestions is materially harder than shown, keep the assertion and reach the suggestion the way the neighbouring tests do — do not change the component to make the test easier.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/timer/timer-bar.test.tsx`
Expected: FAIL — "lights the toggle when the picked project bills by default" fails on `Unable to find a label with the text of: Billable`, because picking a project does not touch `staged.billable` yet.

- [ ] **Step 4: Write the implementation**

Four edits in `src/components/timer/timer-bar.tsx`.

**(a)** Immediately after the `staged` `useState` declaration, add:

```tsx
  /*
   * WHETHER THE USER HAS SAID ANYTHING ABOUT BILLABLE THIS COMPOSITION.
   *
   * `staged.billable` cannot answer that on its own: `false` is both "no,
   * don't bill this" and "nobody has mentioned it", and the two have to behave
   * differently the moment a project with `billableByDefault` is picked. So
   * the fact is recorded separately rather than encoded in the value.
   *
   * A SEPARATE FLAG rather than `boolean | null` on `staged.billable`, because
   * `Classification` is shared with the row and the calendar popover, where a
   * third state has no meaning and every consumer would have to narrow it.
   *
   * Reset wherever `staged` is, which is after each of the two idle writes:
   * the next entry starts with nothing said about it.
   */
  const [billableDecided, setBillableDecided] = useState(false)
```

**(b)** Replace `applyClassification` in full:

```tsx
  /** Applies a classifier change to whichever of the two is currently real. */
  const applyClassification = (change: Partial<Classification>) => {
    if (running === null) {
      /*
       * THE PROJECT'S DEFAULT, APPLIED WHERE NOTHING CAN BE OVERWRITTEN YET.
       *
       * `startImpl` reads `args.billable ?? project?.billableByDefault`, and
       * this bar made that unreachable: it staged `false` and passed it
       * explicitly, so every timer started here was non-billable however the
       * project was configured. The derivation happens on the CLIENT rather
       * than by omitting `billable` from the mutation, so that what the `$`
       * shows is provably what gets written — two derivations could disagree
       * whenever the cached project is behind the server's.
       *
       * Only while idle, and only until the user says otherwise. An entry that
       * already exists never re-inherits: see convex/projects.ts on why an old
       * billable flag "destroys the record of a decision", and the test of that
       * name in convex/entries.edit.test.ts.
       */
      const decided = billableDecided || change.billable !== undefined
      if (change.billable !== undefined) setBillableDecided(true)

      const inherited =
        change.projectId === undefined || decided
          ? {}
          : {
              billable:
                projects.find((project) => project._id === change.projectId)
                  ?.billableByDefault ?? false,
            }

      setStaged((current) => ({ ...current, ...inherited, ...change }))
      return
    }
    // A row that does not exist yet cannot be patched; the start mutation is
    // carrying the staged values and will land in a moment.
    if (isOptimisticId(running._id)) return
    void classify(running._id, change).catch(() => {
      // Same reasoning as the title write: never interrupt a running timer to
      // report that a tag did not stick.
    })
  }
```

> `...inherited` sits **before** `...change` so an explicit `billable` in the same change always wins. `change.projectId === null` (clearing) finds no project and derives `false`, which is the intended behaviour: the flag only ever existed on the project's account.

**(c)** In `takeSuggestion`, add the flag after `setStaged`:

```tsx
  const takeSuggestion = (s: TitleSuggestion) => {
    setDraft({ key: runningKey, text: s.title, dirty: true })
    setStaged({
      projectId: s.projectId ?? null,
      tagIds: s.tagIds,
      billable: s.billable,
    })
    // A SUGGESTION IS A DECISION, not a default: it carries the flag the user
    // last used for this exact title. So the project it also sets must not
    // then re-derive over the top of it.
    setBillableDecided(true)
    setSuggestOpen(false)
    setSuggestIndex(-1)
    inputRef.current?.focus()
  }
```

**(d)** Both places that reset `staged` — one after a successful start in `onToggle`, one in the idle duration popover's `onCreateCompleted` — gain a matching reset. Each currently reads:

```tsx
        setStaged({ projectId: null, tagIds: [], billable: false })
```

Change **both** to:

```tsx
        setStaged({ projectId: null, tagIds: [], billable: false })
        setBillableDecided(false)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/timer/timer-bar.test.tsx`
Expected: PASS, including every pre-existing test in the file. The two existing cases that assert `billable: false` and `billable: true` on start both render with `projects={[]}`, so neither can inherit and neither should move.

- [ ] **Step 6: Confirm the invariant this must not break**

Run: `npx vitest run convex/entries.edit.test.ts`
Expected: PASS, unchanged — in particular *"does not re-inherit billable when the project changes"*. If this file needed editing, the implementation went further than the design allows; revert and re-read the constraint at the top of this task.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `npm test`
Expected: PASS.

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Verify it in the browser**

With `npx convex dev` running and the dev server up:

1. Open `/projects` and set a project to billable by default.
2. Open `/timer` with nothing running. Pick that project in the bar.
3. Confirm the `$` turns brass immediately.
4. Start, then stop. Confirm the entry's row shows billable.
5. Pick the project again to clear it, and confirm the `$` goes out.
6. Click `$` off yourself, then pick the billable project. Confirm it stays off.

- [ ] **Step 9: Commit**

```bash
git add src/components/timer/timer-bar.tsx src/components/timer/timer-bar.test.tsx
git commit -m "fix(timer): the bar was dropping the project's billable default"
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task:

| Spec | Task |
| --- | --- |
| Grouping key (trimmed title + projectId, case-sensitive) | 1 |
| Singletons stay rows; untitled never group | 1 |
| Order anchored at newest member | 1 |
| Aggregates: totalMs, notedCount, fromMs, toMs | 1 |
| Span may exceed total — recorded, not fixed | 1 (test + doc comment), 2 (`toMs` doc) |
| `SittingRow`: badge, title, project, note count, span, total, Play | 2 |
| No tags, no billable mark on the parent | 2 (component doc) |
| Parent has no edits; adds no mutations | 2 (component doc), Global Constraints |
| Play resumes the newest member | 2 |
| Expansion: `Set` keyed `day\0key`, in memory, collapsed initially | 2 |
| `aria-expanded` / `aria-controls`, screenshot's wording | 2 |
| `grouped` prop defaults off vs setting defaults on | 2, 3 |
| Group scope within one day | 2 (`toLogItems` called per `group.entries`) |
| `userSettings.groupEntries`, optional + additive, default on | 3 |
| Settings checkbox; wired to `/timer` and `/reports` | 4 |
| Billable inheritance, idle bar only, client-side | 5 |
| `entries.edit.test.ts` invariant preserved | 5 (dedicated step 6) |

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Three steps flag an assumption about an existing harness (`getByDisplayValue` in Task 2, the input's accessible name and the suggestion flow in Task 5) — each states how to resolve it against the real file and forbids changing the component to suit the test, which is guidance, not a gap.

**Type consistency.** `toLogItems` / `sittingKey` / `LogItem` are named identically in Tasks 1 and 2. `Sitting` in `sitting-row.tsx` is derived via `Extract<LogItem, { kind: "sitting" }>` rather than restated. `SittingRow`'s props (`sitting`, `timeZone`, `use12Hour`, `projects`, `display`, `expanded`, `onToggle`, `onResume`, `controls`) match the call site in Task 2 exactly. `grouped` is the prop name in `DayList` (Task 2), `EntryLog` (Task 4) and both pages (Task 4). `groupEntries` is the field name in the schema, `Settings`, `SETTINGS_DEFAULTS`, `settingsReturns`, `getImpl`, `updateArgs`, `UpdateArgs`, the `SETTINGS` fixture, and `save({ groupEntries })`.

**Ordering.** Tasks 1 → 2 are a chain. Task 3 → 4 are a chain, and 4 also needs 2. Task 5 is fully independent and could go first if that is more convenient.
