import { describe, expect, it } from "vitest"
import {
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  formatBytes,
  trackNameFromFilename,
} from "./audio"

const MB = 1024 * 1024
const GB = 1024 * MB

describe("formatBytes", () => {
  it("writes megabytes to one decimal and drops a trailing zero", () => {
    expect(formatBytes(250 * MB)).toBe("250 MB")
    expect(formatBytes(0.9 * MB)).toBe("0.9 MB")
    expect(formatBytes(0)).toBe("0 MB")
  })

  /*
   * THE REASON THIS FUNCTION EXISTS. The library cap is 2 GiB, and the three
   * hand-rolled `formatMb` copies this replaces would each have rendered it
   * "2048 MB" — a true number in a unit no one uses for it.
   */
  it("switches to gigabytes at a gibibyte", () => {
    expect(formatBytes(2 * GB)).toBe("2 GB")
    expect(formatBytes(GB)).toBe("1 GB")
    expect(formatBytes(1.5 * GB)).toBe("1.5 GB")
  })

  it("stays in megabytes just below the switch", () => {
    expect(formatBytes(1023 * MB)).toBe("1023 MB")
  })

  /* Both caps are rendered by this function in copy the user reads, so their
   * exact spellings are worth pinning. */
  it("spells the two caps the way the product talks about them", () => {
    expect(formatBytes(MAX_TRACK_BYTES)).toBe("250 MB")
    expect(formatBytes(MAX_LIBRARY_BYTES)).toBe("2 GB")
  })
})

describe("trackNameFromFilename", () => {
  it("strips the extension", () => {
    expect(trackNameFromFilename("Rain On Glass.mp3")).toBe("Rain On Glass")
  })

  it("falls back for a name that is only an extension", () => {
    expect(trackNameFromFilename(".mp3")).toBe("Untitled track")
  })
})
