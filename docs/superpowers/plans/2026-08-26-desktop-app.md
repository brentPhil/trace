# Chroneli Desktop (PWA + Tauri tray shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Chroneli as an installable desktop app two ways — finish the PWA on chroneli.com, and build a Tauri 2 thin-wrapper app (window loads `https://chroneli.com`) with a system-tray timer, with Windows/macOS installers built in CI.

**Architecture:** The backend is Convex (cloud); both deliverables are frontend shells. The Tauri window loads the production site remotely, so web deploys update the desktop app. A small web-side bridge (`src/lib/desktop-bridge.ts` + `useDesktopBridge` hook mounted in `AuthedShell`) pushes the reactive running-entry state to the Rust shell via `invoke("timer_state", …)` and executes tray Start/Stop by listening for `tray-start`/`tray-stop` events and calling the existing `entries.start`/`entries.stop` mutation wrappers. The Rust shell owns the tray icon, ticks elapsed time itself (no per-second IPC), and hides the window to tray on close so the webview stays alive.

**Tech Stack:** TanStack Start + React 19 + Convex (existing), vitest (existing), Tauri 2 (`tauri` crate with `tray-icon` + `image-png` features, `@tauri-apps/cli` v2, `@tauri-apps/api` v2), `sharp` (dev-only icon generation), `tauri-apps/tauri-action@v1` in GitHub Actions.

## Global Constraints

- Production URL is exactly `https://chroneli.com` (see `wrangler.jsonc` vars).
- Tauri identifier: `com.chroneli.desktop`. Product name: `Chroneli`.
- Remote IPC: the only allowlisted remote origin is `https://chroneli.com`.
- No service worker for the PWA — Chroneli is useless offline.
- App theme color / background: `#14110e` (the `--ground` token `oklch(0.18 0.008 75)` from `src/styles.css:25`, converted to sRGB hex; verify with the node one-liner in Task 1 before hardcoding elsewhere).
- v1 ships unsigned installers (NSIS on Windows, .dmg on macOS aarch64 + x86_64). No auto-updater, no global shortcuts, no idle detection.
- Tauri command args: Rust `snake_case` parameters are camelCased on the JS side by Tauri 2's default convention (`started_at_ms` ⇄ `startedAtMs`).
- Repo conventions: mutations crossing effect boundaries are wrapped in `useLatest` (`src/hooks/use-latest.ts`); components must not import `convex/_generated/api` (eslint-enforced) — the new hook takes callbacks, it never imports `api`.
- This machine has Node v24 but **no Rust toolchain** (`cargo` missing). Task 4 must get explicit user consent before installing rustup/MSVC Build Tools; if declined, Rust-side tasks are authored code-only and verified in CI.
- Commit messages follow the repo style: `feat(scope): lowercase sentence`, with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Finish the PWA — real icons, correct manifest, head links

**Files:**
- Create: `scripts/make-icons.mjs`
- Create (generated): `public/logo192.png`, `public/logo512.png`, `public/logo512-maskable.png`
- Modify: `public/manifest.json`
- Modify: `src/routes/__root.tsx` (head: manifest link + theme-color meta)
- Test: `src/lib/pwa-manifest.test.ts`
- Modify: `package.json` (add `sharp` devDependency, `icons` script)

**Interfaces:**
- Consumes: `src/logo.svg` (source mark), `--ground` color from `src/styles.css`.
- Produces: manifest + icons that Task 4's shell icons also derive from (`scripts/make-icons.mjs` is reused there).

- [ ] **Step 1: Confirm the theme hex** (documenting, not guessing):

Run:
```bash
node -e "const oklch={l:.18,c:.008,h:75};const a=oklch.c*Math.cos(oklch.h*Math.PI/180),b=oklch.c*Math.sin(oklch.h*Math.PI/180);const l_=oklch.l+.3963377774*a+.2158037573*b,m_=oklch.l-.1055613458*a-.0638541728*b,s_=oklch.l-.0894841775*a-1.291485548*b;const l=l_**3,m=m_**3,s=s_**3;const lin=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];console.log('#'+lin.map(c=>{const v=c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055;return Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')}).join(''))"
```
Expected: `#14110e` (±1 per channel is fine; use whatever it prints everywhere below).

