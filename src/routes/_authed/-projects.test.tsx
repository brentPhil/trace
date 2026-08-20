import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { Projects } from "@/routes/_authed/-projects"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/*
 * The /projects rate flow had no client-side coverage at all, and three of its
 * behaviours are the kind that only ever break silently:
 *
 *   - `InlineEdit<number | null>` must send `null` for an emptied field, not
 *     `undefined` and not `0`. `null` is what `projects.update` reads as
 *     "clear it"; `undefined` means "leave it alone" and `0` is a real
 *     pro-bono price. All three round-trip through the mutation without
 *     error, and only one of them is right.
 *   - `formatRate` must keep "No rate set" and "$0.00/hr" apart on screen.
 *   - a refused rate must keep the typed text and say something true about
 *     the user's own currency.
 *
 * `useClassifierMutations` is mocked because it is the file's whole Convex
 * write surface; the reads go through a seeded QueryClient, exactly as
 * -reports.test.tsx does.
 */

const { mutations } = vi.hoisted(() => ({
  mutations: {
    createProject: vi.fn(async () => ({ projectId: "new" })),
    updateProject: vi.fn(async () => null),
    setArchived: vi.fn(async () => null),
    removeProject: vi.fn(async () => null),
    ensureTag: vi.fn(async () => ({ tagId: "t" })),
    renameTag: vi.fn(async () => null),
    removeTag: vi.fn(async () => null),
  },
}))

vi.mock("@/hooks/use-classifiers", () => ({
  useClassifierMutations: () => mutations,
}))

afterEach(() => {
  cleanup()
  for (const fn of Object.values(mutations)) fn.mockClear()
})

function makeProject(overrides: Partial<Doc<"projects">> & { name: string }): Doc<"projects"> {
  return {
    _id: overrides.name as unknown as Id<"projects">,
    _creationTime: NOW,
    userId: "user-1",
    color: "amber",
    archived: false,
    billableByDefault: false,
    hourlyRateCents: undefined,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

function renderProjects(
  projects: Array<Doc<"projects">>,
  currency = SETTINGS.currency
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => {
          const [, name] = queryKey as [string, string]
          throw new Error(`Unseeded query in test: ${name}`)
        },
      },
    },
  })
  queryClient.setQueryData(convexKey(api.projects.list, {}), projects)
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
  queryClient.setQueryData(convexKey(api.settings.get, {}), { ...SETTINGS, currency })

  render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider>
        <Projects />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

/** Narrows a queried element to the input it is, or fails loudly. */
function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error("expected an input")
  return el
}

/** Opens a project's rate editor and returns the input it swapped in. */
function openRateEditor(projectName: string): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: `Hourly rate for ${projectName}` }))
  return asInput(screen.getByLabelText(`Hourly rate for ${projectName}`))
}

/*
 * THE PAGE'S OWN STRUCTURE, not the rate flow.
 *
 * /projects used to build itself a second way: no `Page`, and a bare
 * `<h1 className="text-sm font-semibold">` sitting INSIDE the first section
 * beside the create button, doing double duty as the page's heading and as that
 * section's label — which is why "Archived" and "Tags" below it are `<h2>`s of a
 * heading that lived in a sibling of theirs. Nothing about that is visible, so
 * the only thing that can hold it is an assertion.
 */
describe("Projects — the page heading", () => {
  it("has exactly one h1, and it names the page", () => {
    renderProjects([makeProject({ name: "Acme" })])

    expectPageHeading("Projects")
  })

  it("keeps the section headings BELOW it, so the outline is h1 then h2", () => {
    renderProjects([
      makeProject({ name: "Acme" }),
      makeProject({ name: "Old client", archived: true }),
    ])

    // Not "no h2s" — the point is that the two that exist are subordinate to
    // the page's heading rather than siblings of it.
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(sections).toEqual(["Archived", "Tags"])
  })
})

