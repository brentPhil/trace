# The desktop app

What this is: a **Tauri 2 shell** — a native window, no bundled frontend —
that loads `https://chroneli.com` directly. `src-tauri/tauri.conf.json` sets
`frontendDist` to that URL instead of a local build directory, so the app you
install is just a window around the production site.

That has one big consequence: **almost nothing about Chroneli itself ships
through this app.** A normal `git push` to `master`, deployed the usual way,
reaches desktop users the instant they next open the window — no rebuild, no
release, no waiting on app-store review. The desktop build in
`src-tauri/` only needs a new release when the *shell* changes: window size
and title, the icon, permissions in `src-tauri/capabilities/`, the tray (once
that lands), Rust dependencies. In practice that should be rare.

## What loading the site remotely costs

The upside above has a matching downside, and it is worth stating plainly
because none of it announces itself.

### Changing the bridge is a breaking change

The tray talks to the web app over three bare strings and one argument shape:
the `timer_state` command, and the `tray-start` / `tray-stop` events. The Rust
side pins them as consts in `src-tauri/src/lib.rs`; the web side spells them as
literals in `src/lib/desktop-bridge.ts`. **Nothing checks that the two agree at
runtime.** There is no handshake and no version number.

So renaming any of those, or changing the arguments `invoke("timer_state", …)`
sends, stops every **already-installed** shell from syncing the moment the
rename deploys — and it does it silently. Old shells are old binaries; they keep
listening for the old names. The user sees a tray that has simply stopped
updating, with no error and nothing in the app to suggest why. Changing a name
means shipping a desktop release *and* waiting for people to install it, which
is exactly the "no rebuild, no release" property this arrangement was chosen
for. Don't, unless there's a real reason.

The same trap, one layer down: `src-tauri/capabilities/default.json` allowlists
exactly `https://chroneli.com`. A remote origin can only call a command it
resolves an ACL entry for, so moving the site to a `www.` host, adding a
redirect that lands the window on a different origin, or serving it from a
preview domain kills IPC just as quietly — the window still loads and the app
still works, the tray just never hears anything again. (That is not
hypothetical: a missing ACL entry made every push fail for the whole life of the
tray branch, and the web side's `.catch` swallowed it. It now logs in
development — see `reportPushFailure` in `src/hooks/use-desktop-bridge.ts`.)

### Offline, or chroneli.com down

There is no local frontend to fall back to — but the site itself now
registers a service worker (`docs/offline.md`), and that changes what "the
window opens with no network" actually means. A window opened offline, after
at least one prior online visit, gets **the cached shell** — the last page it
loaded, with real data dehydrated into it — rather than the platform
webview's own error page. Writes made there queue in the outbox and sync when
the network returns. The tray's **Start timer** still reaches a page that
actually loaded, because that page is the cached one, not a blank window
waiting on a fetch that will never resolve.

That only holds once the service worker has been **registered** on this
device, which itself requires one successful online page load —
`registerServiceWorker()` runs from the root route, and only in a production
build. From that point on, every offline navigation is intercepted by the
worker, and `networkFirstNavigation` always answers it: the cached response
for that URL if one exists, otherwise Chroneli's own inline offline page at
503 — never a fall-through to the platform's chrome, even for a URL that was
never individually visited. A window on a device where the worker has never
registered — no page has ever loaded there while online — is the only case
that still gets the platform's own error page: Edge WebView2's on Windows,
WKWebView's on macOS.

**Verified on Windows (WebView2).** WebView2 is Chromium, and service
workers there behave exactly as they do in a desktop browser.

**NOT yet verified on macOS.** WKWebView's support for a service worker
registered against a *remote* origin is the open question — as opposed to
one bundled with a local app — and until someone checks it on a real Mac,
the desktop app should not be described as offline-capable there.

### `"csp": null` is deliberate

