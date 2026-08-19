# Music and focus mode, and the record identity that survives a resume

**Date:** 2026-08-19
**Status:** designed; not implemented
**Scope:** Phase 1 of four. Playlists and the full project/task preference
chain are deliberately out — see *Decomposition* below.

Chroneli plays music while you track, and remembers which music went with which
piece of work. The premise is that a freelancer's tracker is already open beside
the work for the length of a working day; if it is going to sit there anyway, it
can be the thing that sets the room.

---

## The tension this design is built around

DESIGN.md and PRODUCT.md both argue for a product that gets out of the way:

> It recedes while you work and is exact about the numbers.

> The app is an always-open desktop companion […] It sits in peripheral vision
> for hours and is looked at directly only in short bursts.

A media player is the opposite kind of object. Players want album art, scrubbing
bars, queue management, and a colour of their own. Dropping one into the timer
bar makes the tracker into a jukebox with a clock attached, which inverts the
hierarchy the whole design system exists to protect.

So the governing rule here is: **the music feature is allowed to be useful and
is not allowed to be visible.** Two Ink-muted icons by default. No signal colour,
ever. Everything else lives behind a popover or on its own page.

---

## Decomposition

The original request describes five or six independent subsystems. Attempting
one spec for all of them produces something too vague to implement, so it is cut
into four, each with its own spec/plan cycle:

| Phase | Contents |
|---|---|
| **1 — this spec** | Audio engine, tracker controls, the bundled catalog, uploads, and per-record memory of the last track played |
| 2 | Playlists: create, rename, reorder, delete, add/remove tracks |
| 3 | Project-level and task-level preferences — steps 2 and 3 of the request's four-level priority chain |
| 4 | Catalog categories (Lo-fi / Ambient / Deep Focus / …) once there are enough tracks for a category to mean anything |

Phase 1 is the slice that proves the idea end to end. Per-record memory is the
part no other tracker does, and it is worthless without the engine and a library
beneath it — so those three ship together or not at all.

---

## Two findings from the existing code that shape everything below

### 1. A resume mints a NEW entry, so the memory cannot key on `_id`

`useEntryMutations.resume` (src/hooks/use-entry-mutations.ts) copies title,
project, tags and billable onto a **fresh** `entries.create`. The old
`timeEntries._id` is not carried forward and is never seen again.

The request asks that clicking an existing tracked record restore the music that
record was using. Keyed on `_id`, that memory would be destroyed at the exact
moment it is supposed to be read — the feature would appear to work in
development, where you press play twice on the same running entry, and fail for
every real user, every time, silently.

The identity that *does* survive is the one this product already uses to decide
that two entries are the same work. `sittingKey` in src/lib/group-sittings.ts:

```
`${entry.title.trim()}${SEP}${entry.projectId ?? ""}`
```

Trimmed, case-sensitive, `\0` as the separator so a title cannot impersonate
another by containing the delimiter. **The music preference keys on exactly
this.** Sittings, grouping, the log's expand state and now music all agree on
what "the same work" means, which is the only way they can stay agreeing.

It carries one inherited rule for free: `groupSittings` refuses to group an
untitled entry, because two blank titles on one project are not evidence of the
same work. Music inherits it — **a blank title gets no preference row and no
preference lookup.** Without that, every unnamed entry in the account would share
one music memory and overwrite it in turn.

### 2. Chroneli has no pause, so the request's pause branch describes nothing

`pause` appears nowhere in `convex/entries.ts`, `use-entry-mutations.ts`, or
`timer-bar.tsx`. The schema is explicit: a running entry is `endedAt === null`,
and the only transition out of it is a stop.

The request asks for "pause music when tracking pauses" and "resume music when
tracking resumes". Those are controls for an event this product cannot emit. The
setting was specified, designed, and cut here rather than shipped as a switch
that does nothing — a preference that never fires is worse than a missing one,
because a user who sets it believes something is now true.

If timer pause is wanted, it is a change to the entry model and belongs in its
own spec. Music would pick it up for free.

