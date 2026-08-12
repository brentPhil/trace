# Chroneli Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product from Trace to Chroneli across all user-visible copy and infrastructure names, with the brand defined in one module rather than copy-pasted.

**Architecture:** A new pure module `convex/lib/brand.ts` — reachable as `@shared/brand` from both the client and Convex — exports `APP_NAME` and a `pageTitle()` helper. Every title, wordmark, and email string reads from it. Infrastructure names are renamed in place. Nothing points at chroneli.com yet; the domain cutover is a runbook in the spec, executed by hand.

**Tech Stack:** TypeScript, React 19, TanStack Start/Router, Convex, Vitest (three projects: `unit`/node, `dom`/jsdom, `convex`/edge-runtime), Cloudflare Workers via Wrangler.

**Spec:** [2026-08-12-chroneli-rebrand-design.md](../specs/2026-08-12-chroneli-rebrand-design.md)

## Global Constraints

- The product name is exactly `Chroneli`. The domain is exactly `chroneli.com`.
- Page titles keep the existing separator: an em dash with spaces, `Timer — Chroneli`. Not a hyphen, not an en dash.
- The `TraceError*` identifiers (`TraceErrorCode`, `TraceErrorData`, `isTraceError`, `traceErrorCode` in `convex/lib/codes.ts`) are OUT OF SCOPE. Do not rename them. Comments that name those identifiers keep saying "Trace"; comments that name the product become "Chroneli".
- Dated documents under `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical records. Do NOT rewrite Trace to Chroneli in them. The only exception is this plan and its spec, which are about the rename.
- The Convex project and deployment names do NOT change.
- The email sender ADDRESS stays `onboarding@resend.dev`. Only its display name changes. Changing the address before chroneli.com is verified in Resend breaks password-reset delivery silently.
- `convex/lib/` is the pure shared layer: no Convex imports, no React, no `process.env`. It must run in the `unit` (node) Vitest project.
- Run `pnpm format` before committing if Prettier would reformat a touched file; `pnpm check` must stay green.

---

### Task 1: The brand module

Defines the single source of truth every later task consumes.

**Files:**
- Create: `convex/lib/brand.ts`
- Test: `convex/lib/brand.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `APP_NAME: string` (`"Chroneli"`) and `pageTitle(page?: string): string` returning `` `${page} — Chroneli` `` when given a page and `"Chroneli"` when called bare. Importable as `@shared/brand` from `src/**` and `convex/**`, or as `./brand` from siblings in `convex/lib/`.

> The spec listed an `APP_DOMAIN` export. It is deliberately omitted: no task consumes it, because the domain cutover is env-var work outside the codebase. Adding an export with no caller is dead weight — introduce it when something needs it.

- [ ] **Step 1: Write the failing test**

Create `convex/lib/brand.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { APP_NAME, pageTitle } from "./brand"

describe("pageTitle", () => {
  it("suffixes the page with the product name", () => {
    expect(pageTitle("Timer")).toBe("Timer — Chroneli")
  })

  it("is the product name alone when there is no page", () => {
    expect(pageTitle()).toBe(APP_NAME)
  })

  it("uses an em dash with spaces, not a hyphen", () => {
    expect(pageTitle("Reports")).toContain(" — ")
  })
})

describe("brand constants", () => {
  it("names the product", () => {
    expect(APP_NAME).toBe("Chroneli")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm vitest run convex/lib/brand.test.ts
```

Expected: FAIL — cannot resolve `./brand`.

- [ ] **Step 3: Write the implementation**

Create `convex/lib/brand.ts`:

```ts
/*
 * The product's name, in one place.
 *
 * Page titles, the wordmark and the password-reset email all read from here,
 * so renaming the product is this file rather than a sweep through twenty
 * call sites — which is what the previous name cost.
 *
 * It lives in the shared layer, not `src/lib`, because `convex/email.ts`
 * needs the name too and Convex functions cannot import from `src`.
 */

export const APP_NAME = "Chroneli"

/*
 * The em dash and its spaces are the convention every route title follows.
 * Defining it here is the point: eleven routes previously spelled it out
 * individually, and a separator that drifts between tabs looks like a bug.
 */
export function pageTitle(page?: string) {
  return page ? `${page} — ${APP_NAME}` : APP_NAME
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run convex/lib/brand.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/brand.ts convex/lib/brand.test.ts
git commit -m "feat(brand): one module owns the product name"
```

