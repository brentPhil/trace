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

This opens the native window pointed at `https://chroneli.com` (or, if you're
also running the web app locally, whatever `frontendDist` resolves to — check
`src-tauri/tauri.conf.json` before assuming). There's no frontend to build
first; the Tauri CLI itself comes from `devDependencies`.

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
