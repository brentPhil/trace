# Offline

Chroneli keeps working with no network. Start, stop, retitle, note, edit
times, delete and restore entries; create and edit projects and tags; change
settings; read history, reports and the last-cached log — all of it works
offline, and everything written offline reaches the server, in order, once
the connection returns. A reload or a relaunch while offline loses nothing.

Design record: `docs/superpowers/specs/2026-09-03-offline-outbox-design.md`.
That document was written before implementation and a few of its calls were
corrected along the way; this one describes what shipped, and says where the
two disagree.

## What does not work offline

Four surfaces are online-only, each disabled with a sentence next to the
control rather than a hidden button (`src/lib/offline/offline-copy.ts`):

- **Raising an invoice.** Invoice numbers must be unique, and two devices
  minting one offline could not be reconciled after the fact.
- **Logo and music uploads.** File storage needs the network; there is no
  offline path for a large binary.
- **Google Calendar** — connecting, disconnecting, and its per-calendar
  settings. The consent screen itself needs the network, so there is nothing
  to make optimistic.
- **Sign out** — while offline only. See below; this is one of the places
  the design spec's plan and the shipped code disagree.

Everything else — every entry, project, tag and settings mutation — goes
through the outbox.

## The outbox

One persistent, ordered journal of write intents ("ops"), in IndexedDB, and
one path every offline-capable mutation goes through, online or not
(`src/lib/offline/outbox.ts`):

1. The op is written to the journal.
2. Its optimistic update is applied, so the screen changes at once.
3. The drain hands ops to Convex one at a time, in order, awaiting each
   acknowledgement before sending the next.

On boot the journal is read, every op's optimistic update is re-applied (they
are idempotent by construction — re-running one against the current cache has
to leave it exactly where a fresh apply would), and the drain resumes.

**Order matters, and it is not incidental.** Sending sequentially — never in
parallel — is what makes placeholder rewriting sound. If ops could race, a
retitle could reach the server before the create it depends on.

**Placeholders and dependencies.** An op enqueued offline can name an id the
server has not minted yet — a project created offline, an entry started
offline. Such an op carries the placeholder id the optimistic row already
uses (`optimistic:<clientKey>`, from `src/lib/optimistic-id.ts`). When the op
that mints the real id is acknowledged, the outbox records
`placeholder → real id` in the journal and rewrites every later op's args
before sending it (`src/lib/offline/placeholders.ts`). Because sending is
sequential and a producer always precedes its dependents, a dependent never
reaches the sender still carrying an unresolved placeholder — unless its
producer was itself dropped, in which case the dependent is dropped too
(reason `"orphaned"`).

The rewrite walks every string in the args, not just ones that look like
placeholders — and does the lookup with `Object.hasOwn`, not `resolved[s] ??
s`, because a plain object answers for its prototype and an entry titled
`"constructor"` would otherwise splice a function into the args. Found in
review, not in the design.

**Coalescing.** Two consecutive unsent ops of the same kind on the same
target collapse into one — a retitle, a note, a settings save — so typing a
title offline for ten seconds replays as one write, not ten. The default
collapse is REPLACE (the later op is the whole answer, as with a title); a
few kinds (`projects.update`, `settings.update`) declare `coalesceMerge` and
MERGE instead, because their args are a patch of independent fields and
replacing would drop a color change if a name change came in right after it.
A coalesced op inherits the earlier op's `settled` promise, so a caller
awaiting the first keystroke still resolves when the last one lands.

**Rejections.** Convex's mutation promise does not reject for a lost network
— it waits, which is exactly the behavior an outbox needs. It rejects when
the server refuses the op outright. Almost every refusal is final (a title
too long, an entry that no longer exists), so the op is dropped and a toast
names what was lost, using the op kind's label. The one exception is
`UNAUTHENTICATED`: that op is left in the journal and the drain pauses until
the connection or the auth state changes, because dropping recorded time for
a session hiccup would be the product's worst possible failure.

**Stale starts.** An `entries.start` older than 24 hours with no later
stop/discard/start in the journal to close it is dropped rather than
replayed — the rule `src/lib/pending-start.ts` used to enforce alone, now
folded into the registry as `staleAfterMs` + `closedBy` on the `entries.start`
op kind.

