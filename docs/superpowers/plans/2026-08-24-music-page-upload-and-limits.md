# Music Page Upload and Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/music` report what an upload is doing while it happens, and refuse impossible uploads before they are sent — while stating the three caps the page currently keeps secret.

**Architecture:** A pure `upload-queue.ts` holds the cap rules so they test in Node without a DOM. An XHR wrapper replaces the `fetch` in `uploadOne`, because `fetch` cannot report upload progress. A queue panel component renders one row per file with live bytes; failures persist there with a per-file reason instead of vanishing into an anonymous toast. `Usage` moves to its own component and grows to carry count and free space. No file under `convex/` changes.

**Tech Stack:** React 19, TanStack Router/Query, Convex, Tailwind v4, Vitest 4 (three projects: `unit`/node, `dom`/jsdom, `convex`/edge-runtime), Testing Library with `fireEvent`.

## Global Constraints

- **Never add `@testing-library/user-event` or `jest-dom`.** Neither is a dependency. Use `fireEvent` and plain assertions. (Stated for the repo in `src/components/reports/export-menu.test.tsx`.)
- **No literal cap numbers in user-facing copy.** Every size, count and format list is rendered from `MAX_TRACK_BYTES`, `MAX_LIBRARY_BYTES`, `MAX_TRACK_COUNT`, `ACCEPTED_AUDIO_CONTENT_TYPES` imported from `@shared/audio`.
- **Sizes are formatted by the existing `formatMb`** — MiB arithmetic labelled "MB". `MAX_TRACK_BYTES` therefore reads "20 MB".
- **Do not modify `convex/music.ts` or `convex/lib/audio.ts`.** The server remains the only authority on what is accepted. `precheck` is advisory.
- **Uploads stay sequential.** The comment in `upload()` explains why; do not parallelise.
- **The `Content-Type` header is omitted entirely when `file.type === ""`.** Never sent empty. `addTrackAction` sniffs the blob when no header arrives.
- **Colour is never the only signal.** Per DESIGN.md, any colour change is paired with a text change.
- Style with Tailwind utilities inline. Never hand-write classes in a stylesheet.
- Run `npx prettier --write` on touched files before each commit.

---

## File Structure

| File                                                       | Responsibility                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/music/upload-queue.ts` **(create)**               | Pure cap rules: `precheck`, `advance`. No DOM, no React.          |
| `src/lib/music/upload-queue.test.ts` **(create)**          | Unit tests for the above (`unit` project, Node).                  |
| `src/lib/music/post-file.ts` **(create)**                  | `postFileWithProgress` — the XHR wrapper returning a `storageId`. |
| `src/components/music/upload-queue-panel.tsx` **(create)** | The queue panel and its rows. Presentational.                     |
| `src/components/music/library-usage.tsx` **(create)**      | The meter, extracted from `-music.tsx` and grown.                 |
| `src/routes/_authed/-music.tsx` **(modify)**               | Owns queue state, wires precheck + progress + panel.              |
| `src/routes/_authed/-music.test.tsx` **(modify)**          | Existing fetch stubs become XHR stubs; new coverage added.        |

---

### Task 1: The cap rules, as pure functions

**Files:**

- Create: `src/lib/music/upload-queue.ts`
- Test: `src/lib/music/upload-queue.test.ts`

**Interfaces:**

- Consumes: `MAX_TRACK_BYTES`, `MAX_LIBRARY_BYTES`, `MAX_TRACK_COUNT`, `isAcceptedAudioContentType` from `@shared/audio`.
- Produces:
  - `type Candidate = { name: string; size: number; type: string }`
  - `type LibraryState = { libraryBytes: number; trackCount: number }`
  - `type PrecheckResult = { ok: true } | { ok: false; reason: string }`
  - `precheck(candidate: Candidate, against: LibraryState): PrecheckResult`
  - `advance(state: LibraryState, candidate: Candidate): LibraryState`

`Candidate` is structural rather than `File` on purpose: this module runs in the `unit` (Node) project, and a structural type also states that only three fields of a `File` matter here.

- [ ] **Step 1: Write the failing test**

Create `src/lib/music/upload-queue.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { advance, precheck } from "./upload-queue"
import {
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  MAX_TRACK_COUNT,
} from "@shared/audio"

const MB = 1024 * 1024
const file = (
  over: Partial<{ name: string; size: number; type: string }> = {}
) => ({
  name: "Track.mp3",
  size: MB,
  type: "audio/mpeg",
  ...over,
})
const empty = { libraryBytes: 0, trackCount: 0 }

