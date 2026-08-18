import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { Settings } from "@/routes/_authed/settings"
import { convexKey } from "@/test-utils/convex-query"
import { SETTINGS } from "@/test-utils/fixtures"
import { api } from "../../../convex/_generated/api"
import { getFunctionName } from "convex/server"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"

type ConvexReactQueryModule = typeof ConvexReactQueryModuleType

/*
 * /settings' notes-in-the-PDF control.
 *
 * Worth its own coverage because the DEFAULT is the whole point and defaults
 * are what silently invert: a note is prose the user wrote about how the work
 * actually went, and the PDF is the copy that goes to a client. Off has to stay
 * off until somebody says otherwise, and the control has to state both
 * outcomes rather than leaving one to be inferred from an unchecked box.
 */

const {
  update,
  generateLogoUploadUrl,
  clearLogo,
  setLogo,
  listAccounts,
  linkSocial,
  unlinkAccount,
  googleConnect,
  googleDisconnect,
} = vi.hoisted(() => ({
  update: vi.fn(async () => null),
  generateLogoUploadUrl: vi.fn(async () => "https://upload.example/logo"),
  clearLogo: vi.fn(async () => null),
  setLogo: vi.fn(async () => null),
  // Defaults to "nothing linked", so the page's round-trip effect cannot fire
  // `google.connect` by accident in a test that is about something else — and
  // so a real network call in jsdom never reaches for a server that does not
  // exist in a unit test. The Google tests below override it per test.
  listAccounts: vi.fn(async () => ({
    data: [] as Array<{ providerId: string }>,
  })),
  linkSocial: vi.fn(async () => ({ data: null, error: null })),
  // Better Auth's client returns `{ data, error }` rather than throwing, so
  // "the unlink failed" is a value this mock has to be able to produce.
  unlinkAccount: vi.fn(
    async (): Promise<{
      data: { status: boolean } | null
      error: { message: string } | null
    }> => ({ data: { status: true }, error: null })
  ),
  // `google.connect` and `google.disconnect` are SEPARATE mocks rather than
  // both landing on `update`. This file's whole reason for existing now
  // includes "Disconnect must not re-fire connect", and one shared spy cannot
  // tell those two calls apart.
  googleConnect: vi.fn(async () => null),
  googleDisconnect: vi.fn(async () => null),
}))

vi.mock("@/lib/auth-client", () => ({
  authClient: { listAccounts, linkSocial, unlinkAccount },
}))

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactQueryModule>()
  return {
    ...actual,
    useConvexMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference)
      if (name === "settings:generateLogoUploadUrl")
        return generateLogoUploadUrl
      if (name === "settings:clearLogo") return clearLogo
      if (name === "google:connect") return googleConnect
      if (name === "google:disconnect") return googleDisconnect
      return update
    },
    useConvexAction: () => setLogo,
  }
})

afterEach(() => {
  cleanup()
  update.mockClear()
  generateLogoUploadUrl.mockClear()
  clearLogo.mockClear()
  setLogo.mockClear()
  // `mockReset`, NOT `mockClear`, and the difference is the whole bug it fixes.
  //
  // `mockClear` empties the call list and nothing else: a `mockResolvedValue`
  // stays installed, and — worse — an unconsumed `mockResolvedValueOnce` stays
  // QUEUED. Several tests here queue a one-shot account list and then assert
  // that `listAccounts` is never called, so their value is still sitting in the
  // queue when the suite moves on, waiting to be handed to whichever later test
  // calls it first. That is not hypothetical: it made the disconnect tests
  // silently take the sole-Google-account branch and skip the unlink they exist
  // to assert.
  //
  // `mockReset` drains the queue and drops the implementation, so the default
  // below is re-established from a clean slate every time.
  listAccounts.mockReset()
  listAccounts.mockResolvedValue({ data: [] })
  linkSocial.mockClear()
  unlinkAccount.mockClear()
  unlinkAccount.mockResolvedValue({ data: { status: true }, error: null })
  googleConnect.mockClear()
  googleDisconnect.mockClear()
  // The round-trip marker lives in `sessionStorage` precisely so it survives a
  // document load; it therefore also survives between tests unless cleared.
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
})

type SettingsFixture = Omit<typeof SETTINGS, "logoUrl"> & {
  logoUrl: string | null
}

type ConnectionFixture = {
  connected: boolean
  status: "ok" | "reauth"
  lastSyncedAt: number | null
}