**Instants travel with the op, and so does the name.** `entries.stop` and
`entries.discardRunning` record `endedAt` (or capture "now" as their
immediate answer) at enqueue time, not at send time, so a stop replayed hours
later closes the entry at the moment the user actually pressed it.

**Correction from the design spec.** The spec's §1 said a replayed stop
"carries the id of the entry it is stopping" — looser than what shipped;
§6 already specifies the shape below precisely, including the rejected
timestamp guard, so the gap is really between two parts of the spec, not
between spec and code. What shipped is stronger and more specific than that
§1 sentence suggests: `entries.stop` and
`entries.discardRunning` both take an **optional `entryId`** on the server
(`convex/entries.ts`), and every outbox-issued stop/discard now sends one.
Given an id, the server closes or deletes *only that entry*, and only while
it is still running; omitted, both behave exactly as before — "whatever is
running" — which is what every non-outbox caller still means. The design
spec's first attempt at this was a timestamp guard
(`entry.startedAt >= endedAt`), and it was rejected during implementation: a
backwards clock produces the identical shape to a replayed stop from a stale
timestamp, and `convex/entries.test.ts` requires a backwards clock still stop
the timer. Only the name can tell the two apart, because it says which timer
the user was actually looking at.

**One sender across tabs.** The drain runs under a Web Lock
(`src/lib/offline/web-lock.ts`, acquired as `"chroneli-outbox"` in
`create-outbox.ts`), so two tabs of the same origin never both drain the
journal at once. This is a courtesy, not a correctness requirement — every op
is idempotent by construction (entry and project creates by `clientKey`, tag
ensure by name, patches by value) — so a browser with no Web Locks API simply
falls back to running the lock function inline, and behaves correctly with
one tab.

## One optimistic function, two stores

Convex's `OptimisticLocalStore` only patches queries it has already loaded
from the server. On an offline boot there is nothing loaded, so Convex's own
optimistic mechanism has nothing to patch — the screen would not update at
all for an op made before the socket ever connects.

The fix is not a second optimistic system. Every mutation's optimistic
function — `optimisticStart`, `optimisticSetTitle`, and so on, moved out of
the hooks into pure modules under `src/lib/offline/` (`optimistic-entries.ts`,
`optimistic-classifiers.ts`, `optimistic-settings.ts`) and keyed by op kind in
one registry (`op-kinds.ts`) — is written once, against Convex's
`OptimisticLocalStore` interface, and run against two different
implementations of it:

- **`TanStackLocalStore`** (`src/lib/offline/tanstack-local-store.ts`), an
  adapter over the TanStack `QueryClient` itself. This is what changes the
  screen offline, and the cache it writes into is exactly what the snapshot
  layer persists. It keys queries the same way `convexQuery()` does —
  `["convexQuery", <canonical function name>, <args>]` — so `getAllQueries`
  can find every live instance of a paginated query by name.
- **Convex's own store**, when online: the op is handed to Convex with the
  same optimistic function passed as `optimisticUpdate`, so Convex's ordering
  and reconciliation machinery still runs, and the server's eventual answer
  replaces both stores' guesses.

The two never run in the same request — `create-outbox.ts`'s `send` uses
Convex's store when the mutation actually goes out; `applyLocal` uses the
TanStack adapter for the immediate, always-happens screen update. One
function, two call sites.

## Cached reads: snapshots, not `persistQueryClient`

Every successful Convex query result already in the TanStack cache is
written through to IndexedDB, keyed by TanStack's own query hash
(`src/lib/offline/query-snapshots.ts`). The write is debounced 300ms per key
— a page unloaded inside that window can lose its very last update, which is
recorded rather than treated as a surprise later.

The read side wraps the default `queryFn`: when the socket is not connected
and a snapshot exists for that key, the snapshot is returned immediately;
otherwise Convex's real query function runs. `@convex-dev/react-query` marks
its queries never-stale, so a restored snapshot renders without triggering a
refetch, and the live subscription — opened the moment the query was added to
the cache — replaces it the instant the socket reconnects.

**This is deliberately not TanStack's `persistQueryClient`.** That hydrates
every persisted key at boot; and because `@convex-dev/react-query` opens a
live subscription for every query added to the cache, hydrating hundreds of
old report date-ranges at once would turn every one of them into a live
subscription the moment the socket reconnects. The snapshot layer restores
only what is actually asked for — a query resolves from its snapshot the
first time something renders it, and that is the only work done.

