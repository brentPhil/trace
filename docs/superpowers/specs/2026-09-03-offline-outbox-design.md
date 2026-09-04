# Offline: persistent outbox plus cached reads

**Status:** approved in conversation on 2026-09-03. Chosen over a full
local-first sync engine (curvilinear, Replicate, or a home-grown one) because
those replace the tested server layer to solve a problem this product mostly
does not have; see the conversation record for the comparison.

## Goal

The app keeps working with no network — start, stop, retitle, note, edit
times, delete and restore entries; create and edit projects and tags; change
settings; read history, reports and invoices from the last snapshot — and
everything written offline reaches the server, in order, when the connection
returns. A reload or a relaunch while offline loses nothing and boots to a
usable app.

## What exists today

- Entry creates and invoice creates carry a client-minted UUIDv7 `clientKey`
  that makes them idempotent on the server (`by_user_clientKey` index).
- Every timer-bar and log mutation has a Convex optimistic update, applied
  through Convex's own `OptimisticLocalStore` and pushed into the TanStack
  Query cache by `@convex-dev/react-query`.
- `src/lib/pending-start.ts` journals ONE mutation (start) to localStorage and
  replays it on boot. Its comment names the general queue as the fast-follow.
- Convex buffers unsent mutations in memory while the socket is down and
  replays them on reconnect. That buffer, and the query cache, die on reload.
- No service worker. The desktop app is a Tauri window that loads
  `https://chroneli.com` as a real origin (`docs/desktop.md`), so a service
  worker registered by the site covers it too.

## Design

### 1. The outbox

One persistent, ordered journal of write intents ("ops") in IndexedDB, and one
path every offline-capable mutation goes through, online or not:

1. The op is written to the journal.
2. Its optimistic update is applied so the screen changes at once.
3. The sender hands ops to Convex one at a time, in order, awaiting each
   acknowledgement before sending the next. An acknowledged op is removed.

On boot the journal is loaded, every op's optimistic update is re-applied
(they are idempotent by construction), and the sender resumes.

**Dependencies.** An op may reference an id the server has not minted yet — a
project created offline, an entry started offline. Such an op carries the
placeholder id (`optimistic:<clientKey>`, the same placeholder the optimistic
row already uses). When the producing op is acknowledged, the outbox records
`placeholder → real id` and rewrites later ops before sending them. Because
sending is sequential and the producer always precedes its dependents, a
dependent never reaches the sender unresolved unless its producer was dropped,
in which case it is dropped too.

**Coalescing.** Consecutive unsent ops of the same kind on the same target
(a retitle, a note, a settings field) collapse into one, so typing offline
replays as one write.

**Rejections.** Convex's mutation promise does not reject on a network
failure; it waits. It rejects when the server refuses. A refusal drops the op
and its dependents, and a toast names what was lost using the op kind's label.
The one exception is `UNAUTHENTICATED`, which leaves the op in place and pauses
the sender until the connection or the auth state changes.

**Stale starts.** An `entries.start` older than 24 hours that no later
stop/discard/start in the journal closes is not replayed; it is dropped and
reported. This preserves `pending-start`'s existing rule.

**Instants travel with the op, and so does the name.** `stop` records
`endedAt` at enqueue time (it used to let the server use "now"), so a stop
replayed hours later closes the entry at the moment the user pressed it. It
also carries the id of the entry it is stopping, because the instant alone
cannot distinguish a replayed stop from a backwards clock — and the backwards
clock must still stop the timer. `discardRunning` carries the same name, where
the stakes are higher still: it deletes rather than closes.

**One sender across tabs.** The sender runs under a Web Lock, so two tabs
never double-send. Ops are idempotent anyway: entry and project creates by
`clientKey`, tag ensure by name, patches by value.

### 2. One optimistic function, two stores

Convex's `OptimisticLocalStore` only patches queries it has loaded from the
server, so on an offline boot it has nothing to patch. Rather than add a
second optimistic mechanism, the same optimistic function each mutation
already has runs against a small adapter that implements Convex's
`OptimisticLocalStore` interface over the TanStack cache
(`getQuery`/`getAllQueries`/`setQuery` → `getQueryData`/`findAll`/`setQueryData`).

- Offline: the adapter is what changes the screen, and the changed cache is
  what gets persisted.
- Online: the op is also handed to Convex with the same function as its
  `optimisticUpdate`, so Convex's store carries it into the server's ordering,
  and the server's answer replaces both.

The optimistic functions move out of the hooks into pure modules under
`src/lib/offline/`, keyed by op kind in one registry. The hooks become thin.

### 3. Cached reads: a snapshot layer in the query function

Every successful Convex query result in the TanStack cache is written through
to IndexedDB, keyed by TanStack's query hash. The default `queryFn` is wrapped:
when the socket is not connected and a snapshot exists for the key, the
snapshot is returned at once; otherwise Convex's own query function runs.
`@convex-dev/react-query` marks its queries never-stale, so a restored result
renders without a refetch, and its subscription (created when the query is
added to the cache) replaces it the moment the socket delivers.