function renderSettings(
  over: Partial<SettingsFixture> = {},
  connectionOver: Partial<ConnectionFixture> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(convexKey(api.settings.get, {}), { ...SETTINGS, ...over })
  // Google Calendar's section renders inside this same page and its three
  // reads (`useSuspenseQuery`, not `useQuery`) would otherwise suspend forever
  // with no data ever arriving in this test's fake client — nothing here
  // exercises that section, so "not connected, nothing to show" is enough
  // unless a test overrides it (the reconnect-effect tests below do).
  client.setQueryData(convexKey(api.google.connection, {}), {
    connected: false,
    status: "ok",
    lastSyncedAt: null,
    ...connectionOver,
  })
  client.setQueryData(convexKey(api.google.listCalendars, {}), [])
  client.setQueryData(convexKey(api.projects.list, {}), [])
  // The client is returned so a test can push a new `google.connection` the way
  // the real Convex subscription does after `disconnect` invalidates it — which
  // is the exact moment the re-connect defect used to fire.
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <Toast.Provider>
          <Settings />
          <ToastViewport />
        </Toast.Provider>
      </QueryClientProvider>
    ),
  }
}

/** Arms the page's one-shot "this load is a return from Google" marker, the
 *  same key `settings.tsx` writes before `linkSocial` navigates away. Set
 *  directly rather than by pressing Connect, because `linkSocial` is a full
 *  document navigation that jsdom cannot perform. */
function simulateOAuthReturn() {
  window.sessionStorage.setItem("chroneli:google-link-return", "1")
}

const leaveOut = () => screen.getByLabelText("Leave notes out")
const printThem = () => screen.getByLabelText("Print each row's notes")

describe("/settings — notes in the PDF report", () => {
  it("states both outcomes rather than one checkbox to infer from", () => {
    renderSettings()
    expect(leaveOut()).toBeTruthy()
    expect(printThem()).toBeTruthy()
  })

  /* THE DEFAULT. `SETTINGS_DEFAULTS.pdfIncludeNotes` is false and this is the
   * screen that has to show it that way; a control that renders "on" over a
   * stored "off" is how a client receives notes nobody chose to send. */
  it("is off for an account that has never touched it", () => {
    renderSettings({ pdfIncludeNotes: false })
    expect((leaveOut() as HTMLInputElement).checked).toBe(true)
    expect((printThem() as HTMLInputElement).checked).toBe(false)
  })

  it("reflects an account that has turned it on", () => {
    renderSettings({ pdfIncludeNotes: true })
    expect((printThem() as HTMLInputElement).checked).toBe(true)
    expect((leaveOut() as HTMLInputElement).checked).toBe(false)
  })

  it("saves the moment it is switched on, like every other control here", async () => {
    renderSettings({ pdfIncludeNotes: false })
    fireEvent.click(printThem())
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ pdfIncludeNotes: true })
    )
  })

  it("saves the moment it is switched back off", async () => {
    renderSettings({ pdfIncludeNotes: true })
    fireEvent.click(leaveOut())
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ pdfIncludeNotes: false })
    )
  })

  /* The hint has to say what the control does NOT touch, because "notes in the
   * report" reads as though it might change /reports itself or the other two
   * export formats. It changes neither. */
  it("says which artefacts it does and does not change", () => {
    renderSettings()
    const hint = screen.getByText(/A note is what you wrote/)
    expect(hint.textContent).toContain("CSV and XLSX exports never carry notes")
  })
})

/*
 * /settings' grouping control — here for the same reason the block above is:
 * the DEFAULT is the point, and this one defaults ON.
 *
 * The default itself is the SERVER's, and is asserted there: see
 * convex/settings.test.ts on a row written before the column existed reading
 * back `true`. What this screen owns is the rendering of it — a control that
 * showed unchecked over a stored `true` would read as a feature nobody
 * enabled, and that is a client bug the server test cannot see.
 *
 * `DayList`'s own `grouped` prop defaults OFF, which is deliberate and
 * documented there; it is not the shipped default and nothing here should be
 * read as asserting it.
 */
const groupBox = () =>
  screen.getByLabelText<HTMLInputElement>(
    "Group a day's repeats of the same entry"
  )

describe("/settings — repeated entries", () => {
  /* NO OVERRIDE — this one binds to the `SETTINGS` fixture deliberately, so
   * that flipping the shipped default without meaning to fails here rather
   * than passing against a value the test supplied itself. */
  it("is on for an account that has never touched it", () => {
    renderSettings()
    expect(groupBox().checked).toBe(true)
  })

  it("reflects an account that has turned it off", () => {
    renderSettings({ groupEntries: false })
    expect(groupBox().checked).toBe(false)
  })

  it("saves the moment it is switched off", async () => {
    renderSettings({ groupEntries: true })
    fireEvent.click(groupBox())
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ groupEntries: false })
    )
  })

  it("saves the moment it is switched back on", async () => {
    renderSettings({ groupEntries: false })
    fireEvent.click(groupBox())
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ groupEntries: true })
    )
  })

  /* The hint has to say what grouping does NOT touch. "Group repeats" reads as
   * though entries were being merged into one, which would change what a client
   * is billed for; nothing is merged and no total moves. */
  it("says nothing is merged and no total moves", () => {
    renderSettings()
    const hint = screen.getByText(/When you start and stop the same task/)
    expect(hint.textContent).toContain("Nothing is merged")
    expect(hint.textContent).toContain(
      "exports, invoices and totals are unaffected"
    )
  })
})

