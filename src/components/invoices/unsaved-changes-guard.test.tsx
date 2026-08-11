import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { UnsavedChangesGuard } from "@/components/invoices/unsaved-changes-guard"

/*
 * THE GUARD, and the two exits it covers.
 *
 * It only matters on one page — the invoice editor, the product's one buffered
 * surface — and the failure it prevents is silent by definition: a person clicks
 * the breadcrumb, the page changes, and the paragraph they wrote is gone with no
 * event anywhere to say so.
 *
 * Both mechanisms are asserted because neither covers the other. In-app
 * navigation never touches the browser's unload lifecycle, and a tab close never
 * reaches the router. Getting one right and forgetting the other produces a
 * guard that works in exactly the case you tested it in.
 *
 * `useBlocker` is mocked. It needs a live router, and what is being asserted
 * here is this component's own half of the contract: that it asks to block only
 * while dirty, that it renders a real prompt rather than falling back to
 * `confirm()`, and that every way of dismissing that prompt resolves the
 * blocker rather than leaving the navigation hanging forever.
 */

const { blocker, useBlocker } = vi.hoisted(() => {
  const resolver = {
    status: "idle" as "idle" | "blocked",
    proceed: vi.fn(),
    reset: vi.fn(),
  }
  /* Typed by its ARGUMENT, not inferred from the stub body: the options object
   * is the whole contract with the router, and a mock inferred as taking no
   * arguments makes the thing under test unassertable. */
  const spy = vi.fn(
    (_opts: {
      disabled: boolean
      withResolver: boolean
      enableBeforeUnload: boolean
    }) => resolver
  )
  return { blocker: resolver, useBlocker: spy }
})

vi.mock("@tanstack/react-router", () => ({ useBlocker }))

beforeEach(() => {
  blocker.status = "idle"
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** What `useBlocker` was last asked for — asserted directly, because this test
 *  has no router with which to perform a navigation. */
function lastOpts() {
  const call = useBlocker.mock.calls.at(-1)
  if (call === undefined) throw new Error("useBlocker was never called")
  return call[0]
}

describe("UnsavedChangesGuard — while the form is clean", () => {
  /* A guard that fires on a clean form is a dialog nobody can explain, and
   * people learn to click through it — which is how a guard stops working on
   * the day it is actually needed. */
  it("registers nothing with the router", () => {
    render(<UnsavedChangesGuard when={false} what="Notes" />)
    expect(lastOpts().disabled).toBe(true)
  })

  it("registers no beforeunload handler", () => {
    const add = vi.spyOn(window, "addEventListener")
    render(<UnsavedChangesGuard when={false} what="Notes" />)
    expect(add.mock.calls.filter(([type]) => type === "beforeunload")).toHaveLength(0)
    add.mockRestore()
  })

  it("shows no prompt", () => {
    render(<UnsavedChangesGuard when={false} what="Notes" />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("UnsavedChangesGuard — while the form is dirty", () => {
  it("asks the router to block, and asks for a resolver so it can draw its own prompt", () => {
    render(<UnsavedChangesGuard when={true} what="Notes" />)

    expect(lastOpts().disabled).toBe(false)
    // `withResolver` is what makes a real dialog possible at all: without it
    // `useBlocker` can only answer synchronously, and the only synchronous
    // prompt a browser has is `confirm()`.
    expect(lastOpts().withResolver).toBe(true)
    // Off, deliberately: the listener below is ours, so there is exactly one
    // registration and its lifetime is visibly the same `when`.
    expect(lastOpts().enableBeforeUnload).toBe(false)
  })

  /*
   * TAB CLOSE / RELOAD. The browser draws its own generic string here and
   * ignores anything we would rather it said — that is the platform's answer to
   * pages that begged. Both `preventDefault()` and `returnValue` are set,
   * because older WebKit and Firefox read only the second and a page setting one
   * of them silently fails to prompt on some browsers.
   */
  it("prompts on unload, and stops when the form goes clean", () => {
    const { rerender } = render(<UnsavedChangesGuard when={true} what="Notes" />)

    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    rerender(<UnsavedChangesGuard when={false} what="Notes" />)
    const clean = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
  })

  it("removes its unload listener when it unmounts", () => {
    const { unmount } = render(<UnsavedChangesGuard when={true} what="Notes" />)
    unmount()

    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})

/*
 * THE PROMPT ITSELF — ours, not `confirm()`.
 *
 * `confirm()` would have been the fallback if `useBlocker` had no resolver. It
 * does, so this is a real dialog: it can name the fields, it does not block the
 * main thread, and it is not suppressed in a background tab the way Chrome
 * suppresses `confirm()`.
 */
describe("UnsavedChangesGuard — the prompt", () => {
  function renderBlocked(what = "Billed to and Notes") {
    blocker.status = "blocked"
    render(<UnsavedChangesGuard when={true} what={what} />)
  }

  it("names what is unsaved rather than counting it", () => {
    renderBlocked()
    // "3 fields have unsaved changes" tells somebody deciding whether to
    // discard them nothing they can decide on.
    expect(screen.getByText(/Billed to and Notes/)).toBeTruthy()
    expect(screen.getByText(/only written when you press\s+Save/)).toBeTruthy()
  })

  it("agrees with itself about one field or several", () => {
    renderBlocked("Notes")
    expect(screen.getByText(/Notes has unsaved changes/)).toBeTruthy()
    cleanup()

    renderBlocked("Billed to and Notes")
    expect(screen.getByText(/Billed to and Notes have unsaved changes/)).toBeTruthy()
  })

  it("stays on the page when the answer is Keep editing", () => {
    renderBlocked()
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }))

    expect(blocker.reset).toHaveBeenCalled()
    expect(blocker.proceed).not.toHaveBeenCalled()
  })

  it("leaves only when the answer is explicitly Discard changes", () => {
    renderBlocked()
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))

    expect(blocker.proceed).toHaveBeenCalled()
    expect(blocker.reset).not.toHaveBeenCalled()
  })

  /*
   * Escape means "no, I didn't mean to leave" — the same answer as Keep
   * editing. Dismissing is what a person does when they are UNSURE, and a
   * dismissal that discarded their work would make the safest-feeling key the
   * destructive one. It also must not simply do nothing: the router is holding a
   * navigation open on a promise, and a prompt that closes without resolving it
   * leaves the app unable to navigate at all.
   */
  it("treats Escape as staying, not as discarding", () => {
    renderBlocked()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })

    expect(blocker.reset).toHaveBeenCalled()
    expect(blocker.proceed).not.toHaveBeenCalled()
  })
})
