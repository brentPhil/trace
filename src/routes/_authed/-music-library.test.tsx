import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@/components/ui/toast"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MAX_LIBRARY_BYTES, MAX_TRACK_BYTES, formatBytes } from "@shared/audio"
import { MusicLibrarySection } from "@/routes/_authed/-music-library"
import {
  convexKey,
  resetConnectionOnline,
  setConnectionOnline,
} from "@/test-utils/convex-query"
import { api } from "../../../convex/_generated/api"
import { getFunctionName } from "convex/server"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"
import { chooseOption } from "@/test-utils/select"
import type * as ConvexReactModuleType from "convex/react"

type ConvexReactQueryModule = typeof ConvexReactQueryModuleType
type ConvexReactModule = typeof ConvexReactModuleType

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

// `useOnlineStatus` (the section's own online-only gate, see -music-library.tsx)
// reads `useConvexConnectionState` from "convex/react", which needs a real
// `ConvexReactClient` this file does not have. `useConvexConnectionStateDouble`
// answers "online" by default — see `@/test-utils/convex-query` for what
// flipping it offline means and why.
vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactModule>()
  const { useConvexConnectionStateDouble } =
    await import("@/test-utils/convex-query")
  return { ...actual, useConvexConnectionState: useConvexConnectionStateDouble }
})

afterEach(() => {
  cleanup()
  generateUploadUrl.mockClear()
  addTrack.mockClear()
  renameTrack.mockClear()
  removeTrack.mockClear()
  resetConnectionOnline()
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

/*
 * A stand-in for XMLHttpRequest.
 *
 * The upload POST moved off `fetch` because `fetch` resolves only when the
 * body has finished going out and reports nothing on the way — there is no
 * progress event to listen for. XHR's `upload` object has one, which is the
 * entire reason this fake exists.
 *
 * `emitProgress` lets a test drive the bar to a known point and assert what
 * the row says, rather than racing a real transfer.
 */
class FakeXhr {
  static last: FakeXhr | null = null
  upload = { onprogress: null as null | ((e: ProgressEvent) => void) }
  status = 200
  responseText = JSON.stringify({ storageId: "storage-1" })
  onload: null | (() => void) = null
  onerror: null | (() => void) = null
  onabort: null | (() => void) = null
  method = ""
  url = ""
  headers: Record<string, string> = {}
  body: unknown = null

  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }
  send(body: unknown) {
    this.body = body
  }
  aborted = false
  abort() {
    this.aborted = true
    this.onabort?.()
  }

  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({
      loaded,
      total,
      lengthComputable: true,
    } as ProgressEvent)
  }
  finish() {
    this.onload?.()
  }
}