Snapshots older than 30 days are pruned at boot. All snapshots are cleared on
sign-out. Note that "30 days old" tracks when a snapshot was last *written*,
not when its underlying data was last fetched — serving a snapshot offline is
recorded as an ordinary success and re-stamped, so a query in active use
never ages out. That is the intended trade (what's being read is what should
be kept), stated so it is not rediscovered as a bug later.

## The log's pagination hook

The timer log reads through Convex's own `usePaginatedQuery`, which keeps its
pages in Convex's client and never puts them in the TanStack cache — so
before this work, the log was the one surface the snapshot layer could not
see or restore.

It now reads through `useConvexPages` (`src/hooks/use-convex-pages.ts`): a
small hook that holds a page count and subscribes to one
`convexQuery(listPage, …)` per page, chaining each page's cursor from the
previous page's `continueCursor`. Each page is its own ordinary cache entry,
so each one is snapshotted, restored, and patched by the same optimistic
functions that already walk `listPage` by name.

**On every fresh mount it starts at exactly one page — deliberately, not as a
simplification.** A restored second page's cursor was minted against an
older first page; once new entries land between then and now, the two pages
no longer meet up cleanly. Starting at one page and letting the reader ask
for "load more" avoids serving a log with a gap or a duplicate stitched
silently into it. On an offline boot this means the log shows the newest
cached page and whatever range queries happen to be cached; older pages load
once the connection is back.

## Booting offline: the service worker

Hand-written (`src/sw/index.ts`, routing logic split out as a pure function
in `src/sw/routing.ts` so it is unit-testable without a worker), and built by
a **second Vite invocation** — `vite build && vite build -c
vite.sw.config.ts` in `package.json` — because `vite-plugin-pwa` does not run
under TanStack Start's build. The second build writes `dist/client/sw.js`
with `emptyOutDir: false`, so it lands beside the app's own output rather
than clobbering it. The worker is registered only in production
(`src/lib/offline/register-sw.ts` checks `import.meta.env.PROD`); registering
it in dev would serve stale modules straight through HMR.

The routing table, as `decide()` returns it:

- Non-GET, or cross-origin: **bypass**.
- `/api/*`, `/_serverFn/*`, `/sw.js`: **bypass**.
- A navigation request: **network first**; on failure, the cached copy of
  *that exact URL* if one exists, else a tiny inline offline page.
- `/assets/*` (hashed, immutable build output): **cache first**.
- Every other same-origin GET: **stale-while-revalidate**.

**Correction from the design spec.** The spec described a fallback chain
ending in "the last cached page shell." What shipped has no such shell, and
the comment in `src/sw/index.ts` explains why in the header
`NO SHARED SHELL`: an earlier version kept the last successfully-cached
navigation under one key and served it for *any* URL with no cache entry of
its own. That is wrong for this app specifically, because this app
dehydrates real query results into its SSR HTML — serving `/timer`'s cached
page at a `/reports` URL means painting `/reports` with `/timer`'s data
already hydrated into it, not an empty shell. It also fired before the app
itself could render its own "not opened on this device yet" message, so the
honest answer was being pre-empted by the wrong page's data. A URL that was
never visited now gets the inline offline page instead, which carries no
user data and says plainly what it does not know.

## Auth fallback and reload-on-reconnect

The root route's `beforeLoad` (`src/routes/__root.tsx`) calls a server
function for the auth token on every navigation. In the browser, a **thrown**
call means the fetch itself failed — offline, or chroneli.com unreachable —
and the route falls back to a remembered signed-in flag kept in
`localStorage` (`src/lib/offline/remembered-auth.ts`), marking the boot as
offline. A server that actually answers "no token" is never overridden by
this fallback; only a genuine network failure reaches it.

The remembered flag is a UX guard, not a security boundary — see "What is
stored on the device" below for exactly what that means.

On an offline boot, the Better Auth session fetch also fails, so the Convex
socket stays paused rather than attempting to authenticate with nothing.
When the browser's `online` event fires after such a boot, the page reloads
outright — the shortest path back to a real session — and both the outbox
and the query snapshots survive the reload, since both live in IndexedDB
rather than memory.

A route whose data was never cached on this device has nothing to restore:
its loader waits on a query with no snapshot, forever. `_authed`'s single
`pendingComponent` (`src/components/shell/offline-pending.tsx`) reads the
connection state and, when offline, says plainly that this page has not been
opened on this device yet and will load once the connection returns —
instead of implying the load is merely slow.

