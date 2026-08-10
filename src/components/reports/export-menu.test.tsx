import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ExportMenu } from "@/components/reports/export-menu"
import type { Breakdown } from "@/lib/report-series"

/*
 * `fireEvent`, not `@testing-library/user-event`, and plain assertions rather
 * than jest-dom matchers. Neither package is a dependency of this project, and
 * every other .test.tsx here drives Base UI popups with `fireEvent.click` plus
 * `findByRole` — see classifier-pickers.test.tsx.
 */
afterEach(cleanup)

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
      totalMs: HOUR,
      billableMs: HOUR,
      billableCents: 1_000,
      unratedBillableMs: 0,
      count: 1,
    },
  ],
  titlesTruncated: false,
}

const PROPS = {
  breakdown: BREAKDOWN,
  from: "2026-07-13" as const,
  to: "2026-07-13" as const,
  currency: "USD",
}

describe("ExportMenu", () => {
  it("offers exactly the three formats", async () => {
    render(<ExportMenu {...PROPS} disabledReason={null} />)

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
    render(
      <ExportMenu
        {...PROPS}
        breakdown={{ ...BREAKDOWN, truncated: true }}
        disabledReason="This period is too large to total exactly. Narrow the dates."
      />
    )

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

    render(<ExportMenu {...PROPS} disabledReason={null} />)
    fireEvent.click(screen.getByRole("button", { name: /export/i }))
    fireEvent.click(await screen.findByRole("menuitem", { name: "CSV" }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe("trace-report-2026-07-13.csv")

    vi.unstubAllGlobals()
    click.mockRestore()
  })
})