- [ ] **Step 2: Write the failing test** `src/lib/pwa-manifest.test.ts`:

```ts
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const publicDir = join(__dirname, "../../public")
const manifest = JSON.parse(
  readFileSync(join(publicDir, "manifest.json"), "utf8")
) as {
  name: string
  short_name: string
  start_url: string
  display: string
  theme_color: string
  background_color: string
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>
}

describe("PWA manifest", () => {
  it("declares a standalone app with the product colors", () => {
    expect(manifest.short_name).toBe("Chroneli")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")
    expect(manifest.theme_color).toBe("#14110e")
    expect(manifest.background_color).toBe("#14110e")
  })

  it("lists a 192, a 512 and a maskable icon", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain("192x192")
    expect(sizes).toContain("512x512")
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true)
  })

  it("every declared icon file exists in public/", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(join(publicDir, icon.src)), icon.src).toBe(true)
    }
  })
})
```

- [ ] **Step 3: Run it, confirm it fails**

Run: `npx vitest run src/lib/pwa-manifest.test.ts`
Expected: FAIL — `theme_color` is `#000000` today and `logo192.png`/`logo512.png` do not exist.

- [ ] **Step 4: Add sharp and the icon script**

Run: `npm install --save-dev sharp`

Create `scripts/make-icons.mjs`:

```js
// Regenerates the PWA icons in public/ from src/logo.svg.
// Run: node scripts/make-icons.mjs
import sharp from "sharp"

const GROUND = "#14110e" // --ground from src/styles.css, converted to sRGB

const svg = "src/logo.svg"
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

await sharp(svg, { density: 300 })
  .resize(192, 192, { fit: "contain", background: transparent })
  .png()
  .toFile("public/logo192.png")

await sharp(svg, { density: 300 })
  .resize(512, 512, { fit: "contain", background: transparent })
  .png()
  .toFile("public/logo512.png")

// Maskable: the mark inside the 80% safe zone on a solid ground, so any
// platform mask shape leaves the logo intact.
const mark = await sharp(svg, { density: 300 })
  .resize(400, 400, { fit: "contain", background: transparent })
  .png()
  .toBuffer()
await sharp({
  create: { width: 512, height: 512, channels: 4, background: GROUND },
})
  .composite([{ input: mark, gravity: "centre" }])
  .png()
  .toFile("public/logo512-maskable.png")

console.log("wrote public/logo192.png, logo512.png, logo512-maskable.png")
```

Add to `package.json` scripts: `"icons": "node scripts/make-icons.mjs"`.

Run: `npm run icons`
Expected: the three PNGs appear in `public/`. Open them (or check byte size > 0) to confirm the mark rendered, not a blank square. If `src/logo.svg` is non-square, `fit: "contain"` letterboxes it — that is correct.

- [ ] **Step 5: Rewrite `public/manifest.json`:**