function useFakeXhr() {
  FakeXhr.last = null
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return FakeXhr
}

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
      <Toaster>
        <MusicLibrarySection />
      </Toaster>
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
   * sentence and the number the server enforces cannot drift apart — and the
   * assertion derives it too, for the same reason. */
  it("reports usage against the cap", () => {
    renderMusic()
    expect(
      screen.getByText(new RegExp(`of ${formatBytes(MAX_LIBRARY_BYTES)} used`))
    ).toBeTruthy()
  })

  /* The 2 GiB cap must not read "2048 MB". This is the assertion that would
   * have caught it. */
  it("spells the library cap in gigabytes", () => {
    renderMusic()
    expect(screen.getByText(/of 2 GB used/)).toBeTruthy()
  })

  /* `usage.count` has been computed, validated and sent on every page load
   * since the feature shipped, and rendered nowhere. */
  it("reports the track count against its own cap", () => {
    renderMusic()
    expect(screen.getByText(/2 of 500 tracks/i)).toBeTruthy()
  })

  it("says how much room is left", () => {
    renderMusic()
    const free = MAX_LIBRARY_BYTES - 3_000_000
    expect(
      screen.getByText(new RegExp(`${formatBytes(free)} free`))
    ).toBeTruthy()
  })

  /* Colour is never the only signal — DESIGN.md — and the signal colours are
   * reserved by meaning, so a nearly-full library changes only the SENTENCE. */
  it("leads with what is left when the library is nearly full", () => {
    renderMusic(TRACKS, { bytes: MAX_LIBRARY_BYTES * 0.95, count: 2 })
    expect(screen.getByText(/nearly full/i)).toBeTruthy()
  })

  /* Full is the one state that IS an error — the next upload will be refused
   * — so it is the one that earns `alarm`. */
  it("says the library is full at the cap", () => {
    renderMusic(TRACKS, { bytes: MAX_LIBRARY_BYTES, count: 2 })
    expect(screen.getByText(/library full/i)).toBeTruthy()
  })

  it("states the accepted formats and the per-track cap up front", () => {
    renderMusic()
    expect(screen.getByText(/MP3, M4A, WAV, OGG or FLAC/i)).toBeTruthy()
    expect(
      screen.getByText(new RegExp(`up to ${formatBytes(MAX_TRACK_BYTES)} each`))
    ).toBeTruthy()
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
    chooseOption(/sort/i, "Recently added")
    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("Beta")
  })

  it("sorts by largest", () => {
    renderMusic()
    chooseOption(/sort/i, "Largest")
    // Alpha is 2 MB, Beta is 1 MB.
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("Alpha")
  })

  /*
   * `durationMs` is optional. A track without one is not a zero-length track,
   * so it sorts last rather than first.
   *
   * The CREATION ORDER IS THE REVERSE of the answer, deliberately: while
   * "longest" fell through to the `recent` branch this test passed for the
   * wrong reason, because the fixture happened to already be in the order it
   * asserted. NoDuration is the newer row, so a fall-through now fails.
   */
  it("puts tracks with no known duration last under longest", () => {
    renderMusic([
      { _id: "t1", name: "NoDuration", bytes: 1, _creationTime: 2, url: "u" },
      {
        _id: "t2",
        name: "HasDuration",
        bytes: 1,
        durationMs: 60_000,
        _creationTime: 1,
        url: "u",
      },
    ])
    chooseOption(/sort/i, "Longest")
    const rows = screen.getAllByRole("listitem")
    expect(rows[0].textContent).toContain("HasDuration")
    expect(rows[1].textContent).toContain("NoDuration")
  })

  it("says how many of how many match a search", () => {
    renderMusic()
    fireEvent.change(screen.getByRole("searchbox", { name: /search/i }), {
      target: { value: "alph" },
    })
    expect(screen.getByText(/1 of 2/)).toBeTruthy()
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

  /*
   * THE REJECTED RENAME, covered here because before this fix it was the
   * only mutation on this page whose failure path went untested — and
   * untested is exactly how `onRename={(name) =>
   * renameTrack(...).then(() => {})}` shipped with no `.catch` at all.
   * `TrackRow.commit` swallowed the rejection to reopen the field, so the
   * server's own INVALID_TRACK sentence — "A track needs a name." — never
   * reached `report`, and the only visible signal was the field silently
   * reopening. `renameTrack` rejects with the same `{ data: { code,
   * message } }` shape `isTraceError` narrows, exactly what a real Convex
   * mutation rejection carries after crossing the wire.
   */
  it("surfaces a rejected rename without rewriting the reason", async () => {
    renameTrack.mockImplementationOnce(() =>
      Promise.reject({
        data: { code: "INVALID_TRACK", message: "A track needs a name." },
      })
    )
    renderMusic()

    fireEvent.click(screen.getByRole("button", { name: /rename alpha/i }))
    const field = screen.getByRole("textbox", { name: /track name/i })
    fireEvent.change(field, { target: { value: "" } })
    fireEvent.keyDown(field, { key: "Enter" })

    // Two nodes, the same doubling the rejected-upload test documents: the
    // toast's title renders both on screen and in a live region.
    expect(await screen.findAllByText("A track needs a name.")).toHaveLength(2)

    // The field reopens even though the rejection was ALSO reported — the
    // rethrow in the page's onRename keeps TrackRow.commit's own `.catch`
    // firing, which is what puts the rejected (here, blank) text back in an
    // editable field rather than leaving the row stuck showing nothing.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /track name/i })).toBeTruthy()
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
    useFakeXhr()
    renderMusic()

    const file = new File([new Uint8Array([1, 2, 3])], "Rain On Glass.mp3", {
      type: "audio/mpeg",
    })
    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [file] },
    })

    await waitFor(() => expect(generateUploadUrl).toHaveBeenCalledWith({}))
    await waitFor(() => expect(FakeXhr.last).not.toBeNull())

    const xhr = FakeXhr.last!
    expect(xhr.method).toBe("POST")
    expect(xhr.url).toBe("https://upload.example/track")
    expect(xhr.body).toBe(file)
    expect(xhr.headers["Content-Type"]).toBe("audio/mpeg")
    xhr.finish()

    await waitFor(() => expect(addTrack).toHaveBeenCalled())
    const sent = addTrack.mock.calls[0][0]
    expect(sent.storageId).toBe("storage-1")
    expect(sent.name).toBe("Rain On Glass")
    expect(typeof sent.clientKey).toBe("string")
    expect("durationMs" in sent).toBe(false)
  })

  /*
   * The header is OMITTED, not sent empty, when the OS gave the file no type.
   * An empty Content-Type is a claim that the type is "", which Convex records
   * and `isAcceptedAudioContentType` then refuses — so the file that had the
   * best chance of being sniffed correctly is the one guaranteed to fail.
   */
  it("sends no Content-Type at all for a file the OS did not type", async () => {
    useFakeXhr()
    renderMusic()

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: {
        files: [new File([new Uint8Array([1])], "untyped", { type: "" })],
      },
    })

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    expect("Content-Type" in FakeXhr.last!.headers).toBe(false)
  })

  /* The backend's own sentences — INVALID_TRACK, LIBRARY_FULL — are already
   * written for a person, so the page shows them verbatim rather than
   * translating them into a second vocabulary. */
  it("shows a row with live bytes while a file uploads", async () => {
    useFakeXhr()
    renderMusic()

    // A real size, not `new Uint8Array(10)` — the row renders `mb(item.bytes)`
    // off `file.size`, so a ten-BYTE file correctly reads "of 0 MB".
    const long = new File([new Uint8Array(10)], "Long Track.mp3", {
      type: "audio/mpeg",
    })
    Object.defineProperty(long, "size", { value: 10 * 1024 * 1024 })

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [long] },
    })

    // The row names the file, which is the thing the old anonymous toast
    // could not do.
    expect(await screen.findByText("Long Track.mp3")).toBeTruthy()

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    FakeXhr.last!.emitProgress(5 * 1024 * 1024, 10 * 1024 * 1024)

    expect(await screen.findByText(/5 MB of 10 MB/)).toBeTruthy()
  })

  /*
   * CANCEL, which only became necessary when the per-track cap went to 250 MB.
   * At 20 MB a mistaken upload was over before you could regret it; at 250 MB
   * it can hold the queue for minutes with no way out.
   */
  it("cancels an upload in flight and lets it be retried", async () => {
    useFakeXhr()
    renderMusic()

    const big = new File([new Uint8Array(1)], "Wrong Album.flac", {
      type: "audio/flac",
    })
    Object.defineProperty(big, "size", { value: 200 * 1024 * 1024 })

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [big] },
    })

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    const xhr = FakeXhr.last!

    fireEvent.click(
      await screen.findByRole("button", { name: /cancel wrong album\.flac/i })
    )

    // The request is really torn down, not merely forgotten about — otherwise
    // the bytes keep going out and the "cancel" is a lie told to the user.
    await waitFor(() => expect(xhr.aborted).toBe(true))

    // A cancellation is not a failure: it says so plainly and still offers
    // the retry, because "wrong file, start over" is the reason to cancel.
    // The row and the summary BOTH say it, which is why this matches all
    // rather than one.
    expect(await screen.findByText("Cancelled")).toBeTruthy()

    // And the summary counts it apart from a failure, so a batch the user
    // stopped on purpose does not report itself back as broken.
    expect(await screen.findByText(/0 added · 1 cancelled/)).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /retry wrong album\.flac/i })
    ).toBeTruthy()
    expect(addTrack).not.toHaveBeenCalled()
  })

  it("summarises the batch in one live region", async () => {
    useFakeXhr()
    renderMusic()

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: {
        files: [
          new File([new Uint8Array(1)], "One.mp3", { type: "audio/mpeg" }),
          new File([new Uint8Array(1)], "Two.mp3", { type: "audio/mpeg" }),
        ],
      },
    })

    expect(await screen.findByText(/Uploading 1 of 2/)).toBeTruthy()
  })

  /*
   * THE POINT OF THE PANEL. The old path reported a failure through a toast
   * carrying only the backend's sentence — so three bad files in a folder drop
   * produced three identical messages, none of which said WHICH file failed,
   * and all of which timed out after eight seconds.
   */
  it("keeps a failed row, with its file name and a retry", async () => {
    useFakeXhr()
    renderMusic()

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: {
        files: [
          new File([new Uint8Array(1)], "Broken.mp3", { type: "audio/mpeg" }),
        ],
      },
    })

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    FakeXhr.last!.status = 500
    FakeXhr.last!.finish()

    expect(await screen.findByText("Broken.mp3")).toBeTruthy()
    expect(
      await screen.findByRole("button", { name: /retry broken\.mp3/i })
    ).toBeTruthy()
  })

  /*
   * The file never leaves the browser. Before this, a 300 MB file was uploaded
   * IN FULL, stored by Convex, read by `addTrackAction`, refused, and deleted
   * — with the user watching the whole transfer for an answer that `file.size`
   * already contained.
   */
  it("refuses an oversized file without sending it", async () => {
    useFakeXhr()
    renderMusic()

    const huge = new File([new Uint8Array(1)], "Huge.wav", {
      type: "audio/wav",
    })
    Object.defineProperty(huge, "size", {
      value: MAX_TRACK_BYTES + 1024 * 1024,
    })

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [huge] },
    })

    expect(
      await screen.findByText(
        new RegExp(`The limit is ${formatBytes(MAX_TRACK_BYTES)} per track`)
      )
    ).toBeTruthy()
    expect(FakeXhr.last).toBeNull()
    expect(generateUploadUrl).not.toHaveBeenCalled()
  })

  /* One bad file costs that file, not the good one behind it. */
  it("uploads the good file in a batch whose first file is refused", async () => {
    useFakeXhr()
    renderMusic()

    const huge = new File([new Uint8Array(1)], "Huge.wav", {
      type: "audio/wav",
    })
    Object.defineProperty(huge, "size", {
      value: MAX_TRACK_BYTES + 1024 * 1024,
    })
    const good = new File([new Uint8Array(1)], "Fine.mp3", {
      type: "audio/mpeg",
    })

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: { files: [huge, good] },
    })

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    FakeXhr.last!.finish()
    await waitFor(() => expect(addTrack).toHaveBeenCalledTimes(1))
    expect(addTrack.mock.calls[0][0].name).toBe("Fine")
  })

  it("surfaces a failed POST without rewriting the reason", async () => {
    useFakeXhr()
    renderMusic()

    fireEvent.change(screen.getByLabelText("Music files"), {
      target: {
        files: [
          new File([new Uint8Array([1])], "x.mp3", { type: "audio/mpeg" }),
        ],
      },
    })

    await waitFor(() => expect(FakeXhr.last).not.toBeNull())
    FakeXhr.last!.status = 503
    FakeXhr.last!.finish()

    // `findAllByText` with a length floor rather than an exact count: the
    // reason is about to be rendered in a queue row as well (Task 3), and a
    // test asserting exactly two nodes would break on a change that improves
    // the thing it is testing.
    expect(
      await screen.findAllByText(/That didn't save\. Try again\./)
    ).not.toHaveLength(0)
    expect(addTrack).not.toHaveBeenCalled()
  })

  /*
   * Uploading goes straight to Convex storage — `generateUploadUrl` and
   * `addTrack` above are a plain mutation and action, never the offline
   * outbox — so this stays online-only, the same rule the invoice logo
   * picker in -settings.tsx follows.
   */
  it("disables the file picker and states the offline reason", () => {
    setConnectionOnline(false)
    renderMusic()

    expect(
      screen.getByLabelText<HTMLInputElement>("Music files").disabled
    ).toBe(true)
    expect(
      screen.getByText("You're offline. Uploads need a connection.")
    ).toBeTruthy()
  })

  it("leaves the file picker enabled and says nothing about being offline while online", () => {
    renderMusic()

    expect(
      screen.getByLabelText<HTMLInputElement>("Music files").disabled
    ).toBe(false)
    expect(
      screen.queryByText("You're offline. Uploads need a connection.")
    ).toBeNull()
  })

  /*
   * The picker's own `disabled` is what stops an upload starting offline, but
   * a drop bypasses that element entirely — this file's own comment on the
   * drop handler says the guard "has to be repeated here". The list itself is
   * the drop target (see the component's docblock on why there is no
   * separate dashed zone), so its parent is where `onDrop` is wired.
   */
  it("ignores a drop on the list while offline", () => {
    setConnectionOnline(false)
    renderMusic()

    const dropTarget = screen.getByRole("list").parentElement as HTMLElement
    const file = new File([new Uint8Array([1, 2, 3])], "track.mp3", {
      type: "audio/mpeg",
    })
    fireEvent.drop(dropTarget, { dataTransfer: { files: [file] } })

    expect(generateUploadUrl).not.toHaveBeenCalled()
  })
})