## Sign-out

**Correction from the design spec.** The spec's §5 said sign-out is
"disabled while offline. Also disabled while the outbox is non-empty." What
shipped disables it for offline only. Refusing on a non-empty queue was
tried first and rejected during implementation as a trap: an op the server
keeps refusing, or a drain that has thrown, holds the pending count above
zero permanently, and a sign-out gated on that count reaching zero would then
be unreachable on that machine forever — along with the sign-out-triggered
device clear, which is the one thing that gets a shared or lost machine back
to a clean state.

What ships instead: sign-out is refused **only while offline**
(`OFFLINE_SIGN_OUT_REASON`, disabled with a stated reason), and separately, if
it is online with a non-empty queue, a **warning** is shown next to it
(`pendingSignOutWarning`) rather than a refusal — "N changes have not synced
yet and will be lost." Signing out **clears the queue**. The trade is stated
in `clear-local-data.ts`'s own comment: losing queued changes is bad, but
leaving one person's queue for the next person to sign in on the same
machine — replaying their writes under a different session — is worse, and
an unreachable sign-out guarantees exactly that outcome on a shared device.

Sign-out cleanup (`src/lib/offline/clear-local-data.ts`, `clearLocalData`)
clears the remembered auth flag first, synchronously and outside the
`Promise.all` below — it has no `.catch` at that call site, and is
exception-proof only because `remembered-auth.ts` wraps its own
`localStorage` access internally. The other three run through `Promise.all`,
each `.catch`-guarded independently so one failing store can't block the
others or block the user leaving:

- the query snapshot store (`snapshots.clear()`),
- the outbox — the one that has to go through `Outbox.clear()` rather than
  being poked directly, including rejecting every pending `settled` promise
  as `DISCARDED` and emitting the `changed` event a visible sync-status line
  depends on to notice the queue disappeared,
- the service worker's caches (`clearServiceWorkerCaches()`).

## What is now stored on the device

Offline support is a decision to keep the user's data on their machine, and
that decision deserves its own heading rather than being left for a reader to
discover by inspecting IndexedDB.

**A cached page is not an empty shell.** The service worker caches
navigation *responses*, and this app dehydrates real query results into its
SSR HTML. A cached `/timer` therefore contains actual entries, actual titles,
actual notes — not a loading skeleton waiting to be filled in. IndexedDB
holds two more things beside it: the query snapshots (the same real data,
keyed by query) and the outbox journal (whatever has been typed or done
offline and not yet sent).

**All of it lives in the browser profile of whoever is using the machine.**
It survives until sign-out clears it (`clearLocalData`, above) or the browser
profile itself is cleared by some other means.

**A sign-out that never happens leaves it there.** A shared or lost device
keeps whatever was last cached, indefinitely. That is the ordinary bargain
every offline-capable app makes — the alternative is not caching anything,
which is not offline support — not a defect in this one, but it is a bargain
the reader should be told plainly rather than have to infer from the code.

**What is not stored: no credentials, no tokens.** The remembered signed-in
flag written to `localStorage` is a boolean, nothing more, and it is a UX
guard rather than a security boundary — every Convex function still checks
the actual session itself on every call, offline-remembered flag or not.

## Testing it locally

```bash
pnpm build && pnpm preview
```

`pnpm dev` does not register the service worker at all (see above), so
offline behavior has to be checked against a production build. Open the
preview URL, sign in and load at least one page online — the service worker
only serves what it has already cached or dehydrated — then in DevTools:
**Application → Service Workers → Offline**, or the **Network** panel's
offline throttling. Reload; the last-visited page should render with real
data. Navigate to a route never opened this session and it should show the
"not opened on this device yet" message rather than hang.

## The macOS risk

The service worker has been verified working on **Windows, under
WebView2** — WebView2 is Chromium, and service workers there behave exactly
as they do in a desktop browser.

**It has not been verified on macOS.** `docs/desktop.md`'s Tauri shell uses
WKWebView on macOS, and whether WKWebView supports a service worker
registered against a **remote** `https://` origin — as opposed to a bundled,
local one — is an open question that nobody has checked on real hardware.
Until someone does, the desktop app must not be described as offline-capable
on macOS. See `docs/desktop.md`'s "Offline, or chroneli.com down" section.
