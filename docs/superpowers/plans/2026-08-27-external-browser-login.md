# External-Browser Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all Chroneli desktop sign-in out of the embedded webview and into the user's real browser, handing the session back with a Better Auth one-time token.

**Architecture:** The shell binds an ephemeral `127.0.0.1` port, mints a `state` nonce, and opens the system browser at `/desktop-login?port&state`. That route reuses the existing `AuthForm` and points its `redirectTo` back at itself, so both Google and email/password land back on `/desktop-login` authenticated; `beforeLoad` then generates a one-time token and redirects to the loopback URL. The shell's listener validates `state`, hands the token to the webview, which navigates to `/desktop-callback?token=…` and verifies — setting the first-party session cookie on chroneli.com.

**Tech Stack:** better-auth 1.6.26 (`one-time-token` plugin), @convex-dev/better-auth 0.12.5, TanStack Start/Router, React 19, Convex, vitest + convex-test, Tauri 2, `tauri-plugin-opener`, Rust `std::net`.

## Global Constraints

- Production origin is exactly `https://chroneli.com`.
- Loopback host is the literal `127.0.0.1` — **never** `localhost` (RFC 8252 §8.3).
- Token expiry: `oneTimeToken({ expiresIn: 2 })` (2 minutes). Single use.
- Port must validate as an integer in 1024–65535 before use; the loopback URL is CONSTRUCTED, never taken whole from the query string.
- The `state` nonce is mandatory on both ends. A mismatch discards the token.
- **Any new Tauri command MUST be added to the `build.rs` app manifest AND explicitly allowed in `src-tauri/capabilities/default.json`.** A command missing from that list is silently rejected for the remote origin — that exact omission made the tray inert for the whole previous branch.
- No failure path may be swallowed. `.catch(() => {})` is banned in this feature.
- Do not modify the plain-web login behavior (`src/routes/login.tsx` `beforeLoad`) or `AuthForm`'s existing props.
- Repo conventions: components must not import `convex/_generated/api` (eslint-enforced); substantial explanatory comments in the register of `src/hooks/use-latest.ts`.
- Commit style: `feat(scope): lowercase sentence`, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Branch: `feat/desktop-app`. Do not switch branches. Nothing is pushed.
- Toolchain: pnpm; cargo needs `export PATH="$PATH:$HOME/.cargo/bin"`. Never run `pnpm tauri dev` in an agent — it opens a window and blocks.

---

### Task 1: Enable the one-time-token plugin

**Files:**
- Modify: `convex/auth.ts` (the `plugins: [...]` array, ~line 128)
- Modify: `src/lib/auth-client.ts`
- Test: `convex/oneTimeToken.test.ts`

**Interfaces:**
- Produces: HTTP endpoints `POST /api/auth/one-time-token/generate` and `POST /api/auth/one-time-token/verify` (proxied to Convex by `src/routes/api/auth/$.ts`), and client methods `authClient.oneTimeToken.generate()` / `authClient.oneTimeToken.verify({ token })`.

- [ ] **Step 1: Write the failing test** `convex/oneTimeToken.test.ts`. Read `convex/entries.test.ts` first and mirror its convex-test harness rather than inventing one.

```ts
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"

describe("one-time-token plugin", () => {
  it("is registered on the auth instance", async () => {
    const { createAuth } = await import("./auth")
    const t = convexTest(schema)
    await t.run(async (ctx) => {
      const auth = createAuth(ctx as never)
      // The plugin contributes these endpoints; their absence means it never
      // made it into the array.
      expect(auth.api.generateOneTimeToken).toBeDefined()
      expect(auth.api.verifyOneTimeToken).toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run convex/oneTimeToken.test.ts`
Expected: FAIL — `generateOneTimeToken` is undefined.

- [ ] **Step 3: Register the plugin.** In `convex/auth.ts`, add the import beside the existing `convex` plugin import:

```ts
import { oneTimeToken } from "better-auth/plugins/one-time-token"
```

and extend the plugins array (currently `plugins: [convex({ authConfig })]`):

```ts
    plugins: [
      // Required for Convex compatibility.
      convex({ authConfig }),
      /*
       * The desktop shell's session handoff.
       *
       * Two minutes rather than the three-minute default: the token travels
       * through a browser redirect into a loopback listener that is already
       * running and waiting, so the window between mint and redeem is seconds.
       * A token that grants a full session should not outlive its purpose.
       *
       * Storage needs no schema work — the plugin writes through
       * `createVerificationValue` / `consumeVerificationValue` on the standard
       * `verification` table, which the Convex Better Auth component already
       * defines with `identifier` / `value` / `expiresAt`.
       */
      oneTimeToken({ expiresIn: 2 }),
    ],
```

- [ ] **Step 4: Add the client plugin.** In `src/lib/auth-client.ts` add the import:

```ts
import { oneTimeTokenClient } from "better-auth/client/plugins"
```

and extend the plugins array to `plugins: [convexClient(), oneTimeTokenClient()]`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run convex/oneTimeToken.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: clean, both tsconfigs.