---

### Task 2: Page titles

**Files:**
- Modify: `src/routes/__root.tsx:43`
- Modify: `src/routes/login.tsx:6`, `src/routes/signup.tsx:6`, `src/routes/forgot-password.tsx:15`, `src/routes/reset-password.tsx:18`
- Modify: `src/routes/_authed/timer.tsx:41`, `src/routes/_authed/projects.tsx:21`, `src/routes/_authed/invoices.tsx:18`, `src/routes/_authed/invoices_.new.tsx:49`, `src/routes/_authed/reports.tsx:99`, `src/routes/_authed/settings.tsx:16`
- Modify: `src/routes/_authed/invoices_.$invoiceId.tsx:34` (comment) and `:46-50` (title)
- Test: `src/routes/_authed/-invoice-record.test.tsx:398,401` and `src/routes/_authed/-invoice-new.test.tsx:844`

**Interfaces:**
- Consumes: `pageTitle` from `@shared/brand`.
- Produces: nothing new.

- [ ] **Step 1: Update the two test assertions to the new expected titles**

In `src/routes/_authed/-invoice-record.test.tsx`, change line 398 from `"Invoice #072726-0013 — Trace"` to `"Invoice #072726-0013 — Chroneli"`, and line 401 from `"Invoice — Trace"` to `"Invoice — Chroneli"`.

In `src/routes/_authed/-invoice-new.test.tsx`, change line 844 from `"New invoice — Trace"` to `"New invoice — Chroneli"`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm vitest run src/routes/_authed/-invoice-record.test.tsx src/routes/_authed/-invoice-new.test.tsx
```

Expected: FAIL — 3 assertions, each `expected "… — Trace" to be "… — Chroneli"`.

- [ ] **Step 3: Convert the ten static titles**

In each of the ten route files, add the import and replace the literal. The import path is `@shared/brand` in every case. For example, `src/routes/_authed/timer.tsx`:

```ts
import { pageTitle } from "@shared/brand"
```

```ts
  head: () => ({ meta: [{ title: pageTitle("Timer") }] }),
```

Apply the same shape to the other nine, preserving each page's own words exactly:

| File | Argument |
| --- | --- |
| `src/routes/login.tsx` | `pageTitle("Sign in")` |
| `src/routes/signup.tsx` | `pageTitle("Create your account")` |
| `src/routes/forgot-password.tsx` | `pageTitle("Reset your password")` |
| `src/routes/reset-password.tsx` | `pageTitle("Choose a new password")` |
| `src/routes/_authed/projects.tsx` | `pageTitle("Projects")` |
| `src/routes/_authed/invoices.tsx` | `pageTitle("Invoices")` |
| `src/routes/_authed/invoices_.new.tsx` | `pageTitle("New invoice")` |
| `src/routes/_authed/reports.tsx` | `pageTitle("Reports")` |
| `src/routes/_authed/settings.tsx` | `pageTitle("Settings")` |

- [ ] **Step 4: Convert the root title**

In `src/routes/__root.tsx`, add `import { pageTitle } from "@shared/brand"` and replace the `title` entry at line 43:

```ts
      {
        title: pageTitle(),
      },
```

- [ ] **Step 5: Convert the conditional invoice title**

In `src/routes/_authed/invoices_.$invoiceId.tsx`, add the import, update the comment on line 34 to name the new product, and route both branches through the helper:

```ts
   * this month's — and "Invoice — Chroneli" twice makes the tab strip useless
   * for exactly that. `loaderData` is undefined while the loader is still in