describe("/settings — invoice lines", () => {
  const mergeBox = () =>
    screen.getByLabelText<HTMLInputElement>(
      "Merge same-rate projects into one invoice line"
    )

  it("reflects the account default and saves either choice immediately", async () => {
    renderSettings({ mergeInvoiceLines: true })
    expect(mergeBox().checked).toBe(true)
    fireEvent.click(mergeBox())
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ mergeInvoiceLines: false })
    )
  })

  it("reflects an account that prefers project lines", () => {
    renderSettings({ mergeInvoiceLines: false })
    expect(mergeBox().checked).toBe(false)
  })
})

describe("/settings — invoice logo", () => {
  it("states the backend's accepted formats and size bound", () => {
    renderSettings()
    expect(screen.getByText(/PNG or JPEG, up to 1 MB/)).toBeTruthy()
  })

  it("renders the current logo at its natural aspect ratio and offers removal", () => {
    renderSettings({ logoUrl: "https://files.example/current.png" })
    const image = document.querySelector(
      'img[src="https://files.example/current.png"]'
    )
    expect(image).toBeTruthy()
    expect(image?.getAttribute("alt")).toBe("")
    expect(screen.getByRole("button", { name: "Remove logo" })).toBeTruthy()
  })

  it("uploads the selected file, then selects its returned storage id", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ storageId: "storage-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderSettings()

    const file = new File([new Uint8Array([1, 2, 3])], "mark.png", {
      type: "image/png",
    })
    fireEvent.change(screen.getByLabelText("Invoice logo file"), {
      target: { files: [file] },
    })

    await waitFor(() => expect(generateLogoUploadUrl).toHaveBeenCalledWith({}))
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/logo",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: file,
      })
    )
    await waitFor(() =>
      expect(setLogo).toHaveBeenCalledWith({ storageId: "storage-1" })
    )
  })

  it("refuses an unsupported file locally with an actionable message", async () => {
    renderSettings()
    const file = new File([new Uint8Array([1])], "mark.gif", {
      type: "image/gif",
    })

    fireEvent.change(screen.getByLabelText("Invoice logo file"), {
      target: { files: [file] },
    })

    expect(
      await screen.findAllByText("Use a PNG or JPEG logo no larger than 1 MB.")
    ).toHaveLength(2)
    expect(generateLogoUploadUrl).not.toHaveBeenCalled()
  })

  it("keeps upload failures actionable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    )
    renderSettings()
    const file = new File([new Uint8Array([1])], "mark.png", {
      type: "image/png",
    })

    fireEvent.change(screen.getByLabelText("Invoice logo file"), {
      target: { files: [file] },
    })

    expect(
      await screen.findAllByText("That didn't save. Try again.")
    ).toHaveLength(2)
    expect(setLogo).not.toHaveBeenCalled()
  })

  it("clears only the pointer when Remove is pressed", async () => {
    renderSettings({ logoUrl: "https://files.example/current.png" })
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }))
    await waitFor(() => expect(clearLogo).toHaveBeenCalledWith({}))
  })
})

/*
 * /settings' HOP TWO effect — the round-trip that fires `google.connect`
 * after `linkSocial` redirects back from Google.
 *
 * `google.connect` is, by its own comment in convex/google.ts, the ONLY
 * thing that clears a connection's `reauth` flag. A guard that only checked
 * `connected` would return early for a reconnect, because a `reauth` row is
 * still `connected: true` — leaving the "lost access" banner up until the
 * next cron tick, up to 15 minutes later, even though the user just finished
 * Google's consent screen. The first test below is that reconnect case; the
 * second is the healthy state that must NOT retrigger the mutation on every
 * settings page load.
 */