- [ ] **Step 6: Commit**

```bash
git add convex/auth.ts convex/oneTimeToken.test.ts src/lib/auth-client.ts
git commit -m "feat(auth): a one-time token the desktop shell can trade for a session"
```

---

### Task 2: `/desktop-login` — the browser side of the handoff

**Files:**
- Create: `src/lib/desktop-handoff.ts`
- Create: `src/routes/desktop-login.tsx`
- Test: `src/lib/desktop-handoff.test.ts`

**Interfaces:**
- Consumes: Task 1's `authClient.oneTimeToken.generate()`; the existing `AuthForm` (`src/components/auth-form.tsx`), whose props are `{ mode: "signin" | "signup"; redirectTo?: string; className?: string }` and which uses `redirectTo` BOTH as Google's `callbackURL` (auth-form.tsx:113) and as the `window.location.assign` target on email/password success (auth-form.tsx:154).
- Produces: `parsePort(raw: unknown): number | null` and `loopbackCallbackUrl(port: number, token: string, state: string): string`.

- [ ] **Step 1: Write the failing tests** `src/lib/desktop-handoff.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { loopbackCallbackUrl, parsePort } from "@/lib/desktop-handoff"

describe("parsePort", () => {
  it("accepts an in-range port as a string or a number", () => {
    expect(parsePort("52341")).toBe(52341)
    expect(parsePort(52341)).toBe(52341)
    expect(parsePort("1024")).toBe(1024)
    expect(parsePort("65535")).toBe(65535)
  })

  it("rejects anything outside the unprivileged range", () => {
    expect(parsePort("80")).toBeNull()
    expect(parsePort("1023")).toBeNull()
    expect(parsePort("65536")).toBeNull()
    expect(parsePort("-1")).toBeNull()
  })

  it("rejects values that are not plainly integers", () => {
    expect(parsePort("52341.5")).toBeNull()
    expect(parsePort("52341abc")).toBeNull()
    expect(parsePort("0x1234")).toBeNull()
    expect(parsePort(" 52341 ")).toBeNull()
    expect(parsePort("")).toBeNull()
    expect(parsePort(undefined)).toBeNull()
    expect(parsePort(null)).toBeNull()
    expect(parsePort({})).toBeNull()
  })
})

describe("loopbackCallbackUrl", () => {
  it("builds the URL from parts rather than echoing input", () => {
    expect(loopbackCallbackUrl(52341, "tok", "st")).toBe(
      "http://127.0.0.1:52341/callback?token=tok&state=st"
    )
  })

  it("percent-encodes the token and state", () => {
    expect(loopbackCallbackUrl(52341, "a b&c", "d/e")).toBe(
      "http://127.0.0.1:52341/callback?token=a+b%26c&state=d%2Fe"
    )
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/lib/desktop-handoff.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/desktop-handoff.ts`:**

```ts
/**
 * The two pieces of the desktop handoff that must not be got wrong by hand.
 *
 * The loopback URL is BUILT here rather than read from the query string. A
 * page that accepted a whole redirect target from its own URL and then
 * appended a session-granting token to it would be an open redirect with the
 * session attached — the one mistake in this flow that hands an account to
 * somebody else. This is a different problem from the one `safeRedirect` in
 * src/lib/redirect.ts solves, which is why it does not reuse it.
 */

/**
 * The literal loopback address. NEVER `localhost` — RFC 8252 §8.3 warns that
 * the name can resolve to a non-loopback interface, which would put a session
 * token on the network.
 */
const LOOPBACK_HOST = "127.0.0.1"

/**
 * A port the shell may legitimately have bound, or `null`.
 *
 * Deliberately strict: only an unsigned decimal integer in the unprivileged
 * range. `Number()` alone would accept "0x1234", " 52341 " and "52341.0".
 */
export function parsePort(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null
  const text = String(raw)
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
}

/** Where the browser sends the token so the shell can pick it up. */
export function loopbackCallbackUrl(
  port: number,
  token: string,
  state: string
): string {
  const query = new URLSearchParams({ token, state })
  return `http://${LOOPBACK_HOST}:${port}/callback?${query.toString()}`
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/desktop-handoff.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create the route** `src/routes/desktop-login.tsx`. Read `src/routes/login.tsx` first — this mirrors its shape with one deliberate inversion.

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router"
import { AuthBackdrop } from "@/components/auth-backdrop"
import { AuthForm } from "@/components/auth-form"
import { authClient } from "@/lib/auth-client"
import { loopbackCallbackUrl, parsePort } from "@/lib/desktop-handoff"
import { pageTitle } from "@shared/brand"

/**
 * Where the desktop shell sends your real browser to sign in.
 *
 * THE `beforeLoad` INVERSION IS THE POINT. `/login` throws a redirect INTO the
 * app when you are already authenticated; this route must do the opposite,
 * because an already-signed-in browser is the common case here rather than the
 * exceptional one. Bouncing it to /timer would leave the shell waiting on a
 * callback that never arrives until it timed out, with nothing on screen in
 * either place to say why.
 *
 * So: authenticated means "mint the token and hand it back", and the form is
 * shown only when there is no session to hand over.
 *
 * `redirectTo` points back at THIS route, query string and all. `AuthForm`
 * uses it as Google's `callbackURL` and as the assign target after an
 * email/password sign-in, so both paths return here authenticated and fall
 * into the branch above. That is why this needs no success callback of its own.
 */