describe("Projects — the rate column", () => {
  it("keeps an unset rate and an explicit zero apart on screen", () => {
    renderProjects([
      makeProject({ name: "Unpriced" }),
      makeProject({ name: "Pro bono", hourlyRateCents: 0 }),
      makeProject({ name: "Acme", hourlyRateCents: 6_100 }),
    ])

    expect(screen.getByText("No rate set")).toBeTruthy()
    expect(screen.getByText("$0.00/hr")).toBeTruthy()
    expect(screen.getByText("$61.00/hr")).toBeTruthy()
  })

  it("seeds the editor with the bare number, not the formatted display", () => {
    renderProjects([makeProject({ name: "Acme", hourlyRateCents: 6_100 })])
    expect(openRateEditor("Acme").value).toBe("61.00")
  })

  /*
   * THE clear-to-null path. `InlineEdit<number | null>` is the only generic
   * instantiation in the product whose value can legitimately be `null`, and
   * `parseMoney("")` is what produces it.
   */
  it("clears a rate to null when the field is emptied", async () => {
    renderProjects([makeProject({ name: "Acme", hourlyRateCents: 6_100 })])

    const input = openRateEditor("Acme")
    fireEvent.change(input, { target: { value: "" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledTimes(1))
    expect(mutations.updateProject).toHaveBeenCalledWith({
      projectId: "Acme",
      hourlyRateCents: null,
    })
  })

  it("commits a typed amount as whole cents", async () => {
    renderProjects([makeProject({ name: "Acme", hourlyRateCents: 6_100 })])

    const input = openRateEditor("Acme")
    fireEvent.change(input, { target: { value: "12.5" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledTimes(1))
    expect(mutations.updateProject).toHaveBeenCalledWith({
      projectId: "Acme",
      hourlyRateCents: 1250,
    })
  })

  it("refuses what it cannot read, keeping the text and writing nothing", () => {
    renderProjects([makeProject({ name: "Acme", hourlyRateCents: 6_100 })])

    const input = openRateEditor("Acme")
    fireEvent.change(input, { target: { value: "ten quid" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(mutations.updateProject).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("$10.50")
    // Still open, still holding what was typed — nothing to correct otherwise.
    expect(input.value).toBe("ten quid")
  })

  /*
   * The currency-awareness regression. The help text used to be the constant
   * "Try 10, 10.50, or $10", so an SGD user was shown a dollar sign by the
   * very message rejecting their input — and "S$10", which is what their bank
   * writes, was refused outright.
   */
  it("speaks the user's own currency, in the display, the help and the parser", async () => {
    renderProjects([makeProject({ name: "Acme", hourlyRateCents: 6_100 })], "SGD")

    // ICU separates a bare code from its amount with U+00A0; testing-library's
    // default normalizer collapses that to an ordinary space.
    expect(screen.getByText("SGD 61.00/hr")).toBeTruthy()

    const input = openRateEditor("Acme")
    fireEvent.change(input, { target: { value: "ten quid" } })
    fireEvent.keyDown(input, { key: "Enter" })
    const alert = screen.getByRole("alert").textContent
    expect(alert).toContain("SGD")
    expect(alert).not.toContain("$10.50")

    fireEvent.change(input, { target: { value: "S$70" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(mutations.updateProject).toHaveBeenCalledTimes(1))
    expect(mutations.updateProject).toHaveBeenCalledWith({
      projectId: "Acme",
      hourlyRateCents: 7000,
    })
  })
})

describe("Projects — the new-project form", () => {
  const openForm = () => {
    fireEvent.click(screen.getByRole("button", { name: /new project/i }))
  }

  it("creates a project with the rate it was given", async () => {
    renderProjects([])
    openForm()

    fireEvent.change(screen.getByLabelText("New project name"), {
      target: { value: "  Acme  " },
    })
    fireEvent.change(screen.getByLabelText(/Hourly rate in USD/), {
      target: { value: "61" },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Add" }).closest("form")!)

    await waitFor(() => expect(mutations.createProject).toHaveBeenCalledTimes(1))
    expect(mutations.createProject).toHaveBeenCalledWith({
      name: "Acme",
      hourlyRateCents: 6_100,
    })
  })

  it("sends no rate at all when the field is left blank", async () => {
    renderProjects([])
    openForm()

    fireEvent.change(screen.getByLabelText("New project name"), {
      target: { value: "Acme" },
    })
    fireEvent.submit(screen.getByRole("button", { name: "Add" }).closest("form")!)

    await waitFor(() => expect(mutations.createProject).toHaveBeenCalledTimes(1))
    // `undefined`, not 0 — a blank field is "unpriced", not "free".
    expect(mutations.createProject).toHaveBeenCalledWith({
      name: "Acme",
      hourlyRateCents: undefined,
    })
  })

  it("refuses an unreadable rate without creating anything, and keeps the form open", () => {
    renderProjects([])
    openForm()

    fireEvent.change(screen.getByLabelText("New project name"), {
      target: { value: "Acme" },
    })
    const rate = screen.getByLabelText(/Hourly rate in USD/)
    fireEvent.change(rate, { target: { value: "ten quid" } })
    fireEvent.submit(screen.getByRole("button", { name: "Add" }).closest("form")!)

    expect(mutations.createProject).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toContain("$10.50")
    // The name and the bad rate both survive, so the fix is one edit away.
    expect(asInput(screen.getByLabelText("New project name")).value).toBe("Acme")
    expect(asInput(rate).value).toBe("ten quid")
  })
})
