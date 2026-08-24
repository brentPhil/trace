# The music page tells you what is happening and what it will refuse

**Date:** 2026-08-24
**Status:** designed; not implemented
**Scope:** The `/music` page only — its upload path, its limit readouts, and
its list. Preview playback is deliberately out; see _Out of scope_ below.

`/music` works. Files go up, tracks come back, renames and removals hold. What
it does not do is **say anything while it works, or before it refuses**. This
design is about those two silences.

---

## The two silences

### 1. A ten-file drop shows nothing

`upload()` sets `busy`, loops the files, and clears `busy`. `busy` is wired to
exactly one thing: `disabled` on the file input. So for however long thirty
tracks take, the page is indistinguishable from a page that ignored the drop —
no count, no bytes, no per-file state, no indication that the eleventh file is
still to come.

`fetch()` could not have fixed this even if someone had tried. It resolves when
the POST **completes**; it reports nothing along the way. Byte-level progress
requires `XMLHttpRequest`, whose `upload` object emits `progress` events. That
is the single technical reason this design touches the network call at all.

### 2. Three of the four limits are secrets

The backend enforces four caps. The page mentions one.

| Cap                            | Value   | Stated on the page today      |
| ------------------------------ | ------- | ----------------------------- |
| `MAX_LIBRARY_BYTES`            | 500 MB  | Yes — the meter               |
| `MAX_TRACK_BYTES`              | 20 MiB  | **No**                        |
| `MAX_TRACK_COUNT`              | 500     | **No**                        |
| `ACCEPTED_AUDIO_CONTENT_TYPES` | 5 types | Only as the picker's `accept` |

`MAX_TRACK_BYTES` and `MAX_TRACK_COUNT` appear in **no frontend file at all**.
`usage.count` is computed by `usageImpl`, validated by `usageReturns`, sent over
the wire on every page load — and never rendered.

The cost is not merely that the user is uninformed. Because nothing is checked
before the POST, a 300 MB file is **uploaded in full**, stored by Convex, read
by `addTrackAction`, refused, and deleted. The user waits out a complete upload
of a file that could never have been accepted, and gets a toast at the end of it.

---

## A third problem, found while reading: the toast cannot name the file

```js
const report = (thrown: unknown) => {
  toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
}
```

`upload()` catches per file, deliberately, so one bad file costs that file and
not the nine behind it. Good. But `report` receives only the thrown error, and
the backend's sentences are written about _tracks in general_, not about _this
file_: "A track needs a name.", "Your music library is full."

So a folder drop with three unsupported files produces **three identical
toasts**, each timing out after eight seconds, none of which says which file
failed. The information the user needs — _which_ one — is the one thing not in
the message. This is what motivates a persistent queue rather than better toasts.

---

## Design

### 1. `src/lib/music/upload-queue.ts` — the rules, as pure functions

The precheck lives in its own module so the caps can be tested without a DOM,
an upload, or a Convex client.

```ts
type PrecheckResult = { ok: true } | { ok: false; reason: string }

function precheck(
  file: File,
  against: { libraryBytes: number; trackCount: number }
): PrecheckResult
```

Checked in this order, each returning a sentence written about _this file_:

1. `file.size > MAX_TRACK_BYTES` →
   _"That track is 34.2 MB. The limit is 20 MB per track."_
2. `file.type !== "" && !isAcceptedAudioContentType(file.type)` →
   _"Chroneli plays MP3, M4A, WAV, OGG and FLAC."_
3. `libraryBytes + file.size > MAX_LIBRARY_BYTES` →
   _"Your library has 12 MB free; this track needs 18 MB."_
4. `trackCount + 1 > MAX_TRACK_COUNT` →
   _"Your library holds 500 tracks. Remove one to make room."_

**The type check fires only when the OS gave a type**, and this is the load-
bearing part. `addTrackAction` falls through to the blob's own sniffed type when
the client sends no `Content-Type` — the current code omits the header for
exactly this case and explains why at length. A client-side rejection on an
empty `file.type` would refuse files **the server would have accepted**, which
is a regression dressed as a validation. Empty type means upload it and let the
server sniff.

**The projections are batch-cumulative.** `against` is threaded through the loop
and advanced by each success, so a drop of thirty files checks each one against
what the previous twenty-nine already consumed. Checking every file against the
server's pre-drop total would pass files thirty deep into a library that filled
up at file four — which is precisely the race `acceptTrack`'s server-side check
exists to catch, and there is no reason to make it catch it.

`precheck` is advisory, never authoritative. `acceptTrack` remains the only
thing that decides. This is a fast local "no" for the cases that are certain,
not a second copy of the rule.

### 2. `postFileWithProgress` — the XHR wrapper

Replaces the `fetch` inside `uploadOne`:

```ts
function postFileWithProgress(
  url: string,
  file: File,
  onProgress: (sent: number, total: number) => void
): Promise<string> // the storageId
```

It carries forward, unchanged, the two decisions the current `fetch` call makes
and documents:

- **The `Content-Type` header is omitted entirely when `file.type === ""`**,
  never sent empty. An empty header is a claim that the type is `""`, which
  Convex records and `isAcceptedAudioContentType` then refuses.
