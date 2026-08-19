import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_LOCAL_PREFS, readLocalPrefs, writeLocalPrefs } from "./local-prefs"

// The `unit` project runs in node, which has no localStorage. A minimal stub is
// enough and keeps this test out of jsdom.
function stubStorage(): void {
  const store = new Map<string, string>()
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubStorage()
})

describe("readLocalPrefs", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readLocalPrefs()).toEqual(DEFAULT_LOCAL_PREFS)
  })

  it("round-trips a write", () => {
    writeLocalPrefs({ volume: 0.25, shuffle: true, repeat: "all" })
    const prefs = readLocalPrefs()
    expect(prefs.volume).toBe(0.25)
    expect(prefs.shuffle).toBe(true)
    expect(prefs.repeat).toBe("all")
  })

  it("merges a partial write rather than replacing everything", () => {
    writeLocalPrefs({ volume: 0.25 })
    writeLocalPrefs({ shuffle: true })
    expect(readLocalPrefs().volume).toBe(0.25)
  })

  // Anyone can edit localStorage. Corrupt data must read as "no preference",
  // never as a crash on the layout that mounts the player.
  it("falls back to the defaults on unparseable JSON", () => {
    localStorage.setItem("chroneli:music", "{not json")
    expect(readLocalPrefs()).toEqual(DEFAULT_LOCAL_PREFS)
  })

  it("clamps a volume outside 0..1 and rejects a bad repeat mode", () => {
    localStorage.setItem(
      "chroneli:music",
      JSON.stringify({ volume: 9, repeat: "sideways", shuffle: "yes" })
    )
    const prefs = readLocalPrefs()
    expect(prefs.volume).toBe(1)
    expect(prefs.repeat).toBe(DEFAULT_LOCAL_PREFS.repeat)
    expect(prefs.shuffle).toBe(DEFAULT_LOCAL_PREFS.shuffle)
  })

  it("survives having no localStorage at all — SSR renders this module", () => {
    vi.unstubAllGlobals()
    vi.stubGlobal("localStorage", undefined)
    expect(readLocalPrefs()).toEqual(DEFAULT_LOCAL_PREFS)
    expect(() => writeLocalPrefs({ volume: 0.5 })).not.toThrow()
  })
})
