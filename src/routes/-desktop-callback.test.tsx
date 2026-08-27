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
})