describe("/settings — Google reconnect after reauth", () => {
  it("fires google.connect when a reauth-flagged connection comes back from Google", async () => {
    listAccounts.mockResolvedValueOnce({
      data: [{ providerId: "google" }],
    })
    simulateOAuthReturn()
    renderSettings({}, { connected: true, status: "reauth" })
    await waitFor(() => expect(googleConnect).toHaveBeenCalledWith({}))
  })

  it("fires google.connect on a first connect coming back from Google", async () => {
    listAccounts.mockResolvedValueOnce({
      data: [{ providerId: "google" }],
    })
    simulateOAuthReturn()
    renderSettings({}, { connected: false, status: "ok" })
    await waitFor(() => expect(googleConnect).toHaveBeenCalledWith({}))
  })

  it("does not call google.connect for an already-healthy connection", async () => {
    listAccounts.mockResolvedValueOnce({
      data: [{ providerId: "google" }],
    })
    renderSettings({}, { connected: true, status: "ok" })
    await waitFor(() => expect(screen.getByText("Settings")).toBeTruthy())
    expect(listAccounts).not.toHaveBeenCalled()
    expect(googleConnect).not.toHaveBeenCalled()
  })

  it("does not call google.connect on an ordinary disconnected page load", async () => {
    // The defect this replaced: the effect ran on mount whenever the
    // connection was not healthy, so simply opening /settings while
    // disconnected went looking for a linked Google account to re-adopt.
    listAccounts.mockResolvedValueOnce({
      data: [{ providerId: "google" }],
    })
    renderSettings({}, { connected: false, status: "ok" })
    await waitFor(() => expect(screen.getByText("Settings")).toBeTruthy())
    expect(listAccounts).not.toHaveBeenCalled()
    expect(googleConnect).not.toHaveBeenCalled()
  })
})

/*
 * /settings' DISCONNECT — the control that used to undo itself.
 *
 * Deleting the `googleConnections` row flipped `connection.connected`
 * true→false, which changed the round-trip effect's dependencies, which re-ran
 * it, which found the Google account nothing had unlinked and inserted a fresh
 * connection row. The user watched the section flip straight back to connected
 * and the mirror re-acquire other people's names and addresses.
 */
describe("/settings — Google disconnect", () => {
  it("stays disconnected and does not re-fire connect", async () => {
    listAccounts.mockResolvedValue({ data: [{ providerId: "google" }] })
    const { client } = renderSettings({}, { connected: true, status: "ok" })

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    await waitFor(() => expect(googleDisconnect).toHaveBeenCalledWith({}))

    // What the real Convex subscription pushes once `disconnect` has
    // invalidated `api.google.connection`.
    client.setQueryData(convexKey(api.google.connection, {}), {
      connected: false,
      status: "ok",
      lastSyncedAt: null,
      lastError: null,
      lastErrorAt: null,
    })

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Connect Google/i })).toBeTruthy()
    )
    // EXACTLY ONE call, not zero: `disconnectGoogle` reads the account list
    // itself, to find out whether Google is the only way into this account. A
    // SECOND call would mean the round-trip effect had fired — which is the
    // regression this test exists to catch, since disconnecting flips
    // `connected` to false and that is precisely what used to re-trigger it.
    expect(listAccounts).toHaveBeenCalledTimes(1)
    expect(googleConnect).not.toHaveBeenCalled()
  })

  it("revokes the Google grant rather than only forgetting the mirror", async () => {
    // A password account that later linked Google — two rows, so the unlink is
    // safe to attempt.
    listAccounts.mockResolvedValue({
      data: [{ providerId: "credential" }, { providerId: "google" }],
    })
    renderSettings({}, { connected: true, status: "ok" })
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    await waitFor(() =>
      expect(unlinkAccount).toHaveBeenCalledWith({ providerId: "google" })
    )
    // Our rows first: a surviving grant with no rows is recoverable, a revoked
    // grant with surviving rows burns the connection to `reauth`.
    expect(googleDisconnect.mock.invocationCallOrder[0]).toBeLessThan(
      unlinkAccount.mock.invocationCallOrder[0]
    )
  })

  it("does not unlink Google when it is the only way into the account", async () => {
    // What `signIn.social` on the auth screens now creates: an identity whose
    // ONLY account row is the Google one. Unlinking it would revoke the user's
    // sole credential and lock them out, and Better Auth refuses it anyway
    // (FAILED_TO_UNLINK_LAST_ACCOUNT) — so the attempt is not made, and the
    // user is told where the grant actually lives instead of being advised to
    // press a button that can never work for them.
    listAccounts.mockResolvedValue({ data: [{ providerId: "google" }] })
    renderSettings({}, { connected: true, status: "ok" })

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    await waitFor(() => expect(googleDisconnect).toHaveBeenCalledWith({}))

    expect(unlinkAccount).not.toHaveBeenCalled()
    // `getAllBy`, because the toast renders its title in a live region as well
    // as on screen, so the sentence legitimately appears more than once.
    await waitFor(() =>
      expect(screen.getAllByText(/myaccount/).length).toBeGreaterThan(0)
    )
  })

  it("says so when the grant could not be revoked", async () => {
    listAccounts.mockResolvedValue({
      data: [{ providerId: "credential" }, { providerId: "google" }],
    })
    unlinkAccount.mockResolvedValue({
      data: null,
      error: { message: "session is not fresh" },
    })
    renderSettings({}, { connected: true, status: "ok" })
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))
    expect(
      await screen.findAllByText(/could not revoke its Google access/i)
    ).toHaveLength(2)
  })
})