describe("precheck", () => {
  it("accepts an ordinary track into an empty library", () => {
    expect(precheck(file(), empty)).toEqual({ ok: true })
  })

  it("refuses a track over the per-track cap, naming both sizes", () => {
    const result = precheck(file({ size: MAX_TRACK_BYTES + MB }), empty)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("21 MB")
    expect(result.reason).toContain("20 MB")
  })

  it("accepts a track exactly at the per-track cap", () => {
    expect(precheck(file({ size: MAX_TRACK_BYTES }), empty)).toEqual({
      ok: true,
    })
  })

  it("refuses a type the server would refuse", () => {
    const result = precheck(file({ type: "image/png" }), empty)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("FLAC")
  })

  /*
   * THE LOAD-BEARING CASE. An empty `file.type` is what the OS gives for many
   * files, and `addTrackAction` sniffs the blob when the client sends no
   * Content-Type header. Refusing here would reject files the server ACCEPTS.
   */
  it("lets a file with no type through to the server's sniffing", () => {
    expect(precheck(file({ type: "" }), empty)).toEqual({ ok: true })
  })

  it("refuses a track that will not fit, naming the free space", () => {
    const result = precheck(file({ size: 18 * MB }), {
      libraryBytes: MAX_LIBRARY_BYTES - 12 * MB,
      trackCount: 3,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("12 MB free")
    expect(result.reason).toContain("18 MB")
  })

  it("refuses a track once the count cap is reached", () => {
    const result = precheck(file(), {
      libraryBytes: 0,
      trackCount: MAX_TRACK_COUNT,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("500 tracks")
  })

  it("reports the size problem before the space problem", () => {
    const result = precheck(file({ size: MAX_TRACK_BYTES + MB }), {
      libraryBytes: MAX_LIBRARY_BYTES,
      trackCount: 0,
    })
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("per track")
  })
})

describe("advance", () => {
  it("adds the candidate's bytes and one track", () => {
    expect(
      advance({ libraryBytes: 5 * MB, trackCount: 2 }, file({ size: 3 * MB }))
    ).toEqual({ libraryBytes: 8 * MB, trackCount: 3 })
  })

  /*
   * BATCH-CUMULATIVE. Thirty files dropped into a library with room for four
   * must refuse the fifth. Checking each against the pre-drop total would
   * pass all thirty and let the server refuse twenty-six of them one at a
   * time, after uploading every byte.
   */
  it("makes a batch refuse once the running total fills the library", () => {
    let state = { libraryBytes: MAX_LIBRARY_BYTES - 10 * MB, trackCount: 1 }
    const candidate = file({ size: 4 * MB })

    expect(precheck(candidate, state).ok).toBe(true)
    state = advance(state, candidate)
    expect(precheck(candidate, state).ok).toBe(true)
    state = advance(state, candidate)
    expect(precheck(candidate, state).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/music/upload-queue.test.ts
```

Expected: FAIL — `Failed to resolve import "./upload-queue"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/music/upload-queue.ts`:

```ts
import {
  ACCEPTED_AUDIO_CONTENT_TYPES,
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  MAX_TRACK_COUNT,
  isAcceptedAudioContentType,
} from "@shared/audio"

/*
 * What the page can know before it sends a byte.
 *
 * ADVISORY, NEVER AUTHORITATIVE. `acceptTrack` in convex/music.ts remains the
 * only thing that decides whether a track is stored, and every sentence below
 * is a local echo of a rule it already enforces. The value here is not a second
 * layer of safety — it is that a 300 MB file currently uploads IN FULL, gets
 * stored by Convex, is read by `addTrackAction`, is refused, and is deleted,
 * with the user watching a progress bar the whole way for an answer that was
 * knowable from `file.size` alone.
 *
 * Structural `Candidate` rather than `File`: this module is in the `unit`
 * (Node) test project, and three fields is genuinely all that a cap check
 * reads off an upload.
 */

export type Candidate = { name: string; size: number; type: string }
export type LibraryState = { libraryBytes: number; trackCount: number }
export type PrecheckResult = { ok: true } | { ok: false; reason: string }

const OK: PrecheckResult = { ok: true }

/** Megabytes as the rest of the page writes them — see `formatMb` in
 *  -music.tsx, whose rounding this deliberately matches so "12 MB free" here
 *  and "12 MB of 500 MB used" there cannot disagree by a decimal. */
function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** "MP3, M4A, WAV, OGG or FLAC", built from the allow-list rather than typed
 *  out, so a format added to the server appears in this sentence by itself. */
export function acceptedFormatList(): string {
  const names = ACCEPTED_AUDIO_CONTENT_TYPES.map((type) =>
    type === "audio/mpeg"
      ? "MP3"
      : type === "audio/mp4"
        ? "M4A"
        : type.replace("audio/", "").toUpperCase()
  )
  const last = names[names.length - 1]
  return `${names.slice(0, -1).join(", ")} or ${last}`
}

/**
 * Whether this file can possibly be accepted, given the library as it stands.
 *
 * Order matters: the per-track cap is reported before the library cap, because
 * "that track is too big" is actionable (pick a different file) while "your
 * library is full" sends the user to delete things they may not need to.
 */
export function precheck(
  candidate: Candidate,
  against: LibraryState
): PrecheckResult {
  if (candidate.size > MAX_TRACK_BYTES) {
    return {
      ok: false,
      reason: `That track is ${mb(candidate.size)}. The limit is ${mb(MAX_TRACK_BYTES)} per track.`,
    }
  }

  // ONLY when the OS gave a type. An empty `file.type` is not a claim that the
  // file is unacceptable — it is the absence of a claim, and the server
  // resolves it by sniffing the stored blob. Refusing here would reject files
  // that would have been accepted, which is a regression wearing a validation's
  // clothes. See the Content-Type comment in `postFileWithProgress`.
  if (candidate.type !== "" && !isAcceptedAudioContentType(candidate.type)) {
    return { ok: false, reason: `Chroneli plays ${acceptedFormatList()}.` }
  }

  const free = MAX_LIBRARY_BYTES - against.libraryBytes
  if (candidate.size > free) {
    return {
      ok: false,
      reason: `Your library has ${mb(Math.max(0, free))} free; this track needs ${mb(candidate.size)}.`,
    }
  }

  if (against.trackCount + 1 > MAX_TRACK_COUNT) {
    return {
      ok: false,
      reason: `Your library holds ${MAX_TRACK_COUNT} tracks. Remove one to make room.`,
    }
  }

  return OK
}

/** The library as it will be once `candidate` has landed. Threaded through a
 *  batch so each file is checked against what the earlier ones consumed. */
export function advance(
  state: LibraryState,
  candidate: Candidate
): LibraryState {
  return {
    libraryBytes: state.libraryBytes + candidate.size,
    trackCount: state.trackCount + 1,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/music/upload-queue.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/lib/music/upload-queue.ts src/lib/music/upload-queue.test.ts && npx prettier --write src/lib/music/upload-queue.ts src/lib/music/upload-queue.test.ts
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/music/upload-queue.ts src/lib/music/upload-queue.test.ts
git commit -m "feat(music): the caps become answerable before a byte is sent"
```

---

### Task 2: Byte progress, by replacing fetch with XHR

**Files:**

- Create: `src/lib/music/post-file.ts`
- Modify: `src/routes/_authed/-music.tsx` (`uploadOne`)
- Modify: `src/routes/_authed/-music.test.tsx` (the two tests that stub `fetch`)

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `postFileWithProgress(url: string, file: File, onProgress: (sent: number, total: number) => void): Promise<string>` — resolves the `storageId`.

This task is a **behaviour-preserving swap**. The only externally visible change is that `onProgress` now fires. Two existing tests stub `fetch` and must become XHR stubs; that is expected, not a regression.

- [ ] **Step 1: Write the failing test**

In `src/routes/_authed/-music.test.tsx`, add this helper directly beneath the `TRACKS` fixture:

```tsx
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
  abort() {}

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
```

Now **replace** the existing test `"uploads a file and hands the returned storage id to addTrack"` with:

```tsx
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
```

And **replace** the test `"surfaces a rejected upload without rewriting the reason"` with:

```tsx
it("surfaces a failed POST without rewriting the reason", async () => {
  useFakeXhr()
  renderMusic()

  fireEvent.change(screen.getByLabelText("Music files"), {
    target: {
      files: [new File([new Uint8Array([1])], "x.mp3", { type: "audio/mpeg" })],
    },
  })

  await waitFor(() => expect(FakeXhr.last).not.toBeNull())
  FakeXhr.last!.status = 503
  FakeXhr.last!.finish()

  expect(
    await screen.findAllByText(/That didn't save\. Try again\./)
  ).not.toHaveLength(0)
  expect(addTrack).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/_authed/-music.test.tsx
```

Expected: FAIL — `FakeXhr.last` stays `null`, because `uploadOne` still calls `fetch`.

- [ ] **Step 3: Write the XHR wrapper**

Create `src/lib/music/post-file.ts`:

```ts
/*
 * The upload POST, with a progress event.
 *
 * WHY NOT `fetch`. `fetch` resolves when the request body has finished going
 * out; it exposes nothing while it is going. A 20 MiB track on a slow
 * connection is therefore a completely silent minute, which is what the page
 * did before this file existed. `XMLHttpRequest.upload` emits `progress`, and
 * that single capability is the whole reason for the older API here.
 *
 * Everything else is carried over unchanged from the `fetch` this replaces,
 * including the two decisions that are easy to get wrong — see below.
 */

/** Thrown when the POST itself failed. The page maps this through
 *  `errorMessage`, which supplies the generic "That didn't save." line —
 *  the same sentence the `fetch` version produced. */
export class UploadFailed extends Error {}

export function postFileWithProgress(
  url: string,
  file: File,
  onProgress: (sent: number, total: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("POST", url)

    // OMITTED ENTIRELY when the OS gave the file no type, never sent empty. An
    // empty `Content-Type` is a header CLAIMING a type of "", which Convex then
    // records as the blob's type and `isAcceptedAudioContentType` rejects. With
    // no header at all, `addTrackAction` falls through to the blob's own
    // sniffed type, which is the answer that can be right.
    if (file.type !== "") xhr.setRequestHeader("Content-Type", file.type)

    xhr.upload.onprogress = (event: ProgressEvent) => {
      // `lengthComputable` is false for a request whose length the browser will
      // not commit to. Reporting `event.total` then would draw a bar against a
      // denominator of zero; `file.size` is the number we already know.
      onProgress(event.loaded, event.lengthComputable ? event.total : file.size)
    }

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new UploadFailed(`upload failed with ${xhr.status}`))
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        reject(new UploadFailed("upload returned no id"))
        return
      }
      // Narrowed before `storageId` is read, so a changed response shape fails
      // loudly here rather than sending `undefined` on to the action.
      const storageId =
        typeof payload === "object" &&
        payload !== null &&
        "storageId" in payload &&
        typeof (payload as { storageId: unknown }).storageId === "string"
          ? (payload as { storageId: string }).storageId
          : null
      if (storageId === null) {
        reject(new UploadFailed("upload returned no id"))
        return
      }
      resolve(storageId)
    }

    xhr.onerror = () => reject(new UploadFailed("upload failed"))
    xhr.onabort = () => reject(new UploadFailed("upload cancelled"))

    xhr.send(file)
  })
}
```

- [ ] **Step 4: Use it in `uploadOne`**

In `src/routes/_authed/-music.tsx`, add the import beside the other `@/lib` imports:

```tsx
import { postFileWithProgress } from "@/lib/music/post-file"
```

Then replace the whole block in `uploadOne` from `const response = await fetch(uploadUrl, {` through `if (storageId === null) throw new Error("upload returned no id")` with:

```tsx
const storageId = await postFileWithProgress(uploadUrl, file, () => {})
```

The `onProgress` callback is a no-op **in this task only** — Task 3 is what gives it somewhere to report to. Leave the comment above `generateUploadUrl` and the rest of `uploadOne` untouched.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/routes/_authed/-music.test.tsx
```

Expected: PASS, all tests in the file including the three above.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/lib/music/post-file.ts src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx && npx prettier --write src/lib/music/post-file.ts src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/music/post-file.ts src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
git commit -m "refactor(music): the upload POST can report its progress"
```

---

### Task 3: The queue panel

**Files:**

- Create: `src/components/music/upload-queue-panel.tsx`
- Modify: `src/routes/_authed/-music.tsx`
- Modify: `src/routes/_authed/-music.test.tsx`

**Interfaces:**

- Consumes: `postFileWithProgress` (Task 2).
- Produces:
  - `type UploadStatus = "queued" | "uploading" | "saving" | "done" | "failed"`
  - `type QueuedUpload = { id: string; file: File; name: string; bytes: number; sent: number; status: UploadStatus; reason?: string }`
  - `UploadQueuePanel({ items, onRetry, onDismiss }: { items: Array<QueuedUpload>; onRetry: (id: string) => void; onDismiss: () => void })`

`QueuedUpload` is exported from `upload-queue-panel.tsx` and imported by the page.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/_authed/-music.test.tsx`, inside the `describe("the library")` block:

```tsx
it("shows a row with live bytes while a file uploads", async () => {
  useFakeXhr()
  renderMusic()

  fireEvent.change(screen.getByLabelText("Music files"), {
    target: {
      files: [
        new File([new Uint8Array(10)], "Long Track.mp3", {
          type: "audio/mpeg",
        }),
      ],
    },
  })

  // The row names the file, which is the thing the old anonymous toast
  // could not do.
  expect(await screen.findByText("Long Track.mp3")).toBeTruthy()

  await waitFor(() => expect(FakeXhr.last).not.toBeNull())
  FakeXhr.last!.emitProgress(5 * 1024 * 1024, 10 * 1024 * 1024)

  expect(await screen.findByText(/5 MB of 10 MB/)).toBeTruthy()
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/_authed/-music.test.tsx -t "live bytes"
```

Expected: FAIL — `Unable to find an element with the text: Long Track.mp3`.

- [ ] **Step 3: Write the panel component**

Create `src/components/music/upload-queue-panel.tsx`:

```tsx
import { Check, RotateCw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/*
 * What an upload looks like while it is happening.
 *
 * This panel exists because the page's only report was `report(thrown)` — a
 * toast carrying the backend's sentence and nothing else. The backend's
 * sentences are written about tracks in general ("A track needs a name."),
 * never about THIS file, so a folder drop with three bad files produced three
 * identical eight-second toasts and no way to tell which three. A row that
 * persists, names its file, and offers a retry is the fix; a nicer toast is not.
 *
 * Presentational only. The page owns the queue and every transition in it.
 */

export type UploadStatus = "queued" | "uploading" | "saving" | "done" | "failed"

export type QueuedUpload = {
  id: string
  /** Retained so Retry can re-send without asking for the file again. */
  file: File
  name: string
  bytes: number
  sent: number
  status: UploadStatus
  reason?: string
}

/** Megabytes as `formatMb` writes them, kept identical so the queue row and
 *  the meter beneath it never disagree by a decimal. */
function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/**
 * The one sentence a screen reader hears.
 *
 * ONLY this line is a live region. A row per file would announce thirty times
 * for a folder drop, at a rate no one can follow; the count carries the same
 * information at a rate a person can.
 */
function summarise(items: Array<QueuedUpload>): string {
  const done = items.filter((item) => item.status === "done").length
  const failed = items.filter((item) => item.status === "failed").length
  const running = items.filter(
    (item) => item.status === "uploading" || item.status === "saving"
  ).length

  if (running > 0) return `Uploading ${done + 1} of ${items.length}`
  if (failed > 0) return `${done} added · ${failed} failed`
  return `${done} added`
}

export function UploadQueuePanel({
  items,
  onRetry,
  onDismiss,
}: {
  items: Array<QueuedUpload>
  onRetry: (id: string) => void
  onDismiss: () => void
}) {
  if (items.length === 0) return null

  const settled = items.every(
    (item) => item.status === "done" || item.status === "failed"
  )

  return (
    <section
      aria-label="Uploads"
      className="flex flex-col rounded-md border border-edge-soft"
    >
      <header className="flex items-center justify-between gap-3 border-b border-edge-soft px-3 py-2">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {summarise(items)}
        </p>
        {settled ? (
          <Button type="button" variant="quiet" size="xs" onClick={onDismiss}>
            Dismiss
          </Button>
        ) : null}
      </header>

      <ul className="flex flex-col">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 border-b border-edge-soft px-3 py-2 last:border-b-0"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                {item.status === "done" ? (
                  <Check className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                {item.status === "failed" ? (
                  <TriangleAlert className="size-3.5 shrink-0 text-alarm" />
                ) : null}
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    item.status === "queued" && "text-muted-foreground"
                  )}
                >
                  {item.name}
                </span>
              </div>

              {item.status === "uploading" ? (
                <div
                  aria-hidden="true"
                  className="h-1 overflow-hidden rounded-full bg-surface-raised"
                >
                  <div
                    className="h-full rounded-full bg-ink-muted transition-[width]"
                    style={{
                      width: `${((item.sent / Math.max(1, item.bytes)) * 100).toFixed(1)}%`,
                    }}
                  />
                </div>
              ) : null}

              {item.status === "failed" ? (
                <p className="text-xs text-alarm">{item.reason}</p>
              ) : null}
            </div>

            <span className="shrink-0 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
              {item.status === "uploading"
                ? `${mb(item.sent)} of ${mb(item.bytes)}`
                : item.status === "saving"
                  ? "Saving…"
                  : mb(item.bytes)}
            </span>

            {item.status === "failed" ? (
              <Button
                type="button"
                variant="quiet"
                size="icon-row"
                aria-label={`Retry ${item.name}`}
                onClick={() => onRetry(item.id)}
              >
                <RotateCw className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Wire the queue into the page**

In `src/routes/_authed/-music.tsx`:

Add imports:

```tsx
import {
  UploadQueuePanel,
  type QueuedUpload,
} from "@/components/music/upload-queue-panel"
```

Add state beside the existing `useState` calls:

```tsx
const [queue, setQueue] = useState<Array<QueuedUpload>>([])
```

Add this helper above `uploadOne`:

```tsx
/** One entry's fields, changed in place. Every transition below goes through
 *  here so the queue is only ever replaced, never mutated. */
const patch = (id: string, fields: Partial<QueuedUpload>) => {
  setQueue((current) =>
    current.map((item) => (item.id === id ? { ...item, ...fields } : item))
  )
}
```

Change `uploadOne` to take the queue id and report through it:

```tsx
const uploadOne = async (file: File, id: string) => {
  const durationMs = await decodeDurationMs(file)

  patch(id, { status: "uploading", sent: 0 })
  const uploadUrl = await generateUploadUrl({})
  const storageId = await postFileWithProgress(uploadUrl, file, (sent) => {
    patch(id, { sent })
  })

  // A DISTINCT STATE, not a bar rounded up to 100%. The bytes have all
  // landed and `addTrackAction` can still refuse the blob on its sniffed
  // type — a full bar during a step that can fail is a bar telling a lie.
  patch(id, { status: "saving", sent: file.size })

  await addTrack({
    storageId: storageId as Id<"_storage">,
    clientKey: newClientKey(),
    name: trackNameFromFilename(file.name),
    ...(durationMs === undefined ? {} : { durationMs }),
  })

  patch(id, { status: "done" })
}
```

Replace the body of `upload` with:

```tsx
const upload = async (files: Array<File>) => {
  if (files.length === 0) return

  const entries: Array<QueuedUpload> = files.map((file) => ({
    id: newClientKey(),
    file,
    name: file.name,
    bytes: file.size,
    sent: 0,
    status: "queued",
  }))
  setQueue((current) => [...current, ...entries])

  setBusy(true)
  try {
    // SEQUENTIAL, unchanged. The cap inside `acceptTrack` is checked against
    // the rows that exist at that moment, so parallel uploads of a nearly
    // full library each see the same pre-upload total and several pass a
    // check only one should. A refusal does not stop the run: one bad file
    // in a folder drop costs that file, not the nine behind it.
    for (const entry of entries) {
      try {
        await uploadOne(entry.file, entry.id)
      } catch (thrown) {
        patch(entry.id, { status: "failed", reason: errorMessage(thrown) })
      }
    }
  } finally {
    setBusy(false)
  }
}
```

Add the retry and dismiss handlers beneath `upload`:

```tsx
/** Re-runs one failed entry. The `File` is still held by the queue, so this
 *  costs the user nothing — which is the whole reason a failure stays on
 *  screen instead of timing out like the toast it replaced. */
const retry = (id: string) => {
  const entry = queue.find((item) => item.id === id)
  if (entry === undefined || busy) return
  patch(id, { status: "queued", sent: 0, reason: undefined })
  setBusy(true)
  void (async () => {
    try {
      await uploadOne(entry.file, id)
    } catch (thrown) {
      patch(id, { status: "failed", reason: errorMessage(thrown) })
    } finally {
      setBusy(false)
    }
  })()
}

const dismissFinished = () => {
  setQueue((current) =>
    current.filter((item) => item.status !== "done" && item.status !== "failed")
  )
}
```

Add this effect beneath the handlers, so successes clear themselves:

```tsx
/* A finished row is information for about as long as it takes to read it.
 * Failures are NOT swept — they are the reason this panel exists. */
useEffect(() => {
  if (!queue.some((item) => item.status === "done")) return
  const timer = setTimeout(() => {
    setQueue((current) => current.filter((item) => item.status !== "done"))
  }, 2_000)
  return () => clearTimeout(timer)
}, [queue])
```

Update the React import to `import { useEffect, useState } from "react"`.

Render the panel as the first child inside the page's content div, immediately above `<Usage …>`:

```tsx
<UploadQueuePanel items={queue} onRetry={retry} onDismiss={dismissFinished} />
```

Finally, delete the now-unused `report` function **only if** nothing else references it — `onRename` and `onRemove` still do, so **keep it**.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/routes/_authed/-music.test.tsx
```

Expected: PASS. The previously-replaced test `"surfaces a failed POST without rewriting the reason"` now finds its text in the queue row rather than a toast — if it fails on the count of matched nodes, assert with `findAllByText(...)` and `not.toHaveLength(0)` as written in Task 2.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/components/music/upload-queue-panel.tsx src/routes/_authed/-music.tsx && npx prettier --write src/components/music/upload-queue-panel.tsx src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/music/upload-queue-panel.tsx src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
git commit -m "feat(music): an upload says which file, how far, and why not"
```

---

### Task 4: Refuse the impossible before sending it

**Files:**

- Modify: `src/routes/_authed/-music.tsx`
- Modify: `src/routes/_authed/-music.test.tsx`

**Interfaces:**

- Consumes: `precheck`, `advance`, `type LibraryState` (Task 1); `QueuedUpload` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/_authed/-music.test.tsx`:

```tsx
/*
 * The file never leaves the browser. Before this, a 300 MB file was uploaded
 * IN FULL, stored by Convex, read by `addTrackAction`, refused, and deleted
 * — with the user watching the whole transfer for an answer that `file.size`
 * already contained.
 */
it("refuses an oversized file without sending it", async () => {
  useFakeXhr()
  renderMusic()

  const huge = new File([new Uint8Array(1)], "Huge.wav", { type: "audio/wav" })
  Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 })

  fireEvent.change(screen.getByLabelText("Music files"), {
    target: { files: [huge] },
  })

  expect(await screen.findByText(/The limit is 20 MB per track/)).toBeTruthy()
  expect(FakeXhr.last).toBeNull()
  expect(generateUploadUrl).not.toHaveBeenCalled()
})

/* One bad file costs that file, not the good one behind it. */
it("uploads the good file in a batch whose first file is refused", async () => {
  useFakeXhr()
  renderMusic()

  const huge = new File([new Uint8Array(1)], "Huge.wav", { type: "audio/wav" })
  Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 })
  const good = new File([new Uint8Array(1)], "Fine.mp3", { type: "audio/mpeg" })

  fireEvent.change(screen.getByLabelText("Music files"), {
    target: { files: [huge, good] },
  })

  await waitFor(() => expect(FakeXhr.last).not.toBeNull())
  FakeXhr.last!.finish()
  await waitFor(() => expect(addTrack).toHaveBeenCalledTimes(1))
  expect(addTrack.mock.calls[0][0].name).toBe("Fine")
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/_authed/-music.test.tsx -t "without sending it"
```

Expected: FAIL — `generateUploadUrl` was called; no such text on screen.

- [ ] **Step 3: Wire the precheck in**

In `src/routes/_authed/-music.tsx`, add the import:

```tsx
import { advance, precheck, type LibraryState } from "@/lib/music/upload-queue"
```

Inside `upload`, replace the `for` loop with this version, which threads the library state through the batch:

```tsx
// The library as this batch will leave it, advanced per success — so the
// fifth file into a library with room for four is refused HERE, rather
// than uploaded in full and refused by the server one file at a time.
let state: LibraryState = {
  libraryBytes: usage.bytes,
  trackCount: usage.count,
}

for (const entry of entries) {
  const verdict = precheck(
    { name: entry.name, size: entry.bytes, type: entry.file.type },
    state
  )
  if (!verdict.ok) {
    patch(entry.id, { status: "failed", reason: verdict.reason })
    continue
  }
  try {
    await uploadOne(entry.file, entry.id)
    state = advance(state, {
      name: entry.name,
      size: entry.bytes,
      type: entry.file.type,
    })
  } catch (thrown) {
    patch(entry.id, { status: "failed", reason: errorMessage(thrown) })
  }
}
```

Apply the same check at the top of `retry`, so a retry of a file that no longer fits fails locally:

```tsx
const retry = (id: string) => {
  const entry = queue.find((item) => item.id === id)
  if (entry === undefined || busy) return

  const verdict = precheck(
    { name: entry.name, size: entry.bytes, type: entry.file.type },
    { libraryBytes: usage.bytes, trackCount: usage.count }
  )
  if (!verdict.ok) {
    patch(id, { status: "failed", reason: verdict.reason })
    return
  }

  patch(id, { status: "queued", sent: 0, reason: undefined })
  setBusy(true)
  void (async () => {
    try {
      await uploadOne(entry.file, id)
    } catch (thrown) {
      patch(id, { status: "failed", reason: errorMessage(thrown) })
    } finally {
      setBusy(false)
    }
  })()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/routes/_authed/-music.test.tsx
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/routes/_authed/-music.tsx && npx prettier --write src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
git commit -m "feat(music): a file that cannot be accepted is never uploaded"
```

---

### Task 5: The limits, said out loud

**Files:**

- Create: `src/components/music/library-usage.tsx`
- Modify: `src/routes/_authed/-music.tsx` (delete the local `Usage`, import the new one)
- Modify: `src/routes/_authed/-music.test.tsx`

**Interfaces:**

- Consumes: `acceptedFormatList` (Task 1).
- Produces: `LibraryUsage({ bytes, count }: { bytes: number; count: number })`.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/_authed/-music.test.tsx`:

```tsx
/* `usage.count` has been computed, validated and sent on every page load
 * since the feature shipped, and rendered nowhere. */
it("reports the track count against its own cap", () => {
  renderMusic()
  expect(screen.getByText(/2 of 500 tracks/i)).toBeTruthy()
})

it("says how much room is left", () => {
  renderMusic()
  expect(screen.getByText(/497.1 MB free/i)).toBeTruthy()
})

/* Colour is never the only signal — DESIGN.md — and the signal colours are
 * reserved by meaning, so a nearly-full library changes only the SENTENCE. */
it("leads with what is left when the library is nearly full", () => {
  renderMusic(TRACKS, { bytes: 495 * 1024 * 1024, count: 2 })
  expect(screen.getByText(/nearly full/i)).toBeTruthy()
})

/* Full is the one state that IS an error — the next upload will be refused
 * — so it is the one that earns `alarm`. */
it("says the library is full at the cap", () => {
  renderMusic(TRACKS, { bytes: 500 * 1024 * 1024, count: 2 })
  expect(screen.getByText(/library full/i)).toBeTruthy()
})

it("states the accepted formats and the per-track cap up front", () => {
  renderMusic()
  expect(screen.getByText(/MP3, M4A, WAV, OGG or FLAC/i)).toBeTruthy()
  expect(screen.getByText(/up to 20 MB each/i)).toBeTruthy()
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/_authed/-music.test.tsx -t "track count against"
```

Expected: FAIL — no matching text.

- [ ] **Step 3: Write the component**

Create `src/components/music/library-usage.tsx`:

```tsx
import { MAX_LIBRARY_BYTES, MAX_TRACK_COUNT } from "@shared/audio"
import { cn } from "@/lib/utils"

/*
 * The storage meter, and the page's honest header.
 *
 * EVERY CEILING IS A CONSTANT, never a literal. The number in each sentence
 * and the number `acceptTrack` refuses an upload against are the same import,
 * so they cannot drift into telling the user two different things.
 *
 * `count` is drawn here for the first time. `usageImpl` has computed it,
 * `usageReturns` has validated it, and the query has sent it on every page
 * load since the feature shipped — while the page rendered only `bytes`, so
 * the 500-track cap was enforced and never mentioned.
 *
 * The bar is `aria-hidden` and the sentences carry the values: they are
 * already the exact figures in the units a person thinks in, and a
 * `progressbar` role would announce the same number again as a bare percent.
 *
 * NO BRASS HERE, and this is not a stylistic preference. styles.css reserves
 * all three signals by meaning — enlarger is RUNNING and nothing else, brass
 * is MONEY, safelight is "act here" — to the point that the project palette
 * deliberately skips hues ~230 and ~85 so a project tint can never be misread
 * as a state. A storage meter is none of those three things, so a brass bar
 * would spend a reserved signal on an unrelated meaning.
 *
 * Which leaves a two-step: "nearly full" is INFORMATION and is carried by the
 * sentence alone, at the ordinary muted weight. "Full" is an ERROR — the next
 * upload really will be refused by `acceptTrack` — and takes `alarm`, which is
 * the system's colour for exactly that. Both change their wording, so the
 * colour is the redundant half of the signal in the one case that has any.
 */

const NEARLY_FULL = 0.9

function formatMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

export function LibraryUsage({
  bytes,
  count,
}: {
  bytes: number
  count: number
}) {
  const fraction = Math.min(1, bytes / MAX_LIBRARY_BYTES)
  const free = Math.max(0, MAX_LIBRARY_BYTES - bytes)
  const nearlyFull = fraction >= NEARLY_FULL
  // FULL is an error state and coloured like one: the next upload will be
  // refused by `acceptTrack`. "Nearly full" is not — it is information, and it
  // is carried by the sentence alone. See the colour note in this file's
  // docblock for why neither state may use brass.
  const full = free === 0

  return (
    <div className="flex max-w-prose flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {`${formatMb(bytes)} of ${formatMb(MAX_LIBRARY_BYTES)} used · ${count} of ${MAX_TRACK_COUNT} tracks`}
      </p>

      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            // Paired with the sentence below, never alone. DESIGN.md: meaning
            // is never carried by colour.
            full ? "bg-alarm" : "bg-ink-muted"
          )}
          style={{ width: `${(fraction * 100).toFixed(1)}%` }}
        />
      </div>

      <p
        className={cn("text-xs", full ? "text-alarm" : "text-muted-foreground")}
      >
        {full
          ? "Library full. Remove a track to make room."
          : nearlyFull
            ? `Nearly full — ${formatMb(free)} free. Remove a track to make room.`
            : `${formatMb(free)} free`}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Swap it into the page**

In `src/routes/_authed/-music.tsx`:

1. Delete the entire local `Usage` function and its docblock.
2. Add the import:

```tsx
import { LibraryUsage } from "@/components/music/library-usage"
import { acceptedFormatList } from "@/lib/music/upload-queue"
```

3. Replace `<Usage bytes={usage.bytes} />` with:

```tsx
<LibraryUsage bytes={usage.bytes} count={usage.count} />
```

4. Add the format-and-size line inside the header `actions` label, directly beneath the `<input>`:

```tsx
<span className="mt-1 block text-xs text-muted-foreground">
  {`${acceptedFormatList()} · up to ${formatMb(MAX_TRACK_BYTES)} each`}
</span>
```

5. Add `MAX_TRACK_BYTES` to the existing `@shared/audio` import.
6. Update the `Empty` copy for an unfilled library to name the same limits:

```tsx
<Empty>
  No music uploaded yet. Add {acceptedFormatList()} files up to{" "}
  {formatMb(MAX_TRACK_BYTES)} each, and they become selectable from the
  tracker&apos;s music control, beside the tracks that ship with Chroneli.
</Empty>
```

Keep `formatMb` in `-music.tsx` — `TrackRow` still uses it.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/routes/_authed/-music.test.tsx
```

Expected: PASS. The pre-existing test `"reports usage against the cap"` (asserting `/of 500 MB/i`) must still pass unchanged — if it does not, the sentence was rewritten too aggressively.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/components/music/library-usage.tsx src/routes/_authed/-music.tsx && npx prettier --write src/components/music/library-usage.tsx src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/music/library-usage.tsx src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
git commit -m "feat(music): the page states every cap it will refuse you for"
```

---

### Task 6: The list and its controls

**Files:**

- Modify: `src/routes/_authed/-music.tsx`
- Modify: `src/routes/_authed/-music.test.tsx`

**Interfaces:**

- Consumes: everything above.
- Produces: `type SortKey = "name" | "recent" | "largest" | "longest"` (widened in place).

- [ ] **Step 1: Write the failing test**

Add to `src/routes/_authed/-music.test.tsx`:

```tsx
it("sorts by largest", () => {
  renderMusic()
  fireEvent.change(screen.getByRole("combobox", { name: /sort/i }), {
    target: { value: "largest" },
  })
  // Alpha is 2 MB, Beta is 1 MB.
  expect(screen.getAllByRole("listitem")[0].textContent).toContain("Alpha")
})

/* `durationMs` is optional. A track without one is not a zero-length track,
 * so it sorts last rather than first. */
it("puts tracks with no known duration last under longest", () => {
  renderMusic([
    { _id: "t1", name: "NoDuration", bytes: 1, _creationTime: 1, url: "u" },
    {
      _id: "t2",
      name: "HasDuration",
      bytes: 1,
      durationMs: 60_000,
      _creationTime: 2,
      url: "u",
    },
  ])
  fireEvent.change(screen.getByRole("combobox", { name: /sort/i }), {
    target: { value: "longest" },
  })
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/_authed/-music.test.tsx -t "sorts by largest"
```

Expected: FAIL — the list does not reorder, because `"largest"` falls through to the `recent` branch.

- [ ] **Step 3: Widen the sort**

In `src/routes/_authed/-music.tsx`, change the type and the comparator:

```tsx
type SortKey = "name" | "recent" | "largest" | "longest"
```

Replace the `filtered.sort(...)` call inside `orderTracks` with:

```tsx
filtered.sort((a, b) => {
  if (sort === "name") return a.name.localeCompare(b.name)
  if (sort === "recent") return b._creationTime - a._creationTime
  if (sort === "largest") return b.bytes - a.bytes
  // `durationMs` is OPTIONAL — a track the browser could not decode has no
  // length, which is not the same as a length of zero. `-1` sorts those
  // after every known duration rather than ahead of all of them, which is
  // where a `?? 0` would have put them.
  const left = a.durationMs ?? -1
  const right = b.durationMs ?? -1
  return right - left
})
```

Update the `orderTracks` docblock's closing paragraph to mention that `largest` reads `bytes` (always present) and `longest` reads the optional `durationMs`.

Add the two options to the `<select>`:

```tsx
            <option value="name">Name</option>
            <option value="recent">Recently added</option>
            <option value="largest">Largest</option>
            <option value="longest">Longest</option>
```

- [ ] **Step 4: Polish the controls**

Still in `src/routes/_authed/-music.tsx`:

1. Add `import { Input } from "@/components/ui/input"` and `import { Upload } from "lucide-react"` (extend the existing `lucide-react` import).

2. Replace the header `actions` file input with a button-styled label. The `<input>` keeps its `aria-label="Music files"` — every existing test finds it by that name.

```tsx
<div className="flex flex-col items-end gap-1">
  <label
    className={cn(
      buttonVariants({ variant: "outline", size: "sm" }),
      "cursor-pointer",
      busy && "pointer-events-none opacity-50"
    )}
  >
    <Upload className="size-4" />
    Add music
    <input
      type="file"
      accept={AUDIO_INPUT_ACCEPT}
      multiple
      disabled={busy}
      aria-label="Music files"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        // Cleared so choosing the SAME file again still fires `change`
        // — which is what a person does after a rejection they have
        // since fixed, and the one case a file input swallows silently.
        event.target.value = ""
        void upload(files)
      }}
      className="sr-only"
    />
  </label>
  <span className="text-xs text-muted-foreground">
    {`${acceptedFormatList()} · up to ${formatMb(MAX_TRACK_BYTES)} each`}
  </span>
</div>
```

Add `buttonVariants` to the existing `@/components/ui/button` import.

3. Replace the hand-rolled `<input type="search">` classes with the `Input` component:

```tsx
<Input
  type="search"
  value={search}
  aria-label="Search music"
  placeholder="Search"
  onChange={(event) => setSearch(event.target.value)}
  className="h-8 w-48 text-sm"
/>
```

4. Add the match count beside the sort control, rendered only while searching:

```tsx
{
  search.trim() === "" ? null : (
    <span className="text-xs text-muted-foreground">
      {`${visible.length} of ${tracks.length}`}
    </span>
  )
}
```

5. Strengthen the drag feedback. Replace the drop wrapper's `className` with:

```tsx
          className={cn(
            "relative rounded-md transition-colors",
            dragging && "ring-2 ring-ring"
          )}
```

and add this as the wrapper's first child:

```tsx
{
  dragging ? (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-ground/80 text-sm text-foreground">
      Drop to add
    </div>
  ) : null
}
```

The drop target remains **the list itself** — the existing comment argues against a permanent dashed band, and only the feedback during the drag changes here.

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: PASS across all three projects. Every pre-existing music test must still pass — nothing in this task changes what the server accepts.

- [ ] **Step 6: Typecheck, lint, format**

```bash
npx tsc --noEmit && npx eslint src/routes/_authed/-music.tsx && npx prettier --write src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
```

Expected: no errors.

- [ ] **Step 7: Verify in the browser**

Start the dev server on **port 3100** (the project's fixed port — `SITE_URL` and the Google redirect URI are registered against it):

```bash
npm run dev
```

Open `/music` and confirm: the **Add music** button and its format line; the meter reading bytes, count and free space; a multi-file selection producing queue rows with moving bars; an oversized file refused instantly with a named row and a Retry; and the "Drop to add" overlay during a drag.

- [ ] **Step 8: Commit**

```bash
git add src/routes/_authed/-music.tsx src/routes/_authed/-music.test.tsx
git commit -m "feat(music): the library list gains sorts, a match count and a real drop state"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                                                         | Task                |
| ---------------------------------------------------------------------------------------------------- | ------------------- |
| §1 `precheck`, four caps, empty-type fall-through, batch-cumulative                                  | Task 1, Task 4      |
| §2 `postFileWithProgress`, Content-Type omission, sequential                                         | Task 2              |
| §3 Queue panel, five states, one live region, persistent failures, Retry, Dismiss, 2s self-dismiss   | Task 3              |
| §4 Count, free space, brass past 90% with paired sentence, format line, empty state                  | Task 5              |
| §5 Add music button, `Input`, Largest/Longest, drop overlay, match count, list stays the drop target | Task 6              |
| Testing: `upload-queue.test.ts`                                                                      | Task 1              |
| Testing: page coverage for queue, failures, meter, formats                                           | Tasks 3–6           |
| Out of scope: no preview, no permanent drop zone, no `convex/` change                                | Honoured throughout |

**Type consistency:** `QueuedUpload` is defined once in `upload-queue-panel.tsx` (Task 3) and imported by the page. `Candidate`/`LibraryState`/`PrecheckResult` are defined once in `upload-queue.ts` (Task 1); Task 4 constructs `Candidate` from `QueuedUpload` fields plus `entry.file.type` at both call sites. `formatMb` intentionally exists in three files with identical arithmetic — noted in each docblock — because extracting it would put a two-line formatter in a shared module for the sake of DRY while coupling three components that have no other relationship.

**Known ordering note:** Task 3's tests assert queue-row text that Task 2's replaced test also matches. Task 2 is therefore written to assert with `findAllByText(...)` / `not.toHaveLength(0)` rather than an exact node count, so it survives Task 3 adding a second rendering of the same sentence.
