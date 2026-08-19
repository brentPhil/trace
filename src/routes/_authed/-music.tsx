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
import { useState } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import {
  convexQuery,
  useConvexAction,
  useConvexMutation,
} from "@convex-dev/react-query"
import { Pencil, Trash2 } from "lucide-react"
import { Page } from "@/components/shell/page"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Toast } from "@/components/ui/toast"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import {
  AUDIO_INPUT_ACCEPT,
  MAX_LIBRARY_BYTES,
  trackNameFromFilename,
} from "@shared/audio"
import { api } from "../../../convex/_generated/api"
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

type SortKey = "name" | "recent"

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

  const visible = orderTracks(tracks, search, sort)

  /**
   * One file, all the way in.
   *
   * The duration is decoded FIRST and separately, so a file the browser cannot
   * decode never reaches a branch that could abandon the upload — see
   * `decodeDurationMs`, which resolves `undefined` rather than rejecting.
   */
  const uploadOne = async (file: File) => {
    const durationMs = await decodeDurationMs(file)

    const uploadUrl = await generateUploadUrl({})
    const response = await fetch(uploadUrl, {
      method: "POST",
      // Omitted rather than sent empty when the OS gave the file no type: an
      // empty `Content-Type` is a header claiming a type of "", which Convex
      // would then record as the blob's type and `isAcceptedAudioContentType`
      // would reject. With no header at all, `addTrackAction` falls through to
      // the blob's own sniffed type, which is the answer that can be right.
      ...(file.type === "" ? {} : { headers: { "Content-Type": file.type } }),
      body: file,
    })
    if (!response.ok) throw new Error("upload failed")
    const payload: unknown = await response.json()
    const storageId =
      typeof payload === "object" &&
      payload !== null &&
      "storageId" in payload &&
      typeof payload.storageId === "string"
        ? payload.storageId
        : null
    if (storageId === null) throw new Error("upload returned no id")

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
   * should cost that file, not the nine good ones behind it.
   */
  const upload = async (files: Array<File>) => {
    if (files.length === 0) return
    setBusy(true)
    try {
      for (const file of files) {
        try {
          await uploadOne(file)
        } catch (thrown) {
          report(thrown)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    /*
      NOT PINNED — see `Page`'s rule. The header is a title and the file
      picker; neither is a readout of, nor a control over, the list beneath it,
      and the search and sort that ARE controls over it sit with the list.
    */
    <Page
      title="Music"
      actions={
        <label className="text-sm">
          <span className="sr-only">Music files</span>
          <input
            type="file"
            accept={AUDIO_INPUT_ACCEPT}
            multiple
            disabled={busy}
            aria-label="Music files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              // Cleared so choosing the SAME file again still fires `change` —
              // which is what a person does after a rejection they have since
              // fixed, and the one case a file input silently swallows.
              event.target.value = ""
              void upload(files)
            }}
            className="max-w-full text-sm file:mr-3 file:rounded-md file:border file:border-edge file:bg-ground file:px-2 file:py-1.5 file:text-sm"
          />
        </label>
      }
    >
      <div className="flex flex-1 flex-col gap-4 px-4 pb-6">
        <Usage bytes={usage.bytes} />

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            aria-label="Search music"
            placeholder="Search"
            onChange={(event) => setSearch(event.target.value)}
            className={cn(
              "w-48 rounded-md border border-edge bg-ground px-2 py-1 text-sm",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
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
          </select>
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
            "rounded-md transition-colors",
            dragging && "ring-2 ring-ring"
          )}
        >
          {tracks.length === 0 ? (
            <Empty>
              No music uploaded yet. Add an MP3, M4A, WAV, OGG or FLAC and it
              becomes selectable from the tracker&apos;s music control, beside
              the tracks that ship with Chroneli.
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
  filtered.sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : b._creationTime - a._creationTime
  )
  return filtered
}

/**
 * The storage meter.
 *
 * The ceiling is `MAX_LIBRARY_BYTES`, never a literal 500: the number in this
 * sentence and the number `acceptTrack` refuses an upload against are the same
 * constant, so they cannot drift into telling the user two different things.
 *
 * The bar is `aria-hidden` and the sentence carries the value, rather than a
 * `progressbar` role with a `valuenow` — the sentence is already the exact
 * figure in the units a person thinks in, and a progressbar would announce the
 * same number a second time as a bare percentage.
 */
function Usage({ bytes }: { bytes: number }) {
  const fraction = Math.min(1, bytes / MAX_LIBRARY_BYTES)
  return (
    <div className="flex max-w-prose flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">
        {`${formatMb(bytes)} of ${formatMb(MAX_LIBRARY_BYTES)} used`}
      </p>
      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full bg-ink-muted"
          style={{ width: `${(fraction * 100).toFixed(1)}%` }}
        />
      </div>
    </div>
  )
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
