import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { DayList, LogSkeleton } from "@/components/entries/day-list"
import { SittingRow } from "@/components/entries/sitting-row"
import { joinNotes, toLogItems } from "@/lib/group-sittings"
import { makeEntry } from "@/test-utils/fixtures"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { Classification } from "@/components/timer/timer-bar"
import type { LogItem } from "@/lib/group-sittings"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

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

  /*
   * A plain, ungrouped row alongside the sitting — the ordinary case, where a
   * day is not JUST one repeated title. Its title cannot join `twice`, and its
   * duration is chosen so the day's own total (2:15:00) reads differently from
   * the sitting's (2:00:00): the two used to be the same 7,200,000ms because
   * the sitting WAS the whole day, which is what forced every assertion below
   * that needs "the sitting's own figure" to scope itself under `within(...)`
   * plus `.closest(".group")` to avoid also matching the day header. With this
   * entry in the day, the day header and the sitting row no longer say the
   * same thing, and those assertions can run unscoped.
   */
  const unrelated = makeEntry({
    _id: "c" as unknown as Doc<"timeEntries">["_id"],
    title: "Weekly retro",
    startedAt: 8_000_000,
    endedAt: 8_900_000,
    durationMs: 900_000,
  })

  const groups = [
    {
      day: "2026-08-09",
      label: "Today",
      entries: [unrelated, ...twice],
      notedCount: 1,
      totalMs: 8_100_000,
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

  it("renders entry and sitting titles at the title scale", () => {
    renderLog(true)
    const entryTitle = screen.getByRole("button", { name: "Description: Weekly retro" })
    expect(entryTitle.className).toContain("text-base")

    const sittingTitle = screen.getByText("Crew dropdowns")
    expect(sittingTitle.className).toContain("text-base")
    expect(sittingTitle.className).toContain("font-medium")
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

    // The day's other, unrelated entry is no part of this group, and the
    // collapse must not reach it: it draws exactly as the flat log would.
    expect(screen.getByText("Weekly retro")).toBeTruthy()
  })

  it("shows the span from first start to last end, and the summed total", () => {
    renderLog(true)
    expect(screen.getByText("00:00 – 02:06")).toBeTruthy()
    // Unscoped for the same reason as the note count above: the day's own
    // total (2:15:00, the sitting plus the unrelated "Weekly retro" entry) is no
    // longer the same figure as the sitting's own (2:00:00), so each can only
    // match its own element.
    //
    // `formatClock` never pads the hour (`format-total.ts` / `duration.ts`),
    // so a two-hour total reads "2:00:00", not "02:00:00".
    expect(screen.getByText("2:00:00")).toBeTruthy()
    expect(screen.getByText("2:15:00")).toBeTruthy()
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

  /*
   * THE PARENT ROW AS EDITOR.
   *
   * Nested here rather than in a sibling describe so it can reuse `twice`,
   * `groups` and `renderLog` above — the same day, the same sitting, the same
   * reason the day header's own "1 of 3 noted" and the sitting's figure read
   * as different strings. `SittingRow` is exercised two ways below: through
   * `DayList` (`renderLog`) for behaviour that does not depend on the props
   * `DayList` does not wire up yet — see that component's own doc comment on
   * why — and directly, via `renderSitting`, for the classifier behaviour
   * that does.
   */
  describe("the parent row is the sitting's editor", () => {
    const SEALOGS = {
      _id: "jd7sealogs" as unknown as Id<"projects">,
      _creationTime: 0,
      userId: "user-1",
      name: "Sealogs",
      color: "amber",
      billableByDefault: true,
      archived: false,
      updatedAt: 0,
      deletedAt: null,
    } as unknown as Doc<"projects">

    const PRO_BONO = {
      ...SEALOGS,
      _id: "jd7probono" as unknown as Id<"projects">,
      name: "Pro bono",
      billableByDefault: false,
    } as unknown as Doc<"projects">

    /**
     * Renders `SittingRow` directly rather than through `DayList`: the
     * classifier props under test (`onClassify` chief among them) are not
     * ones `DayList` supplies yet — wiring them in is the next task — so a
     * test that needs to observe them has to mount the row itself. Built from
     * `twice` by default, overriding per member when a case needs to.
     */
    const renderSitting = ({
      onClassify = vi.fn(),
      onNoteOpen = vi.fn(),
      members,
      tags = [],
    }: {
      onClassify?: (change: Partial<Classification>) => void
      onNoteOpen?: () => void
      members?: Array<Partial<Doc<"timeEntries">>>
      tags?: Array<Doc<"tags">>
    } = {}) => {
      const memberEntries = members === undefined
        ? twice
        : members.map((over, index) =>
            makeEntry({
              _id: `sitting-member-${index}` as unknown as Doc<"timeEntries">["_id"],
              title: "Crew dropdowns",
              startedAt: index * 3_600_000,
              endedAt: (index + 1) * 3_600_000,
              ...over,
            })
          )
      const sitting = toLogItems(memberEntries).find(
        (item): item is Extract<LogItem, { kind: "sitting" }> => item.kind === "sitting"
      )
      if (sitting === undefined) throw new Error("fixture did not produce a sitting")

      return render(
        <SittingRow
          sitting={sitting}
          timeZone="UTC"
          use12Hour={false}
          projects={[SEALOGS, PRO_BONO]}
          tags={tags}
          display="hms"
          expanded={false}
          onToggle={() => {}}
          onResume={() => {}}
          onClassify={onClassify}
          onNoteOpen={onNoteOpen}
          onCreateProject={vi.fn()}
          onCreateTag={vi.fn()}
          controls="sitting-panel"
        />
      )
    }

    it("shows every distinct member note, joined — not any single member's", () => {
      // `renderSitting`'s two `twice` members carry only one note between
      // them, which is not enough to tell "the parent shows the join" apart
      // from "the parent shows whichever member happened to have a note" —
      // both would pass. Two DIFFERENT notes are the only fixture that can
      // fail if `SittingRow` regresses to picking one member's prose.
      const NOTE_A = "Set up the invite template for the crew."
      const NOTE_B = "Sent it out to the three team leads."
      const memberEntries = [
        makeEntry({
          _id: "sitting-note-a" as unknown as Doc<"timeEntries">["_id"],
          title: "Crew dropdowns",
          startedAt: 0,
          endedAt: 3_600_000,
          note: NOTE_A,
        }),
        makeEntry({
          _id: "sitting-note-b" as unknown as Doc<"timeEntries">["_id"],
          title: "Crew dropdowns",
          startedAt: 3_600_000,
          endedAt: 7_200_000,
          note: NOTE_B,
        }),
      ]
      const sitting = toLogItems(memberEntries).find(
        (item): item is Extract<LogItem, { kind: "sitting" }> => item.kind === "sitting"
      )
      if (sitting === undefined) throw new Error("fixture did not produce a sitting")

      // Rendered directly, not through `DayList`/`renderLog`: `SittingRow`
      // never mounts a member row itself — `DayList` does that, only while
      // expanded (`day-list.tsx:232`) — so this tree holds exactly one note
      // control and a member's own note has nothing here it could satisfy.
      const { container } = render(
        <SittingRow
          sitting={sitting}
          timeZone="UTC"
          use12Hour={false}
          projects={[]}
          tags={[]}
          display="hms"
          expanded={false}
          onToggle={() => {}}
          onResume={() => {}}
          onClassify={() => {}}
          onNoteOpen={() => {}}
          onCreateProject={vi.fn()}
          onCreateTag={vi.fn()}
          controls="sitting-panel"
        />
      )

      const expectedNote = joinNotes(sitting.entries)
      expect(expectedNote).toContain(NOTE_A)
      expect(expectedNote).toContain(NOTE_B)

      const noteButton = within(container)
        .getAllByRole("button")
        .find((button) => button.textContent === expectedNote)
      expect(noteButton).toBeTruthy()
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
      // Inheritance only ever turns billable ON. Removing a mark would
      // destroy the record of a decision; adding one destroys nothing.
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

    it("keeps the billable toggle reachable at every width, unlike the tag picker beside it", () => {
      // Fix for a phone-unreachable control: `ProjectPicker`'s `chooseProject`
      // can mark a sitting billable at any width, so the one control that can
      // undo that has to exist at every width too — jsdom computes no layout,
      // so "every width" is asserted as the absence of Tailwind's responsive
      // `hidden` utility rather than a measured viewport.
      renderSitting()

      const toggle = screen.getByLabelText("Not billable")
      expect(toggle.className).not.toMatch(/\bhidden\b/)

      // The tag picker is the control this is contrasted against: it stays
      // narrow-width-hidden, unaffected by this fix.
      const tagPicker = screen.getByLabelText("Tags")
      expect(tagPicker.className).toMatch(/\bhidden\b/)
    })

    it("wires the tag picker to onClassify", () => {
      const onClassify = vi.fn()
      const FOCUS = {
        _id: "tag-focus" as unknown as Id<"tags">,
        _creationTime: 0,
        userId: "user-1",
        name: "Focus",
        color: "amber",
        archived: false,
        updatedAt: 0,
        deletedAt: null,
      } as unknown as Doc<"tags">
      renderSitting({ onClassify, tags: [FOCUS] })

      fireEvent.click(screen.getByLabelText("Tags"))
      fireEvent.click(screen.getByRole("option", { name: "Focus" }))

      expect(onClassify).toHaveBeenCalledWith({ tagIds: [FOCUS._id] })
    })

    it("opens the note editor for the sitting from the parent's own note control", () => {
      const onNoteOpen = vi.fn()
      renderSitting({ onNoteOpen })

      // `twice`'s one member note is enough to reach the note button here —
      // this test is about the control firing `onNoteOpen`, not about what
      // text it shows (that is the joined-notes test above).
      fireEvent.click(screen.getByRole("button", { name: /Finished the assignment modal\./ }))

      expect(onNoteOpen).toHaveBeenCalledTimes(1)
    })

    it("no longer counts noted members on the parent", () => {
      renderLog(true)
      // Positive first: without it, this test also passes if grouping breaks
      // entirely and no `SittingRow` renders at all — the absence below would
      // then be true for the wrong reason.
      expect(screen.getByLabelText("Show grouped entries")).toBeTruthy()
      expect(screen.queryByText(/of 2 noted/)).toBeNull()
    })
  })

  /*
   * A MEMBER CARRIES TIME, NOT PROSE.
   *
   * `SittingRow` above already owns the note — this is the other half of that
   * move: `DayList` has to stop a member row from drawing one of its own, or
   * the same prose reads twice within one disclosure. Scoped to a group of
   * just `twice` (not `groups`, which also carries the unrelated "Weekly
   * retro" row) so a billable-toggle or note-button query below matches
   * exactly the sitting under test, not a second unrelated row sharing the
   * same unlit state.
   */
  describe("a sitting's members carry time, not prose", () => {
    const sittingOnly = [
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

    const renderGroupedLog = (actions: EntryRowActions = noActions) =>
      render(
        <DayList
          groups={sittingOnly}
          timeZone="UTC"
          use12Hour={false}
          weekStartDay={0}
          projects={[]}
          tags={[]}
          actions={actions}
          grouped
        />
      )

    it("renders no note line on a member row", () => {
      renderGroupedLog()
      fireEvent.click(screen.getByLabelText("Show grouped entries"))

      // Both members are on screen with their own times — `formatTimeRange`
      // over UTC epoch instants, un-padded like every other assertion above.
      expect(screen.getByText("01:06 – 02:06")).toBeTruthy()
      expect(screen.getByText("00:00 – 01:00")).toBeTruthy()
      // ...and exactly one note control between them, on the parent: the
      // joined note text (member "b" is the only one of `twice` carrying a
      // note), not a second copy of it and not an empty hatch on either
      // member. The query has to match BOTH shapes a member's `NoteLine`
      // could take — the prose button (a copy of "b"'s note) and the
      // "+ add note" hatch (what "a", note-less, would render) — or an
      // implementation that only suppressed the note line when the note was
      // non-empty would leave "a"'s hatch showing and still pass.
      expect(
        screen.queryAllByRole("button", {
          name: /add note|Finished the assignment modal\./i,
        })
      ).toHaveLength(1)
    })

    it("still renders the note on a lone entry", () => {
      // A row that is not part of a sitting is untouched by any of this.
      const lone = [
        {
          day: "2026-08-09",
          label: "Today",
          entries: [
            makeEntry({ _id: "lone" as unknown as Doc<"timeEntries">["_id"] }),
          ],
          notedCount: 0,
          totalMs: 3_600_000,
          billableMs: 0,
          runningCount: 0,
        },
      ]
      render(
        <DayList
          groups={lone}
          timeZone="UTC"
          use12Hour={false}
          weekStartDay={0}
          projects={[]}
          tags={[]}
          actions={noActions}
          grouped
        />
      )
      expect(screen.getByRole("button", { name: /\+ add note/i })).toBeTruthy()
    })

    it("hands every member to the classify action", () => {
      const onSittingClassify = vi.fn()
      renderGroupedLog({ onSittingClassify } as unknown as EntryRowActions)

      // Collapsed: the sitting's own toggle is the only "Not billable" control
      // on screen (the members are unmounted at rest — see `day-list.tsx`).
      fireEvent.click(screen.getByLabelText("Not billable"))

      expect(onSittingClassify).toHaveBeenCalledWith(
        [expect.objectContaining({ _id: "b" }), expect.objectContaining({ _id: "a" })],
        { billable: true }
      )
    })
  })
})
