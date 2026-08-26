import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NoteLine } from "@/components/entries/note-line"

afterEach(cleanup)

/*
 * THE NOTE, EDITED WHERE IT IS READ.
 *
 * It was a dialog — `NoteSheet`, with a draft store, a Save button and a
 * save-on-dismiss path — and it is now the same gesture as the title beside it.
 * These pin the four properties that made the change worth making, and the one
 * hazard the shape introduces (a paragraph opened with everything selected).
 */

const NOTE = "Rewrote the picker.\n\nStill to do: the empty state."

function renderLine(
  props: Partial<React.ComponentProps<typeof NoteLine>> = {}
) {
  const onSave = vi.fn(async () => {})
  render(
    <NoteLine note={NOTE} notesExpanded={false} onSave={onSave} {...props} />
  )
  return onSave
}

/** The field the trigger becomes. Named, so a stray textbox cannot pass for it. */
const field = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Note:|Add note/ })

describe("NoteLine", () => {
  it("edits in place rather than opening a dialog", () => {
    renderLine()

    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    expect(field()).toBeTruthy()
    // No dialog anywhere: the whole point of the change.
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  /* A textarea, not an input — the note holds the paragraph breaks the writer
   * typed, and an input cannot carry one. */
  it("gives the note a textarea, seeded with what is already written", () => {
    renderLine()
    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    expect(field().tagName).toBe("TEXTAREA")
    expect(field().value).toBe(NOTE)
  })

  /*
   * THE HAZARD THE TITLE'S BEHAVIOUR WOULD HAVE INTRODUCED. `InlineEdit` opens
   * a single-line field with its value SELECTED, which is right for retyping
   * four words and catastrophic on a paragraph: the next keystroke destroys a
   * note the user came back to add one line to.
   */
  it("opens with the caret at the end and nothing selected", () => {
    renderLine()
    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    expect(field().selectionStart).toBe(NOTE.length)
    expect(field().selectionEnd).toBe(NOTE.length)
  })

  it("saves on blur, like every other field in the row", async () => {
    const onSave = renderLine()
    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    fireEvent.change(field(), { target: { value: "Shipped it." } })
    fireEvent.blur(field())

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Shipped it."))
  })

  /* Enter is a line break here, and the explicit commit moves to ⌘/Ctrl+Enter —
   * the same pairing the dialog used, so the key already in someone's fingers
   * still works. */
  it("takes ⌘↵ as the commit and plain Enter as a newline", async () => {
    const onSave = renderLine()
    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    fireEvent.change(field(), { target: { value: "First line." } })
    fireEvent.keyDown(field(), { key: "Enter" })
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.keyDown(field(), { key: "Enter", metaKey: true })
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("First line."))
  })

  it("reverts on Escape without writing anything", () => {
    const onSave = renderLine()
    fireEvent.click(screen.getByRole("button", { name: /Rewrote the picker/ }))

    fireEvent.change(field(), { target: { value: "Half a sentence" } })
    fireEvent.keyDown(field(), { key: "Escape" })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Rewrote the picker/ })).toBeTruthy()
  })

  /*
   * The hatch is an invitation, and it has to open the same editor the written
   * note does — otherwise "add" and "edit" are two features that can drift.
   */
  it("writes a first note from the empty hatch", async () => {
    const onSave = renderLine({ note: "" })

    fireEvent.click(screen.getByRole("button", { name: "Add note" }))
    fireEvent.change(field(), { target: { value: "Paired on the importer." } })
    fireEvent.blur(field())

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("Paired on the importer.")
    )
  })

  /*
   * `aria-label` REPLACES a control's content rather than adding to it, so a
   * bare "Edit note" would tell the one reader who cannot see the line that a
   * control exists and never what it says. Same shape as `EditableTitle`'s
   * `Description: …`.
   */
  it("keeps the note's own words in the control's accessible name", () => {
    renderLine()
    // Matched as a prefix: Testing Library normalises an accessible name, so the
    // paragraph break in the fixture arrives here as a single space.
    expect(
      screen.getByRole("button", { name: /^Note: Rewrote the picker./ })
    ).toBeTruthy()
  })
})
