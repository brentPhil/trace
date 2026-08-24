/*
 * /music — THE PAGE, NOT THE ROUTE. The route definition and its loader stay
 * in music.tsx; the `-` prefix keeps this file out of the route tree, the same
 * convention the tests beside it already use.
 *
 * The component lives here because it has to be EXPORTED — -music.test.tsx
 * renders it against a seeded query client — and an export of a route file is
 * something the router's code-splitter refuses to split: every page shipped in
 * the eager bundle, with a [tanstack-router] warning per route saying so.
 * Imported from a non-route file, `component:` splits as normal.
 *
 * The upload path is `settings.setLogo`'s, deliberately, because the backend's
 * is too: mint a URL, POST the blob straight to Convex, hand the returned
 * storage id to an ACTION that validates it. See convex/music.ts, whose own
 * header makes the same point from the other side — the blob exists before any
 * of our code sees it, so every rejection there deletes what is already stored.
 * Nothing on this page needs to clean up after a refusal; that is exactly why
 * the validation lives in the action rather than here.
 */
import { useEffect, useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query"
import { Pencil, Trash2, Upload } from "lucide-react"
import { LibraryUsage } from "@/components/music/library-usage"
import { UploadQueuePanel } from "@/components/music/upload-queue-panel"
import { Page } from "@/components/shell/page"
import { Button, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Toast } from "@/components/ui/toast"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { errorMessage } from "@/lib/error-message"
import { postFileWithProgress } from "@/lib/music/post-file"
import { acceptedFormatList, advance, precheck } from "@/lib/music/upload-queue"
import { cn } from "@/lib/utils"
import {
  AUDIO_INPUT_ACCEPT,
  MAX_TRACK_BYTES,
  trackNameFromFilename,
} from "@shared/audio"
import { api } from "../../../convex/_generated/api"
import type { QueuedUpload } from "@/components/music/upload-queue-panel"
import type { LibraryState } from "@/lib/music/upload-queue"
import type { Id } from "../../../convex/_generated/dataModel"

/** How a track is shaped once it has crossed the wire — see `trackReturns` in
 *  convex/music.ts, which is the authority on it. */
type Track = {
  _id: Id<"musicTracks">
  name: string
  bytes: number
  durationMs?: number
  _creationTime: number
  url: string | null
}

type SortKey = "name" | "recent" | "largest" | "longest"

export function Music() {
  const { data: tracks } = useSuspenseQuery(
    convexQuery(api.music.listTracks, {})
  )
  const { data: usage } = useSuspenseQuery(convexQuery(api.music.usage, {}))

  const generateUploadUrl = useLatest(
    useConvexMutation(api.music.generateUploadUrl)
  )
  const addTrack = useLatest(useConvexAction(api.music.addTrack))
  const renameTrack = useLatest(useConvexMutation(api.music.renameTrack))
  const removeTrack = useLatest(useConvexMutation(api.music.removeTrack))

  const toasts = Toast.useToastManager()

  /* The one error posture on this page, and it is /projects' verbatim: the
   * backend's INVALID_TRACK and LIBRARY_FULL messages are already sentences
   * written for a person ("Your music library is full. Remove a track to make
   * room."), so the toast is the whole response and nothing here rewrites
   * them. `errorMessage` supplies the generic line for everything else. */
  const report = (thrown: unknown) => {
    toasts.add({
      title: errorMessage(thrown),
      priority: "high",
      timeout: 8_000,
    })
  }

  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortKey>("name")
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<Array<QueuedUpload>>([])

  const visible = orderTracks(tracks, search, sort)

  /** One entry's fields, changed in place. Every transition below goes through
   *  here so the queue is only ever replaced, never mutated. */
  const patch = (id: string, fields: Partial<QueuedUpload>) => {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, ...fields } : item))
    )
  }

  /**
   * One file, all the way in.
   *
   * The duration is decoded FIRST and separately, so a file the browser cannot
   * decode never reaches a branch that could abandon the upload — see
   * `decodeDurationMs`, which resolves `undefined` rather than rejecting.
   */
  const uploadOne = async (file: File, id: string) => {
    const durationMs = await decodeDurationMs(file)

    patch(id, { status: "uploading", sent: 0 })
    const uploadUrl = await generateUploadUrl({})
    // The POST lives in `postFileWithProgress` because `fetch` cannot report
    // how far a request body has got — it resolves only once the whole body
    // has gone out. Everything that call used to do here, including the
    // Content-Type omission for an untyped file, moved with it.
    const storageId = await postFileWithProgress(uploadUrl, file, (sent) => {
      patch(id, { sent })
    })

    // A DISTINCT STATE, not a bar rounded up to 100%. The bytes have all
    // landed and `addTrackAction` can still refuse the blob on its sniffed
    // type — a full bar during a step that can fail is a bar telling a lie.
    patch(id, { status: "saving", sent: file.size })

    await addTrack({
      storageId: storageId as Id<"_storage">,
      // `newClientKey`, not a bare `crypto.randomUUID()`: this is the same
      // idempotency key every entry the client creates already carries, and
      // `acceptTrack` looks it up to make a retry after a lost response return
      // the existing row instead of billing for a second copy of the file.
      clientKey: newClientKey(),
      name: trackNameFromFilename(file.name),
      // OMITTED, never sent as null or zero. `durationMs` is optional in the
      // action's validator precisely so "we could not decode it" is expressible
      // as an absence; a zero would be a claim about the track that is false.
      ...(durationMs === undefined ? {} : { durationMs }),
    })

    patch(id, { status: "done" })
  }

  /**
   * A selection or a drop, one file at a time.
   *
   * SEQUENTIAL, not `Promise.all`. The library cap is checked inside
   * `acceptTrack` against the rows that exist at that moment, so ten parallel
   * uploads of a nearly-full library each see the same pre-upload total and
   * several can pass a check that only one of them should — and a rejection
   * then arrives for a file the user watched succeed. One at a time also means
   * a bad file's toast names the file that came before the rest are still going.
   *
   * A refusal does NOT stop the run: one unsupported file in a folder drop
   * should cost that file, not the nine good ones behind it — and the failure
   * now lands on that file's own queue row, which is the thing the toast it
   * replaced could not do.
   */
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
      // The library as this batch will leave it, advanced per success — so the
      // fifth file into a library with room for four is refused HERE, rather
      // than uploaded in full and refused by the server one file at a time.
      let state: LibraryState = {
        libraryBytes: usage.bytes,
        trackCount: usage.count,
      }

      for (const entry of entries) {
        const candidate = {
          name: entry.name,
          size: entry.bytes,
          type: entry.file.type,
        }
        const verdict = precheck(candidate, state)
        if (!verdict.ok) {
          patch(entry.id, { status: "failed", reason: verdict.reason })
          continue
        }
        try {
          await uploadOne(entry.file, entry.id)
          state = advance(state, candidate)
        } catch (thrown) {
          patch(entry.id, { status: "failed", reason: errorMessage(thrown) })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  /** Re-runs one failed entry. The `File` is still held by the queue, so this
   *  costs the user nothing — which is the whole reason a failure stays on
   *  screen instead of timing out like the toast it replaced. */
  const retry = (id: string) => {
    const entry = queue.find((item) => item.id === id)
    if (entry === undefined || busy) return

    // Re-checked, because the library may have filled since this row failed.
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

  const dismissFinished = () => {
    setQueue((current) =>
      current.filter(
        (item) => item.status !== "done" && item.status !== "failed"
      )
    )
  }

  /* A finished row is information for about as long as it takes to read it.
   * Failures are NOT swept — they are the reason this panel exists. */
  useEffect(() => {
    if (!queue.some((item) => item.status === "done")) return
    const timer = setTimeout(() => {
      setQueue((current) => current.filter((item) => item.status !== "done"))
    }, 2_000)
    return () => clearTimeout(timer)
  }, [queue])

  return (
    /*
      NOT PINNED — see `Page`'s rule. The header is a title and the file
      picker; neither is a readout of, nor a control over, the list beneath it,
      and the search and sort that ARE controls over it sit with the list.
    */
    <Page
      title="Music"
      actions={
        /*
          A LABEL STYLED AS A BUTTON, wrapping an `sr-only` input — not a bare
          `<input type="file">` with `file:` utilities on it. The browser's own
          picker chrome was the one control on this page drawn by the engine
          rather than by the design system, and it sat in the header where the
          eye lands first. The input keeps its `aria-label`, so it is still the
          same control to a screen reader and to every test that finds it.
        */
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
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-4 pb-6">
        <UploadQueuePanel
          items={queue}
          onRetry={retry}
          onDismiss={dismissFinished}
        />

        <LibraryUsage bytes={usage.bytes} count={usage.count} />

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={search}
            aria-label="Search music"
            placeholder="Search"
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 w-48 text-sm"
          />
          <select
            value={sort}
            aria-label="Sort"
            onChange={(event) => setSort(event.target.value as SortKey)}
            className={cn(
              "rounded-md border border-edge bg-ground px-2 py-1 text-sm",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          >
            <option value="name">Name</option>
            <option value="recent">Recently added</option>
            <option value="largest">Largest</option>
            <option value="longest">Longest</option>
          </select>

          {/* Only while searching: a count beside an unfiltered list is a
              restatement of the list. */}
          {search.trim() === "" ? null : (
            <span className="text-xs text-muted-foreground">
              {`${visible.length} of ${tracks.length}`}
            </span>
          )}
        </div>

        {/*
          THE DROP TARGET IS THE LIST ITSELF, not a separate dashed rectangle
          above it. A dedicated drop zone is a second control for something the
          file picker in the header already does, and it costs a permanent band
          of the page to advertise a gesture that is discovered by trying it.
          Dropping onto the list is the gesture people actually attempt.

          `dragging` is cleared on drop AND on leave, because a drag that ends
          outside the window fires neither `drop` nor `dragend` here.
        */}
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            // Ignored, not queued, while `busy`: the file picker above is
            // already `disabled` for the same reason, but a drop bypasses that
            // element entirely, so the guard has to be repeated here. Letting a
            // second drop through would start a concurrent `upload()`, and
            // `upload`'s own comment explains uploads are SEQUENTIAL precisely
            // so the account-cap check inside `acceptTrack` cannot be raced by
            // parallel batches each reading the same pre-upload total — two
            // concurrent runs from two drops reintroduce exactly that race. The
            // first run's `finally` would also flip `busy` back to false while
            // the second run is still going, re-enabling the picker mid-upload.
            if (busy) return
            void upload(Array.from(event.dataTransfer.files))
          }}
          className={cn(
            "relative rounded-md transition-colors",
            dragging && "ring-2 ring-ring"
          )}
        >
          {/* The ring alone was a visual change with no stated meaning. The
              target is still THE LIST — see the note above on why there is no
              permanent dashed band — so only the feedback improves. */}
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-ground/80 text-sm text-foreground">
              Drop to add
            </div>
          ) : null}
          {tracks.length === 0 ? (
            <Empty>
              No music uploaded yet. Add {acceptedFormatList()} files up to{" "}
              {formatMb(MAX_TRACK_BYTES)} each, and they become selectable from
              the tracker&apos;s music control, beside the tracks that ship with
              Chroneli.
            </Empty>
          ) : visible.length === 0 ? (
            <Empty>Nothing here matches “{search}”.</Empty>
          ) : (
            <ul className="flex flex-col rounded-md border border-edge-soft">
              {visible.map((track) => (
                <TrackRow
                  key={track._id}
                  track={track}
                  onRename={(name) =>
                    // The rejection is reported here, through the same `report`
                    // the remove and upload paths use, AND rethrown. Swallowing
                    // it here would mean the docblock's promise above —
                    // "the server's own 'A track needs a name.' is the sentence
                    // the user should read" — is a lie: nothing else on this
                    // path shows the user anything. Rethrowing keeps
                    // `TrackRow.commit`'s own `.catch` doing its job, which is
                    // unrelated to whether the user was told why: it reopens the
                    // field with the rejected text still in it.
                    renameTrack({ trackId: track._id, name })
                      .then(() => {})
                      .catch((thrown: unknown) => {
                        report(thrown)
                        throw thrown
                      })
                  }
                  onRemove={() => {
                    void removeTrack({ trackId: track._id }).catch(report)
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * What the list shows, from what the query returned.
 *
 * THE NAME SORT IS REDONE HERE even though `listTracksImpl` already sorted by
 * name server-side, because this component owns a sort TOGGLE: the moment
 * "recent" reorders the array, "name" has to be able to put it back, and
 * relying on the server's order would make one of the two modes a no-op that
 * only looks right until the other one has been used.
 *
 * "RECENT" IS `_creationTime` DESCENDING, THE REAL VALUE, NOT A STAND-IN FOR
 * IT. Convex document ids are opaque — they carry no ordering guarantee — so
 * sorting by `_id` would have been an arbitrary order wearing "Recently
 * added" as a label, which is exactly the kind of guess-on-the-user's-behalf
 * this product does not make. `trackReturns` in convex/music.ts now includes
 * `_creationTime`, Convex's own per-document timestamp, so this sort states a
 * fact instead of approximating one.
 */
function orderTracks(
  tracks: Array<Track>,
  search: string,
  sort: SortKey
): Array<Track> {
  const needle = search.trim().toLowerCase()
  const filtered =
    needle === ""
      ? [...tracks]
      : tracks.filter((track) => track.name.toLowerCase().includes(needle))
  filtered.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name)
    if (sort === "recent") return b._creationTime - a._creationTime
    // `bytes` is always present; every row the query returns has one.
    if (sort === "largest") return b.bytes - a.bytes
    // `durationMs` is OPTIONAL — a track the browser could not decode has no
    // length, which is not the same as a length of zero. `-1` sorts those
    // after every known duration rather than ahead of all of them, which is
    // where a `?? 0` would have put them.
    const left = a.durationMs ?? -1
    const right = b.durationMs ?? -1
    return right - left
  })
  return filtered
}

/**
 * One track: its name, its size, and the two things you can do to it.
 *
 * THE RENAME IS HAND-ROLLED RATHER THAN `InlineEdit`, and the reason is an
 * accessibility one rather than a stylistic one. `InlineEdit` takes a single
 * `ariaLabel` and puts it on both the closed trigger and the open input, which
 * is right for a field whose display IS the value ("Project name: Acme"). Here
 * the trigger is a discrete Rename button that has to name its target —
 * "Rename Alpha", so a screen-reader user tabbing a list of ten tracks can
 * tell the buttons apart — while the input it opens is just "Track name". One
 * label cannot be both, and widening `InlineEdit`'s API for one caller is a
 * worse trade than fifteen lines here.
 */
function TrackRow({
  track,
  onRename,
  onRemove,
}: {
  track: Track
  onRename: (name: string) => Promise<void>
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(track.name)

  const open = () => {
    setDraft(track.name)
    setEditing(true)
  }

  /**
   * Enter and blur both commit; Escape reverts. Those are the two things a
   * person does when they have finished typing and the one thing they do when
   * they have not, and it is the same contract `InlineEdit` states at length.
   *
   * A rejected rename REOPENS the field with the rejected text still in it. A
   * blank name is sent rather than refused locally: the server's own "A track
   * needs a name." is the sentence the user should read, and a second copy of
   * that rule here is a second place for it to go stale.
   */
  const commit = () => {
    setEditing(false)
    const name = draft.trim()
    if (name === track.name) return
    void onRename(name).catch(() => {
      setDraft(name)
      setEditing(true)
    })
  }

  return (
    <li
      className={cn(
        "group flex items-center gap-3 px-3 py-2",
        "border-b border-edge-soft last:border-b-0"
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={draft}
          aria-label="Track name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              // Committing unmounts this input, and unmounting fires no blur —
              // so there is no second commit to guard against here.
              commit()
            } else if (event.key === "Escape") {
              event.preventDefault()
              event.stopPropagation()
              setEditing(false)
            }
          }}
          className={cn(
            "min-w-0 flex-1 rounded-sm border border-edge bg-ground px-1.5 py-0.5 text-sm",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{track.name}</span>
      )}

      {track.durationMs === undefined ? null : (
        <span className="shrink-0 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
          {formatClock(track.durationMs)}
        </span>
      )}
      <span className="shrink-0 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
        {formatMb(track.bytes)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        {editing ? null : (
          <Button
            type="button"
            variant="quiet"
            size="icon-row"
            aria-label={`Rename ${track.name}`}
            onClick={open}
            className="opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            <Pencil className="size-4" />
          </Button>
        )}
        {editing ? null : (
          // Hidden, not merely relocated, while `editing`: the input above
          // commits its draft `onBlur`, and clicking Remove blurs it on the
          // way to firing its own `onClick` — so a Remove click during a
          // rename would send a `renameTrack` for a document `removeTrack` is
          // about to delete out from under it. Removing the control is what
          // keeps that click from being possible at all, the same way Rename
          // is already hidden here for the reverse reason.
          <Button
            type="button"
            variant="quiet"
            size="icon-row"
            aria-label={`Remove ${track.name}`}
            onClick={onRemove}
            className="opacity-100 hover:text-alarm focus-visible:opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------

/** Megabytes to one decimal, and the trailing `.0` dropped — so the cap reads
 *  "500 MB" rather than "500.0 MB" while a small file still reads "0.9 MB"
 *  instead of rounding away to "1 MB". MiB, matching the constants it renders. */
function formatMb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** A duration as a person reads one off a player: 3:07, never 187000. */
function formatClock(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

/** How long to wait for the browser to tell us how long a track is. */
const DURATION_DECODE_TIMEOUT_MS = 5_000

/**
 * The track's length, if the browser will say — and `undefined` if it will not.
 *
 * BEST-EFFORT BY DESIGN, and it NEVER REJECTS. A file this cannot decode is
 * still a perfectly valid upload: the server accepts by content type and size,
 * not by whether an `<audio>` element in this particular browser happened to
 * have a decoder for it. Every failure path — no `createObjectURL` (a
 * server-side render), a type the browser declines outright, an `error` event,
 * a decode that simply never finishes — resolves `undefined`, which the caller
 * then omits from the action's arguments entirely.
 *
 * `canPlayType` IS ASKED FIRST, and it is not merely an optimisation. A media
 * element handed a codec it has no decoder for fires neither `loadedmetadata`
 * nor, in several engines, `error` — it just sits there, and the upload would
 * then wait out the full timeout below before starting. Asking the question the
 * browser can answer synchronously turns a five-second stall into nothing at
 * all, for exactly the files that were never going to decode. It is also what
 * makes this function deterministic under jsdom, whose media element answers ""
 * to everything because it loads no media.
 *
 * The timeout remains for the case `canPlayType` gets wrong — it answers
 * "maybe" far more often than "probably", and a container it can open but not
 * decode still hangs. Without it such a file leaves this promise pending and
 * the upload never starts at all, which is a far worse outcome than a track
 * with no duration shown beside it.
 */
function decodeDurationMs(file: File): Promise<number | undefined> {
  if (typeof URL.createObjectURL !== "function") {
    return Promise.resolve(undefined)
  }
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let objectUrl: string | null = null

    const finish = (value: number | undefined) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      // Revoked on every path, including success: an object URL holds the file
      // in memory until it is released, and these are up to 20 MiB each.
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
      resolve(value)
    }

    try {
      const audio = new Audio()
      // An empty answer is "no", and so is a file the OS gave no type at all —
      // there is nothing to ask about. Both mean: upload it, say nothing about
      // its length.
      if (file.type === "" || audio.canPlayType(file.type) === "") {
        finish(undefined)
        return
      }
      audio.preload = "metadata"
      audio.addEventListener("loadedmetadata", () => {
        const seconds = audio.duration
        finish(
          Number.isFinite(seconds) && seconds > 0
            ? Math.round(seconds * 1000)
            : undefined
        )
      })
      audio.addEventListener("error", () => finish(undefined))
      timer = setTimeout(() => finish(undefined), DURATION_DECODE_TIMEOUT_MS)
      objectUrl = URL.createObjectURL(file)
      audio.src = objectUrl
    } catch {
      finish(undefined)
    }
  })
}
