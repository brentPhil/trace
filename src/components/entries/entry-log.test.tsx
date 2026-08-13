import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { EntryLog } from "@/components/entries/entry-log"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { makeEntry, noEntryActions } from "@/test-utils/fixtures"
import type { EntryActions } from "@/hooks/use-entry-actions"
import type { DayGroup, Entry } from "@/lib/group-entries"
import type { Doc } from "../../../convex/_generated/dataModel"

/*
 * THE REGRESSION THIS PINS: a sitting-wide write used to fail behind a
 * `.catch(() => {})` that said nothing — the optimistic patch to every
 * member (including `billable`, which reaches invoices) reverted with no
 * explanation. `EntryLog.onSittingClassify` now reports that refusal the
 * same way the row's own classify does (`use-entry-actions.ts`): a
 * high-priority toast carrying `errorMessage(thrown)`.
 */

const updateMany = vi.fn()

vi.mock("@/hooks/use-entry-edit-mutations", () => ({
  useEntryEditMutations: () => ({ updateMany }),
}))

vi.mock("@/hooks/use-classifiers", () => ({
  useClassifiers: () => ({ projects: [], tags: [] }),
}))

afterEach(() => {
  cleanup()
  updateMany.mockReset()
})

/** Two intervals of one title on one day — a sitting of 2 when `grouped`. */
const twice: Array<Entry> = [
  makeEntry({
    _id: "b" as unknown as Doc<"timeEntries">["_id"],
    title: "Crew dropdowns",
    startedAt: 4_000_000,
    endedAt: 7_600_000,
    durationMs: 3_600_000,
  }),
  makeEntry({
    _id: "a" as unknown as Doc<"timeEntries">["_id"],
    title: "Crew dropdowns",
    startedAt: 0,
    endedAt: 3_600_000,
    durationMs: 3_600_000,
  }),
]

const groups: Array<DayGroup> = [
  {
    day: "2026-08-09",
    label: "Today",
    entries: twice,
    notedCount: 0,
    totalMs: 7_200_000,
    billableMs: 0,
    runningCount: 0,
  },
]

const renderEntryLog = ({
  shownGroups = groups,
  actions = {
    ...noEntryActions,
    onRemoveMany: vi.fn().mockResolvedValue(true),
  },
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

describe("EntryLog — a sitting-wide write that fails", () => {
  it("raises a high-priority toast instead of reverting silently", async () => {
    updateMany.mockRejectedValueOnce(new Error("refused"))

    renderEntryLog({ actions: noEntryActions })

    // The sitting's own billable toggle — collapsed, so it is the only "Not
    // billable" control on screen.
    fireEvent.click(screen.getByLabelText("Not billable"))

    // A plain `Error` is not a trace error, so `errorMessage` falls back to
    // its generic sentence — see `src/lib/error-message.ts`. Scoped to the
    // "Notifications" region, not a bare `findByText`: a "high" priority
    // toast is also announced through a second, visually-hidden `role="alert"`
    // live region Base UI renders elsewhere in the portal for screen readers,
    // carrying the same text — an unscoped query would be ambiguous.
    const notifications = await screen.findByRole("region", { name: "Notifications" })
    expect(within(notifications).getByText("That didn't save. Try again.")).toBeTruthy()
  })
})

describe("EntryLog — selection lifecycle", () => {
  it("deletes the exact live selected entries and clears selection on success", async () => {
    const onRemoveMany = vi.fn().mockResolvedValue(true)
    renderEntryLog({ actions: { ...noEntryActions, onRemoveMany } })

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select all records for Today/ })
    )
    const expectedIds = groups[0].entries.map((entry) => entry._id)
    expect(
      screen.getByText(`${expectedIds.length} records selected`)
    ).toBeTruthy()

    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected records" })
    )
    await waitFor(() => expect(onRemoveMany).toHaveBeenCalledTimes(1))
    expect(
      onRemoveMany.mock.calls[0][0].map((entry: Entry) => entry._id)
    ).toEqual(expectedIds)
    await waitFor(() =>
      expect(
        screen.queryByRole("toolbar", { name: "Selected entry actions" })
      ).toBeNull()
    )
  })

  it("keeps a failed selection available for retry", async () => {
    const onRemoveMany = vi.fn().mockResolvedValue(false)
    renderEntryLog({ actions: { ...noEntryActions, onRemoveMany } })

    const day = screen.getByRole("checkbox", {
      name: /Select all records for Today/,
    })
    fireEvent.click(day)
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected records" })
    )
    await waitFor(() => expect(onRemoveMany).toHaveBeenCalled())

    expect(
      screen.getByRole("toolbar", { name: "Selected entry actions" })
    ).toBeTruthy()
    expect((day as HTMLInputElement).checked).toBe(true)
  })

  it("clears selection with the toolbar and Escape", () => {
    renderEntryLog()
    const day = screen.getByRole("checkbox", {
      name: /Select all records for Today/,
    })

    fireEvent.click(day)
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }))
    expect((day as HTMLInputElement).checked).toBe(false)

    fireEvent.click(day)
    fireEvent.keyDown(screen.getByRole("region", { name: "Time entries" }), {
      key: "Escape",
    })
    expect((day as HTMLInputElement).checked).toBe(false)
  })

  it("counts every underlying record of a collapsed sitting", () => {
    renderEntryLog()
    // Collapsed: one row on screen standing for two entries. The bar must
    // report what Delete would actually destroy.
    expect(
      screen.queryByRole("button", { name: "Hide grouped entries" })
    ).toBeNull()
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /Select all 2 records for Crew dropdowns/,
      })
    )
    expect(screen.getByText("2 records selected")).toBeTruthy()
  })

  it("drops an entry that disappeared from the log out of the selection", async () => {
    const onRemoveMany = vi.fn().mockResolvedValue(true)
    const { rerender } = renderEntryLog({
      actions: { ...noEntryActions, onRemoveMany },
    })

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Select all records for Today/ })
    )
    expect(screen.getByText("2 records selected")).toBeTruthy()

    // One member paginates out (or is deleted elsewhere). The selection must
    // narrow to what is still on screen rather than carry a stale id into the
    // next delete, which would fail the WHOLE transaction with NOT_FOUND.
    const shrunk: Array<DayGroup> = [
      { ...groups[0], entries: [twice[0]], totalMs: 3_600_000 },
    ]
    rerender(
      <Toast.Provider>
        <EntryLog
          groups={shrunk}
          timeZone="UTC"
          use12Hour={false}
          weekStartDay={0}
          actions={{ ...noEntryActions, onRemoveMany }}
          grouped
        />
        <ToastViewport />
      </Toast.Provider>
    )

    expect(screen.getByText("1 record selected")).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", { name: "Delete selected records" })
    )
    await waitFor(() => expect(onRemoveMany).toHaveBeenCalledTimes(1))
    expect(
      onRemoveMany.mock.calls[0][0].map((entry: Entry) => entry._id)
    ).toEqual([twice[0]._id])
  })

  it("shows no toolbar until something is selected", () => {
    renderEntryLog()
    expect(
      screen.queryByRole("toolbar", { name: "Selected entry actions" })
    ).toBeNull()
  })
})