---

## Data model

### `musicTracks` — new table

```
userId: v.string()
clientKey: v.string()              // UUIDv7, minted client-side
storageId: v.id("_storage")
name: v.string()                   // renameable; seeded from the filename, extension stripped
contentType: v.string()
bytes: v.number()
durationMs: v.optional(v.number()) // decoded client-side; optional because decode can fail
updatedAt: v.number()
deletedAt: v.union(v.number(), v.null())
```

Indexes: `by_user_name` `[userId, name]`, `by_user` `[userId]` (creation order
is "recently added"), `by_user_clientKey` `[userId, clientKey]`.

`clientKey` is the same idempotency device `timeEntries` and `invoices` already
use, and it matters more here than anywhere else in the product: an upload is
the longest-running mutation the app has, and a retry after a lost response on a
bad connection would otherwise store the same 8 MB file twice and bill for both.

### `musicPreferences` — new table

```
userId: v.string()
title: v.string()                            // trimmed, exactly as sittingKey does it
projectId: v.union(v.id("projects"), v.null())
trackRef: v.union(
  v.object({ origin: v.literal("upload"),   trackId: v.id("musicTracks") }),
  v.object({ origin: v.literal("chroneli"), slug: v.string() }),
)
updatedAt: v.number()
```

Index: `by_user_title_project` `[userId, title, projectId]`.

`projectId` is `v.union(..., v.null())` rather than `v.optional`, for the reason
`timeEntries.endedAt` is: an optional field is not indexable, and "this title
with no project" has to be a lookup rather than a scan-and-filter.

`trackRef` is a discriminated union rather than two nullable columns. It is the
seam the later phases hang off: a catalog moved to R2, or a playlist reference in
Phase 2, is a new member of this union and nothing that reads it changes shape.

### `userSettings` — two additive fields

```
musicAutoplay: v.optional(v.boolean())        // default true
musicOnStop: v.optional(v.union(
  v.literal("stop"), v.literal("pause"), v.literal("continue")))  // default "pause"
```

Optional and additive, following `currency`, `pdfIncludeNotes` and
`groupEntries`: a settings row written before these existed has no opinion,
`settings.get` falls through to `SETTINGS_DEFAULTS`, and **no backfill migration
is required.**

### What is deliberately NOT in the database

**Volume, shuffle and repeat live in `localStorage`.**

Two reasons, and both are load-bearing. A volume slider fires a change event per
pixel of drag; routing that to a Convex mutation is a write storm for a value
nobody audits. And "how loud" is a fact about *this laptop's speakers*, not about
the account — syncing it would mean a user on headphones sets the volume for
their next session on desk speakers.

