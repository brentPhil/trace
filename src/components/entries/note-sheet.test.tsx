import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NoteSheet, clearNoteDrafts } from "@/components/entries/note-sheet"
import { Toast, ToastViewport } from "@/components/ui/toast"
import type { Entry } from "@/lib/group-entries"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * The bug: Escape, a click on the backdrop, and Skip all called `onOpenChange`
 * straight through with no check on `value`, so a typed note that was never
 * explicitly saved was simply gone. PRODUCT.md calls the note the product;
 * these tests pin the fix down at the behavioural level — what gets written,
 * what gets restored, what a user sees — rather than at implementation
 * details like which ref holds what.
 */

function makeEntry(over: Partial<Entry> = {}): Entry {
  return {
    _id: "e1" as unknown as Id<"timeEntries">,
    _creationTime: 0,
    userId: "u",
    title: "Client call",
    note: "",
    startedAt: Date.now() - 60_000,
    endedAt: Date.now(),
    durationMs: 60_000,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  } as Entry
}

/** A controlled harness matching how `EntryLog` actually drives the sheet:
 * `entry` is NOT cleared when the sheet closes, only `open` changes — so
 * reopening on the same entry is a real, supported path, not a special case. */
function Harness({
  entry,
  onSave,
}: {
  entry: Entry
  onSave: (id: Id<"timeEntries">, note: string) => Promise<void>
}) {
  const [open, setOpen] = useState(true)
  return (
    <Toast.Provider>
      <button onClick={() => setOpen(true)}>reopen</button>
      <NoteSheet entry={entry} open={open} onOpenChange={setOpen} onSave={onSave} />
      <ToastViewport />
    </Toast.Provider>
  )
}

const textarea = () => screen.getByLabelText<HTMLTextAreaElement>("What did you do?")

// Base UI's dialog positioning/animation machinery reaches for APIs jsdom
// doesn't have; the popover suite hits the same wall (see
// popover-force-close.test.ts). Papered over for every DOM test in
// `src/test-utils/setup-dom.ts`.

afterEach(cleanup)
/*
 * The draft store is MODULE state now, deliberately — see note-sheet.tsx. That
 * is what makes it outlive the sheet, the log around it and the route above
 * that; it also makes it outlive `cleanup()`, so a draft armed by one test
 * would seed the textarea in the next. Cleared here rather than exposed as a
 * reset switch inside the component, because no product path throws a pending
 * draft away.
 */
afterEach(clearNoteDrafts)

