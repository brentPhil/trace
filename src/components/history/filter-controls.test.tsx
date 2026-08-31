import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FilterControls } from "@/components/history/filter-controls"
import { chooseOption } from "@/test-utils/select"
import { matches } from "@/lib/history-filters"
import { filterEntry as entry } from "@/test-utils/fixtures"
import type { QuickFilters } from "@/lib/history-filters"
import type { Doc } from "../../../convex/_generated/dataModel"

/*
 * FilterControls is the whole of Timer's filter bar and two thirds of
 * Reports': search, project, billable. Rendered here against a plain array
 * and the real `matches` predicate — no router, no Convex — so what these
 * tests prove is exactly what the pages get: the controls narrow a list.
 */

afterEach(cleanup)

const projects = [
  { _id: "p1", name: "Website" } as unknown as Doc<"projects">,
  { _id: "p2", name: "Acme Corp" } as unknown as Doc<"projects">,
]

const entries = [
  entry({ _id: "e1" as never, title: "Fix login bug", projectId: "p1" as never }),
  entry({
    _id: "e2" as never,
    title: "Write invoice",
    note: "for Acme",
    projectId: "p2" as never,
    billable: true,
  }),
  entry({ _id: "e3" as never, title: "Standup notes" }),
]

function nameOf(id: string | undefined): string {
  if (id === undefined) return ""
  return projects.find((p) => p._id === id)?.name ?? ""
}

/** Timer's whole filtering story, as a harness: controls plus the rows they narrow. */
function Harness() {
  const [filters, setFilters] = useState<QuickFilters>({
    projectId: null,
    billableOnly: false,
    text: "",
  })
  const visible = entries.filter((e) => matches(e, filters, nameOf))
  return (
    <div>
      <FilterControls filters={filters} projects={projects} onChange={setFilters} />
      <ul>
        {visible.map((e) => (
          <li key={e._id}>{e.title}</li>
        ))}
      </ul>
    </div>
  )
}

function titles(): Array<string | null> {
  return screen.getAllByRole("listitem").map((el) => el.textContent)
}

describe("FilterControls", () => {
  it("narrows the rendered rows as the search text changes", () => {
    render(<Harness />)
    expect(titles()).toHaveLength(3)

    fireEvent.change(screen.getByPlaceholderText("Search titles, notes and projects"), {
      target: { value: "invoice" },
    })

    expect(titles()).toEqual(["Write invoice"])
  })

  it("narrows the rendered rows by project", () => {
    render(<Harness />)

    // "p1" is the VALUE; "Website" is what the option says. A Select is
    // driven by the label the user reads, which is the better test anyway.
    chooseOption("Project", "Website")

    expect(titles()).toEqual(["Fix login bug"])
  })

  it("narrows the rendered rows to billable entries only", () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: "Billable" }))

    expect(titles()).toEqual(["Write invoice"])
  })
})
