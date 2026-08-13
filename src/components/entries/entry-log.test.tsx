import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { EntryLog } from "@/components/entries/entry-log"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { makeEntry, noEntryActions } from "@/test-utils/fixtures"
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

describe("EntryLog — a sitting-wide write that fails", () => {
  it("raises a high-priority toast instead of reverting silently", async () => {
    updateMany.mockRejectedValueOnce(new Error("refused"))

    const twice = [
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
    const groups = [
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

    render(
      <Toast.Provider>
        <EntryLog
          groups={groups}
          timeZone="UTC"
          use12Hour={false}
          weekStartDay={0}
          actions={noEntryActions}
          grouped
        />
        <ToastViewport />
      </Toast.Provider>
    )

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
