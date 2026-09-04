import { beforeEach, describe, expect, it } from "vitest"
import { clearRememberedAuth, readRememberedAuth, writeRememberedAuth } from "./remembered-auth"

// jsdom is not available in the unit project; a minimal localStorage stands in.
const backing = new Map<string, string>()
beforeEach(() => {
  backing.clear()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  }
})

describe("remembered auth", () => {
  it("defaults to signed out", () => {
    expect(readRememberedAuth()).toBe(false)
  })
  it("remembers, and forgets", () => {
    writeRememberedAuth(true)
    expect(readRememberedAuth()).toBe(true)
    clearRememberedAuth()
    expect(readRememberedAuth()).toBe(false)
  })
})
