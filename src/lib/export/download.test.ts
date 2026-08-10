import { describe, expect, it } from "vitest"
import { exportFilename } from "./download"

describe("exportFilename", () => {
  it("names the range, so two exports never collide in a downloads folder", () => {
    expect(exportFilename("2026-07-13", "2026-07-25", "csv")).toBe(
      "trace-report-2026-07-13_2026-07-25.csv"
    )
  })

  it("does not repeat a single-day range", () => {
    expect(exportFilename("2026-07-13", "2026-07-13", "pdf")).toBe(
      "trace-report-2026-07-13.pdf"
    )
  })
})
