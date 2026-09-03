import { beforeEach, describe, expect, it, vi } from "vitest"
import { signOutAndLeave } from "./auth-client"

// The "unit" project runs in Node — no `window`, and no real Better Auth
// client. `createAuthClient` is mocked outright rather than the network
// underneath it, because `signOutAndLeave`'s own contract (cleanup first,
// cleanup cannot block sign-out) does not depend on what Better Auth does
// with the request — only on the order these two calls happen in and on
// what a rejecting `before` does to the second one.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }))

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({ signOut }),
}))

beforeEach(() => {
  signOut.mockReset()
  signOut.mockImplementation(
    async ({ fetchOptions }: { fetchOptions?: { onSuccess?: () => void } }) => {
      fetchOptions?.onSuccess?.()
    }
  )
  // A minimal stand-in, the same shape `remembered-auth.test.ts` uses: this
  // project has no jsdom, so `window` does not exist until a test supplies it.
  ;(globalThis as { window?: unknown }).window = {
    location: { assign: vi.fn() },
  }
})

describe("signOutAndLeave", () => {
  /**
   * Sign-out is the more important half of this task: the cleanup that clears
   * the device (see `clearLocalData`) has to be GONE before the account it
   * belonged to is. Reversing this order would mean the sign-out request
   * could beat the cache clear to the finish line, leaving a signed-out
   * visitor able to see a stale, still-cached copy of the page.
   */
  it("runs the cleanup before requesting sign-out", async () => {
    const order: Array<string> = []
    signOut.mockImplementation(async () => {
      order.push("signOut")
    })
    const before = async () => {
      order.push("before")
    }

    await signOutAndLeave(before)

    expect(order).toEqual(["before", "signOut"])
  })

  /**
   * The cleanup must not be able to PREVENT sign-out. `clearLocalData` already
   * catches both of its own inner calls, so in practice `before` never
   * rejects — but `signOutAndLeave`'s own contract does not rely on every
   * future caller remembering that. A `before` that rejects outright must
   * still leave the user signed out, not stranded on an authed page because a
   * cache failed to clear.
   */
  it("still signs out when the cleanup rejects", async () => {
    const before = async () => {
      throw new Error("could not clear the cache")
    }

    await expect(signOutAndLeave(before)).resolves.toBeUndefined()

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("defaults to a no-op cleanup for callers with nothing to clear", async () => {
    await signOutAndLeave()

    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it("redirects to the given destination on a successful sign-out", async () => {
    await signOutAndLeave(async () => undefined, "/login")

    expect(window.location.assign).toHaveBeenCalledWith("/login")
  })
})
