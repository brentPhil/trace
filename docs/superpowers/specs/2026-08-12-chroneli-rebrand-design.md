# Rebrand Trace to Chroneli

The product is renamed from Trace to Chroneli, and a newly purchased domain,
chroneli.com, becomes its home. This spec covers the rename and prepares the
domain cutover; it does not perform the cutover.

## Decisions

Three questions were settled before design:

**Scope.** User-visible copy plus infrastructure names. The Convex project and
its deployment keep their current names — the deployment URL is internal, and
renaming it churns environment variables across two deployments for no reader's
benefit. The internal `TraceError*` identifiers also stay.

**Domain.** Code and docs prepare for chroneli.com; nothing points at it yet.
Attaching a custom domain and editing DNS are dashboard actions on the owner's
Cloudflare account, and Better Auth derives its `baseURL` from the `SITE_URL`
environment variable ([convex/auth.ts:14](../../../convex/auth.ts)). Pointing
`SITE_URL` at a domain that does not yet resolve breaks sign-in and password
reset. Order matters, so the cutover is a runbook the owner executes.

**Approach.** Centralize rather than find-and-replace. The rename touches ~20
sites only because the name is copy-pasted; eleven route files each hardcode
their own title suffix. Collapsing that duplication is a targeted improvement to
code this change already has to touch.

## The brand module

A new `convex/lib/brand.ts`, addressed as `@shared/brand`:

```ts
export const APP_NAME = "Chroneli"
export const APP_DOMAIN = "chroneli.com"

export function pageTitle(page?: string) {
  return page ? `${page} — ${APP_NAME}` : APP_NAME
}
```

It lives in `convex/lib/` rather than `src/lib/` because
[convex/email.ts](../../../convex/email.ts) needs `APP_NAME` and Convex
functions cannot import from `src`. The `@shared/*` alias already maps to
`convex/lib/*` from both TypeScript projects, which is how `@shared/day` and
`@shared/codes` are shared today. This module joins that layer: pure data and
pure functions, no Convex imports, safe on both sides.

`pageTitle` takes the page name and owns the separator, so the em-dash
convention is defined once instead of eleven times.

## What changes

**Titles — 12 files.** Ten static `head()` blocks become `pageTitle("Timer")`
and so on: `login`, `signup`, `forgot-password`, `reset-password`, and the
`_authed` routes `timer`, `projects`, `invoices`, `invoices_.new`, `reports`,
`settings`. [__root.tsx:43](../../../src/routes/__root.tsx) takes bare
`pageTitle()`. The conditional title in
[invoices_.$invoiceId.tsx:48](../../../src/routes/_authed/invoices_.$invoiceId.tsx)
keeps its either/or shape, with both branches routed through the helper.

**Wordmark — 3 files.** [auth-shell.tsx:37](../../../src/components/auth-shell.tsx),
[index.tsx:38](../../../src/routes/index.tsx), and
[app-sidebar.tsx](../../../src/components/shell/app-sidebar.tsx) — the last both
as visible text and as the `aria-label` — render `{APP_NAME}` instead of a
literal.

**Email — 1 file.** [convex/email.ts](../../../convex/email.ts) uses `APP_NAME`
in the `EMAIL_FROM` default, the subject line, and the HTML body heading. The
sender address stays `onboarding@resend.dev` until chroneli.com is verified in
Resend; only the display name changes now. Changing the address before
verification would fail delivery silently, which is exactly the failure mode a
password reset cannot afford.

**Tests — 2 files.** Three assertions hardcode the old suffix:
[-invoice-record.test.tsx:398](../../../src/routes/_authed/-invoice-record.test.tsx)
and `:401`, and
[-invoice-new.test.tsx:844](../../../src/routes/_authed/-invoice-new.test.tsx).
They assert the composed string, not the helper, so they keep testing what a
user actually sees in the tab.

