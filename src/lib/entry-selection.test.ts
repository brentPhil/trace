import { describe, expect, it } from "vitest"
import {
  pruneSelection,
  selectionState,
  toggleSelection,
} from "./entry-selection"
import type { Id } from "../../convex/_generated/dataModel"

const id = (value: string) => value as Id<"timeEntries">
const A = id("a")
const B = id("b")
const C = id("c")

describe("entry selection", () => {
  it("is unchecked when none of the represented ids are selected", () => {
    expect(selectionState([A, B], new Set([C]))).toBe("unchecked")
  })

  it("is checked when every represented id is selected", () => {
    expect(selectionState([A, B], new Set([A, B, C]))).toBe("checked")
  })

  it("is indeterminate when only some represented ids are selected", () => {
    expect(selectionState([A, B], new Set([A]))).toBe("indeterminate")
  })

  it("selects all ids when the target is unchecked", () => {
    expect([...toggleSelection(new Set([C]), [A, B])]).toEqual([C, A, B])
  })

  it("clears all represented ids when the target is checked or mixed", () => {
    expect([...toggleSelection(new Set([A, B, C]), [A, B])]).toEqual([C])
    expect([...toggleSelection(new Set([A, C]), [A, B])]).toEqual([C])
  })

  it("deduplicates represented ids", () => {
    expect([...toggleSelection(new Set(), [A, A, B])]).toEqual([A, B])
  })

  it("prunes ids that are no longer live", () => {
    expect([...pruneSelection(new Set([A, B, C]), [A, C])]).toEqual([A, C])
  })
})