**Playback position is not stored at all.** The request hedges on it ("if
appropriate"), and it is not. Restoring a track at 2:47 is disorienting in a way
restoring a podcast is not, and the write pattern to support it is either
per-second or lands on a code path that has to be right at exactly the moment
the app is being closed.

---

## Architecture

Six units. Each answers *what does it do, how do you use it, what does it
depend on* without reference to the others' internals.

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/lib/music/queue.ts` | **Pure.** tracks + index + shuffle seed + repeat mode → next / prev / on-ended. No DOM, no React. | nothing |
| `src/lib/music/catalog.ts` | The bundled manifest: slug, display name, file path. A literal array. | nothing |
| `src/lib/music/track-ref.ts` | **Pure.** `TrackRef` union and `resolveTrackUrl`. | catalog |
| `src/hooks/use-audio-element.ts` | The **only** place `HTMLAudioElement` is touched. `load / play / pause / setVolume / onEnded`. | — |
| `src/components/music/music-provider.tsx` | Owns one `<audio>` and the queue state; exposes context. Mounted in `_authed.tsx`. | the four above |
| `src/hooks/use-music-tracking.ts` | The bridge: running-entry state → settings → preference resolution. | provider, entries |

Two boundaries are the point of this table.

**The provider is mounted in the `_authed` layout, not in a route.** TanStack
Router unmounts a route component on navigation; an `<audio>` element inside one
would stop the music every time the user clicked Reports. It mounts once, above
the router outlet, and never remounts for the length of the session.

**`use-music-tracking.ts` is the only file that knows about both halves.**
Tracker code never learns what audio is; audio code never learns what an entry
is. Deleting that one file removes the feature and leaves both sides working —
which is the test of whether the boundary is real.

### The catalog, and where it lives

`public/music/` ships to `dist/client` and is served as a Cloudflare Workers
static asset. This costs no storage billing, needs no signed URLs, no DB rows and
no network call beyond the audio fetch itself, and works offline in development.

It is bounded by **git, not by Cloudflare.** Every MP3 is a binary blob in
history forever, uncompressable and unremovable without a history rewrite.
Cloudflare's limits (25 MiB/file, 20k files) are nowhere near binding. The
decision recorded here is a **ceiling of roughly twelve tracks, ~55 MB.** Past
that the manifest moves to R2 and `resolveTrackUrl` grows a base URL — a
one-file change with no data migration, which is why the indirection exists.

`.gitattributes` gains `*.mp3 binary`, consistent with the existing png/woff
block.

`public/music/LICENSE.md` records, **per file**: the filename, the origin URL it
was downloaded from, and the licence it was released under. The tracks are
royalty-free / open-source audio cleared for commercial use — the first file,
`alex-morgan-lofi-chill-vlog-beats-573883.mp3`, carries Pixabay's download naming
convention. Writing it down is not ceremony: this is a commercial product at
chroneli.com, the person who can answer "where did this come from" is the person
who downloaded it, and that answer has a shelf life. A track whose provenance
cannot be produced on request is a track that has to be pulled.

**The catalog ships with one track and no categories.** Lo-fi / Ambient / Deep
Focus are meaningless partitions of a one-element set. Categories are one field
on the manifest whenever there are enough tracks to divide.

---

## Resolution: which music plays when a timer starts

If `musicAutoplay` is off, nothing happens, and the rest of this section does not
run.

1. `musicPreferences` for `title.trim()` + `projectId` — **skipped entirely when
   the title is blank**
2. The last-played track, from `localStorage`
3. The first track in the bundled catalog

The preference row is written when the user **changes track while an entry is
running** — never on start. That distinction is the whole honesty of the
feature: the table records choices a person made, not choices the resolver made
on their behalf. Writing on start would mean step 3's arbitrary fallback
immediately becomes a stored preference indistinguishable from a deliberate one,
and after a week every record in the account "prefers" the first catalog track.

On stop, `musicOnStop` applies: `stop`, `pause`, or `continue`.

---

## Interface

### The timer bar

A new `src/components/music/music-controls.tsx`. Nothing is added to
`timer-bar.tsx`, which is already 966 lines and is the file this feature is most
likely to be blamed for making unreadable.

**Collapsed — the default, and what is on screen essentially always:** two
Ink-muted icon buttons, a speaker and a disc, bordered per the Boundary Rule.

**No signal colour, in any state.** Enlarger is reserved exclusively for the
running timer, and music playing is not the work running — the moment a second
thing on the surface is cold-lit, the running state stops being findable in half
a second, which is the property the entire palette is built to buy. Brass means
money. So playing-vs-muted is carried by **icon shape** (speaker with waves
vs. speaker struck through) and by the Now Playing text, satisfying DESIGN.md's
rule that meaning is never carried by colour alone.

**Now Playing:** one line, Ink-muted, track name only, truncated, never wrapping.

**Expanded** (popover from the disc): Now Playing block — previous, play/pause,
next, shuffle, repeat, volume — then a list under two headings, *Chroneli Music*
and *My Music*. Changing track from here never touches the timer.

### `/music` — new route

Sidebar entry after Projects, on the existing `Page` shell that Projects and
Reports use. Drag-and-drop and file-picker upload; a list with rename, delete,
search, and sort by name or recently added; a usage meter reading
`142 MB of 500 MB`.

A route rather than a settings block, because this is a management surface with
search and sort in it, and /settings is where switches live.

### /settings — new Music section

Two controls: **Play music when tracking starts**, and **When tracking stops** →
stop / pause / keep playing.

---

## Limits

| Limit | Value | Why |
|---|---|---|
| Per file | 20 MB | Comfortably holds a 10-minute 256 kbps track |
| Per account | 500 MB | ~80–150 tracks. Convex bills storage per GB, and audio is ~1000× the footprint of invoice logos — the only files this app stores today |
| Track count | 500 | Bounds the row read that sums `bytes` for the cap |
| Accepted types | `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/ogg`, `audio/flac` | Allow-list, never a deny-list |

The count cap exists so the usage sum stays a bounded index read. The alternative
— a denormalised running total — is a number that can drift from the rows it
claims to describe, and a storage meter that lies is worse than one that costs a
few hundred rows to compute.

---

## Failure modes

**Upload validation follows `settings.setLogo` exactly**, including the part that
is easy to skip: when validation fails, the already-stored blob is **deleted**.
`settings.test.ts` asserts this today and the music tests assert it too.
Otherwise every rejected upload leaks a paid-for file that no row references and
no UI can reach.

Four rejections, each with its own message: unsupported type, over 20 MB, would
exceed the account cap, over the track count.

**Browser autoplay policy is the failure most likely to ship unnoticed.**
`play()` rejects when the browser has seen no user gesture. Starting a timer *is*
a click, so the ordinary path is fine — a restored session or a programmatic
start is not. The rejected promise is caught and the speaker icon drops into a
*click to play* state. Unhandled, this looks precisely like "the music feature is
broken", and only for some users, and only sometimes.

**A track that will not play** — 404, corrupt, unsupported codec — skips to the
next and raises one quiet toast. If every track in the queue fails, playback
stops rather than walking the list forever.

**A preference pointing at a deleted track** falls through to the next
resolution step. The stale row is cleaned on read, not by a migration.

**Deleting a track deletes its `_storage` blob in the same mutation.** Otherwise
the usage meter and the storage bill disagree, and the bill is the one that is
right — the user is charged for files the product has told them are gone.

**Two open tabs are two players.** Chroneli is explicitly a pinned-tab app, so
this will happen. A `BroadcastChannel` announcement pauses playback in other tabs
when one starts.

---

## Testing

| Layer | What is asserted |
|---|---|
| `queue.test.ts` | The next/prev × shuffle × repeat matrix, and the two edges that bite: a **one-track** catalog and an **empty** one |
| `track-ref.test.ts` | Both origins resolve; an unknown slug returns null rather than a broken URL |
| `convex/music.test.ts` | All four upload rejections **and the blob cleanup after each**; ownership isolation; preference upsert keyed on title+project; the blank-title rule; blob cascade on delete |
| `music-controls.test.tsx` | Collapsed render, expansion, handler dispatch — in the style of `timer-bar.test.tsx` |

`use-audio-element.ts` exists so that **no test ever needs real audio.** It is the
single mockable seam over `HTMLAudioElement`, and it is the reason the queue
logic — the part with actual branching in it — is testable as a pure function.

The ownership tests matter most. Every index here leads with `userId` for the
reason schema.ts gives: ownership is a key prefix, not a filter someone can
forget on the one query where forgetting it is expensive.

---

## Out of scope, and why

- **Playlists** — Phase 2. In Phase 1 the library is the queue.
- **Project and task preferences** — Phase 3. Per-record memory covers the
  request's own examples (Coding → coding music, Writing → ambient) because the
  record key already includes the project.
- **Categories** — Phase 4, when the catalog is big enough to divide.
- **Timer pause** — not a music feature. The product has no pause; adding one is
  a change to the entry model.
- **Playback position** — argued above.
- **Streaming providers** — considered and rejected: no crossfade control, no
  per-record position, and a provider OAuth flow for a feature meant to recede.
