import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { DayList, LogSkeleton } from "@/components/entries/day-list"
import { makeEntry } from "@/test-utils/fixtures"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { Doc } from "../../../convex/_generated/dataModel"

/*
 * The regression this guards: `/reports` used to fall through to Timer's
 * onboarding copy ("Nothing tracked yet…") for the entire first page load,
 * because `usePaginatedQuery` reports `groups.length === 0` for exactly the
 * same shape of empty array a genuinely empty account produces. `DayList`
 * cannot itself know whether zero groups means "still loading" or "actually
 * empty" — that is the caller's call to make, via `empty` — so these tests
 * pin down the two building blocks a caller needs to make it: an overridable
 * empty state, and a loading placeholder that can never be confused with it.
 */

const noActions = {} as EntryRowActions

afterEach(cleanup)

describe("DayList empty state", () => {
  it("falls back to the Timer onboarding copy when no empty state is supplied", () => {
    render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
      />
    )
    expect(screen.getByText("Nothing tracked yet.")).toBeTruthy()
  })

  it("renders the caller's own empty state instead, when one is given", () => {
    render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={<p>Nothing here. Try a wider date range, or clear the filters.</p>}
      />
    )
    expect(
      screen.getByText("Nothing here. Try a wider date range, or clear the filters.")
    ).toBeTruthy()
    // The onboarding copy must not also be present underneath it — a caller
    // supplying its own empty state expects it to REPLACE the default, not
    // sit alongside it.
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
  })

  /*
   * `empty ?? <EmptyLog/>` made "render nothing" inexpressible: `null` is the
   * obvious way to ask for it and fell straight back to the onboarding copy.
   * Timer's answer was to stop rendering `EntryLog` at all while a filter
   * matched nothing — which took `NoteSheet` and every held note draft down
   * with it on a keystroke. This is the API that lets it keep the log mounted.
   */
  it("renders nothing at all when the caller explicitly passes null", () => {
    const { container } = render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={null}
      />
    )
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    expect(container.textContent).toBe("")
  })

  it("never shows any empty state — onboarding or custom — once groups arrive", () => {
    const groups = [
      {
        day: "2026-08-09",
        label: "Today",
        entries: [],
        notedCount: 0,
        totalMs: 0,
        billableMs: 0,
        runningCount: 0,
      },
    ]
    render(
      <DayList
        groups={groups}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={<p>Nothing here.</p>}
      />
    )
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    expect(screen.queryByText("Nothing here.")).toBeNull()
    expect(screen.getByText("Today")).toBeTruthy()
  })
})

/*
 * "EntryRow — addressable from the calendar" USED TO SIT HERE, and it is gone
 * rather than moved. It pinned `data-entry-id` and `tabIndex === -1` on the
 * row, both of which existed for one caller: the calendar, which switched to
 * List, found the row by that attribute and focused it. A block on the grid
 * opens its own editor now — see `calendar-entry-popover.tsx` — so nothing
 * looks a row up by id, and a test asserting an attribute no code reads is a
 * test that can only ever fail for the wrong reason.
 */

/*
 * A NOTE THE READER CAN ACTUALLY READ.
 *
 * The log clips a note to one line, which is what makes fifty rows scannable
 * and what makes the log useless the moment the note is the thing you came
 * for — a standup, or an invoice line. /timer carries a switch for it now, and
 * these are the two properties a row owes that switch: the text stops being
 * ellipsed, and it stops being label-sized.
 *
 * ASSERTED AS CLASSES, deliberately. jsdom computes no layout — every element
 * is zero by zero, so "is this text clipped" has no runtime answer here. The
 * classes ARE the behaviour in a utility system, and they are exactly what a
 * careless refactor of the row would drop.
 */
describe("a note in the log", () => {
  const NOTE = "Rewrote the CSV import so a half-finished upload can be resumed."

  const dayWithNote = [
    {
      day: "2026-08-09",
      label: "Today",
      entries: [makeEntry({ note: NOTE })],
      notedCount: 1,
      totalMs: 3_600_000,
      billableMs: 0,
      runningCount: 0,
    },
  ]

  const renderLog = (notesExpanded: boolean) =>
    render(
      <DayList
        groups={dayWithNote}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        notesExpanded={notesExpanded}
      />
    )

  it("clips it to one line by default", () => {
    renderLog(false)
    const note = screen.getByText(NOTE)

    expect(note.className).toContain("truncate")
    expect(note.className).not.toContain("whitespace-pre-wrap")
  })

  it("wraps it and steps it up to body size when asked", () => {
    renderLog(true)
    const note = screen.getByText(NOTE)

    // `pre-wrap` and not plain wrapping: a note is typed in a textarea where
    // Enter inserts a newline, so the user's own paragraph breaks are part of
    // what they wrote. `break-words` is the pasted-URL case.
    expect(note.className).toContain("whitespace-pre-wrap")
    expect(note.className).toContain("break-words")
    expect(note.className).not.toContain("truncate")

    // `text-xs` is a label size. Once the note is what you came to read it is
    // prose, at the size the note sheet itself writes it.
    const control = note.closest("button")
    expect(control).not.toBeNull()
    expect(control!.className).toContain("text-sm")
    expect(control!.className).not.toContain("text-xs")
  })

  it("still opens the note sheet either way", () => {
    // The clip is a display mode, not a different control: the one gesture the
    // note line has — open it and edit it — has to survive the switch.
    renderLog(true)
    expect(screen.getByText(NOTE).closest("button")?.getAttribute("type")).toBe("button")
  })
})

