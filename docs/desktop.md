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

There is no local frontend to fall back to. If the site is unreachable when the
window opens, what the user gets is **the platform webview's own error page** —
Edge WebView2's on Windows, WKWebView's on macOS. No Chroneli branding, no retry
button, nothing that suggests the app is fine and the network isn't. Meanwhile
the tray is still there, still offering **Start timer**, and that Start goes
nowhere: it emits an event into a page that never loaded.

Worth fixing if the app gets real usage; not worth pre-building an offline shell
before then.

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

## Regenerating icons

Icons are derived from `src/logo.svg`, the same source the PWA icons come
from:

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