```json
{
  "name": "Chroneli — time tracking that records what was accomplished",
  "short_name": "Chroneli",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#14110e",
  "background_color": "#14110e",
  "icons": [
    { "src": "logo192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "logo512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "logo512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

- [ ] **Step 6: Link it from the head.** In `src/routes/__root.tsx`, the `head: () => ({ … })` block currently has `meta` (charset, viewport, title) and `links` (stylesheet). Add:

To `meta`, after the title entry:
```ts
{
  name: "theme-color",
  content: "#14110e",
},
```

To `links`, after the stylesheet entry:
```ts
{
  rel: "manifest",
  href: "/manifest.json",
},
```

- [ ] **Step 7: Run the test and the suite**

Run: `npx vitest run src/lib/pwa-manifest.test.ts`
Expected: PASS (3 tests).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 8: Verify installability locally.** Start the dev server (port 3100 — use the project's launch config, not Bash) and confirm in the browser pane that `GET /manifest.json` returns the new JSON and the document head contains `<link rel="manifest">`. Real install prompt verification happens on chroneli.com after deploy — note that in the commit body, don't block on it.

- [ ] **Step 9: Commit**

```bash
git add public/manifest.json public/logo192.png public/logo512.png public/logo512-maskable.png scripts/make-icons.mjs src/lib/pwa-manifest.test.ts src/routes/__root.tsx package.json package-lock.json
git commit -m "feat(pwa): chroneli.com installs as a standalone app"
```

---

### Task 2: Desktop bridge module (web side)

**Files:**
- Create: `src/lib/desktop-bridge.ts`
- Test: `src/lib/desktop-bridge.test.ts`
- Modify: `package.json` (add `@tauri-apps/api` dependency)

**Interfaces:**
- Consumes: `@tauri-apps/api/core` (`invoke`), `@tauri-apps/api/event` (`listen`) — imported **dynamically** only when inside the shell, so the module is inert on the plain web.
- Produces (Task 3 relies on these exact signatures):
  - `isDesktopShell(): boolean`
  - `pushTimerState(state: ShellTimerState): Promise<void>` where `ShellTimerState = { running: boolean; title: string; startedAtMs: number | null }`
  - `onTrayCommand(handlers: { start: () => void; stop: () => void }): Promise<() => void>` — resolves to an unlisten function.
- Produces (Task 5 relies on the wire contract): invokes command `timer_state` with args `{ running, title, startedAtMs }`; listens for events `tray-start` and `tray-stop`.

- [ ] **Step 1: Install the API package**

Run: `npm install @tauri-apps/api`
(Regular dependency, not dev: it ships in the client bundle so the page on chroneli.com can talk to the shell.)

- [ ] **Step 2: Write the failing tests** `src/lib/desktop-bridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

const invoke = vi.fn(async () => undefined)
const listeners = new Map<string, (event: { payload: unknown }) => void>()
const unlisten = vi.fn()
const listen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
  listeners.set(name, handler)
  return unlisten
})

vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen }))

import { isDesktopShell, onTrayCommand, pushTimerState } from "@/lib/desktop-bridge"

function enterShell() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  listeners.clear()
  vi.clearAllMocks()
})

describe("isDesktopShell", () => {
  it("is false in a plain browser", () => {
    expect(isDesktopShell()).toBe(false)
  })

  it("is true when the Tauri IPC globals are present", () => {
    enterShell()
    expect(isDesktopShell()).toBe(true)
  })
})

describe("pushTimerState", () => {
  it("does nothing outside the shell", async () => {
    await pushTimerState({ running: false, title: "", startedAtMs: null })
    expect(invoke).not.toHaveBeenCalled()
  })

  it("forwards the state to the timer_state command", async () => {
    enterShell()
    await pushTimerState({ running: true, title: "Deep work", startedAtMs: 123 })
    expect(invoke).toHaveBeenCalledWith("timer_state", {
      running: true,
      title: "Deep work",
      startedAtMs: 123,
    })
  })
})