describe("dismissing a note with unsaved text", () => {
  it("saves the typed draft when Escape is pressed, instead of discarding it", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry()} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "fixed the parser bug" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })

    expect(onSave).toHaveBeenCalledWith("e1", "fixed the parser bug")
  })

  it("saves the typed draft when Skip is clicked", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry()} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "wrote the release notes" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }))
    })

    expect(onSave).toHaveBeenCalledWith("e1", "wrote the release notes")
  })

  /*
   * The third dismissal path, and the only one that was untested — it rested
   * entirely on the claim that Base UI funnels every reason through
   * `Dialog.Root`'s `onOpenChange`. That claim is the most likely thing in this
   * file to stop being true on an upgrade, so it is worth a real click rather
   * than a comment.
   */
  it("saves the typed draft when the backdrop is clicked", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry()} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "shipped the migration" } })

    // Base UI's `Dialog.Backdrop`, rendered before the popup inside the same
    // portal. Asserted to be a different element from the popup, so a future
    // DOM change that made this select the popup itself would fail loudly
    // rather than quietly turn this into a click on the dialog's own surface.
    const backdrop = document.querySelector("[data-open]")
    expect(backdrop).toBeTruthy()
    expect(backdrop).not.toBe(screen.getByRole("dialog"))
    await act(async () => {
      fireEvent.pointerDown(backdrop!, { button: 0, pointerType: "mouse" })
      fireEvent.mouseDown(backdrop!, { button: 0 })
      fireEvent.mouseUp(backdrop!, { button: 0 })
      fireEvent.click(backdrop!, { button: 0 })
    })

    expect(onSave).toHaveBeenCalledWith("e1", "shipped the migration")
  })

  it("reports the save with an Undo, the same vocabulary entry-log.tsx uses", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry({ title: "Refactor" })} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "cleaned up the parser" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })

    expect(await screen.findByText("Saved note for “Refactor”")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy()
  })

  it("Undo puts the previous note back", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry({ note: "original note" })} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "replaced it entirely" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })
    expect(onSave).toHaveBeenLastCalledWith("e1", "replaced it entirely")

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Undo" }))
    })
    expect(onSave).toHaveBeenLastCalledWith("e1", "original note")
  })

  it("does nothing when the text was never changed — a quiet dismissal stays quiet", async () => {
    const onSave = vi.fn(async () => {})
    render(<Harness entry={makeEntry({ note: "already saved" })} onSave={onSave} />)

    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  /*
   * The other half of that backstop, and the one that was missing: once the
   * dismissal's own save has SUCCEEDED, the draft has done its job and must go.
   *
   * Left behind, it outranks `entry.note` for the rest of the sheet's mount
   * (see the seeding effect), so the next change to that note from anywhere —
   * a second tab, another device, the optimistic rollback this file's comments
   * cite — is invisible on reopen, and the next Escape writes the stale text
   * back over it. A silently reverted note, which is the outcome PRODUCT.md
   * ranks worst.
   */
  it("drops the draft once its save lands, so a note changed elsewhere survives a reopen", async () => {
    const onSave = vi.fn(async () => {})
    const { rerender } = render(
      <Harness entry={makeEntry({ note: "old note" })} onSave={onSave} />
    )

    fireEvent.change(textarea(), { target: { value: "abc" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })
    expect(onSave).toHaveBeenLastCalledWith("e1", "abc")

    // The note now changes from somewhere this sheet does not control.
    rerender(<Harness entry={makeEntry({ note: "xyz" })} onSave={onSave} />)

    fireEvent.click(screen.getByRole("button", { name: "reopen" }))
    expect(textarea().value).toBe("xyz")
  })

  /*
   * THE HOLE THE CALENDAR TAB OPENED, AND THAT /reports HAD ALREADY OPENED.
   *
   * This sheet is a child of `EntryLog`. /timer unmounts `EntryLog` when the
   * view switches to Calendar, and any navigation to /reports unmounts it too —
   * so while the draft store was a `useRef` on this component, a failed save's
   * only copy of the user's words died with a tab click. `cleanup()` here IS
   * that unmount: everything this component held per-mount is gone before the
   * second render, and the draft has to survive it anyway.
   */
  it("keeps a failed save's draft across a full unmount — a tab switch or a route change", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("offline")
    })
    render(<Harness entry={makeEntry({ note: "old note" })} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "the words that matter" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })
    expect(onSave).toHaveBeenLastCalledWith("e1", "the words that matter")

    // The whole tree goes, exactly as it does when /timer switches to Calendar.
    cleanup()
    render(<Harness entry={makeEntry({ note: "old note" })} onSave={onSave} />)

    expect(textarea().value).toBe("the words that matter")
  })

  it("restores the draft on reopen rather than the stale server note, while the save is still in flight", async () => {
    // onSave never resolves — standing in for "pulled into a call" mid-write,
    // where the round trip hasn't finished by the time the sheet is reopened.
    const onSave = vi.fn(() => new Promise<void>(() => {}))
    render(<Harness entry={makeEntry({ note: "old note" })} onSave={onSave} />)

    fireEvent.change(textarea(), { target: { value: "half-typed thought" } })
    await act(async () => {
      fireEvent.keyDown(textarea(), { key: "Escape" })
    })

    fireEvent.click(screen.getByRole("button", { name: "reopen" }))
    expect(textarea().value).toBe("half-typed thought")
  })
})
