import { Toast } from "@base-ui/react/toast"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Announcer } from "@/components/a11y/announcer"
import { CopyEntriesButton } from "@/components/entries/copy-entries-button"
import { ToastViewport } from "@/components/ui/toast"
import type { ComponentProps } from "react"

afterEach(cleanup)

/*
 * `Toast.useToastManager()` throws with no ancestor provider, and `useAnnounce`
 * silently no-ops without one — the same wrapper `RootComponent` supplies app
 * wide (routes/__root.tsx), for the same reason `export-menu.test.tsx` copies
 * it. The `Announcer` is here rather than stubbed because the announcement IS
 * the assertion in the case below: it is the only thing that tells a
 * screen-reader user the copy happened.
 */
function renderButton(props: ComponentProps<typeof CopyEntriesButton>) {
  return render(
    <Announcer>
      <Toast.Provider>
        <CopyEntriesButton {...props} />
        <ToastViewport />
      </Toast.Provider>
    </Announcer>
  )
}

/** Replaces the clipboard for one test, and reports what reached it. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
}

describe("CopyEntriesButton", () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it("puts the built text on the clipboard", async () => {
    const written: Array<string> = []
    stubClipboard(async (text) => {
      written.push(text)
    })

    renderButton({ count: 2, build: () => "Time entries\n2 records" })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await waitFor(() => expect(written).toEqual(["Time entries\n2 records"]))
  })

  /*
   * The thunk is the whole reason this component takes a function rather than a
   * string: the text is a transcript of every row on screen, and building it
   * per render — for a button nobody has pressed — is a scan of the log on
   * every keystroke in the search box beside it.
   */
  it("builds the text only when pressed", () => {
    stubClipboard(async () => {})
    const build = vi.fn(() => "text")

    renderButton({ count: 1, build })
    expect(build).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(build).toHaveBeenCalledTimes(1)
  })

  /*
   * The count, not "Copied": the tick tells a sighted reader it worked, and the
   * number is what says WHAT was copied — a partial log is the ordinary case on
   * /reports, where the button copies the pages loaded so far.
   */
  it("announces how many records were copied", async () => {
    stubClipboard(async () => {})

    renderButton({ count: 7, build: () => "text" })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await screen.findByText("Copied 7 records")
  })

  it("says one record in the singular", async () => {
    stubClipboard(async () => {})

    renderButton({ count: 1, build: () => "text" })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await screen.findByText("Copied 1 record")
  })

  it("confirms on the button itself", async () => {
    stubClipboard(async () => {})

    renderButton({ count: 1, build: () => "text" })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    await screen.findByRole("button", { name: "Copied" })
  })

  /*
   * THE FAILURE THIS COMPONENT EXISTS TO SURFACE. A clipboard write can be
   * refused — no secure context, the document not focused, a permission denied
   * — and the button gives no other sign. Silence means the reader pastes
   * whatever was on the clipboard before into a message they are about to send.
   */
  it("says so out loud when the clipboard refuses", async () => {
    stubClipboard(async () => {
      throw new Error("denied")
    })
    // The `execCommand` fallback is not implemented in jsdom; make its absence
    // an explicit refusal rather than a thrown TypeError from inside the lib.
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    })

    renderButton({ count: 1, build: () => "text" })
    fireEvent.click(screen.getByRole("button", { name: "Copy" }))

    // Two matches: the visible toast, and Base UI's own live region beside it.
    expect(
      await screen.findAllByText("Could not copy to the clipboard.")
    ).not.toHaveLength(0)
    // And it must NOT claim success alongside the refusal.
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull()
  })

  /*
   * Disabled with the reason ON the control rather than a toast after a click
   * that appeared to work — `ExportMenu`'s rule, and the reader who most needs
   * it is the one who cannot see that the log below is empty.
   */
  it("refuses an empty log, with the reason readable", () => {
    stubClipboard(async () => {})
    const build = vi.fn(() => "text")

    renderButton({ count: 0, build })

    const button = screen.getByRole("button", { name: "Copy" })
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(screen.getByText("There are no records to copy.")).toBeTruthy()
    expect(button.getAttribute("aria-describedby")).toBe(
      screen.getByText("There are no records to copy.").id
    )
  })

  /*
   * "THESE ARE NOT ALL THE ROWS YET", which the button cannot see for itself.
   *
   * The text it builds states a record count and a total under the range the
   * caller named. Copied off a half-paginated log, that floor reads as the
   * answer for the whole range in a paste that has no load-more control under
   * it — so the page, which is the only thing that knows, refuses on its
   * behalf.
   */
  it("takes a refusal from the caller, and states it", () => {
    stubClipboard(async () => {})
    const build = vi.fn(() => "text")

    renderButton({
      count: 100,
      build,
      disabledReason: "Still loading this period.",
    })

    const button = screen.getByRole("button", { name: "Copy" })
    expect(button.hasAttribute("disabled")).toBe(true)
    expect(button.getAttribute("aria-describedby")).toBe(
      screen.getByText("Still loading this period.").id
    )
    fireEvent.click(button)
    expect(build).not.toHaveBeenCalled()
  })

  /* An empty log outranks the caller's reason: naming the pagination while
   * nothing is on screen explains a button with no rows behind it. */
  it("prefers the empty-log reason over the caller's", () => {
    stubClipboard(async () => {})

    renderButton({
      count: 0,
      build: () => "text",
      disabledReason: "Still loading this period.",
    })

    expect(screen.getByText("There are no records to copy.")).toBeTruthy()
    expect(screen.queryByText("Still loading this period.")).toBeNull()
  })
})