This is deliberately NOT TanStack's `persistQueryClient`: that hydrates every
persisted key at boot, and `@convex-dev/react-query` opens a live subscription
for every query added to the cache, so hundreds of old report ranges would
become live subscriptions on every reconnect. The snapshot layer restores only
what is asked for.

Snapshots older than 30 days are pruned at boot. All snapshots are cleared on
sign-out.

**The timer log.** It reads through Convex's `usePaginatedQuery`, which the
TanStack cache never sees. It moves to a small hook, `useConvexPages`, that
holds a page count and subscribes to one `convexQuery(listPage, …)` per page,
chaining each page's cursor from the previous page's `continueCursor`. The
existing optimistic patches walk pages by function name and carry over
unchanged. On a fresh boot the hook starts at one page, so the offline log
shows the newest page and everything cached in range queries; older pages load
when online.

### 4. Booting offline

- **Service worker**, hand-written and built by a second Vite entry
  (`vite.sw.config.ts` → `dist/client/sw.js`), because `vite-plugin-pwa` does
  not run under TanStack Start's build. Routing rules, as a pure function:
  non-GET and cross-origin → bypass; `/api/*`, `/_serverFn/*`, `/sw.js` →
  bypass; navigations → network first, on failure the cached copy of that
  URL, then the last cached page shell, then a tiny inline offline page;
  `/assets/*` → cache first (hashed, immutable); other same-origin GETs →
  stale-while-revalidate. Registered only in production builds. Caches are
  cleared on sign-out.
- **Auth.** The root route's `beforeLoad` calls a server function for the
  token. When that call THROWS in the browser (the server was unreachable),
  the route falls back to a remembered signed-in flag in localStorage and
  marks the boot as offline. A server that answers "no token" is never
  overridden. On an offline boot the Better Auth session fetch also fails, so
  the Convex socket stays paused; when the `online` event fires after such a
  boot, the page reloads to pick up a real session. The outbox and the
  snapshots survive the reload.
- **A route whose data was never cached.** Its loader waits on a query that
  cannot resolve; the `_authed` route's `pendingComponent` reads the
  connection state and says the page has not been opened on this device yet
  and will load when back online.
- **Desktop.** On Windows the WebView2 engine is Chromium and the worker works
  as in a browser. On macOS, WKWebView's support for service workers on a
  remote `https` origin must be verified on a real machine before the desktop
  is described as offline-capable there. `docs/desktop.md`'s "Offline" section
  is updated to say so.

### 5. Online-only surfaces

Disabled while offline, each with a sentence saying why (never hidden):

- Raising an invoice (invoice numbers must be unique; two devices offline
  would each mint one).
- Logo and music uploads (file storage needs the network).
- Google Calendar connect/disconnect and its per-calendar settings.
- Sign out (a session cannot be ended offline, and pending changes would be
  orphaned). Also disabled while the outbox is non-empty.

"Online" is `navigator.onLine` AND the Convex socket connected, with a small
allowance before the first connection so the status does not flash at boot.

### 6. Server changes

- `projects` gains optional `clientKey` and a `by_user_clientKey` index;
  `projects.create` accepts `clientKey` and returns the existing row on a
  replay, exactly as `entries.start` does.
- `entries.stop` and `entries.discardRunning` take an optional `entryId`. Given
  one they act on that entry alone, and only while it is running; omitted, they
  behave exactly as they do today. This is what stops a replayed stop from
  ending — or a replayed discard from deleting — a timer another device started
  in the meantime. A timestamp guard was tried first and rejected: it cannot be
  told apart from a backwards clock, which `convex/entries.test.ts` requires
  still stop the timer.

Clients need nothing: the client never creates or edits them. Tags dedupe by
name already.

### 7. Conflicts

Same user, two devices, last write wins on the server, which is already the
model. Two devices both starting a timer offline is resolved by the server's
existing rule that a start closes whatever was running, clamped forward past
it.

### 8. Status surface

A line in the shell, in the same register as `RunawayBanner` (`role="status"`,
never colour alone): a glyph plus text — "Offline. N changes will sync when
you're back." while offline; "Syncing N changes…" while online with pending
ops; "All changes saved" for two seconds after the count returns to zero.

### 9. Testing

- Outbox engine, placeholder rewriting, coalescing, staleness, the TanStack
  adapter, the snapshot layer, the service-worker routing function and the
  online predicate are pure modules with in-memory stores, tested in the
  `unit` project. IndexedDB stores are tested with `fake-indexeddb`.
- The optimistic-entries module inherits the hook test's fake store.
- The idempotent project create and the stop rule get Convex function tests.
- Existing hook tests mock `useOutboxMutation` instead of
  `useConvexMutation`.

## Out of scope

- Offline playback of uploaded music (Convex storage is cross-origin).
- Any change to invoices, Google, or music mutations.
- macOS verification of the service worker (recorded as a risk).
