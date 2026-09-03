import { describe, expect, it } from "vitest"
import { rewritePlaceholders, unresolvedPlaceholders } from "./placeholders"

const resolved = { "optimistic:p1": "projects:real1", "optimistic:e1": "entries:real1" }

describe("rewritePlaceholders", () => {
  it("replaces placeholder strings anywhere in the args", () => {
    const args = {
      entryId: "optimistic:e1",
      projectId: "optimistic:p1",
      tagIds: ["tags:t1", "optimistic:p1"],
      nested: { keep: "optimistic:unknown", n: 3, flag: true, nil: null },
    }
    expect(rewritePlaceholders(args, resolved)).toEqual({
      entryId: "entries:real1",
      projectId: "projects:real1",
      tagIds: ["tags:t1", "projects:real1"],
      nested: { keep: "optimistic:unknown", n: 3, flag: true, nil: null },
    })
  })

  it("returns the same reference when nothing changes", () => {
    const args = { title: "hello", n: 1 }
    expect(rewritePlaceholders(args, resolved)).toBe(args)
  })
})

describe("unresolvedPlaceholders", () => {
  it("lists placeholders with no real id yet, once each", () => {
    const args = { a: "optimistic:x", b: ["optimistic:x", "optimistic:e1"], c: "plain" }
    expect(unresolvedPlaceholders(args, resolved)).toEqual(["optimistic:x"])
  })

  it("is empty for plain args", () => {
    expect(unresolvedPlaceholders({ title: "x", ids: ["a"] }, {})).toEqual([])
  })
})
