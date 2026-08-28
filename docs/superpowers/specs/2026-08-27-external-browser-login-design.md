# External-browser login for the Chroneli desktop shell

Date: 2026-08-27
Status: approved
Branch: feat/desktop-app

## Why

Google blocks OAuth requests from embedded webviews and names **WKWebView
(iOS & macOS)** explicitly, returning `disallowed_useragent`. Tauri uses
WKWebView on macOS, so **Google sign-in is expected to fail outright in the
macOS build**. WebView2 (Windows) is not named and likely works today, but it
is the same risk class and Google can tighten its user-agent heuristics
without warning.

Sources:
- https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/
- https://developers.google.com/identity/protocols/oauth2/policies

This is therefore a correctness fix for the Mac build, not a convenience
feature.

## Decisions taken

1. **All sign-in goes through the external browser** — Google and
   email/password alike. One code path to build, test and secure, and it
   guarantees the browser holds a session, which makes the Calendar-connect
   follow-up straightforward.
2. **Loopback `127.0.0.1` callback**, not a custom URI scheme. RFC 8252 §8.1:
   "multiple apps can typically register the same scheme, which makes it
   indeterminate as to which app will receive the authorization code" — and we
   have no PKCE to mitigate it, because what we carry is a token that grants a
   session outright. Loopback also works identically under `tauri dev` on every
   platform, whereas macOS cannot register a URI scheme at runtime at all.
   Claimed-`https` (§7.2, which the RFC prefers) needs Universal Links, an
   `apple-app-site-association` file and a notarized app — none of which v1 has.

## What makes this cheap

Three facts established by reading the installed source, not assumed:

1. **The session cookie is already first-party on `chroneli.com`.**
   `convex/auth.ts` sets `baseURL: siteUrl`, and `src/routes/api/auth/$.ts`
   proxies `/api/auth/*` to Convex. So verifying against
   `https://chroneli.com/api/auth/one-time-token/verify` sets the cookie in
   exactly the jar the webview reads. Had auth lived on `convex.site`, this
   design would need cross-site cookie surgery.
2. **No schema migration.** The `one-time-token` plugin stores through
   `internalAdapter.createVerificationValue` / `consumeVerificationValue` on the
   standard `verification` table, which the Convex Better Auth component already
   defines with `identifier` / `value` / `expiresAt`.
3. **The plugin composes with this setup.** `better-auth/plugins/one-time-token`
   and `oneTimeTokenClient` both exist in the installed 1.6.26, and the existing
   `plugins: [convex({ authConfig })]` proves the `better-auth/minimal` entry
   point accepts a plugins array.

## Flow

1. Shell binds an ephemeral port on `127.0.0.1` and mints a random `state` nonce.
2. Shell opens the system browser to
   `https://chroneli.com/desktop-login?port=<p>&state=<n>`.
3. User signs in normally. Real browser: Google works, password managers work,
   and the existing auth form is reused unchanged.
4. The page, now authenticated, calls `authClient.oneTimeToken.generate()` and
   redirects to `http://127.0.0.1:<p>/callback?token=…&state=<n>`.
5. The listener accepts one request, **checks `state` matches what it minted**,
   serves a small "you can close this tab" page, and shuts down.
6. The shell hands the token to the webview, which navigates to
   `/desktop-callback?token=…`.
7. That route calls `oneTimeToken.verify({ token })`, which sets the first-party
   session cookie, then `location.replace()`s into the app.

## Components

**Backend.** One line in `convex/auth.ts`: `oneTimeToken({ expiresIn: 2 })`
alongside `convex({ authConfig })`. No schema change.

**Web.**
- `oneTimeTokenClient()` added to `src/lib/auth-client.ts`.
- `src/routes/desktop-login.tsx` — wraps the existing auth form; on
  authentication, generates a token and redirects to the loopback URL.
- `src/routes/desktop-callback.tsx` — verifies the token, redirects into the app.
- A branch in the login screen: when `isDesktopShell()` is true (the helper
  already exists in `src/lib/desktop-bridge.ts`), render "Continue in browser"
  instead of the form. The plain-web login path is untouched.

**Shell.**
- `src-tauri/src/browser_auth.rs` — owns the nonce, the listener and the
  timeout. Roughly 40 lines of `std::net`: bind, loop past incidental requests
  (favicon) until the callback path arrives, time out, shut down. Hand-rolled
  rather than `tauri-plugin-oauth`: one request, fully auditable, no new
  dependency.
