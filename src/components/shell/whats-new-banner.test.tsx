import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

import { WHATS_NEW, WhatsNewBanner } from "@/components/shell/whats-new-banner"
import { renderWithRouter } from "@/test-utils/router"

const KEY = "chroneli:whats-new-dismissed"

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The banner contains a `Link`, which throws outside a router. */
const renderBanner = () =>
  render(renderWithRouter(<WhatsNewBanner />, { path: "/timer" }))

describe("WhatsNewBanner", () => {
  it("announces the current update to someone who has not dismissed it", async () => {
    renderBanner()
    // `waitFor`, because the banner is CLOSED until the mount effect has read
    // storage — the honest first tick its docblock argues for.
    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "What's new" })).toBeTruthy()
    })
    expect(screen.getByText(WHATS_NEW.title)).toBeTruthy()
    expect(screen.getByRole("link", { name: WHATS_NEW.cta })).toBeTruthy()
  })

  it("dismisses on the close button, and records WHICH update was dismissed", async () => {
    renderBanner()
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss what's new" })
    )
    expect(screen.queryByRole("complementary", { name: "What's new" })).toBeNull()
    // The id, not a boolean: a later update with a NEW id must reappear, and a
    // flag would silence every announcement forever after the first.
    expect(window.localStorage.getItem(KEY)).toBe(WHATS_NEW.id)
  })

  it("stays closed for someone who already dismissed this update", async () => {
    window.localStorage.setItem(KEY, WHATS_NEW.id)
    renderBanner()
    // The absence claim needs the effect to have RUN, so flush it by waiting on
    // a stable element rather than sleeping.
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "What's new" })).toBeNull()
    })
  })

  it("reappears when the dismissal names an OLDER update", async () => {
    window.localStorage.setItem(KEY, "2026-01-something-earlier")
    renderBanner()
    expect(await screen.findByText(WHATS_NEW.title)).toBeTruthy()
  })

  it("still shows when storage throws rather than answering", async () => {
    // `localStorage` access itself throws in some contexts (storage disabled);
    // the reader swallows that, and an unreadable dismissal means not dismissed.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled")
    })
    renderBanner()
    expect(await screen.findByText(WHATS_NEW.title)).toBeTruthy()
  })
})
