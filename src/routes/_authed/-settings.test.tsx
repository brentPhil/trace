import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { Settings } from "@/routes/_authed/settings"
import { convexKey } from "@/test-utils/convex-query"
import { SETTINGS } from "@/test-utils/fixtures"
import { api } from "../../../convex/_generated/api"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"

type ConvexReactQueryModule = typeof ConvexReactQueryModuleType

/*
 * /settings' notes-in-the-PDF control.
 *
 * Worth its own coverage because the DEFAULT is the whole point and defaults
 * are what silently invert: a note is prose the user wrote about how the work
 * actually went, and the PDF is the copy that goes to a client. Off has to stay
 * off until somebody says otherwise, and the control has to state both
 * outcomes rather than leaving one to be inferred from an unchecked box.
 */

const { update } = vi.hoisted(() => ({ update: vi.fn(async () => null) }))

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactQueryModule>()
  return { ...actual, useConvexMutation: () => update }
})

afterEach(() => {
  cleanup()
  update.mockClear()
})

function renderSettings(over: Partial<typeof SETTINGS> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(convexKey(api.settings.get, {}), { ...SETTINGS, ...over })
  return render(
    <QueryClientProvider client={client}>
      <Toast.Provider>
        <Settings />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

const leaveOut = () => screen.getByLabelText("Leave notes out")
const printThem = () => screen.getByLabelText("Print each row's notes")

describe("/settings — notes in the PDF report", () => {
  it("states both outcomes rather than one checkbox to infer from", () => {
    renderSettings()
    expect(leaveOut()).toBeTruthy()
    expect(printThem()).toBeTruthy()
  })

  /* THE DEFAULT. `SETTINGS_DEFAULTS.pdfIncludeNotes` is false and this is the
   * screen that has to show it that way; a control that renders "on" over a
   * stored "off" is how a client receives notes nobody chose to send. */
  it("is off for an account that has never touched it", () => {
    renderSettings({ pdfIncludeNotes: false })
    expect((leaveOut() as HTMLInputElement).checked).toBe(true)
    expect((printThem() as HTMLInputElement).checked).toBe(false)
  })

  it("reflects an account that has turned it on", () => {
    renderSettings({ pdfIncludeNotes: true })
    expect((printThem() as HTMLInputElement).checked).toBe(true)
    expect((leaveOut() as HTMLInputElement).checked).toBe(false)
  })

  it("saves the moment it is switched on, like every other control here", async () => {
    renderSettings({ pdfIncludeNotes: false })
    fireEvent.click(printThem())
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pdfIncludeNotes: true }))
  })

  it("saves the moment it is switched back off", async () => {
    renderSettings({ pdfIncludeNotes: true })
    fireEvent.click(leaveOut())
    await waitFor(() => expect(update).toHaveBeenCalledWith({ pdfIncludeNotes: false }))
  })

  /* The hint has to say what the control does NOT touch, because "notes in the
   * report" reads as though it might change /reports itself or the other two
   * export formats. It changes neither. */
  it("says which artefacts it does and does not change", () => {
    renderSettings()
    const hint = screen.getByText(/A note is what you wrote/)
    expect(hint.textContent).toContain("CSV and XLSX exports never carry notes")
  })
})
