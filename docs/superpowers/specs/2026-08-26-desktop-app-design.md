# Chroneli on the desktop — PWA + Tauri tray app

Date: 2026-08-26
Status: approved

## Goal

Ship Chroneli as a desktop app for Windows and macOS, two ways:

1. **PWA** — finish the existing half-wired manifest so chroneli.com installs
   as a standalone-window app from Chrome/Edge (Windows) and Safari's
   Add to Dock (macOS). Ships immediately, updates are just web deploys.
2. **Tauri 2 thin wrapper** — a native app whose window loads
   `https://chroneli.com` directly, plus a system-tray timer with
   start/stop. Installers for Windows (NSIS) and macOS (.dmg, Intel +
   Apple Silicon) built in CI.

The backend is Convex (cloud) and auth is Better Auth on Convex HTTP
routes, so no server ships with either app — both are frontend shells.

## Part 1 — PWA

Current state: `public/manifest.json` exists but references
`logo192.png`/`logo512.png` which do not exist in `public/`, and the
manifest link from the document head must be verified.

Work:

- Generate real 192×192 and 512×512 PNG icons (plus a maskable variant)
  from `src/logo.svg`.
- Fix `public/manifest.json` (icons, theme/background colors that match
  the app).
- Add `<link rel="manifest">` and `<meta name="theme-color">` to the root
  route's head.
- Verify installability on chroneli.com with Chrome/Edge.

Explicitly out: no service worker. Chroneli is useless offline
(Convex-backed), and modern Chrome installs without one.

## Part 2 — Tauri 2 shell

A `src-tauri/` directory in this repo. The window loads
`https://chroneli.com` — no bundled frontend, so every web deploy updates
the desktop app and the shell rarely needs re-releasing. Remote-domain
IPC is enabled by allowlisting `chroneli.com` in the capability config,
which is what lets the page use the bridge below.

### Bridge (web side)

`src/lib/desktop-bridge.ts`, a small module that no-ops outside Tauri.
Inside the shell it:

1. Watches the same reactive `running` query the timer bar uses and
   pushes `{running, title, startedAt}` to the shell whenever it changes.
   The shell computes ticking elapsed time itself in Rust — no per-second
   IPC.
2. Listens for `tray-start`/`tray-stop` events from the shell and calls
   the existing `entries.start`/`entries.stop` mutations, the same code
   path as the timer bar's button.

### Tray (shell side)

- Icon reflects state: idle vs recording.
- Tooltip/menu show the running title and live elapsed time.
- Menu items: Start / Stop, Open Chroneli, Quit.
- The window's close button hides to tray instead of quitting; the
  webview must stay alive for tray Start/Stop to reach Convex. Quit
  lives in the tray menu.

## Distribution

A GitHub Actions workflow using `tauri-action` builds the Windows NSIS
installer and macOS `.dmg` (aarch64 + x86_64) on tagged releases. First
releases ship unsigned: Windows users click through SmartScreen, Mac
users right-click → Open. Signing/notarization is a documented follow-up
if distribution grows beyond a small group.

## Testing

- The bridge is plain TypeScript against a mockable Tauri API — vitest
  coverage like the rest of the app.
- The Rust shell is thin; verification is a manual smoke check per
  release (window loads, tray reflects a running timer, tray start/stop
  round-trips).

## Out of scope for v1

Global shortcuts, idle detection, auto-updater for the shell,
code signing.