- `tauri-plugin-opener`, with its capability scoped to `https://chroneli.com/*`
  only.
- A `begin_browser_login` command, granted the same way `timer_state` is — via
  the app manifest in `build.rs` plus an explicit allow in the capability.
  Adding it to the manifest list is mandatory: a command absent from that list
  is rejected for the remote origin, which is precisely the bug that made the
  tray inert for the whole of the previous branch.

## The already-signed-in browser

`src/routes/login.tsx:12-14` throws a redirect when `context.isAuthenticated`,
sending signed-in visitors into the app. **`/desktop-login` must NOT copy that
pattern.** A browser that already holds a Chroneli session is the common case —
it is how most people will hit this page — and bouncing it to `/timer` would
leave the shell waiting on a callback that never comes, until it timed out with
no explanation.

Instead, `/desktop-login` treats an existing session as the fast path: generate
the token immediately in `beforeLoad` and redirect to the loopback URL without
ever rendering a form. Sign-in is only shown when there is no session.

## Validating the port

The loopback URL is CONSTRUCTED by the page, never taken whole from the query
string: the page reads `port`, rejects anything that is not an integer in
1024–65535, and builds `http://127.0.0.1:<port>/callback` itself. Accepting a
full redirect target from the query string would be an open redirect with a
session token attached. Note this is a different problem from the one
`src/lib/redirect.ts`'s `safeRedirect` solves, so it needs its own check rather
than reuse.

## Security

- **The `state` nonce is mandatory, not decorative.** Without it any local
  process could hand the shell a token of its choosing.
- `127.0.0.1` literal, never `localhost` — RFC 8252 §8.3: "the use of localhost
  is NOT RECOMMENDED … avoids inadvertently listening on network interfaces
  other than the loopback interface."
- The listener exists only for the duration of the flow and hard-times-out.
- Tokens are single-use with a 2-minute expiry.
- The `opener` capability allowlists exactly the production origin, so a
  compromised page cannot use the shell to launch arbitrary URLs.

Residual risk, stated plainly: local malware listening on the loopback port
could capture a token. That is inherent to loopback redirects and RFC 8252
accepts it; anything able to exploit it already owns the machine.

## Error handling

| Case | Behavior |
|---|---|
| Browser never returns | Listener times out; window shows a retry |
| `state` mismatch | Token discarded; logged in dev, never acted on |
| Token expired | `/desktop-callback` shows "that link expired, try again" |
| User cancels | Cancel button in the waiting state kills the listener |
| Port bind fails | Surfaced to the user, never swallowed |

That last row is a deliberate reaction to this branch's history: an empty
`.catch(() => {})` on the timer bridge hid a total feature failure through six
code reviews. Every failure path in this flow reports.

## Testing

- Token generate/verify round trip and state-mismatch rejection: `convex-test`.
- The two new routes: vitest, like the rest of the app.
- The listener: Rust unit tests for request-line parsing, state comparison and
  timeout. Parsing is where a hand-rolled server earns its tests.
- End-to-end sign-in needs a human, same as the tray.

## Out of scope

- **Google Calendar connect** (`linkSocial` in Settings) remains broken on
  macOS. It is the other Google flow in the app and deserves its own pass now
  that the browser will reliably hold a session.
- Deep links / custom URI schemes.
- Claimed-`https` Universal Links.
- Any change to the plain-web login.

## Accepted consequence

This changes desktop sign-in for everyone, including Windows users whose
in-webview login works today. That is the price of one code path instead of
two, and it was accepted deliberately.

## Addendum (2026-08-28): scope of the browser handoff narrowed

After using the build, the product owner reversed decision 1: the desktop app
now shows the ordinary login form immediately, and ONLY OAuth (the Google
button) leaves for the external browser — matching the common desktop-app
pattern. Email/password submits inside the webview, which has always worked;
the webview block this feature exists for is specific to OAuth.

The handoff machinery (loopback listener, nonce, one-time token,
/desktop-login, /desktop-callback) is unchanged — only its trigger moved from
a dedicated screen into the Google button. This also let /login regain full
SSR: the server and client render identical markup again, the shell/web
difference living entirely in a click handler and an effect.
