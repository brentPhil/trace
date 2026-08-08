import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { NoteSheet } from "@/components/entries/note-sheet"
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

beforeEach(() => {
  // Base UI's dialog positioning/animation machinery reaches for APIs jsdom
  // doesn't have; the popover suite hits the same wall (see
  // popover-force-close.test.ts) and papers over it the same way.
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    NoopResizeObserver
})

afterEach(cleanup)

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
