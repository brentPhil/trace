import { describe, expect, it } from "vitest"
import { SWITCH_UNDO_MS, switchToAnnounce } from "@/lib/use-switch-undo"

const NOW = Date.parse("2026-08-20T10:00:00.000Z")

function running(over: Record<string, unknown> = {}) {
  return {
    _id: "entry_1",
    title: "Team standup",
    startedAt: NOW - 30_000,
    source: "calendar",
    ...over,
  }
}

describe("switchToAnnounce", () => {
  it("announces a calendar switch that just happened", () => {
    expect(switchToAnnounce(running(), null, NOW)).toEqual({
      entryId: "entry_1",
      title: "Team standup",
    })
  })

  it("says nothing about an entry the user started themselves", () => {
    // The toast exists because the switch happened at a moment the user did not
    // choose. Announcing something they pressed a button for would be noise.
    expect(switchToAnnounce(running({ source: "web" }), null, NOW)).toBeNull()
  })

  it("says nothing when there is no running entry", () => {
    expect(switchToAnnounce(null, null, NOW)).toBeNull()
  })

  it("says nothing about a switch older than the undo window", () => {
    // Long enough to notice a wrong interruption, short enough that the offer
    // is not still on screen an hour into the call. A tab opened at noon must
    // not offer to reverse the nine o'clock standup.
    const stale = running({ startedAt: NOW - SWITCH_UNDO_MS - 1 })
    expect(switchToAnnounce(stale, null, NOW)).toBeNull()
  })

  it("does not announce the same switch twice", () => {
    // The query re-fires on every reactive update — a title edit, a tag, the
    // next sync. Without the seen-id the toast would reappear on each one for
    // as long as the window stayed open.
    expect(switchToAnnounce(running(), "entry_1", NOW)).toBeNull()
  })

  it("announces a second switch that follows the first", () => {
    const next = running({ _id: "entry_2", title: "Design review" })
    expect(switchToAnnounce(next, "entry_1", NOW)).toEqual({
      entryId: "entry_2",
      title: "Design review",
    })
  })
})