```

```ts
    meta: [
      {
        title:
          loaderData === undefined
            ? pageTitle("Invoice")
            : pageTitle(`Invoice #${loaderData.number}`),
      },
    ],
```

- [ ] **Step 6: Fix the body copy that names the product**

`src/routes/_authed/invoices_.new.tsx` also renders the name in visible UI, not just its title. At line 539, inside the `<p role="status">` shown when the URL carries no period:

```tsx
          This link carried no period Chroneli could read, so the preview below
```

This is prose a user reads, so it takes the name directly rather than an interpolation — a `{APP_NAME}` in the middle of a sentence would fragment the text node for no benefit, and this file already imports `pageTitle` for its title.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm vitest run src/routes/_authed/-invoice-record.test.tsx src/routes/_authed/-invoice-new.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors from either project.

- [ ] **Step 9: Commit**

```bash
git add src/routes
git commit -m "refactor(brand): route titles read the name instead of spelling it"
```

---

### Task 3: The wordmark

The sidebar carries three brand touchpoints, not one: the accessible name, the collapsed-rail initial, and the full wordmark. The initial is derived from `APP_NAME` so it cannot drift from it.

**Files:**
- Modify: `src/components/shell/app-sidebar.tsx:157-160` (comment), `:163` (aria-label), `:183` (initial), `:186` (wordmark)
- Modify: `src/components/auth-shell.tsx:37`
- Modify: `src/routes/index.tsx:38`

**Interfaces:**
- Consumes: `APP_NAME` from `@shared/brand`.
- Produces: nothing new.

- [ ] **Step 1: Update the sidebar**

In `src/components/shell/app-sidebar.tsx`, add `import { APP_NAME } from "@shared/brand"`.

Update the comment at lines 157-160, which names the old initial:

```tsx
            `aria-label` rather than letting the glyphs below name it: the
            wordmark collapses to its initial, and "C" is not a destination
            anybody can act on. Both spans are decorative here, which also
            makes the name identical in jsdom (no CSS) and in a browser. */}
```

Replace the `aria-label` on line 163:

```tsx
          aria-label={APP_NAME}
```

Replace the collapsed initial at line 183 and the wordmark at line 186:

```tsx
          <span aria-hidden="true" className="hidden group-data-[collapsible=icon]:inline">
            {APP_NAME[0]}
          </span>
          <span aria-hidden="true" className="group-data-[collapsible=icon]:hidden">
            {APP_NAME}
          </span>
```

- [ ] **Step 2: Update the auth shell**

In `src/components/auth-shell.tsx`, add `import { APP_NAME } from "@shared/brand"` and replace line 37:

```tsx
        <span className="text-base font-medium tracking-tight">{APP_NAME}</span>
```

- [ ] **Step 3: Update the landing page**

In `src/routes/index.tsx`, add `import { APP_NAME } from "@shared/brand"` and replace line 38:

```tsx
        <span className="text-base font-medium tracking-tight">{APP_NAME}</span>
```

- [ ] **Step 4: Run the component tests**

```bash
pnpm vitest run --project dom
```

Expected: PASS. The sidebar test asserts the accessible name; it must still find the link now that the label is `{APP_NAME}`. If it fails on a hardcoded `"Trace"`, update that assertion to `"Chroneli"` — that is the test correctly noticing the rename.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/app-sidebar.tsx src/components/auth-shell.tsx src/routes/index.tsx
git commit -m "refactor(brand): the wordmark and its collapsed initial follow the name"
```

---

### Task 4: The password-reset email

There is no test harness for email copy — `resetEmail` is module-private and the only exported entry point sends through Resend. Rather than export an internal purely to assert a string, this task is verified by typecheck and by reading the diff. The strings are derived from `APP_NAME`, so they cannot disagree with the rest of the app.

**Files:**
- Modify: `convex/email.ts:18` (sender), `:22` (text subject), `:36` (HTML heading), `:102` (email subject)

**Interfaces:**
- Consumes: `APP_NAME` from `@shared/brand`.
- Produces: nothing new.

