import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ExportMenu } from "@/components/reports/export-menu"
import { Toast, ToastViewport } from "@/components/ui/toast"
import type { Breakdown } from "@/lib/report-series"
import type { ComponentProps } from "react"

/*
 * `fireEvent`, not `@testing-library/user-event`, and plain assertions rather
 * than jest-dom matchers. Neither package is a dependency of this project, and
 * every other .test.tsx here drives Base UI popups with `fireEvent.click` plus
 * `findByRole` — see classifier-pickers.test.tsx.
 */
afterEach(cleanup)

// `pdfBlob` now does real work (pdf-lib, layout) — mocked here so the one test
// that needs it to fail can drive that failure directly, instead of standing
// up a real report just to reject partway through.
vi.mock("@/lib/export/to-pdf", () => ({ pdfBlob: vi.fn() }))

const HOUR = 3_600_000

const BREAKDOWN: Breakdown = {
  totalMs: HOUR,
  billableMs: HOUR,
  count: 1,
  runningCount: 0,
  truncated: false,
  billableCents: 1_000,
  unratedBillableMs: 0,
  days: [
    { day: "2026-07-13", totalMs: HOUR, billableMs: HOUR, billableCents: 1_000, count: 1 },
  ],
  projects: [],
  hours: Array.from({ length: 24 }, () => 0),
  titles: [
    {
      projectId: null,
      project: "Acme",
      title: "Standup",
      weekStart: "2026-07-13",
      notes: [],
      totalMs: HOUR,
      billableMs: HOUR,
      billableCents: 1_000,
      unratedBillableMs: 0,
      count: 1,
    },
  ],
  titlesTruncated: false,
  notesTruncated: false,
}

const PROPS = {
  breakdown: BREAKDOWN,
  from: "2026-07-13" as const,
  to: "2026-07-13" as const,
  currency: "USD",
}

// `ExportMenu` reads `Toast.useToastManager()`, which throws with no
// ancestor `Toast.Provider` — the same wrapper `RootComponent` supplies app
// wide (see routes/__root.tsx) and `copy-entries-button.test.tsx` copies for the same
// reason.
function renderMenu(props: ComponentProps<typeof ExportMenu>) {
  return render(
    <Toast.Provider>
      <ExportMenu {...props} />
      <ToastViewport />
    </Toast.Provider>
  )
}

describe("ExportMenu", () => {
  it("offers exactly the three formats", async () => {
    renderMenu({ ...PROPS, disabledReason: null })

    fireEvent.click(screen.getByRole("button", { name: /export/i }))

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent)
    ).toEqual(["PDF", "CSV", "XLSX"])
  })

  /*
   * The rule this component exists to enforce. `truncated` means every figure
   * on /reports is a floor, and a floor that becomes a document handed to a
   * client is a client under-billed by an unknown amount with nothing on the
   * page to reveal it. Disabled with the reason ON the control, not a toast
   * after a click that appeared to work.
   */
  it("refuses a truncated range, and says why on the control itself", () => {
    renderMenu({
      ...PROPS,
      breakdown: { ...BREAKDOWN, truncated: true },
      disabledReason: "This period is too large to total exactly. Narrow the dates.",
    })

    const trigger = screen.getByRole("button", { name: /export/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(true)

    // The reason must be REACHABLE, not merely present. `aria-describedby`
    // pointing at rendered text is what a screen reader announces; a `title`
    // on a disabled control is announced by nothing and focusable by no one.
    const describedBy = trigger.getAttribute("aria-describedby")
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy!)?.textContent).toBe(
      "This period is too large to total exactly. Narrow the dates."
    )
  })

  it("downloads a CSV named for the range", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    // jsdom implements neither, and `downloadBlob` calls both.
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    })

    renderMenu({ ...PROPS, disabledReason: null })
    fireEvent.click(screen.getByRole("button", { name: /export/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "CSV" }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe("chroneli-report-2026-07-13.csv")

    vi.unstubAllGlobals()
    click.mockRestore()
  })

  /*
   * The bug: `run()` had a `finally` and no `catch`, so a rejected export was
   * an unhandled promise rejection and the button quietly went back to
   * "Export" — nothing on screen ever said the click had failed. Task 8 gave
   * `to-pdf.ts` a real implementation, so the failure this test drives is now
   * mocked rather than the stub's unconditional throw — the toast/un-stick
   * behaviour under test is `run()`'s, not `pdfBlob`'s.
   */
  it("surfaces a failed export as a toast naming the format, and un-sticks the button", async () => {
    const { pdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(pdfBlob).mockRejectedValueOnce(new Error("boom"))

    renderMenu({ ...PROPS, disabledReason: null })
    fireEvent.click(screen.getByRole("button", { name: /export/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "PDF" }))

    // Scoped to the `role="alert"` live region, not a bare `findByText` —
    // Base UI's toast renders its title twice: once visibly (marked
    // `aria-hidden`) and once inside this region for screen readers (see
    // `ToastList` in `ui/toast.tsx`) — and an unscoped text query matches
    // both.
    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("PDF export failed.")).toBeTruthy()

    // Never the thrown Error's own text. The mock rejects with "boom"; if the
    // catch block regressed to interpolating the caught error's message
    // (e.g. `errorMessage(thrown)`) instead of the fixed format-naming
    // string, this would leak straight into the toast a client reads.
    expect(screen.queryByText(/boom/i)).toBeNull()

    const trigger = screen.getByRole("button", { name: /export/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
    expect(trigger.textContent).toContain("Export")
  })
})
