/// <reference types="vite/client" />
// `import.meta.glob` is a Vite feature, and convex/tsconfig.json targets the
// Convex runtime rather than a bundler, so the type has to be pulled in here.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"

// convex-test discovers function modules by globbing from the file that calls
// it, so this has to live here rather than in a helper.
const modules = import.meta.glob("./**/*.*s")

describe("one-time-token plugin", () => {
  it("is registered on the auth instance", async () => {
    const { createAuth } = await import("./auth")
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const auth = createAuth(ctx as never)
      // The plugin contributes these endpoints; their absence means it never
      // made it into the array.
      expect(auth.api.generateOneTimeToken).toBeDefined()
      expect(auth.api.verifyOneTimeToken).toBeDefined()
    })
  })
})
