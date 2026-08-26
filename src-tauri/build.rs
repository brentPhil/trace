fn main() {
    // The window loads the REMOTE origin https://chroneli.com, and in Tauri 2 a
    // command invoked from a remote origin has to resolve an explicit ACL entry.
    // `core:default` grants the CORE plugins only — it never grants an app
    // command — so with a bare `tauri_build::build()` there is no
    // `allow-timer-state` permission anywhere in the ACL and every
    // `invoke("timer_state", …)` from the page is rejected. The Rust still
    // compiles and the unit tests still pass, because none of it crosses IPC.
    //
    // Declaring the command here autogenerates `allow-timer-state` /
    // `deny-timer-state` under the `__app-acl__` key, which
    // `capabilities/default.json` then grants.
    //
    // NOTE: an app manifest also flips tauri's `has_app_acl_manifest` on, which
    // starts gating LOCAL origins too. The capability covers both — it sets no
    // `local: false` — so this does not trade one broken path for another.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["timer_state"])),
    )
    .expect("failed to run tauri-build");
}
