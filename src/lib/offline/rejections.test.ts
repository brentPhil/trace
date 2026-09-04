import { ConvexError } from "convex/values"
import { describe, expect, it } from "vitest"
import { isRetryableRejection } from "./rejections"

describe("isRetryableRejection", () => {
  it("keeps an op the server refused only for want of a session", () => {
    const error = new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in." })
    expect(isRetryableRejection(error)).toBe(true)
  })

  it("drops every other refusal", () => {
    expect(isRetryableRejection(new ConvexError({ code: "TOO_LONG", message: "x" }))).toBe(false)
    expect(isRetryableRejection(new Error("ArgumentValidationError"))).toBe(false)
    expect(isRetryableRejection("nope")).toBe(false)
  })
})
