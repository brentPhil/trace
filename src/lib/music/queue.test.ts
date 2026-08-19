import { describe, expect, it } from "vitest"
import { nextIndex, prevIndex, shuffledOrder } from "./queue"

const plain = (length: number, index: number, repeat: "off" | "one" | "all" = "off") =>
  ({ length, index, repeat, order: null }) as const

describe("nextIndex", () => {
  it("advances through a list", () => {
    expect(nextIndex(plain(3, 0))).toBe(1)
    expect(nextIndex(plain(3, 1))).toBe(2)
  })

  it("stops at the end when repeat is off", () => {
    expect(nextIndex(plain(3, 2))).toBe(null)
  })

  it("wraps to the start when repeat is all", () => {
    expect(nextIndex(plain(3, 2, "all"))).toBe(0)
  })

  it("stays put when repeat is one", () => {
    expect(nextIndex(plain(3, 1, "one"))).toBe(1)
  })

  // The one-track catalog. This is what ships on day one.
  it("returns null on a single track with repeat off, and 0 with repeat all", () => {
    expect(nextIndex(plain(1, 0))).toBe(null)
    expect(nextIndex(plain(1, 0, "all"))).toBe(0)
    expect(nextIndex(plain(1, 0, "one"))).toBe(0)
  })

  it("returns null on an empty list whatever the repeat mode", () => {
    expect(nextIndex(plain(0, 0))).toBe(null)
    expect(nextIndex(plain(0, 0, "all"))).toBe(null)
    expect(nextIndex(plain(0, 0, "one"))).toBe(null)
  })

  it("follows the shuffle order rather than the list order", () => {
    // Playing position 0 of the list, which is second in the shuffled order,
    // so the next track is whatever the order puts third.
    expect(nextIndex({ length: 3, index: 0, repeat: "off", order: [2, 0, 1] })).toBe(1)
  })

  it("wraps within the shuffle order when repeat is all", () => {
    expect(nextIndex({ length: 3, index: 1, repeat: "all", order: [2, 0, 1] })).toBe(2)
  })
})

describe("prevIndex", () => {
  it("steps backwards", () => {
    expect(prevIndex(plain(3, 2))).toBe(1)
  })

  it("stops at the start when repeat is off", () => {
    expect(prevIndex(plain(3, 0))).toBe(null)
  })

  it("wraps to the end when repeat is all", () => {
    expect(prevIndex(plain(3, 0, "all"))).toBe(2)
  })

  // Deliberately NOT symmetric with nextIndex: pressing Previous is a request
  // to move, so "repeat one" must not trap the user on the current track.
  it("moves off the current track even when repeat is one", () => {
    expect(prevIndex(plain(3, 2, "one"))).toBe(1)
  })

  it("returns null on an empty list", () => {
    expect(prevIndex(plain(0, 0))).toBe(null)
  })

  it("follows the shuffle order backwards", () => {
    expect(prevIndex({ length: 3, index: 0, repeat: "off", order: [2, 0, 1] })).toBe(2)
  })
})

describe("shuffledOrder", () => {
  it("is a permutation of every index", () => {
    const order = shuffledOrder(8, 12345)
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it("is deterministic for a given seed", () => {
    expect(shuffledOrder(8, 99)).toEqual(shuffledOrder(8, 99))
  })

  it("handles the degenerate lengths", () => {
    expect(shuffledOrder(0, 1)).toEqual([])
    expect(shuffledOrder(1, 1)).toEqual([0])
  })
})
