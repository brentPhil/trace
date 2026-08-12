import { describe, expect, it } from "vitest"
import { APP_NAME, pageTitle } from "./brand"

describe("pageTitle", () => {
  it("suffixes the page with the product name", () => {
    expect(pageTitle("Timer")).toBe("Timer — Chroneli")
  })

  it("is the product name alone when there is no page", () => {
    expect(pageTitle()).toBe(APP_NAME)
  })
})