**Manifest and README.** [public/manifest.json](../../../public/manifest.json)
was never branded — it still carries the scaffold's "TanStack App" and "Create
TanStack App Sample". It gets the real name and the description already written
in DESIGN.md. [README.md](../../../README.md) is likewise the untouched template
readme and gets a real project header.

**Docs.** DESIGN.md's `name:` frontmatter becomes Chroneli. Prose in PRODUCT.md
and DESIGN.md that names the product is renamed. Historical specs and plans
under `docs/superpowers/` are left alone: they are dated records of what was
decided at the time, and rewriting them would falsify that history.

**Infrastructure names.** `name` becomes `chroneli` in
[package.json](../../../package.json), [wrangler.jsonc](../../../wrangler.jsonc),
and the two configurations in
[.claude/launch.json](../../../.claude/launch.json).

## Known seam

Comments that name the *product* are renamed. Comments that name the *code
construct* `isTraceError` are not, because the identifiers themselves are out of
scope. A Chroneli codebase will therefore contain `TraceErrorCode`,
`TraceErrorData`, `isTraceError`, and `traceErrorCode`, exported from
`@shared/codes` and consumed in `src/lib/error-message.ts` and
`src/lib/invoice-draft.ts`.

This is a deliberate deferral, not an oversight. Renaming them is a mechanical
rename across a small, well-typed surface that the compiler verifies
completely — worth doing as its own commit, where the diff is obviously
behaviour-preserving and not tangled with copy changes.

## The Worker rename is a new Worker

Changing `name` in `wrangler.jsonc` does not rename the deployed Worker. The
next deploy creates a second Worker called `chroneli`; the existing `trace`
Worker stays live, serving the old code at `trace.<subdomain>.workers.dev`,
until it is deleted from the Cloudflare dashboard. Editing the file back does
not undo this.

That is acceptable here because chroneli.com will front the new Worker, but the
old one must be deleted deliberately rather than abandoned — an orphaned Worker
serving a stale copy of a time tracker is a live app with real-looking data at a
URL nobody is watching.

## Cutover runbook

To be executed by the owner, in this order. Each step is safe to stop after.

1. **Add the domain to Cloudflare** and confirm the nameservers are active, so
   chroneli.com resolves.
2. **Deploy.** This happens on its own: Cloudflare Workers Builds deploys on
   push, so merging the rebrand creates the `chroneli` Worker without anyone
   asking it to. Step 1 is not a prerequisite — the new Worker is reachable at
   its workers.dev URL and behaves exactly as `trace` did, because nothing yet
   depends on the new domain. Confirm this build succeeded before continuing.
3. **Attach the custom domain** chroneli.com to the `chroneli` Worker. Verify
   the app loads over the domain before touching auth.
4. **Repoint auth.** Set `SITE_URL` to `https://chroneli.com` on the Convex
   production deployment, and `VITE_SITE_URL` for the build. Sign in and run one
   password reset end to end. Until this step, auth still works against the old
   URL; after it, the new domain is authoritative.
5. **Verify chroneli.com in Resend**, then set `EMAIL_FROM` to
   `Chroneli <noreply@chroneli.com>`. Send one reset to confirm delivery from
   the new sender.
6. **Delete the `trace` Worker** once chroneli.com has served traffic
   successfully.

Steps 4 and 5 are the ones that can break a working app; both are single
environment variables and both are reversible by setting the old value back.

Outside this repository, and left to the owner's judgement: the GitHub
repository name `brentPhil/trace`, and the local working directory.

## Verification

- `pnpm typecheck` — both projects, since the shared module crosses them.
- `pnpm test` — the three updated title assertions must pass.
- `pnpm build` then `wrangler deploy --dry-run` — proves the renamed config
  still resolves its entry point and reads the assets directory.
- A grep for `Trace` confirming every remaining hit is either a `TraceError*`
  identifier, a comment naming one, a dated document under `docs/superpowers/`,
  or an unrelated word such as "tracking".
