import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DayLogFragment } from "./fragments/day-log"
import { ReportReadoutFragment } from "./fragments/report-readout"
import { TYPED_NOTE } from "./sample-data"

/*
 * jsdom has no IntersectionObserver and reports every rect as zeros, which is
 * exactly why the fragments' own tests see the finished `static` page. These
 * tests supply both — an element far below the fold and an observer fired by
 * hand — to walk the reveal through pending → in.
 */
let intersect: () => void = () => {}
let reducedMotion = false
const realMatchMedia = window.matchMedia

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion = false
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          )
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 5000,
  } as DOMRect)
  window.matchMedia = (query: string) => ({
    ...realMatchMedia(query),
    matches: reducedMotion && query.includes("prefers-reduced-motion"),
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.matchMedia = realMatchMedia
})

describe("DayLogFragment reveal", () => {
  it("waits below the fold, then types the empty note over its hatch", () => {
    const { container } = render(<DayLogFragment />)
    const rows = () => [...container.querySelectorAll("li")]

    expect(rows().every((li) => li.className.includes("opacity-0"))).toBe(true)
    expect(container.querySelector("[data-hatched]")).not.toBeNull()

    act(() => intersect())
    expect(rows().some((li) => li.className.includes("opacity-0"))).toBe(false)
    expect(rows()[0]?.className).toContain("animate-landing-rise")
    // Not yet: the rows arrive first.
    expect(container.querySelector("[data-typed-note]")).toBeNull()

    act(() => {
      vi.advanceTimersByTime(1600)
    })
    const partial = container.querySelector("[data-typed-note]")?.textContent
    expect(partial?.length).toBeGreaterThan(0)
    expect(TYPED_NOTE.startsWith(partial ?? "x")).toBe(true)
    expect(container.querySelector("[data-hatched]")).toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(container.querySelector("[data-typed-note]")?.textContent).toBe(
      TYPED_NOTE
    )
  })

  it("stays finished and hatched under reduced motion", () => {
    reducedMotion = true
    const { container } = render(<DayLogFragment />)
    expect(container.querySelector("li")?.className).not.toContain("opacity-0")
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(container.querySelector("[data-hatched]")).not.toBeNull()
  })
})

describe("ReportReadoutFragment reveal", () => {
  it("counts from nothing to the week's real figures", () => {
    const { container } = render(<ReportReadoutFragment />)
    const figures = () =>
      [...container.querySelectorAll("dd")].map((d) => d.textContent)

    expect(figures()).toEqual(["<1m", "<1m", "$0.00", "0"])

    act(() => intersect())
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(figures()).toEqual(["25h 19m", "21h 30m", "$1,935.00", "23"])
  })
})