describe("LogSkeleton", () => {
  /*
   * The two tests that used to sit here could not fail. One asserted that
   * `LogSkeleton` does not contain "Nothing tracked yet." — it renders only
   * `<Skeleton>` divs, so that is true by construction and stays true if the
   * component is deleted. The other asserted that SOME descendant carries
   * `aria-hidden="true"`, which any descendant satisfies. These assert the
   * three properties the component actually has to have.
   */

  it("says out loud that something is loading", () => {
    // The whole thing used to be `aria-hidden`, and it is the ONLY content on
    // screen during the first page load. A screen-reader user got silence
    // where a sighted user gets shimmering bars.
    render(<LogSkeleton />)
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")
  })

  it("hides the decorative bars, and only the bars, from the accessibility tree", () => {
    const { container } = render(<LogSkeleton />)
    const bars = container.querySelectorAll('[data-slot="skeleton"]')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull()
    // …and the announcement is NOT inside that hidden subtree, or it would be
    // just as silent as the bars.
    expect(screen.getByRole("status").closest('[aria-hidden="true"]')).toBeNull()
  })

  it("draws bars that are visible on the ground, and not pill-shaped", () => {
    // `bg-muted` resolves to `--surface`, which is 1.09:1 against the log's
    // ground — invisible, and halved again at the trough of `animate-pulse`.
    // `rounded-2xl` on an `h-4` bar is a full pill, the "rounded-everything"
    // look DESIGN.md rejects by name. Both are properties of the shared
    // primitive, so this is where they get pinned.
    const { container } = render(<LogSkeleton />)
    for (const bar of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bar.className).toContain("bg-skeleton")
      expect(bar.className).not.toContain("bg-muted")
      expect(bar.className).not.toContain("rounded-2xl")
    }
  })
})

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
    // Not `getByDisplayValue`: `EditableTitle` only becomes an input while
    // being edited (`InlineEdit`, `inline-edit.tsx`). At rest it is a button
    // wrapping a `<span>` of the trimmed title, so that span is what a row
    // actually offers to find a title by.
    expect(screen.getAllByText("Crew dropdowns")).toHaveLength(2)
  })

  it("collapses the repeat behind a count, hiding both rows until asked", () => {
    renderLog(true)

    const toggle = screen.getByLabelText("Show grouped entries")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(toggle.textContent).toContain("2")
    // Not merely hidden: not rendered. Fifty collapsed groups would otherwise
    // mount fifty rows' worth of pickers nobody can see.
    //
    // The count is 1, not 0: `SittingRow`'s own static title span (see that
    // component) reads "Crew dropdowns" too, and it is not one of the members
    // this assertion is about — those are the ones absent.
    expect(screen.queryAllByText("Crew dropdowns")).toHaveLength(1)
  })

  it("states how many of the group carry a note", () => {
    // The day header's own nudge, moved onto the parent. Collapsing rows must
    // not turn a missing note from VISIBLE into ABSENT.
    //
    // Scoped to the sitting row itself: this fixture's one sitting IS the
    // whole day, so the day header above states the identical "1 of 2 noted"
    // for its own, unrelated reason — asserting unscoped would pass or fail
    // on the wrong element.
    renderLog(true)
    const sittingRow = screen.getByLabelText("Show grouped entries").closest<HTMLElement>(".group")
    expect(sittingRow).not.toBeNull()
    expect(within(sittingRow!).getByText("1 of 2 noted")).toBeTruthy()
  })

  it("shows the span from first start to last end, and the summed total", () => {
    renderLog(true)
    expect(screen.getByText("00:00 – 02:06")).toBeTruthy()
    // Scoped for the same reason as the note count above: this fixture's day
    // total and sitting total are the same 7,200,000ms, so an unscoped query
    // would find the day header's figure too.
    //
    // `formatClock` never pads the hour (`format-total.ts` / `duration.ts`),
    // so a two-hour total reads "2:00:00", not "02:00:00".
    const sittingRow = screen.getByLabelText("Show grouped entries").closest<HTMLElement>(".group")
    expect(sittingRow).not.toBeNull()
    expect(within(sittingRow!).getByText("2:00:00")).toBeTruthy()
  })

  it("reveals every member when expanded, and says so", () => {
    renderLog(true)

    const badge = screen.getByLabelText("Show grouped entries")
    fireEvent.click(badge)

    const toggle = screen.getByLabelText("Hide grouped entries")
    expect(toggle.getAttribute("aria-expanded")).toBe("true")

    // Scoped to the revealed container, not the whole document: the parent
    // row's own static title span (see `SittingRow`) also reads "Crew
    // dropdowns", and it is not one of the two members being counted here.
    const panelId = toggle.getAttribute("aria-controls")
    const panel = document.getElementById(panelId!)
    expect(panel).not.toBeNull()
    expect(within(panel!).getAllByText("Crew dropdowns")).toHaveLength(2)
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
    expect(screen.getByText("Email")).toBeTruthy()
    expect(screen.getByText("Standup")).toBeTruthy()
  })
})