describe("onTrayCommand", () => {
  it("resolves to a no-op outside the shell", async () => {
    const cleanup = await onTrayCommand({ start: vi.fn(), stop: vi.fn() })
    expect(listen).not.toHaveBeenCalled()
    cleanup() // must not throw
  })

  it("routes tray events to the handlers and unlistens on cleanup", async () => {
    enterShell()
    const start = vi.fn()
    const stop = vi.fn()
    const cleanup = await onTrayCommand({ start, stop })

    listeners.get("tray-start")?.({ payload: null })
    listeners.get("tray-stop")?.({ payload: null })
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)

    cleanup()
    expect(unlisten).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run, confirm failure**

Run: `npx vitest run src/lib/desktop-bridge.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `src/lib/desktop-bridge.ts`:**

```ts
/**
 * The web app's half of the desktop shell conversation.
 *
 * Inert on the plain web on purpose: `@tauri-apps/api` is only imported
 * dynamically after the shell's IPC globals have been seen, so a browser on
 * chroneli.com never loads it and never pays for it.
 */
export type ShellTimerState = {
  running: boolean
  title: string
  startedAtMs: number | null
}

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Hands the running-entry state to the shell, which owns the tray from there. */
export async function pushTimerState(state: ShellTimerState): Promise<void> {
  if (!isDesktopShell()) return
  const { invoke } = await import("@tauri-apps/api/core")
  await invoke("timer_state", {
    running: state.running,
    title: state.title,
    startedAtMs: state.startedAtMs,
  })
}

/**
 * Start/Stop clicked in the tray menu. Resolves to the unlisten function so
 * the caller's effect can clean up.
 */
export async function onTrayCommand(handlers: {
  start: () => void
  stop: () => void
}): Promise<() => void> {
  if (!isDesktopShell()) return () => {}
  const { listen } = await import("@tauri-apps/api/event")
  const unlistenStart = await listen("tray-start", () => handlers.start())
  const unlistenStop = await listen("tray-stop", () => handlers.stop())
  return () => {
    unlistenStart()
    unlistenStop()
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/lib/desktop-bridge.test.ts`
Expected: PASS (6 tests).
Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/desktop-bridge.ts src/lib/desktop-bridge.test.ts package.json package-lock.json
git commit -m "feat(desktop): a bridge module the shell's tray talks through"
```

---

### Task 3: `useDesktopBridge` hook, mounted in `AuthedShell`

**Files:**
- Create: `src/hooks/use-desktop-bridge.ts`
- Test: `src/hooks/use-desktop-bridge.test.tsx`
- Modify: `src/routes/_authed.tsx` (mount the hook beside the other `running` watchers, around line 165)

**Interfaces:**
- Consumes: Task 2's `isDesktopShell` / `pushTimerState` / `onTrayCommand`; `useLatest` from `src/hooks/use-latest.ts`; `Doc<"timeEntries">` from `convex/_generated/dataModel`.
- Produces: `useDesktopBridge(running: Doc<"timeEntries"> | null, actions: { start: () => Promise<unknown>; stop: () => Promise<unknown> }, onError: (thrown: unknown) => void): void`

- [ ] **Step 1: Write the failing tests** `src/hooks/use-desktop-bridge.test.tsx`:

```tsx
import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDesktopBridge } from "@/hooks/use-desktop-bridge"
import type { Doc } from "../../convex/_generated/dataModel"

const bridge = vi.hoisted(() => ({
  isDesktopShell: vi.fn(() => true),
  pushTimerState: vi.fn(async () => undefined),
  onTrayCommand: vi.fn(async (_handlers: { start: () => void; stop: () => void }) => vi.fn()),
}))
vi.mock("@/lib/desktop-bridge", () => bridge)

function runningEntry(overrides: Partial<Doc<"timeEntries">> = {}): Doc<"timeEntries"> {
  return {
    _id: "e1" as Doc<"timeEntries">["_id"],
    _creationTime: 1000,
    userId: "u1",
    clientKey: "k1",
    title: "Deep work",
    startedAt: 1000,
    endedAt: null,
    durationMs: null,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  }
}

afterEach(() => vi.clearAllMocks())

describe("useDesktopBridge", () => {
  it("pushes the running state on mount and again when it changes", () => {
    const actions = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }
    const { rerender } = renderHook(
      ({ running }) => useDesktopBridge(running, actions, vi.fn()),
      { initialProps: { running: null as Doc<"timeEntries"> | null } }
    )
    expect(bridge.pushTimerState).toHaveBeenCalledWith({
      running: false,
      title: "",
      startedAtMs: null,
    })

    rerender({ running: runningEntry() })
    expect(bridge.pushTimerState).toHaveBeenLastCalledWith({
      running: true,
      title: "Deep work",
      startedAtMs: 1000,
    })
  })

  it("does nothing outside the shell", () => {
    bridge.isDesktopShell.mockReturnValueOnce(false).mockReturnValueOnce(false)
    renderHook(() => useDesktopBridge(null, { start: vi.fn(), stop: vi.fn() }, vi.fn()))
    expect(bridge.pushTimerState).not.toHaveBeenCalled()
    expect(bridge.onTrayCommand).not.toHaveBeenCalled()
  })

  it("wires tray commands to the actions and reports their failures", async () => {
    const start = vi.fn(async () => undefined)
    const stop = vi.fn(async () => {
      throw new Error("offline")
    })
    const onError = vi.fn()
    renderHook(() => useDesktopBridge(null, { start, stop }, onError))

    // The handlers the hook registered with the bridge:
    const handlers = bridge.onTrayCommand.mock.calls[0]![0]
    handlers.start()
    handlers.stop()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("unlistens on unmount", async () => {
    const unlisten = vi.fn()
    bridge.onTrayCommand.mockResolvedValueOnce(unlisten)
    const { unmount } = renderHook(() =>
      useDesktopBridge(null, { start: vi.fn(), stop: vi.fn() }, vi.fn())
    )
    await vi.waitFor(() => expect(bridge.onTrayCommand).toHaveBeenCalled())
    unmount()
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/hooks/use-desktop-bridge.test.tsx`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement `src/hooks/use-desktop-bridge.ts`:**

```ts
import { useEffect } from "react"
import { useLatest } from "@/hooks/use-latest"
import { isDesktopShell, onTrayCommand, pushTimerState } from "@/lib/desktop-bridge"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Keeps the desktop shell's tray in step with the running entry, and lets the
 * tray's Start/Stop go through the exact mutations the timer bar uses.
 *
 * Mounted in `AuthedShell` beside the other hooks that watch `running` — the
 * one mount that survives navigation, so the tray never goes stale because the
 * user changed pages. Everything is a no-op outside the Tauri shell.
 */
export function useDesktopBridge(
  running: Doc<"timeEntries"> | null,
  actions: { start: () => Promise<unknown>; stop: () => Promise<unknown> },
  onError: (thrown: unknown) => void
): void {
  // `useLatest` for the same reason every effect-crossing callback in this
  // codebase uses it: the callers hand in fresh closures per render, and the
  // listener effect below must register exactly once.
  const start = useLatest(actions.start)
  const stop = useLatest(actions.stop)
  const report = useLatest(onError)

  useEffect(() => {
    if (!isDesktopShell()) return
    // A failed push means the shell side is gone or mid-restart; there is
    // nothing useful to tell the user, and the next state change retries.
    void pushTimerState({
      running: running !== null,
      title: running?.title ?? "",
      startedAtMs: running?.startedAt ?? null,
    }).catch(() => {})
  }, [running])

  useEffect(() => {
    if (!isDesktopShell()) return
    let cleanup: (() => void) | null = null
    let cancelled = false
    void onTrayCommand({
      start: () => void start().catch(report),
      stop: () => void stop().catch(report),
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
  }, [start, stop, report])
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/hooks/use-desktop-bridge.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Mount it.** In `src/routes/_authed.tsx`, inside `AuthedShell`: `entryMutations` is declared at line ~194 and `report` at ~199. Add **after `report`'s declaration** (order matters — plain function references):

```ts
useDesktopBridge(
  running,
  { start: entryMutations.start, stop: entryMutations.stop },
  report
)
```

with the import `import { useDesktopBridge } from "@/hooks/use-desktop-bridge"` alongside the other hook imports. Note: this moves the hook call below non-hook declarations — React only requires hooks to be unconditional, but if the file's lint setup complains about hook ordering, instead declare `report` above the existing hook block and put `useDesktopBridge` beside `useTabTitleClock` (line ~165).

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test`
Expected: all green (the new tests included; nothing else broken).
Run: `npm run typecheck`
Expected: clean.
Run: `npm run lint`
Expected: clean — in particular no `api` import was added to any component.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-desktop-bridge.ts src/hooks/use-desktop-bridge.test.tsx src/routes/_authed.tsx
git commit -m "feat(desktop): the authed shell keeps the tray in step with the timer"
```

---

### Task 4: Tauri shell scaffold (`src-tauri/`)

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/.gitignore`
- Create (generated): `src-tauri/icons/*` via `tauri icon`
- Modify: `package.json` (devDependency `@tauri-apps/cli`, script `"tauri": "tauri"`)

**Interfaces:**
- Consumes: `scripts/make-icons.mjs` pattern from Task 1 (a 1024px PNG render of `src/logo.svg` feeds `tauri icon`).
- Produces: a building shell that Task 5 fills in — `lib.rs` exposes `pub fn run()`, `main.rs` calls it. Window label is `main`.

- [ ] **Step 1: Toolchain gate (ASK THE USER before installing).** Run `cargo --version`. It is known to be missing on this machine. Ask the user: installing Rust on Windows means rustup + the MSVC C++ Build Tools (a multi-GB Visual Studio component). If they consent, install and verify `cargo --version` and `rustc --version` succeed. If they decline, complete Tasks 4–5 as authored code, skip every `cargo`/`tauri dev` verification step, and rely on Task 6's CI to compile — say so in the commit body.

- [ ] **Step 2: CLI + icon source**

Run: `npm install --save-dev @tauri-apps/cli`
Add to `package.json` scripts: `"tauri": "tauri"`.

Extend `scripts/make-icons.mjs` with a 1024px render (same sharp pattern, output to the scratchpad or `src-tauri/app-icon.png`):

```js
await sharp(svg, { density: 300 })
  .resize(1024, 1024, { fit: "contain", background: transparent })
  .png()
  .toFile("src-tauri/app-icon.png")
```

Run: `npm run icons` then `npm run tauri icon src-tauri/app-icon.png`
Expected: `src-tauri/icons/` filled with `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `icon.png`, and Windows store logos. (`tauri icon` writes to `src-tauri/icons` by default.)

- [ ] **Step 3: Author the config files.**

`src-tauri/.gitignore`:
```
target/
gen/
```

`src-tauri/Cargo.toml`:
```toml
[package]
name = "chroneli-desktop"
version = "0.1.0"
description = "Chroneli desktop shell"
edition = "2021"

[lib]
name = "chroneli_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon", "image-png"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`src-tauri/build.rs`:
```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/tauri.conf.json`:
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Chroneli",
  "version": "0.1.0",
  "identifier": "com.chroneli.desktop",
  "build": {
    "frontendDist": "https://chroneli.com"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Chroneli",
        "width": 1200,
        "height": 800,
        "minWidth": 480,
        "minHeight": 360
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis", "app", "dmg"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```
(`frontendDist` as an external URL is the documented "no assets are embedded, load this URL" mode; the `main` window loads it by default, so no `url` field is needed.)

`src-tauri/capabilities/default.json` — this is the line that lets the page served from chroneli.com use IPC at all:
```json
{
  "identifier": "remote-chroneli",
  "description": "The production site is the app; it may use IPC.",
  "windows": ["main"],
  "remote": {
    "urls": ["https://chroneli.com"]
  },
  "permissions": ["core:default"]
}
```
Security note for the commit body: remote-domain IPC is scoped to exactly this origin; the documented iframe caveat applies to Linux/Android, which we do not ship.

`src-tauri/src/main.rs`:
```rust
// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    chroneli_desktop_lib::run()
}
```

`src-tauri/src/lib.rs` (scaffold only; Task 5 replaces the body):
```rust
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verify it builds (toolchain permitting)**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles clean (first run downloads crates; minutes, not seconds).
Then smoke it: `npm run tauri dev` — a window opens showing chroneli.com; log in; the app works. Close it. (Skip both if Step 1 was declined.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri package.json package-lock.json scripts/make-icons.mjs
git commit -m "feat(desktop): a tauri shell that opens chroneli.com in a native window"
```

---

### Task 5: Tray timer in the shell (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs` (full implementation)
- Create: `src-tauri/icons/tray-idle.png`, `src-tauri/icons/tray-recording.png` (generated)
- Modify: `scripts/make-icons.mjs` (tray icon generation)

**Interfaces:**
- Consumes: Task 2's wire contract — command `timer_state(running: bool, title: String, started_at_ms: Option<i64>)` (JS sends `startedAtMs`; Tauri's camelCase convention maps it), events `tray-start`/`tray-stop` emitted to the webview.
- Produces: the shipped tray behavior; `format_elapsed(ms: i64) -> String` unit-tested in the same file.

- [ ] **Step 1: Tray icons.** Extend `scripts/make-icons.mjs`:

```js
// Tray icons: 32px. Idle is the mark alone; recording adds a red dot badge.
await sharp(svg, { density: 300 })
  .resize(32, 32, { fit: "contain", background: transparent })
  .png()
  .toFile("src-tauri/icons/tray-idle.png")

const dot = Buffer.from(
  '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="7" fill="#e5484d" stroke="#14110e" stroke-width="2"/></svg>'
)
const base = await sharp(svg, { density: 300 })
  .resize(32, 32, { fit: "contain", background: transparent })
  .png()
  .toBuffer()
await sharp(base)
  .composite([{ input: dot }])
  .png()
  .toFile("src-tauri/icons/tray-recording.png")
```

Run: `npm run icons`. Expected: both PNGs exist, ~32×32.

- [ ] **Step 2: Write the failing Rust test.** In `src-tauri/src/lib.rs`, add at the bottom:

```rust
#[cfg(test)]
mod tests {
    use super::format_elapsed;

    #[test]
    fn under_an_hour_shows_minutes_and_seconds() {
        assert_eq!(format_elapsed(0), "0:00");
        assert_eq!(format_elapsed(59_000), "0:59");
        assert_eq!(format_elapsed(23 * 60_000 + 45_000), "23:45");
    }

    #[test]
    fn an_hour_and_up_gains_the_hours_field() {
        assert_eq!(format_elapsed(3_600_000), "1:00:00");
        assert_eq!(format_elapsed(3_600_000 + 23 * 60_000 + 45_000), "1:23:45");
    }

    #[test]
    fn negative_clock_skew_clamps_to_zero() {
        assert_eq!(format_elapsed(-5_000), "0:00");
    }
}
```

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL — `format_elapsed` not defined. (No toolchain: mark as CI-verified.)

- [ ] **Step 3: Implement.** Replace `src-tauri/src/lib.rs` with:

```rust
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// What the web app last told us. `title`/`started_at_ms` are only meaningful
/// while `running` is true.
#[derive(Default, Clone)]
struct TimerState {
    running: bool,
    title: String,
    started_at_ms: Option<i64>,
}

struct Shared {
    state: Mutex<TimerState>,
}

/// Handles the ticker thread needs to rewrite the tray. Cloned menu items are
/// live handles onto the same native menu.
struct TrayHandles {
    status: MenuItem<tauri::Wry>,
    start: MenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
}

const TRAY_ID: &str = "chroneli-tray";
const IDLE_ICON: &[u8] = include_bytes!("../icons/tray-idle.png");
const RECORDING_ICON: &[u8] = include_bytes!("../icons/tray-recording.png");

fn format_elapsed(ms: i64) -> String {
    let total_secs = (ms.max(0)) / 1000;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let seconds = total_secs % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The web app pushes every running-entry change through here.
#[tauri::command]
fn timer_state(app: AppHandle, running: bool, title: String, started_at_ms: Option<i64>) {
    let shared = app.state::<Shared>();
    *shared.state.lock().unwrap() = TimerState { running, title, started_at_ms };
    refresh_tray(&app);
}

/// Rewrites icon, tooltip and menu from the current state. Called on every
/// state push and once a second by the ticker while running.
fn refresh_tray(app: &AppHandle) {
    let state = { app.state::<Shared>().state.lock().unwrap().clone() };
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    let Some(handles) = app.try_state::<TrayHandles>() else { return };

    let icon_bytes = if state.running { RECORDING_ICON } else { IDLE_ICON };
    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
    }

    if state.running {
        let title = if state.title.trim().is_empty() { "Untitled" } else { state.title.trim() };
        let elapsed = format_elapsed(now_ms() - state.started_at_ms.unwrap_or(now_ms()));
        let line = format!("{elapsed} · {title}");
        let _ = tray.set_tooltip(Some(&line));
        let _ = handles.status.set_text(&line);
    } else {
        let _ = tray.set_tooltip(Some("Chroneli — no timer running"));
        let _ = handles.status.set_text("No timer running");
    }
    let _ = handles.start.set_enabled(!state.running);
    let _ = handles.stop.set_enabled(state.running);
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Shared { state: Mutex::new(TimerState::default()) })
        .invoke_handler(tauri::generate_handler![timer_state])
        .setup(|app| {
            let status = MenuItem::with_id(app, "status", "No timer running", false, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start timer", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop timer", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Chroneli", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &start, &stop, &open, &quit])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tauri::image::Image::from_bytes(IDLE_ICON)?)
                .tooltip("Chroneli — no timer running")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // The webview owns the mutations (auth lives there); the
                    // tray only asks. See use-desktop-bridge.ts.
                    "start" => { let _ = app.emit("tray-start", ()); }
                    "stop" => { let _ = app.emit("tray-stop", ()); }
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            app.manage(TrayHandles { status, start, stop });

            // Second-hand for the tray: the web app pushes only state CHANGES,
            // the elapsed text ticks here.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(1));
                let running = handle.state::<Shared>().state.lock().unwrap().running;
                if running {
                    refresh_tray(&handle);
                }
            });

            Ok(())
        })
        // Close hides to tray: the webview must stay alive or tray Start/Stop
        // has no authenticated page to act through. Quit lives in the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(Keep the `#[cfg(test)] mod tests` block from Step 2 at the bottom.)

- [ ] **Step 4: Test and smoke (toolchain permitting)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 3 tests PASS.
Run: `npm run tauri dev`, log in, then verify by hand: tray icon appears; starting a timer in the window flips the icon to the red-dot variant within a second and the menu's first line ticks; tray **Stop timer** stops the entry in the web UI; tray **Start timer** starts one; closing the window hides it and **Open Chroneli** brings it back; **Quit** exits.
If `invoke("timer_state")` is rejected in the console, the remote capability isn't reaching the page — recheck `capabilities/default.json` matches Task 4 Step 3 exactly (window `main`, exact origin, `core:default`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/icons/tray-idle.png src-tauri/icons/tray-recording.png scripts/make-icons.mjs
git commit -m "feat(desktop): the tray shows the running timer and can start and stop it"
```

---

### Task 6: Release CI + desktop docs

**Files:**
- Create: `.github/workflows/desktop.yml`
- Create: `docs/desktop.md`

**Interfaces:**
- Consumes: the buildable `src-tauri/` from Tasks 4–5.
- Produces: a draft GitHub release with `.exe` (NSIS) and two `.dmg`s on every `desktop-v*` tag.

- [ ] **Step 1: Author `.github/workflows/desktop.yml`:**

```yaml
name: desktop
on:
  push:
    tags:
      - "desktop-v*"

permissions:
  contents: write

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: "--target aarch64-apple-darwin"
          - platform: macos-latest
            args: "--target x86_64-apple-darwin"
          - platform: windows-latest
            args: ""
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ contains(matrix.args, 'aarch64') && 'aarch64-apple-darwin' || contains(matrix.args, 'x86_64-apple-darwin') && 'x86_64-apple-darwin' || '' }}
      # The shell has no frontend build (frontendDist is the production URL),
      # but the tauri CLI comes from devDependencies.
      - run: npm ci
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: desktop-v__VERSION__
          releaseName: "Chroneli Desktop v__VERSION__"
          releaseBody: |
            Unsigned builds — Windows: click through SmartScreen ("More info → Run anyway").
            macOS: right-click the app → Open the first time.
          releaseDraft: true
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Author `docs/desktop.md`** covering, in short sections: what the desktop app is (thin shell over chroneli.com — web deploys update it, shell releases are rare); local dev (`npm run tauri dev`, needs rustup + MSVC Build Tools on Windows / Xcode CLT on macOS); regenerating icons (`npm run icons` then `npm run tauri icon src-tauri/app-icon.png`); releasing (bump `version` in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, tag `desktop-vX.Y.Z`, push the tag, publish the draft release); the unsigned-install caveats verbatim from the release body; and the follow-ups deliberately not in v1 (signing/notarization, auto-updater, global shortcuts, idle detection).

- [ ] **Step 3: Validate the workflow YAML**

Run: `npx --yes yaml-lint .github/workflows/desktop.yml`
Expected: exits 0 with a "valid YAML" line.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/desktop.yml docs/desktop.md
git commit -m "feat(desktop): tagged releases build windows and mac installers"
```

- [ ] **Step 5: Ship check.** Run `npm test && npm run typecheck && npm run lint` one final time across the repo. Expected: all clean. Then hand off per superpowers:finishing-a-development-branch (the work is on `master` per this repo's habit — confirm with the user whether to push, and remind them the first real end-to-end release proof is pushing a `desktop-v0.1.0` tag and installing the artifacts).
