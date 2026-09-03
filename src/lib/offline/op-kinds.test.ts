import { describe, expect, it } from "vitest"
import { getFunctionName } from "convex/server"
import { OP_KINDS, STALE_START_MS } from "./op-kinds"

describe("OP_KINDS", () => {
  it("names every kind after the Convex function it sends", () => {
    for (const [name, def] of Object.entries(OP_KINDS)) {
      expect(getFunctionName(def.ref)).toBe(name.replace(".", ":"))
      expect(def.label.length).toBeGreaterThan(0)
    }
  })

  it("mints and resolves come in pairs", () => {
    for (const def of Object.values(OP_KINDS)) {
      expect(def.mints === undefined).toBe(def.minted === undefined)
    }
  })

  it("start goes stale after a day unless closed", () => {
    expect(OP_KINDS["entries.start"].staleAfterMs).toBe(STALE_START_MS)
    expect(OP_KINDS["entries.start"].closedBy).toEqual([
      "entries.stop",
      "entries.discardRunning",
      "entries.start",
    ])
  })

  it("start's immediate result carries the placeholder the optimistic row uses", () => {
    const r = OP_KINDS["entries.start"].immediate({ clientKey: "k", title: "" }, 5)
    expect(r).toEqual({ entryId: "optimistic:k", stoppedEntryIds: [], serverNow: 5, replayed: false })
  })
})
