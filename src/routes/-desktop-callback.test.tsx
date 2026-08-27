import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DesktopCallback } from "@/routes/desktop-callback"

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock("@/lib/auth-client", () => ({ authClient: { oneTimeToken: { verify } } }))

const replace = vi.fn()
vi.stubGlobal("location", { ...window.location, replace })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DesktopCallback", () => {
  it("verifies the token and enters the app", async () => {
    verify.mockResolvedValue({ data: { session: {} }, error: null })
    render(<DesktopCallback token="tok" />)
    await waitFor(() => expect(verify).toHaveBeenCalledWith({ token: "tok" }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/timer"))
  })

  it("explains an expired token instead of showing a raw error", async () => {
    verify.mockResolvedValue({ data: null, error: { message: "expired" } })
    render(<DesktopCallback token="tok" />)
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toMatch(/expired/i)
    expect(replace).not.toHaveBeenCalled()
  })

  it("never verifies an empty token", async () => {
    render(<DesktopCallback token="" />)
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(verify).not.toHaveBeenCalled()
  })

  it("does not re-spend the token under StrictMode's mount/cleanup/mount", async () => {
    verify.mockResolvedValue({ data: { session: {} }, error: null })
    // StrictMode is what actually reproduces the defect: React deliberately
    // runs the effect, cleans it up, and runs it again on the very first
    // mount. Without the ref guard, that second invocation calls `verify`
    // again with the same, now-consumed token.
    render(
      <StrictMode>
        <DesktopCallback token="tok" />
      </StrictMode>
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/timer"))
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it("shows the failure state instead of hanging forever when verify rejects", async () => {
    verify.mockRejectedValue(new Error("network down"))
    render(<DesktopCallback token="tok" />)
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })
})
