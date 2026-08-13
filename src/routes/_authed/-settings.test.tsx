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

/*
 * /settings' grouping control — here for the same reason the block above is:
 * the DEFAULT is the point, and this one defaults ON.
 *
 * The default itself is the SERVER's, and is asserted there: see
 * convex/settings.test.ts on a row written before the column existed reading
 * back `true`. What this screen owns is the rendering of it — a control that
 * showed unchecked over a stored `true` would read as a feature nobody
 * enabled, and that is a client bug the server test cannot see.
 *
 * `DayList`'s own `grouped` prop defaults OFF, which is deliberate and
 * documented there; it is not the shipped default and nothing here should be
 * read as asserting it.
 */
const groupBox = () =>
  screen.getByLabelText("Group a day's repeats of the same entry") as HTMLInputElement

describe("/settings — repeated entries", () => {
  /* NO OVERRIDE — this one binds to the `SETTINGS` fixture deliberately, so
   * that flipping the shipped default without meaning to fails here rather
   * than passing against a value the test supplied itself. */
  it("is on for an account that has never touched it", () => {
    renderSettings()
    expect(groupBox().checked).toBe(true)
  })

  it("reflects an account that has turned it off", () => {
    renderSettings({ groupEntries: false })
    expect(groupBox().checked).toBe(false)
  })

  it("saves the moment it is switched off", async () => {
    renderSettings({ groupEntries: true })
    fireEvent.click(groupBox())
    await waitFor(() => expect(update).toHaveBeenCalledWith({ groupEntries: false }))
  })

  it("saves the moment it is switched back on", async () => {
    renderSettings({ groupEntries: false })
    fireEvent.click(groupBox())
    await waitFor(() => expect(update).toHaveBeenCalledWith({ groupEntries: true }))
  })

  /* The hint has to say what grouping does NOT touch. "Group repeats" reads as
   * though entries were being merged into one, which would change what a client
   * is billed for; nothing is merged and no total moves. */
  it("says nothing is merged and no total moves", () => {
    renderSettings()
    const hint = screen.getByText(/When you start and stop the same task/)
    expect(hint.textContent).toContain("Nothing is merged")
    expect(hint.textContent).toContain("exports, invoices and totals are unaffected")
  })
})