- The response payload is narrowed before `storageId` is read; a response
  without one throws rather than passing `undefined` down the line.

Uploads stay **sequential**. The existing comment's reasoning holds in full —
parallel batches each read the same pre-upload total and several pass a check
only one should — and a serial queue is also the one that reads well with a
byte-level bar, since a single moving row beats ten fighting for the same pipe.

### 3. The queue panel

Above the meter, rendered only when the queue is non-empty.

**The summary line is the only `aria-live="polite"` region**: _"Uploading 3 of
10"_ while running, _"8 added · 2 failed"_ when done. Announcing each row would
turn a folder drop into a firehose in a screen reader; announcing the count
gives the same information at the rate a person can absorb it.

Each row carries the file's name and size, and one of five states:

| State       | Row shows                                                      |
| ----------- | -------------------------------------------------------------- |
| `queued`    | Name and size, dimmed                                          |
| `uploading` | A bar, and "7.3 of 18.2 MB"                                    |
| `saving`    | "Saving…" — the `addTrack` action, after the bytes have landed |
| `done`      | A check; the row self-dismisses after 2 seconds                |
| `failed`    | The reason, in place of the bar, and a **Retry**               |

`saving` is a distinct state rather than a rounding-up of `uploading` to 100%,
because it is a real and separately-failing step: the bytes can be entirely
delivered and `addTrackAction` can still refuse the blob on its sniffed type.
A bar sitting at 100% while that happens is a bar telling a small lie.

**Failures persist.** They are the reason this panel exists rather than a nicer
toast. The `File` is retained by the queue entry, so **Retry** re-runs that one
file without a re-drop. A **Dismiss** clears everything finished.

### 4. The limits, said out loud

The `Usage` component grows from one sentence into the page's honest header:

- **"142 MB of 500 MB used · 37 of 500 tracks"** — `usage.count` finally drawn.
- **"358 MB free"** as the second line.
- Past 90%, the sentence leads with what is left: _"Nearly full — 12 MB free.
  Remove a track to make room."_ **No colour change.**
- At the cap, and only there, the bar and sentence take `alarm`:
  _"Library full. Remove a track to make room."_

**No brass, deliberately.** The obvious move is a warning-coloured bar past
90%, and styles.css forbids it. All three signals are reserved by meaning —
enlarger is RUNNING and nothing else, brass is MONEY, safelight is "act here" —
strictly enough that the twelve-hue project palette **skips hues ~230 and ~85
entirely** so a project tint can never be misread as a state. A storage meter
is none of those three things.

That leaves a two-step. "Nearly full" is _information_, and information in this
system is carried by words at the ordinary muted weight. "Full" is an _error_ —
`acceptTrack` really will refuse the next upload — and `alarm` is the system's
colour for precisely that. Both states change their wording, so in the one case
that has a colour, the colour is the redundant half.

Beneath the picker, once: **"MP3, M4A, WAV, OGG or FLAC · up to 20 MB each."**
The empty state says the same thing, since a user with no tracks reads that
instead.

All sizes are formatted by the existing `formatMb`, which does MiB arithmetic
and labels the result "MB" — so `MAX_TRACK_BYTES` renders as "20 MB" throughout,
matching what the meter beside it already says.

Every number above comes from the shared constants. No literal `500` or `20`
appears in a sentence — the existing `Usage` docblock already makes this
argument for `MAX_LIBRARY_BYTES` and it extends unchanged to the other three.

### 5. The list and its controls

- The bare `<input type="file">` and its browser-default `file:` chrome become
  a **Add music** label styled as a button. It is currently the least designed
  element on the page and the first one the eye lands on.
- Search and sort adopt the existing `Input` component rather than hand-rolled
  border/focus classes repeated inline.
- Sort gains **Largest** and **Longest**. `bytes` is always present;
  `durationMs` is optional, so tracks without one sort last under **Longest**
  rather than being treated as zero-length.
- The drag state becomes an overlay reading **"Drop to add"**, replacing today's
  bare ring, which is a visual change with no stated meaning.
- While a search is active, the list states **"6 of 37"**.

**The drop target remains the list itself.** The existing comment argues against
a permanent dashed band — a second control for what the picker already does,
costing a permanent strip of page to advertise a gesture discovered by trying
it — and that argument is correct. Only the feedback during the drag improves.

---

## Out of scope

- **Preview playback on `/music`.** A play button per row would be genuinely
  useful and is a larger change: it touches `MusicProvider`'s contract, and
  `playRef`'s boolean return exists to serve a priority chain this page has no
  part in. Its own cycle.
- **A permanent drop zone.** Argued against above.
- **Any change to `convex/music.ts`.** Every cap, message and validation on the
  server stays exactly as it is. This design only makes the client honest about
  rules the server already enforces.

## Testing

- `upload-queue.test.ts` — `precheck` against each of the four caps, the
  empty-`file.type` fall-through, and batch-cumulative projection across a
  simulated multi-file drop.
- `-music.test.tsx` — a drop renders queue rows; a failed row keeps its reason
  and offers Retry; the summary line reports counts; the meter renders count
  and free space; the format-and-size line is present.
- The existing music tests must continue to pass untouched. Nothing here changes
  what the server accepts, so any existing test that breaks is a regression.
