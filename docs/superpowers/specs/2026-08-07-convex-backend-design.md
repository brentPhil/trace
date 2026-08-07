# Convex as backend and database for `trace`

Date: 2026-08-07
Status: Approved

## Goal

Wire Convex into the existing TanStack Start scaffold as the backend and database,
with authenticated server-side rendering and live queries. No application tables
yet — plumbing only, verifiable end to end.

## Decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Client integration | `@convex-dev/react-query` + TanStack Query via `@tanstack/react-router-ssr-query` | One query definition server-renders through the route loader and upgrades to a live websocket subscription on the client. |
| Auth | Better Auth (`@convex-dev/better-auth`) | See below. |
| App schema | Empty `defineSchema({})` | Requested. Better Auth is a Convex *component*, so its tables live in the component's namespace, not the app schema. |
| Provisioning | Existing Convex project | Already created in the Convex dashboard. |

### Why not Convex Auth

`@convex-dev/auth` (0.0.94) is beta and documents support for client-side React
SPAs and React Native only. Server-side framework support is listed as under
active development, and TanStack Start is not listed.

Pairing it with SSR would mean public data server-renders but authenticated data
cannot, because the server holds no identity — every authenticated route would
fall back to a client-side loading flash, defeating the SSR integration.

Better Auth is the path Convex documents for TanStack Start. It is a library plus
a Convex component, not a hosted service: users and sessions live in this
project's own Convex deployment.

## Architecture

Three layers:

- **Data plane.** `ConvexQueryClient` is registered as TanStack Query's `queryFn`
  and `queryKeyHashFn`. `setupRouterSsrQueryIntegration` handles dehydrate/hydrate.
- **Auth plane.** Better Auth runs inside the Convex deployment. The browser talks
  to `/api/auth/$`, a TanStack Start server route proxying to Convex, which
  exchanges a session cookie for a JWT.
- **SSR seam.** The root route's `beforeLoad` calls a `getToken()` server function
  and pushes the token into `convexQueryClient.serverHttpClient`. This is what
  makes authenticated data server-render.

Request flow for an authenticated page:

```
request -> beforeLoad -> getToken() (cookie -> JWT)
        -> serverHttpClient.setAuth(token)
        -> loader ensureQueryData -> Convex query runs with identity
        -> HTML streamed with real data
        -> hydrate -> ConvexBetterAuthProvider -> websocket -> live updates
```

## Dependencies

Runtime:

- `convex` (>= 1.25.0 required by the component; latest is 1.43.0)
- `@convex-dev/react-query`
- `@tanstack/react-query`
- `@convex-dev/better-auth`
- `better-auth@~1.6.15` (component peer range: `>=1.6.11 <1.7.0`)

Already present: `@tanstack/react-router-ssr-query` (unused until now), `@types/node`.

## Files created

**`convex/`**

- `convex.config.ts` — `app.use(betterAuth)` from `@convex-dev/better-auth/convex.config`
  (the non-local install; the local-install variant under `convex/betterAuth/` is
  not used)
- `auth.config.ts` — `providers: [getAuthConfigProvider()]`
- `auth.ts` — `authComponent = createClient<DataModel>(components.betterAuth)`,
  `createAuth(ctx)` with email+password enabled and `requireEmailVerification: false`,
  plus a `getCurrentUser` query
- `http.ts` — `authComponent.registerRoutes(http, createAuth)`
- `schema.ts` — `defineSchema({})`, no app tables
- `healthcheck.ts` — a query returning a constant, no table access

**`src/`**

- `lib/auth-client.ts` — `createAuthClient({ plugins: [convexClient()] })`
- `lib/auth-server.ts` — `convexBetterAuthReactStart({ convexUrl, convexSiteUrl })`;
  `basePath` omitted, defaults to `/api/auth`
- `routes/api/auth/$.ts` — GET/POST proxy to `handler`

## Files modified

- **`src/router.tsx`** — construct `ConvexQueryClient` with `expectAuth: true`,
  build `QueryClient` with the Convex `hashFn`/`queryFn`, call
  `convexQueryClient.connect(queryClient)`, pass both into router context, call
  `setupRouterSsrQueryIntegration`.
- **`src/routes/__root.tsx`** — `createRootRoute` becomes
  `createRootRouteWithContext<{ queryClient; convexQueryClient }>`, add `beforeLoad`
  with the `getAuth` server function, add a root `component` that wraps `<Outlet/>`
  in `ConvexBetterAuthProvider`.
