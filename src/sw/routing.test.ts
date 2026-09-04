import { describe, expect, it } from "vitest"
import { decide } from "./routing"

const ORIGIN = "https://chroneli.com"
const req = (path: string, extra: Partial<{ method: string; mode: string; origin: string }> = {}) => ({
  url: `${extra.origin ?? ORIGIN}${path}`,
  method: extra.method ?? "GET",
  mode: extra.mode ?? "cors",
})

describe("decide", () => {
  it("bypasses writes, other origins, auth, server functions and itself", () => {
    expect(decide(req("/timer", { method: "POST" }), ORIGIN)).toBe("bypass")
    expect(decide(req("/x", { origin: "https://accomplished-shrimp-747.convex.cloud" }), ORIGIN)).toBe("bypass")
    expect(decide(req("/api/auth/get-session"), ORIGIN)).toBe("bypass")
    expect(decide(req("/_serverFn/abc"), ORIGIN)).toBe("bypass")
    expect(decide(req("/sw.js"), ORIGIN)).toBe("bypass")
  })
  it("treats navigations, hashed assets and public files distinctly", () => {
    expect(decide(req("/timer", { mode: "navigate" }), ORIGIN)).toBe("navigation")
    expect(decide(req("/assets/index-abc123.js"), ORIGIN)).toBe("asset")
    expect(decide(req("/manifest.json"), ORIGIN)).toBe("public")
    expect(decide(req("/music/track.mp3"), ORIGIN)).toBe("public")
  })
})