export const Route = createFileRoute("/desktop-login")({
  head: () => ({ meta: [{ title: pageTitle("Sign in to the desktop app") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    port: typeof search.port === "string" ? search.port : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const port = parsePort(search.port)
    const state = search.state
    // A malformed handshake is not something the user can fix by signing in,
    // so do not show them a form that cannot lead anywhere.
    if (port === null || !state) {
      throw new Error(
        "This sign-in link is missing information from the desktop app. Start sign-in from the app again."
      )
    }
    if (!context.isAuthenticated) return

    const { data, error } = await authClient.oneTimeToken.generate()
    if (error || !data?.token) {
      throw new Error(
        "Could not hand your session to the desktop app. Start sign-in from the app again."
      )
    }
    // A full document load, not a router navigation: the target is a local
    // HTTP server, not a route in this app.
    throw redirect({ href: loopbackCallbackUrl(port, data.token, state) })
  },
  component: DesktopLoginRoute,
})

function DesktopLoginRoute() {
  const search = Route.useSearch()
  const back = `/desktop-login?port=${search.port ?? ""}&state=${search.state ?? ""}`

  return (
    <main className="relative flex min-h-svh [align-items:safe_center] justify-center p-6">
      <AuthBackdrop />
      <div className="w-full max-w-sm space-y-4">
        <p className="text-muted-foreground text-center text-sm">
          Signing in to the Chroneli desktop app.
        </p>
        <AuthForm mode="signin" redirectTo={back} />
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck`
Expected: clean. `src/routeTree.gen.ts` regenerates via the router plugin; if the route is not picked up, run `pnpm build` once to force generation, then re-run.
Run: `pnpm lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/desktop-handoff.ts src/lib/desktop-handoff.test.ts src/routes/desktop-login.tsx src/routeTree.gen.ts
git commit -m "feat(desktop): the browser signs in and hands the session back"
```

---

### Task 3: `/desktop-callback` — the webview redeems the token

**Files:**
- Create: `src/routes/desktop-callback.tsx`
- Test: `src/routes/-desktop-callback.test.tsx`

**Interfaces:**
- Consumes: Task 1's `authClient.oneTimeToken.verify({ token })`.
- Produces: `DesktopCallback({ token }: { token: string })`, exported separately from the route so it is testable without a router. The route itself is what Task 6 navigates to.

Note the `-` filename prefix: this repo uses it for route tests (see `src/routes/_authed/-settings.test.tsx`) so the router plugin does not treat them as routes.

- [ ] **Step 1: Write the failing test** `src/routes/-desktop-callback.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const verify = vi.fn()
vi.mock("@/lib/auth-client", () => ({ authClient: { oneTimeToken: { verify } } }))

const replace = vi.fn()
vi.stubGlobal("location", { ...window.location, replace })

import { DesktopCallback } from "@/routes/desktop-callback"

afterEach(() => vi.clearAllMocks())

describe("DesktopCallback", () => {
  it("verifies the token and enters the app", async () => {
    verify.mockResolvedValue({ data: { session: {} }, error: null })
    render(<DesktopCallback token="tok" />)
    await waitFor(() => expect(verify).toHaveBeenCalledWith({ token: "tok" }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/timer"))
  })

  it("explains an expired token instead of showing a raw error", async () => {
    verify.mockResolvedValue({ data: null, error: { message: "expired" } })
    render(<DesktopCallback token="tok" />)
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i)
    expect(replace).not.toHaveBeenCalled()
  })

  it("never verifies an empty token", async () => {
    render(<DesktopCallback token="" />)
    expect(await screen.findByRole("alert")).toBeInTheDocument()
    expect(verify).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/routes/-desktop-callback.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/routes/desktop-callback.tsx`:**

```tsx
import { useEffect, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { pageTitle } from "@shared/brand"

/**
 * The webview's half of the handoff: trade the one-time token for a session.
 *
 * `verify` sets the session cookie itself, and the cookie is first-party on
 * this origin because `convex/auth.ts` sets `baseURL` to the site URL and
 * `/api/auth/$` proxies to Convex. That is the whole reason this design works
 * without cross-site cookie handling — a token verified here lands in exactly
 * the jar the app reads.
 *
 * `location.replace` rather than `assign`, so the URL carrying a spent token
 * is not left in the webview's history as a back-button target.
 */
export function DesktopCallback({ token }: { token: string }) {
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (token === "") {
      setFailure(
        "That sign-in link was incomplete. Start sign-in from the app again."
      )
      return
    }
    let cancelled = false
    void (async () => {
      const { error } = await authClient.oneTimeToken.verify({ token })
      if (cancelled) return
      if (error) {
        // The overwhelmingly likely cause is the two-minute expiry, and it is
        // the only one the user can do anything about.
        setFailure(
          "That sign-in link expired. Start sign-in from the app again."
        )
        return
      }
      location.replace("/timer")
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <main className="flex min-h-svh [align-items:safe_center] justify-center p-6">
      {failure === null ? (
        <p className="text-muted-foreground text-sm">Signing you in…</p>
      ) : (
        <p role="alert" className="max-w-sm text-center text-sm">
          {failure}
        </p>
      )}
    </main>
  )
}

export const Route = createFileRoute("/desktop-callback")({
  head: () => ({ meta: [{ title: pageTitle("Signing in") }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  component: function DesktopCallbackRoute() {
    const { token } = Route.useSearch()
    return <DesktopCallback token={token} />
  },
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/routes/-desktop-callback.test.tsx`
Expected: PASS (3 tests).
Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/desktop-callback.tsx src/routes/-desktop-callback.test.tsx src/routeTree.gen.ts
git commit -m "feat(desktop): the webview trades the handoff token for a session"
```

---

### Task 4: The loopback listener in Rust

**Files:**
- Create: `src-tauri/src/browser_auth.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod browser_auth;` near the top)

**Interfaces:**
- Produces, used by Task 5:
  - `pub struct Handoff { pub port: u16, pub state: String }`
  - `pub enum HandoffError { StateMismatch, TimedOut }`
  - `pub fn parse_callback(request_line: &str, expected_state: &str) -> Result<String, HandoffError>` — pure, unit-tested
  - `pub fn begin(timeout: Duration) -> std::io::Result<(Handoff, Receiver<Result<String, HandoffError>>)>` — binds `127.0.0.1:0`, spawns the listener thread, returns the bound port and nonce immediately plus a channel that yields the token

- [ ] **Step 1: Write the failing tests.** Create `src-tauri/src/browser_auth.rs` containing ONLY this test module first, and add `mod browser_auth;` to `src-tauri/src/lib.rs` so it compiles at all:

```rust
#[cfg(test)]
mod tests {
    use super::{parse_callback, HandoffError};

    #[test]
    fn extracts_the_token_when_the_state_matches() {
        let line = "GET /callback?token=abc123&state=nonce HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "abc123");
    }

    #[test]
    fn order_of_the_query_parameters_does_not_matter() {
        let line = "GET /callback?state=nonce&token=abc123 HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "abc123");
    }

    #[test]
    fn percent_encoded_values_are_decoded() {
        let line = "GET /callback?token=a+b%26c&state=nonce HTTP/1.1";
        assert_eq!(parse_callback(line, "nonce").unwrap(), "a b&c");
    }

    #[test]
    fn a_wrong_state_is_refused_even_with_a_valid_token() {
        let line = "GET /callback?token=abc123&state=attacker HTTP/1.1";
        assert!(matches!(
            parse_callback(line, "nonce"),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn a_missing_state_is_refused() {
        let line = "GET /callback?token=abc123 HTTP/1.1";
        assert!(matches!(
            parse_callback(line, "nonce"),
            Err(HandoffError::StateMismatch)
        ));
    }

    #[test]
    fn an_empty_token_is_refused() {
        let line = "GET /callback?token=&state=nonce HTTP/1.1";
        assert!(parse_callback(line, "nonce").is_err());
    }

    #[test]
    fn incidental_requests_are_not_mistaken_for_the_callback() {
        // Browsers ask for this unprompted; it must not end the wait.
        assert!(parse_callback("GET /favicon.ico HTTP/1.1", "nonce").is_err());
        assert!(parse_callback("GET / HTTP/1.1", "nonce").is_err());
    }
}
```

- [ ] **Step 2: Run, confirm failure**

Run: `export PATH="$PATH:$HOME/.cargo/bin"; cargo test --manifest-path src-tauri/Cargo.toml browser_auth`
Expected: FAIL to compile — `parse_callback` not found.

- [ ] **Step 3: Add the entropy dependency.**

Run: `export PATH="$PATH:$HOME/.cargo/bin"; cargo add getrandom@0.3 --manifest-path src-tauri/Cargo.toml`

This resolves to a crate already present transitively (0.3.4), so it adds no new
third-party code to the build — it only makes the dependency direct and
declared.

- [ ] **Step 4: Implement.** Prepend to `src-tauri/src/browser_auth.rs`, above the test module:

```rust
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

/// What the shell needs in order to send the browser somewhere useful.
pub struct Handoff {
    pub port: u16,
    pub state: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum HandoffError {
    /// The request did not carry the nonce this listener minted. Discard it:
    /// something other than our own browser tab is talking to this port.
    StateMismatch,
    TimedOut,
}

/// The page shown in the browser tab once the token is in hand.
const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
<body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0\">\
<p>Signed in. You can close this tab and return to Chroneli.</p>";

/// Pulls the token out of a callback request line, refusing anything whose
/// `state` is not ours.
///
/// Pure and separately tested because this is the security boundary: it is the
/// only thing between a local process that guessed the port and a live
/// session. Everything it can get wrong — parameter order, percent encoding, a
/// missing nonce, the browser's unprompted /favicon.ico — is reachable from a
/// unit test without binding a socket.
pub fn parse_callback(
    request_line: &str,
    expected_state: &str,
) -> Result<String, HandoffError> {
    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or(HandoffError::StateMismatch)?;
    let query = path
        .strip_prefix("/callback?")
        .ok_or(HandoffError::StateMismatch)?;

    let mut token = None;
    let mut state = None;
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        match key {
            "token" => token = Some(percent_decode(value)),
            "state" => state = Some(percent_decode(value)),
            _ => {}
        }
    }

    // Compared before the token is looked at, so a caller who does not know the
    // nonce learns nothing about whether their token parsed.
    if state.as_deref() != Some(expected_state) {
        return Err(HandoffError::StateMismatch);
    }
    token
        .filter(|t| !t.is_empty())
        .ok_or(HandoffError::StateMismatch)
}

/// `application/x-www-form-urlencoded` decoding: `+` is a space, `%XX` a byte.
fn percent_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A 256-bit nonce from the operating system's CSPRNG.
///
/// This value is the only thing standing between a local process that guessed
/// the port and a token that grants a full session, so it must not be
/// PREDICTABLE — which rules out anything derived from the clock. A nonce
/// seeded from the current nanosecond looks random and is not: an attacker who
/// knows roughly when sign-in began searches a very small space.
///
/// `getrandom` rather than `rand`: it is already in this tree transitively,
/// it is a thin wrapper over the OS entropy source, and one buffer fill is the
/// entire requirement.
///
/// A failure here must be fatal to the flow rather than papered over with a
/// weaker fallback — an unguessable nonce is the security property, and
/// continuing without one silently removes it.
fn mint_state() -> std::io::Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|e| std::io::Error::other(format!("no system entropy for a sign-in nonce: {e}")))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Binds a loopback port and waits, on its own thread, for one callback.
///
/// Returns as soon as the port is known so the caller can put it in the URL it
/// opens; the token arrives later on the channel.
///
/// `127.0.0.1` explicitly rather than `localhost` — RFC 8252 §8.3 warns the
/// name can resolve to a non-loopback interface, which would put a session
/// token on the network.
pub fn begin(
    timeout: Duration,
) -> std::io::Result<(Handoff, Receiver<Result<String, HandoffError>>)> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))?;
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;
    let state = mint_state()?;
    let (tx, rx) = channel();

    let expected = state.clone();
    std::thread::spawn(move || {
        // A deadline rather than a blocking accept, so a browser that never
        // comes back cannot strand the thread or hold the port forever.
        let deadline = Instant::now() + timeout;
        loop {
            if Instant::now() >= deadline {
                let _ = tx.send(Err(HandoffError::TimedOut));
                return;
            }
            match listener.accept() {
                Ok((stream, _)) => {
                    if let Some(token) = handle(stream, &expected) {
                        let _ = tx.send(Ok(token));
                        return;
                    }
                    // Anything else — /favicon.ico, a stray probe — is answered
                    // and ignored, and the wait continues.
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => {
                    let _ = tx.send(Err(HandoffError::TimedOut));
                    return;
                }
            }
        }
    });

    Ok((Handoff { port, state }, rx))
}

/// Reads one request line, answers it, and yields a token if it was the one.
fn handle(mut stream: TcpStream, expected_state: &str) -> Option<String> {
    let mut line = String::new();
    let readable = stream.try_clone().ok()?;
    if BufReader::new(readable).read_line(&mut line).is_err() {
        return None;
    }
    match parse_callback(line.trim_end(), expected_state) {
        Ok(token) => {
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                DONE_PAGE.len(),
                DONE_PAGE
            );
            Some(token)
        }
        Err(_) => {
            let _ = write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            None
        }
    }
}
```

- [ ] **Step 5: Run tests and clippy**

Run: `export PATH="$PATH:$HOME/.cargo/bin"; cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass — the 7 new `browser_auth` tests plus the 17 existing.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: zero warnings. Fix anything it raises rather than allowing it.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/browser_auth.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "fix(desktop): a loopback listener that refuses a nonce it did not mint"
```

---

### Task 5: Wire the command, the opener, and the ACL

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 4's `browser_auth::begin`, `Handoff`, `HandoffError`.
- Produces, used by Task 6: command `begin_browser_login` taking no arguments; events `browser-login-token` (payload `{ token: string }`) and `browser-login-failed` (payload `{ reason: "timed_out" | "state_mismatch" | "bind_failed" }`).

**READ THIS FIRST.** `build.rs` already declares an app manifest listing `timer_state`. A command not in that list is rejected for the remote origin with no error the page can see. Adding it to `generate_handler!` alone is NOT enough — that omission is exactly what made the tray inert for the whole previous branch. Both edits, or the feature silently does nothing.

- [ ] **Step 1: Add the dependencies**

Run: `export PATH="$PATH:$HOME/.cargo/bin"; cargo add tauri-plugin-opener --manifest-path src-tauri/Cargo.toml`
Run: `pnpm add @tauri-apps/plugin-opener`

- [ ] **Step 2: Extend the app manifest** in `src-tauri/build.rs` — add `"begin_browser_login"` to the existing `.commands(&[...])` list beside `"timer_state"`.

- [ ] **Step 3: Grant it, narrowly,** in `src-tauri/capabilities/default.json`. Add to the `permissions` array:

```json
    "allow-begin-browser-login",
    {
      "identifier": "opener:allow-open-url",
      "allow": [{ "url": "https://chroneli.com/*" }]
    }
```

The opener grant is scoped to the production origin deliberately: an unscoped `opener:default` would let a compromised page use the shell to launch any URL or local handler it liked.

- [ ] **Step 4: Write the failing ACL test.** `src-tauri/src/lib.rs` already has resolved-ACL tests from the previous branch — find the one asserting `timer_state` resolves for the remote origin and mirror it exactly, including its helper:

```rust
    #[test]
    fn the_remote_origin_may_begin_a_browser_login() {
        // Same shape as the timer_state ACL test above. A command absent from
        // build.rs's manifest resolves to None here, which is the silent
        // rejection that made the tray inert once already.
        assert!(resolves_for_remote("begin_browser_login"));
    }
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — the command does not resolve yet.

- [ ] **Step 5: Implement the command** in `src-tauri/src/lib.rs`:

```rust
/// How long the shell waits for the browser before giving up.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

/// Opens the system browser at the sign-in page and waits for the handoff.
///
/// Returns as soon as the browser has been launched; the token arrives later
/// as a `browser-login-token` event. Every failure is reported as
/// `browser-login-failed` rather than swallowed — a silent failure here would
/// leave the user watching a spinner with no way to know it is over.
#[tauri::command]
fn begin_browser_login(app: AppHandle) -> Result<(), String> {
    let (handoff, rx) = browser_auth::begin(LOGIN_TIMEOUT)
        .map_err(|e| format!("could not open a local port for sign-in: {e}"))?;

    let url = format!(
        "https://chroneli.com/desktop-login?port={}&state={}",
        handoff.port, handoff.state
    );
    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|e| format!("could not open your browser: {e}"))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        let reason = match rx.recv() {
            Ok(Ok(token)) => {
                let _ = handle
                    .emit("browser-login-token", serde_json::json!({ "token": token }));
                return;
            }
            Ok(Err(browser_auth::HandoffError::StateMismatch)) => "state_mismatch",
            Ok(Err(browser_auth::HandoffError::TimedOut)) => "timed_out",
            Err(_) => "bind_failed",
        };
        let _ = handle.emit("browser-login-failed", serde_json::json!({ "reason": reason }));
    });

    Ok(())
}
```

Register both: add `.plugin(tauri_plugin_opener::init())` to the builder and `begin_browser_login` to `tauri::generate_handler![...]` beside `timer_state`.

- [ ] **Step 6: Verify the ACL actually resolves — this is the point of the task**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all pass, the new ACL test included.
Run: `grep -c begin_browser_login src-tauri/gen/schemas/acl-manifests.json`
Expected: at least `1`. **If this prints 0, the command is unreachable from the page** no matter what compiles — go back to Step 2.
Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs src-tauri/capabilities/default.json src-tauri/src/lib.rs package.json pnpm-lock.yaml
git commit -m "feat(desktop): the shell opens a real browser to sign in"
```

---

### Task 6: The webview side — button, waiting state, and the token round trip

**Files:**
- Modify: `src/lib/desktop-bridge.ts`
- Modify: `src/lib/desktop-bridge.test.ts`
- Create: `src/components/auth/desktop-sign-in.tsx`
- Test: `src/components/auth/desktop-sign-in.test.tsx`
- Modify: `src/routes/login.tsx`

**Interfaces:**
- Consumes: Task 5's `begin_browser_login` command and the `browser-login-token` / `browser-login-failed` events; the existing `isDesktopShell()` in `src/lib/desktop-bridge.ts`.
- Produces: `beginBrowserLogin(): Promise<void>` and `onBrowserLogin(handlers: { token: (token: string) => void; failed: (reason: string) => void }): Promise<() => void>`; the `<DesktopSignIn />` component.

- [ ] **Step 1: Extend the bridge tests.** Add to `src/lib/desktop-bridge.test.ts`, reusing that file's existing mocks and its `enterShell()` helper, and importing the two new names at the top:

```ts
describe("beginBrowserLogin", () => {
  it("does nothing outside the shell", async () => {
    await beginBrowserLogin()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("invokes the command inside the shell", async () => {
    enterShell()
    await beginBrowserLogin()
    expect(invoke).toHaveBeenCalledWith("begin_browser_login")
  })

  it("lets a rejection propagate so the caller can report it", async () => {
    enterShell()
    invoke.mockRejectedValueOnce(new Error("no port"))
    await expect(beginBrowserLogin()).rejects.toThrow("no port")
  })
})

describe("onBrowserLogin", () => {
  it("routes each event to its own handler", async () => {
    enterShell()
    const token = vi.fn()
    const failed = vi.fn()
    const cleanup = await onBrowserLogin({ token, failed })

    listeners.get("browser-login-token")?.({ payload: { token: "tok" } })
    expect(token).toHaveBeenCalledWith("tok")
    expect(failed).not.toHaveBeenCalled()

    listeners.get("browser-login-failed")?.({ payload: { reason: "timed_out" } })
    expect(failed).toHaveBeenCalledWith("timed_out")
    expect(token).toHaveBeenCalledTimes(1)

    cleanup()
    expect(unlisten).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/lib/desktop-bridge.test.ts`
Expected: FAIL — `beginBrowserLogin` is not exported.

- [ ] **Step 3: Implement in `src/lib/desktop-bridge.ts`,** appended below the existing exports:

```ts
/**
 * Asks the shell to open the user's real browser to sign in.
 *
 * Rejections are deliberately NOT swallowed here, unlike `pushTimerState`
 * above: failing to open a browser is the end of the road for the user and
 * they need to be told. The empty catch on the timer push is defensible only
 * because the next state change retries it; nothing retries this.
 */
export async function beginBrowserLogin(): Promise<void> {
  if (!isDesktopShell()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("begin_browser_login")
}

/** The shell's answer to `beginBrowserLogin`, whichever way it went. */
export async function onBrowserLogin(handlers: {
  token: (token: string) => void
  failed: (reason: string) => void
}): Promise<() => void> {
  if (!isDesktopShell()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  const unlistenToken = await listen<{ token: string }>(
    "browser-login-token",
    (event) => handlers.token(event.payload.token)
  )
  const unlistenFailed = await listen<{ reason: string }>(
    "browser-login-failed",
    (event) => handlers.failed(event.payload.reason)
  )
  return () => {
    unlistenToken()
    unlistenFailed()
  }
}
```

- [ ] **Step 4: Run bridge tests**

Run: `npx vitest run src/lib/desktop-bridge.test.ts`
Expected: PASS — the existing tests plus 4 new.

- [ ] **Step 5: Write the failing component test** `src/components/auth/desktop-sign-in.test.tsx`.

NOTE: jest-dom is NOT installed in this repo — there is no `toBeInTheDocument`,
`toHaveTextContent` or `toBeEnabled`. Use plain assertions, as every other test
here does. `cleanup()` in `afterEach` is required; there is no auto-cleanup.

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  beginBrowserLogin: vi.fn(async () => undefined),
  onBrowserLogin: vi.fn(async (_h: unknown) => vi.fn()),
}))
vi.mock("@/lib/desktop-bridge", () => bridge)

const replace = vi.fn()
vi.stubGlobal("location", { ...window.location, replace })

import { DesktopSignIn } from "@/components/auth/desktop-sign-in"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DesktopSignIn", () => {
  it("opens the browser and shows that it is waiting", async () => {
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    expect(bridge.beginBrowserLogin).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/waiting for your browser/i)).toBeTruthy()
  })

  it("enters the app when the token arrives", async () => {
    render(<DesktopSignIn />)
    const handlers = bridge.onBrowserLogin.mock.calls[0]![0] as {
      token: (t: string) => void
    }
    handlers.token("tok")
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/desktop-callback?token=tok")
    )
  })

  it("says so when the wait times out, and offers another go", async () => {
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    const handlers = bridge.onBrowserLogin.mock.calls[0]![0] as {
      failed: (r: string) => void
    }
    handlers.failed("timed_out")
    expect((await screen.findByRole("alert")).textContent).toMatch(/timed out/i)
    const retry = screen.getByRole("button", { name: /continue in browser/i })
    expect((retry as HTMLButtonElement).disabled).toBe(false)
  })

  it("reports a failure to open the browser at all", async () => {
    bridge.beginBrowserLogin.mockRejectedValueOnce(new Error("no port"))
    render(<DesktopSignIn />)
    fireEvent.click(screen.getByRole("button", { name: /continue in browser/i }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/no port/i)
  })
})
```

- [ ] **Step 6: Run, confirm failure**

Run: `npx vitest run src/components/auth/desktop-sign-in.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 7: Implement `src/components/auth/desktop-sign-in.tsx`.** Check `src/lib/error-message.ts` for the exact export name — it is used throughout `src/hooks/use-entry-actions.ts` and must be imported the same way.

```tsx
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { beginBrowserLogin, onBrowserLogin } from "@/lib/desktop-bridge"
import { errorMessage } from "@/lib/error-message"

const FAILURE_COPY: Record<string, string> = {
  timed_out: "That timed out waiting for your browser. Try again.",
  state_mismatch: "That sign-in did not match this app. Try again.",
  bind_failed: "Could not listen for your browser's reply. Try again.",
}

/**
 * The desktop app's whole sign-in screen.
 *
 * There is no form here on purpose. Google refuses OAuth from embedded
 * webviews and names WKWebView — which is what Tauri uses on macOS — so a
 * Google button inside this window fails outright there. Sending BOTH sign-in
 * methods to the real browser keeps one path rather than two, and it means the
 * browser always holds a session, which is what a later Calendar-connect fix
 * will need.
 */
export function DesktopSignIn() {
  const [waiting, setWaiting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onBrowserLogin({
      token: (token) => {
        // Straight to the route that redeems it; that is what sets the cookie.
        location.replace(`/desktop-callback?token=${encodeURIComponent(token)}`)
      },
      failed: (reason) => {
        setWaiting(false)
        setFailure(FAILURE_COPY[reason] ?? "Sign-in did not finish. Try again.")
      },
    }).then((unlisten) => {
      // The unmount can land while `listen` is still resolving; a listener
      // registered after its cleanup ran would survive forever.
      if (cancelled) unlisten()
      else cleanup = unlisten
    })
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [])

  async function start() {
    setFailure(null)
    setWaiting(true)
    try {
      await beginBrowserLogin()
    } catch (thrown) {
      setWaiting(false)
      setFailure(errorMessage(thrown))
    }
  }

  return (
    <div className="w-full max-w-sm space-y-4 text-center">
      <p className="text-muted-foreground text-sm">
        Chroneli signs you in through your browser, so your password manager and
        Google both work normally.
      </p>
      <Button onClick={() => void start()} className="w-full">
        Continue in browser
      </Button>
      {waiting && (
        <p className="text-muted-foreground text-sm">
          Waiting for your browser… come back once you have signed in.
        </p>
      )}
      {failure !== null && (
        <p role="alert" className="text-sm">
          {failure}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 8: Branch the login route.** In `src/routes/login.tsx`, replace the `<AuthForm ... />` element with a conditional, leaving `beforeLoad`, `validateSearch` and everything else untouched:

```tsx
      {isDesktopShell() ? (
        <DesktopSignIn />
      ) : (
        <AuthForm
          mode="signin"
          redirectTo={safeRedirect(search.redirect)}
          className="w-full max-w-sm"
        />
      )}
```

Add imports for `isDesktopShell` from `@/lib/desktop-bridge` and `DesktopSignIn` from `@/components/auth/desktop-sign-in`.

- [ ] **Step 9: Run everything**

Run: `npx vitest run src/components/auth/desktop-sign-in.test.tsx`
Expected: PASS (4 tests).
Run: `pnpm test`
Expected: all pass. NOTE: `src/components/history/period-controls.test.tsx` is a known pre-existing flake that times out under full-suite load and passes when run alone — if it fails, re-run it alone to confirm and say so. It is not yours to fix.
Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/desktop-bridge.ts src/lib/desktop-bridge.test.ts src/components/auth/desktop-sign-in.tsx src/components/auth/desktop-sign-in.test.tsx src/routes/login.tsx
git commit -m "feat(desktop): signing in opens your browser instead of the webview"
```

---

### Task 7: Document it, and verify the branch

**Files:**
- Modify: `docs/desktop.md`

- [ ] **Step 1: Add a "Signing in" section** to `docs/desktop.md`, matching the prose tone of the sections already there. It must cover:

  - **Why the browser.** Google refuses OAuth from embedded webviews and names WKWebView, which Tauri uses on macOS, so an in-window Google button fails outright there. Link `https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/`. Note that WebView2 on Windows is not named and works today, but that both platforms go through the browser so there is one path rather than two.
  - **The flow, in the order a reader would debug it:** shell binds `127.0.0.1:0` and mints a nonce → opens `/desktop-login?port&state` → browser signs in → `/desktop-login` generates a one-time token in `beforeLoad` → redirects to the loopback listener → shell emits the token → webview navigates to `/desktop-callback` → `verify` sets the first-party cookie.
  - **Why loopback and not `chroneli://`** — RFC 8252 §8.1 (any app can claim a URI scheme, and we have no PKCE to mitigate it), plus macOS cannot register a scheme at runtime so it could not be tested under `tauri dev` at all.
  - **`127.0.0.1`, never `localhost`** — RFC 8252 §8.3.
  - **The ACL trap, stated as a rule:** any new Tauri command must be added to `build.rs`'s app manifest AND allowed in `capabilities/default.json`, or it is silently rejected for the remote origin. Point at `grep begin_browser_login src-tauri/gen/schemas/acl-manifests.json` as the way to prove it landed.
  - **What is still broken:** Google Calendar connect (`linkSocial` in Settings) still runs in the webview and so still fails on macOS. Say plainly that it is known and not yet fixed.

- [ ] **Step 2: Commit**

```bash
git add docs/desktop.md
git commit -m "docs(desktop): why signing in leaves the app"
```

- [ ] **Step 3: Final verification across the branch**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Run: `export PATH="$PATH:$HOME/.cargo/bin"; cargo test --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: all clean.

Then report what a human must smoke-test, since none of it can be automated: sign in from the shell end to end on Windows; confirm Google specifically works in the browser; confirm an already-signed-in browser completes instantly without ever showing a form; confirm a token left for three minutes is refused with the expiry message rather than a raw error; and confirm the timeout path leaves a usable retry rather than a dead spinner.
