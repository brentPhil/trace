import { beforeEach, describe, expect, it, vi } from "vitest"
import { readRememberedAuth, writeRememberedAuth } from "@/lib/offline/remembered-auth"
import type * as ReactStartModuleType from "@tanstack/react-start"

type ReactStartModule = typeof ReactStartModuleType

/*
 * `createServerFn(...).handler(fn)` requires the real Start server runtime —
 * an `AsyncLocalStorage` context this test never enters — so calling the real
 * `getAuth` throws "No Start context found in AsyncLocalStorage" before it
 * ever reaches `getToken`. Standing `.handler` in for the identity function is
 * what makes `getAuth()` inside `__root.tsx`'s `beforeLoad` reach the mocked
 * `getToken` below directly, the same as it would from inside a real server
 * function call.
 */
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<ReactStartModule>()
  return {
    ...actual,
    createServerFn: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }
})

const auth = vi.hoisted(() => ({
  getToken: vi.fn(),
}))
vi.mock("@/lib/auth-server", () => ({ getToken: auth.getToken }))

// jsdom is not available in the unit project; a minimal localStorage/window
// stands in, the same shape `remembered-auth.test.ts` uses. Both scenarios
// below are the BROWSER path — `beforeLoad`'s `typeof window === "undefined"`
// check is what the inversion check below targets.
const backing = new Map<string, string>()
beforeEach(() => {
  backing.clear()
  auth.getToken.mockReset()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  }
})

/**
 * A server that ANSWERS "no token" must clear the remembered flag; only a
 * server that could not be REACHED may leave it standing. Both arrive at the
 * same call site in `__root.tsx`'s `beforeLoad` — a thrown `getAuth()` versus
 * a resolved one — and telling them apart is the entire safety argument for
 * booting offline, so it gets a test of its own rather than resting on a
 * reading of the code. `remembered-auth.test.ts` only proves the storage
 * round-trips; it never touches which of these two paths writes to it.
 */
describe("__root beforeLoad: answered no token vs unreachable server", () => {
  const routeContext = () => ({ context: { convexQueryClient: {} } })

  it("a resolved answer of no token clears the remembered flag and is not offline", async () => {
    writeRememberedAuth(true) // stale from an earlier, real sign-in
    auth.getToken.mockResolvedValue(undefined)

    const { Route } = await import("@/routes/__root")
    const beforeLoad = Route.options.beforeLoad as (ctx: unknown) => Promise<{
      isAuthenticated: boolean
      bootedOffline: boolean
    }>
    const result = await beforeLoad(routeContext())

    expect(result).toMatchObject({ isAuthenticated: false, bootedOffline: false })
    expect(readRememberedAuth()).toBe(false)
  })

  it("a rejected fetch leaves the remembered flag standing and boots offline", async () => {
    writeRememberedAuth(true)
    auth.getToken.mockRejectedValue(new Error("network unreachable"))

    const { Route } = await import("@/routes/__root")
    const beforeLoad = Route.options.beforeLoad as (ctx: unknown) => Promise<{
      isAuthenticated: boolean
      bootedOffline: boolean
    }>
    const result = await beforeLoad(routeContext())

    expect(result).toMatchObject({ isAuthenticated: true, bootedOffline: true })
    expect(readRememberedAuth()).toBe(true)
  })
})