- **`vite.config.ts`** — add `ssr: { noExternal: ['@convex-dev/better-auth'] }`.
  Without it, SSR module resolution fails.
- **`tsconfig.json`** — exclude `convex/`, which gets its own generated tsconfig
  with different `lib`/`module` settings.
- **`package.json`** — new dependencies.

- **`eslint.config.js`** — ignore `convex/**`, since excluding it from the root
  tsconfig leaves the typed-lint project service unable to resolve those files.
  `npx convex dev` typechecks them against `convex/tsconfig.json` instead.
- **`.gitignore`** — add `!.env.example` so the template escapes the `.env*` rule.
- **`.env.example`** — new, documents the four local variables and calls out the
  two that belong on the deployment instead.

### Deviations from the published guide

1. **Root route shape.** The guide targets `@tanstack/react-router` ~1.140 and
   puts `<html>`/`<body>` in a root `component`. This project is on 1.170.22,
   whose scaffold uses `shellComponent` for the document. The `shellComponent`
   is kept as the document shell, and the provider is added via a root
   `component` wrapping `<Outlet/>`.

2. **`authClient` cast.** `ConvexBetterAuthProvider`'s `authClient` prop is typed
   as `createAuthClient<BetterAuthClientPlugin & { plugins }>`, an intersection
   that a client built exactly as the guide shows does not satisfy under
   `strict`. The upstream example never runs `tsc` over `src/` — its
   `dev:backend` script only passes `--typecheck-components`, which covers
   `convex/` — so the typing is unexercised upstream. Worked around with a
   narrow `as unknown as AuthClient` cast at the single call site. Runtime is
   unaffected. Revisit above `@convex-dev/better-auth` 0.12.5.

## Environment

`.env.local` — gitignored by the existing `.env*` rule. First two written by
`npx convex dev`:

| Variable | Value |
| --- | --- |
| `CONVEX_DEPLOYMENT` | written by `convex dev` |
| `VITE_CONVEX_URL` | written by `convex dev`, `.convex.cloud` |
| `VITE_CONVEX_SITE_URL` | same host, `.convex.site` |
| `VITE_SITE_URL` | `http://localhost:3000` |

Set on the **deployment**, because Convex functions cannot read the local
`.env.local`:

```
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000
```

This local/deployment split is the most common setup error with this stack.

## Verification

All items below were run against dev deployment `acoustic-ibis-909` and passed.

1. `pnpm typecheck` clean.
2. `npx convex dev --once` deploys without error; `convex run healthcheck:get`
   returns `{ ok: true, backend: "convex" }`.
3. `/` server-renders the healthcheck payload — confirmed by fetching the raw
   HTML rather than inspecting the DOM, so this proves SSR and not hydration.
4. `GET /api/auth/ok` returns `{"ok":true}` through the proxy route, confirming
   TanStack Start -> Convex -> Better Auth round-trips.
5. Sign-up over the proxy succeeds and the session persists via cookie.
6. **Authenticated SSR confirmed.** The same URL, fetched with and without the
   session cookie, returns different server-rendered HTML: the signed-out
   response contains the sign-up form, the signed-in response contains
   `Signed in as setup-verify@example.test`. Authenticated data reaches the
   HTML with no client-side loading pass.

A request with no `Origin` header is rejected with `MISSING_OR_NULL_ORIGIN`,
so Better Auth's CSRF protection is active.

### Verification scaffolding note

`AuthPanel` reads the user through `convexQuery(api.auth.getCurrentUser)` rather
than `authClient.useSession()`. The latter is a client-only hook and renders a
placeholder during SSR, which would have hidden whether authenticated SSR was
working at all. `convex/auth.ts` therefore uses `safeGetAuthUser`, which returns
null when signed out instead of throwing.

### Test data left behind

Sign-up verification created a user in the dev deployment:
`setup-verify@example.test`. Delete it from the Convex dashboard when no longer
needed.

## Known caveats

- `expectAuth: true` is required for a seamless initial render, and only affects
  the period before initial authentication. Convex recommends reloading the page
  on sign-out, otherwise authenticated queries may fire before auth is ready.
- An open issue reports the SSR auth check re-running on client navigations, not
  only initial load. A latency wart, not a correctness bug.
- Convex's TanStack Start support is labeled Release Candidate and
  `@convex-dev/react-query` is at 0.1.0. Expect API churn.

## Out of scope

Sign-in and sign-up UI beyond what verification requires, application tables,
`convex-test` suites, OAuth social providers, email verification and the
associated email sending.
