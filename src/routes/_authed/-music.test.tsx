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
import { Music } from "@/routes/_authed/-music"
import { convexKey } from "@/test-utils/convex-query"
import { api } from "../../../convex/_generated/api"
import { getFunctionName } from "convex/server"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"

type ConvexReactQueryModule = typeof ConvexReactQueryModuleType

/*
 * /music — the library.
 *
 * `fireEvent`, not `@testing-library/user-event`, and plain assertions rather
 * than jest-dom matchers: neither package is a dependency of this project. See
 * the header of src/components/reports/export-menu.test.tsx, which states the
 * rule for the whole repo.
 *
 * The Convex mocking is -settings.test.tsx's, verbatim in shape: the QUERIES
 * go through the real `convexQuery` against a seeded `QueryClient`, so the
 * page's `useSuspenseQuery` calls resolve without a network, and only
 * `useConvexMutation`/`useConvexAction` are replaced with spies. Seeding the
 * client rather than stubbing `convexQuery` keeps the key that the page asks
 * for and the key this file writes derived from the same `getFunctionName`,
 * so a query renamed on either side fails loudly instead of quietly reading
 * `undefined`.
 */

const { generateUploadUrl, addTrack, renameTrack, removeTrack } = vi.hoisted(
  () => ({
    generateUploadUrl: vi.fn(async () => "https://upload.example/track"),
    // `addTrack` is an ACTION, not a mutation, so it arrives through
    // `useConvexAction` — the same split -settings.test.tsx draws between
    // `generateLogoUploadUrl` (mutation) and `setLogo` (action).
    //
    // Its parameter is DECLARED even though the body ignores it: `vi.fn(async
    // () => …)` types the recorded calls as `[]`, so reading
    // `addTrack.mock.calls[0][0]` — which the upload test below does, because
    // the point of that test is the argument shape — is a tuple index error
    // rather than the assertion it looks like.
    addTrack: vi.fn(async (_args: Record<string, unknown>) => "t9"),
    renameTrack: vi.fn(async () => null),
    removeTrack: vi.fn(async () => null),
  })
)

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactQueryModule>()
  return {
    ...actual,
    useConvexMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(reference)
      if (name === "music:generateUploadUrl") return generateUploadUrl
      if (name === "music:removeTrack") return removeTrack
      return renameTrack
    },
    useConvexAction: () => addTrack,
  }
})

afterEach(() => {
  cleanup()
  generateUploadUrl.mockClear()
  addTrack.mockClear()
  renameTrack.mockClear()
  removeTrack.mockClear()
  vi.unstubAllGlobals()
})

/*
 * Two tracks whose NAME order and whose CREATION order disagree, deliberately.
 *
 * Alpha sorts first by name and Beta has the later `_creationTime`, so "sorted
 * by name" and "recently added" cannot both pass by accident on a list that
 * happens to already be in the right order — which is exactly what a fixture
 * listed in one single order would let through.
 */
const TRACKS = [
  {
    _id: "t3",
    name: "Beta",
    bytes: 1_000_000,
    _creationTime: 2_000,
    url: "https://f/b",
  },
  {
    _id: "t2",
    name: "Alpha",
    bytes: 2_000_000,
    _creationTime: 1_000,
    url: "https://f/a",
  },
]

function renderMusic(
  tracks: Array<Record<string, unknown>> = TRACKS,
  usage: { bytes: number; count: number } = { bytes: 3_000_000, count: 2 }
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(convexKey(api.music.listTracks, {}), tracks)
  client.setQueryData(convexKey(api.music.usage, {}), usage)
  return render(
    <QueryClientProvider client={client}>
      <Toast.Provider>
        <Music />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

describe("the library", () => {
  it("lists tracks sorted by name by default", () => {
    renderMusic()
    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("Alpha")
    expect(rows[1].textContent).toContain("Beta")
  })

  /* The ceiling is read from `MAX_LIBRARY_BYTES`, so the number in the
   * sentence and the number the server enforces cannot drift apart. */
  it("reports usage against the cap", () => {
    renderMusic()
    expect(screen.getByText(/of 500 MB/i)).toBeTruthy()
  })

  it("filters by search", () => {
    renderMusic()
    fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
      target: { value: "alph" },
    })
    expect(screen.getAllByRole("listitem")).toHaveLength(1)
  })

  it("sorts by recently added", () => {
    renderMusic()
    fireEvent.change(screen.getByRole("combobox", { name: /sort/i }), {
      target: { value: "recent" },
    })
    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("Beta")
  })

  it("renames a track", async () => {
    renderMusic()
    fireEvent.click(screen.getByRole("button", { name: /rename alpha/i }))
    const field = screen.getByRole("textbox", { name: /track name/i })
    fireEvent.change(field, { target: { value: "Renamed" } })
    fireEvent.keyDown(field, { key: "Enter" })
    await waitFor(() =>
      expect(renameTrack).toHaveBeenCalledWith({
        trackId: "t2",
        name: "Renamed",
      })
    )
  })

  it("removes a track", async () => {
    renderMusic()
    fireEvent.click(screen.getByRole("button", { name: /remove alpha/i }))
    await waitFor(() =>
      expect(removeTrack).toHaveBeenCalledWith({ trackId: "t2" })
    )
  })

  it("shows an empty state when nothing is uploaded", () => {
    renderMusic([], { bytes: 0, count: 0 })
    expect(screen.getByText(/no music uploaded yet/i)).toBeTruthy()
  })

  /*
   * THE UPLOAD, covered here because it is the one thing on this page with no
   * other proof. The three-step dance — mint a URL, POST the blob, hand the
   * returned storage id to the action — is `settings.setLogo`'s, and the
   * failure it is most prone to is a silent one: a POST that succeeds while
   * the id is read from the wrong field simply never adds a track.
   *
   * `durationMs` is asserted ABSENT rather than present. jsdom decodes no
   * audio, which is the same shape as a real file the browser cannot decode —
   * and the rule is that such a file still uploads, with the field omitted
   * rather than sent as null or zero.
   */
  it("uploads a file and hands the returned storage id to addTrack", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ storageId: "storage-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    renderMusic()

    const file = new File([new Uint8Array([1, 2, 3])], "Rain On Glass.mp3", {
      type: "audio/mpeg",
    })
    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [file] },
    })

    await waitFor(() => expect(generateUploadUrl).toHaveBeenCalledWith({}))
    expect(fetchMock).toHaveBeenCalledWith(
      "https://upload.example/track",
      expect.objectContaining({ method: "POST", body: file })
    )
    await waitFor(() => expect(addTrack).toHaveBeenCalled())
    const sent = addTrack.mock.calls[0][0]
    expect(sent.storageId).toBe("storage-1")
    expect(sent.name).toBe("Rain On Glass")
    expect(typeof sent.clientKey).toBe("string")
    expect("durationMs" in sent).toBe(false)
  })

  /* The backend's own sentences — INVALID_TRACK, LIBRARY_FULL — are already
   * written for a person, so the page shows them verbatim rather than
   * translating them into a second vocabulary. */
  it("surfaces a rejected upload without rewriting the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 }))
    )
    renderMusic()

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: {
        files: [
          new File([new Uint8Array([1])], "x.mp3", { type: "audio/mpeg" }),
        ],
      },
    })

    // Two nodes: the toast renders its title in a live region as well as on
    // screen — see -settings.test.tsx, which documents the same doubling.
    expect(
      await screen.findAllByText("That didn't save. Try again.")
    ).toHaveLength(2)
    expect(addTrack).not.toHaveBeenCalled()
  })
})