`src-tauri/tauri.conf.json` sets `app.security.csp` to `null`. That is a
decision, not a gap someone left open.

Tauri's CSP support works by injecting the policy into the HTML it serves. With
`frontendDist` pointing at a remote URL, Tauri serves nothing — the response
comes from chroneli.com — so there is no document for it to inject into and the
setting has nothing to act on. **The site's own `Content-Security-Policy`
headers are the entire defense here**, exactly as they are for the same site in
a normal browser. Setting a policy in `tauri.conf.json` would not add one; it
would only make it look like the app had one.

## Signing in

The login screen in the desktop app is **the login screen** — the same
`AuthForm` the website renders, email and password fields and all. You type
them into the window and submit them there, exactly as in a browser. That path
was never broken and there is no desktop-specific version of it.

**Only the Google button is different.** Google refuses OAuth from embedded
webviews and says so by name: an attempt from inside one comes back as
`disallowed_useragent`, and WKWebView — which is what Tauri uses on macOS — is
called out explicitly in [Google's own announcement of the
block](https://developers.googleblog.com/en/making-oauth-flows-safer/). So in
the shell that one button hands the sign-in to the user's real browser instead
of navigating this window to Google.

What happens when it is clicked, end to end:

1. `AuthForm` sees `isDesktopShell()` and calls `begin_browser_login` instead
   of `authClient.signIn.social`.
2. The shell binds a **loopback** listener on an ephemeral port and mints a
   64-hex-character nonce, then opens the system browser at
   `/desktop-login?port=…&state=…`.
3. The browser signs in normally — real Chrome or Safari, so the password
   manager works and Google is happy — and `/desktop-login` mints a Better
   Auth **one-time token** and posts it to
   `http://127.0.0.1:<port>/callback?token=…&state=…`.
4. The listener checks the nonce, emits `browser-login-token` to the webview,
   and the page navigates itself to `/desktop-callback?token=…`, which redeems
   the token and sets the session cookie **on the window's own origin**.

The webview is listening for that event from the moment the login screen
mounts, not from the moment the button is clicked. `begin_browser_login`
resolves as soon as the browser has been *launched*, and Tauri does not replay
an event to a listener that was not registered when it fired — so invoking
first and listening after leaves a real gap in which a fast round trip is
dropped on the floor and the app waits forever for a sign-in that already
succeeded.

### Why loopback and not a custom URL scheme

A `chroneli://` scheme is the other obvious way to get the token back, and it
is worse here for two independent reasons.

RFC 8252 **§8.1** is the first: any application on the machine can register the
same private-use scheme, and the OS picks a winner without asking anybody.
Whoever wins receives the callback — token included. The mitigation OAuth
normally leans on is PKCE, and it does not apply: what comes back over this
wire is not an authorization code being exchanged, it is a Better Auth one-time
token that grants a session to whoever presents it. There is no verifier to
bind it to. A loopback listener has no such ambiguity — the shell either bound
the port or it did not, and it knows which port it bound.

The second is plainer: **macOS cannot register a URL scheme at runtime.** It
comes from `CFBundleURLTypes` in the app bundle's `Info.plist`, which means a
scheme only works for an *installed, bundled* app — never for `tauri dev`,
where the sign-in path would then be untestable in exactly the mode it is
developed in.

Note the literal `127.0.0.1` in `src/lib/desktop-handoff.ts`, never
`localhost`. RFC 8252 **§8.3**: the name can resolve to something that is not
the loopback interface, and this URL carries a session-granting token. The
constant is spelled out and commented there for that reason.

### Adding a command means touching the ACL

`begin_browser_login` is an app command invoked from a **remote** origin, so it
needs two things that are easy to write only one of:

- an entry in the `commands(&[…])` list in `src-tauri/build.rs`, which
  autogenerates the `allow-begin-browser-login` permission, and
- a grant for that permission in `src-tauri/capabilities/default.json`.

Miss the capability and every invoke is rejected with nothing on screen and
nothing in the console — the same silent failure that made the tray inert for a
whole branch. The cheap check:

```bash
grep begin_browser_login src-tauri/gen/schemas/acl-manifests.json
```

Nothing back means the command is not in the ACL at all, whatever the Rust
looks like. There is a `the_acl_lets_chroneli_com_*` test per command for the
same reason; add one with the command.

### Google Calendar connect is still broken on macOS

Signing in is fixed. **Connecting Google Calendar is not.** That flow is
`linkSocial` in Settings (`src/routes/_authed/-settings.tsx`), it runs in the
webview, and it goes to exactly the Google consent screen that refuses embedded
webviews — so on macOS it fails the same way sign-in used to. This is known and
deliberately not fixed yet: the fix wants the browser to already hold a session
so the link can happen there, which is a bigger change than this one, and the
handoff above is the piece it will be built on.

## Local dev

Prerequisites, once per machine:

- **[rustup](https://rustup.rs)** — installs the Rust toolchain `cargo`
  needs.
- **Windows only: the MSVC C++ Build Tools.** rustup alone is not enough —
  it installs the compiler, but the *linker* Cargo needs on Windows comes
  from the Build Tools, not from rustup. Get them from
  [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  and select the "Desktop development with C++" workload. Skipping this
  produces a linker error (`link.exe not found` or similar) the first time
  you build, not at `rustup` install time — so it's easy to think rustup was
  sufficient until the first `cargo build`.
- **macOS only: the Xcode Command Line Tools** — `xcode-select --install`.

With those in place:

```bash
pnpm install
pnpm tauri dev
```

This opens the native window pointed at `https://chroneli.com`. There's no
frontend to build first; the Tauri CLI itself comes from `devDependencies`.

**Dev and release read different config keys for that URL**, which is worth
knowing before you change either. Tauri resolves the window's address in
`get_app_url`: a release build uses `frontendDist` when that is a URL, but
`tauri dev` uses **`devUrl` only** and never consults `frontendDist` at all.
Both are set to `https://chroneli.com` in `src-tauri/tauri.conf.json` so the
two modes agree. Delete `devUrl` and dev does not fall back to the other key —
it serves embedded assets instead, of which a URL-valued `frontendDist`
produces none, and the window shows `asset not found: index.html`.

Note the consequence: **`tauri dev` runs against production**, with real data
and a real session. That is deliberate — it is what the shipped app does — but
it means the shell is not the place to try out unreleased web changes.

Pointing `devUrl` at the local web dev server (`http://localhost:3100`) to
develop bridge changes takes a second step: the capability in
`src-tauri/capabilities/default.json` allowlists exactly
`https://chroneli.com`, so IPC from any other origin is rejected and the tray
silently stops receiving state. You would have to add the localhost origin
there too — and that grant must **not** ship in a release build.

## Running it against your local web app

`pnpm tauri dev` points the shell at **production**. That is right for a smoke
test of the shipped app and useless for developing, because the shell loads its
frontend remotely: anything you have not deployed does not exist as far as the
window is concerned. A sign-in button you just wrote is not there, and
`/desktop-login` 404s.

For a real loop, one command:

```bash
pnpm tauri:dev
```

Note the colon — `pnpm tauri dev` without it is the production smoke test
above, and it shows you production's OLD login page, which is easy to misread
as the feature being broken. `tauri:dev` starts the web dev server itself
(`beforeDevCommand`), waits for it to answer on 3100, opens the window, and
stops the server when the window closes.

`tauri:dev` merges `src-tauri/tauri.dev.conf.json` over the base config, which
does two things that both have to happen together:

- points `devUrl` at `http://localhost:3100`, and
- grants that origin the same capability the production origin has.

The second is not optional and its absence is invisible. The window would load
your dev server perfectly, the button would render, and every `invoke` would be
refused by the ACL with nothing on screen and nothing in the console — the same
silent failure that made the tray inert for an entire branch. Tauri rejects IPC
from any origin a capability does not name.

That dev grant is written **inline** in the dev config rather than as a file in
`capabilities/`. Files there are auto-discovered and would ship in every release
build; inline, the grant cannot exist unless that config is merged. Verified by
building both ways and grepping the binary: the dev origin appears only with the
dev config applied.

`SIGN_IN_URL_BASE` in `src-tauri/src/lib.rs` is split on `debug_assertions` for
the same reason. The sign-in page, the one-time token and the session cookie
must all come from the origin the window is on. A debug shell that sent you to
production to sign in would appear to work — the browser signs into production,
mints a production token, posts it back — and then the dev webview verifies it
against localhost, where it was never issued. You would see "that link expired"
with nothing wrong at either end.

One number lives in four places: `--port 3100` in the `dev` script, `devUrl`,
the inline capability's `remote.urls`, and `SIGN_IN_URL_BASE`. Three are JSON no
compiler reads, so `the_sign_in_url_stays_on_the_origin_the_capability_names`
reads the JSON at compile time and fails loudly if they drift.

Your Convex dev deployment's `SITE_URL` has to match `http://localhost:3100`
too, and so does the Google OAuth redirect URI, or Better Auth will mint
cookies for an origin the window is not on.

## Regenerating icons

Icons are derived from `public/logo.svg`, the same source the PWA icons, the
favicon and the in-app `<Logo />` come from:

```bash
pnpm icons                              # writes src-tauri/app-icon.png, among others
pnpm tauri icon src-tauri/app-icon.png  # fans it out into src-tauri/icons/
```

Run both, in that order, whenever the logo changes. The second command
regenerates every platform-specific size and format Tauri's bundler expects
(`.ico`, `.icns`, the various PNG sizes) — hand-editing anything under
`src-tauri/icons/` directly is not worth it.

## Releasing

A release is a **git tag**, not a manual build. Pushing a tag matching
`desktop-v*` runs `.github/workflows/desktop.yml`, which builds a Windows
installer and two macOS disk images (Apple Silicon and Intel) and attaches
them to a **draft** GitHub release.

1. Bump `version` in **both**:
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`

   Both need to move together — Tauri's bundler reads the Cargo version for
   the binary and the conf.json version for the release metadata, and they're
   expected to agree.

2. Commit that bump.

3. Tag and push:

   ```bash
   git tag desktop-v0.2.0
   git push origin desktop-v0.2.0
   ```

4. Wait for the `desktop` workflow to finish (three jobs: two macOS
   architectures, one Windows build), then open the draft release on GitHub,
   review the attached installers, and publish it.

The workflow never publishes automatically — `releaseDraft: true` is
deliberate, so a bad build never becomes a public release Chroneli didn't
review.

## Unsigned installs

Neither platform's build is signed, so installing takes an extra step the
first time:

- **Windows:** SmartScreen will warn that the app is from an unrecognized
  publisher. Click **More info → Run anyway**.
- **macOS:** Gatekeeper will refuse a plain double-click the first time.
  Right-click (or Control-click) the app → **Open**, then confirm in the
  dialog. After that first launch, it opens normally.

Both are expected, not a sign anything is broken — see the exclusions below.

## Deliberately not in v1

Left out on purpose, not by oversight:

- **Code signing and notarization** — the reason the caveats above exist.
  Signing costs money (a certificate) and macOS notarization adds a
  submit-and-wait step to every release; neither is worth it before the app
  has users who'd notice.
- **Auto-updater** — not needed yet because the shell almost never changes
  (see above). Worth revisiting only if shell releases stop being rare.
- **Global shortcuts** — start/stop a timer from outside the window.
- **Idle detection** — pause a running timer when the machine is idle.

None of these block the app from being useful; they're the first things to
pick back up if the desktop app gets real usage.