- [ ] **Step 1: Import the name and update the sender default**

In `convex/email.ts`, add the import:

```ts
import { APP_NAME } from "@shared/brand"
```

Replace line 18, keeping the address unchanged:

```ts
const FROM = process.env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`
```

- [ ] **Step 2: Update the three copy strings**

Line 22, in the plain-text body:

```ts
    `Reset your ${APP_NAME} password`,
```

Line 36, in the HTML body:

```ts
      <p style="margin:0 0 16px"><strong>Reset your ${APP_NAME} password</strong></p>
```

Line 102, the subject passed to Resend:

```ts
      subject: `Reset your ${APP_NAME} password`,
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors. The HTML string at line 36 is already a template literal, so `${APP_NAME}` interpolates; confirm the surrounding backticks were not disturbed.

- [ ] **Step 4: Verify no stray old name remains in the file**

```bash
grep -n "Trace" convex/email.ts
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add convex/email.ts
git commit -m "refactor(brand): the reset email signs itself with the shared name"
```

---

### Task 5: Static assets, docs, and product prose

`public/manifest.json` and `README.md` were never branded at all — both still carry the TanStack scaffold's placeholder text. This task gives them real content for the first time, and sweeps the four comments that describe the product by name.

**Files:**
- Modify: `public/manifest.json`
- Modify: `README.md`
- Modify: `DESIGN.md:3` and `:36`
- Modify: `src/components/entries/day-list.tsx:15`, `src/components/ui/calendar.tsx:12`, `src/components/ui/tabs.tsx:31`, `src/lib/export/pdf/invoice-doc.test.ts:84`

**Interfaces:**
- Consumes: nothing (static files cannot import the module).
- Produces: nothing.

- [ ] **Step 1: Replace the manifest's placeholder names**

In `public/manifest.json`, change only the two name fields, leaving icons and colours untouched:

```json
  "short_name": "Chroneli",
  "name": "Chroneli — time tracking that records what was accomplished",
```

- [ ] **Step 2: Give the README a real header**

Replace the first three lines of `README.md` — currently the scaffold's `# TanStack Start + shadcn/ui` and its template blurb — with:

```markdown
# Chroneli

A time tracker that records what was accomplished, not only how long it took.
Built with TanStack Start, React and Convex, and deployed to Cloudflare Workers.
```

Leave the rest of the file's shadcn instructions in place.

- [ ] **Step 3: Update the design document**

In `DESIGN.md`, line 3:

```yaml
name: Chroneli
```

and line 36:

```markdown
# Design System: Chroneli
```

- [ ] **Step 4: Rename the product in the four comments that describe it**

These name the product, not the `TraceError*` identifiers, so they are in scope. Change only the word:

`src/components/entries/day-list.tsx:15`

```
 * with a filter applied, because Chroneli's entries are meaningful one at a time —
```

`src/components/ui/calendar.tsx:12`

```
 * Chroneli's design system — see DESIGN.md. This is a hand-edit of the
```

`src/components/ui/tabs.tsx:31`

```
 * DESIGN.md builds depth out of. `segmented` is the same IDEA in Chroneli's
```

`src/lib/export/pdf/invoice-doc.test.ts:84`

```
   * `A$` and SGD as `SGD `, so a bare `$` on a Chroneli invoice IS unambiguous.
```

Do NOT touch `src/lib/error-message.ts:6`, `src/routes/_authed/-invoice-record.test.tsx:407`, or `convex/lib/codes.ts:102,115`. Those describe the `TraceError` type, which keeps its name.

- [ ] **Step 5: Verify line lengths still satisfy Prettier**

```bash
pnpm check
```

Expected: clean. "Chroneli's" is two characters longer than "Trace's", so a comment that sat near the margin may now exceed it. If Prettier objects, rewrap that comment by hand — it will not rewrap comments for you.

- [ ] **Step 6: Confirm nothing out of scope changed**

```bash
git diff --stat
```

