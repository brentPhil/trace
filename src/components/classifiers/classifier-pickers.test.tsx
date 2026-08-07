import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ProjectPicker, TagPicker } from "@/components/classifiers/classifier-pickers"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/*
 * The pickers are used BOTH ways: the timer bar drives `open` so that typing
 * `@` can raise them, and the entry row uses them uncontrolled. That difference
 * hid a bug — uncontrolled, the close path was a no-op, so choosing a project
 * left the popover sitting open over the row it had just changed.
 *
 * Both modes are tested here because only one of them was ever exercised by
 * hand.
 */

beforeEach(() => {
  // Base UI's positioner measures its anchor; jsdom has neither.
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    NoopResizeObserver
  Element.prototype.scrollIntoView = function scrollIntoView() {}
})

afterEach(cleanup)

const projects = [
  { _id: "p1", name: "Acme", color: "coral", archived: false },
  { _id: "p2", name: "Beta", color: "teal", archived: false },
] as unknown as Array<Doc<"projects">>

const tags = [
  { _id: "t1", name: "deep-work" },
  { _id: "t2", name: "meeting" },
] as unknown as Array<Doc<"tags">>

const newProject = async () => ({ projectId: "p3" as unknown as Id<"projects"> })
const newTag = async () => ({ tagId: "t3" as unknown as Id<"tags"> })

const isOpen = () => screen.queryByPlaceholderText("Search projects") !== null

describe("ProjectPicker", () => {
  it("closes after choosing when UNCONTROLLED — the entry-row case", async () => {
    // The bug: `onOpenChange?.(false)` with no handler attached did nothing, so
    // the popover stayed open on top of the row it had just edited.
    const onChange = vi.fn()
    render(
      <ProjectPicker
        projects={projects}
        value={null}
        onChange={onChange}
        onCreate={newProject}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    expect(isOpen()).toBe(true)

    fireEvent.click(await screen.findByRole("option", { name: /Acme/ }))

    expect(onChange).toHaveBeenCalledWith("p1")
    expect(isOpen()).toBe(false)
  })

  it("closes after choosing when CONTROLLED — the timer-bar case", async () => {
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <ProjectPicker
          projects={projects}
          value={null}
          open={open}
          onOpenChange={setOpen}
          onChange={vi.fn()}
          onCreate={newProject}
        />
      )
    }
    render(<Controlled />)

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    expect(isOpen()).toBe(true)

    fireEvent.click(await screen.findByRole("option", { name: /Acme/ }))
    expect(isOpen()).toBe(false)
  })

  it("clears the search text between openings", async () => {
    // A stale filter would silently hide most of the list the next time.
    render(
      <ProjectPicker
        projects={projects}
        value={null}
        onChange={vi.fn()}
        onCreate={newProject}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    fireEvent.change(screen.getByPlaceholderText("Search projects"), {
      target: { value: "Beta" },
    })
    fireEvent.click(await screen.findByRole("option", { name: /Beta/ }))

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    expect(screen.getByPlaceholderText<HTMLInputElement>("Search projects").value).toBe("")
  })

  it("selecting the project already set clears it", async () => {
    const onChange = vi.fn()
    render(
      <ProjectPicker
        projects={projects}
        value={"p1" as unknown as Id<"projects">}
        onChange={onChange}
        onCreate={newProject}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Project: Acme" }))
    fireEvent.click(await screen.findByRole("option", { name: /Acme/ }))

    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe("TagPicker", () => {
  it("stays open while choosing, because tags are multi-select", async () => {
    // Picking three tags must not mean opening the same menu three times.
    const onChange = vi.fn()
    render(
      <TagPicker tags={tags} value={[]} onChange={onChange} onCreate={newTag} />
    )

    fireEvent.click(screen.getByRole("button", { name: "Tags" }))
    fireEvent.click(await screen.findByRole("option", { name: /deep-work/ }))

    expect(onChange).toHaveBeenCalledWith(["t1"])
    expect(screen.queryByPlaceholderText("Search or add tags")).not.toBeNull()
  })

  it("toggles a tag off when it is already selected", async () => {
    const onChange = vi.fn()
    render(
      <TagPicker
        tags={tags}
        value={["t1"] as unknown as Array<Id<"tags">>}
        onChange={onChange}
        onCreate={newTag}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Tags: 1 selected" }))
    fireEvent.click(await screen.findByRole("option", { name: /deep-work/ }))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