Expected: exactly seven files — the three docs and assets, plus the four comment files. If anything under `docs/superpowers/` appears, revert it: those are dated records and are out of scope.

- [ ] **Step 7: Commit**

```bash
git add public/manifest.json README.md DESIGN.md src/components/entries/day-list.tsx src/components/ui/calendar.tsx src/components/ui/tabs.tsx src/lib/export/pdf/invoice-doc.test.ts
git commit -m "docs(brand): the manifest, readme and comments say what this is"
```

---

### Task 6: Infrastructure names

Renaming the Worker deploys a SECOND Worker rather than renaming the first. The old `trace` Worker stays live until deleted from the Cloudflare dashboard — that deletion is the owner's step 6 in the spec's runbook, not part of this task.

**Files:**
- Modify: `package.json:2`
- Modify: `wrangler.jsonc` (the `name` field)
- Modify: `.claude/launch.json` (both configuration names)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Rename the package**

In `package.json`, line 2:

```json
  "name": "chroneli",
```

- [ ] **Step 2: Rename the Worker**

In `wrangler.jsonc`, change the `name` field to `"chroneli"`. Leave `main`, `compatibility_date`, `compatibility_flags`, and the assets configuration exactly as they are.

- [ ] **Step 3: Rename the launch configurations**

In `.claude/launch.json`, rename the two configurations from `trace` and `trace-dev` to `chroneli` and `chroneli-dev`. Leave every port and URL unchanged.

- [ ] **Step 4: Verify the build still bundles under the new name**

```bash
pnpm build
```

Expected: both client and ssr environments build, ending in `Success` / `built in …`.

- [ ] **Step 5: Verify Wrangler resolves the renamed config**

```bash
npx wrangler deploy --dry-run
```

Expected: output naming the Worker `chroneli`, resolving `main` to the built server entry, and NOT prompting for project setup. A prompt means Wrangler failed to read `wrangler.jsonc`. If it reports needing an `account_id` because the token can see more than one account, add `"account_id"` to `wrangler.jsonc` and re-run — that is expected, not a failure of this task.

- [ ] **Step 6: Commit**

```bash
git add package.json wrangler.jsonc .claude/launch.json
git commit -m "chore(brand): the worker and package answer to chroneli"
```

---

### Task 7: Full verification sweep

**Files:**
- No production changes expected. This task proves the rename is complete and internally consistent.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Run the whole suite**

```bash
pnpm test
```

Expected: all three projects pass.

- [ ] **Step 2: Typecheck both projects**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Confirm formatting is clean**

```bash
pnpm check
```

Expected: `All matched files use Prettier code style!`. If not, run `pnpm format` and amend the relevant commit.

- [ ] **Step 4: Audit every surviving mention of the old name**

```bash
grep -rn "Trace" src convex public README.md DESIGN.md PRODUCT.md --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md"
```

Expected: every remaining hit falls into exactly one of these categories, and nothing else:

- the `TraceError*` identifiers in `convex/lib/codes.ts` and their consumers in `src/lib/error-message.ts` and `src/lib/invoice-draft.ts`
- comments that name those identifiers
- the word "tracking" or "tracks", which merely contains the letters

Any hit that is user-visible copy is a miss — fix it and re-run.

- [ ] **Step 5: Confirm the shared module is genuinely pure**

```bash
grep -nE "convex/|react|process\.env" convex/lib/brand.ts
```

Expected: no output. The module must stay importable from both runtimes.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(brand): sweep the last of the old name"
```

Skip this step if steps 1-5 produced no changes.

---

## After the plan

The code rename is then complete, but the product is NOT yet reachable at chroneli.com. Hand the owner the cutover runbook in the spec — add the custom domain, then `SITE_URL` and `VITE_SITE_URL`, then Resend verification and `EMAIL_FROM`, then delete the orphaned `trace` Worker. Steps 4 and 5 there are the two that can break a working app.

The `TraceError*` identifiers remain, deliberately. Renaming them is a mechanical, compiler-verified change that belongs in its own commit, where the diff is obviously behaviour-preserving.
