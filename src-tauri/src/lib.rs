pub mod browser_auth;

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// What the web app last told us. `title`/`started_at_ms` are only meaningful
/// while `running` is true.
///
/// `started_at_ms` IS NOT the Convex `startedAt`. That value is server time,
/// and this process subtracts it from the local `SystemTime` clock — so on a
/// machine whose clock drifts, a raw server instant would make the tray and
/// the page disagree about the same entry by the full skew. The web app
/// therefore subtracts its own measured skew before pushing, and what arrives
/// here is a DEVICE-clock instant: `now_ms() - started_at_ms` is term-for-term
/// what the page displays. See `ShellTimerState.startedAtMs` in
/// src/lib/desktop-bridge.ts, which carries the other half of this contract.
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
    /// Which icon the tray is currently showing — `Some(true)` for recording,
    /// `Some(false)` for idle. `None` is the pre-init value only: it is seeded
    /// `Some(false)` the moment the tray is built, and a failed swap leaves the
    /// previous value rather than clearing it, so nothing puts it back to
    /// `None`. It stays an `Option` because `None != Some(_)` is exactly the
    /// "we do not know what is on screen, draw it" comparison a future
    /// build-before-seed reordering would need.
    ///
    /// Only ever touched on the main thread inside `render_tray`, so it is
    /// never contended; the `Mutex` is here for interior mutability, not for
    /// synchronisation.
    shown_running: Mutex<Option<bool>>,
}

const TRAY_ID: &str = "chroneli-tray";
const IDLE_ICON: &[u8] = include_bytes!("../icons/tray-idle.png");
const RECORDING_ICON: &[u8] = include_bytes!("../icons/tray-recording.png");

/// The wire contract with the web app, in one place.
///
/// These four strings are the whole of the shell's public surface, and every
/// one of them is matched by a bare literal in `src/lib/desktop-bridge.ts`. A
/// rename on this side is not a compile error on either side — it is a shell
/// that silently stops responding — so `the_wire_identifiers_are_pinned` holds
/// them still. They are `pub` because they genuinely are this crate's exported
/// contract, and because that keeps `TIMER_STATE_COMMAND` (which nothing in the
/// Rust build reads — see below) out of the dead-code lint.
///
/// `#[tauri::command]` derives the invoke name from the function IDENTIFIER, so
/// this const cannot be the source of truth for it; it is a tripwire that
/// `the_command_const_matches_the_handler_function` checks against the real
/// identifier. Do not "clean up" by renaming the `timer_state` fn to match some
/// other spelling of the const — the fn name is what goes on the wire.
pub const TIMER_STATE_COMMAND: &str = "timer_state";
/// Emitted when Start is chosen in the tray menu; the webview does the work.
pub const TRAY_START_EVENT: &str = "tray-start";
/// Emitted when Stop is chosen in the tray menu; the webview does the work.
pub const TRAY_STOP_EVENT: &str = "tray-stop";
/// The label of the one window, as declared in `tauri.conf.json`.
pub const MAIN_WINDOW_LABEL: &str = "main";

const IDLE_TOOLTIP: &str = "Chroneli — no timer running";
const IDLE_STATUS: &str = "No timer running";
/// Shown in place of the elapsed time when a running entry arrives with no
/// start time. Convex will not currently produce that, but a frozen "0:00" is
/// indistinguishable from a timer that just started, and a tray that lies is
/// worse than one that admits it does not know.
const UNKNOWN_ELAPSED: &str = "—:—";

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

/// The single line the tray shows for `state` — tooltip and status item both.
/// `None` means nothing is running, and the caller renders the idle text.
///
/// Pure, so the parts that are easy to get quietly wrong (the empty-title
/// fallback, a missing start time, an elapsed clock that has gone backwards)
/// are reachable from a test without a running event loop.
///
/// `now` and `state.started_at_ms` are both device-clock instants — see
/// `TimerState` — so the subtraction needs no correction of its own.
fn tray_line(state: &TimerState, now: i64) -> Option<String> {
    if !state.running {
        return None;
    }
    let trimmed = state.title.trim();
    let title = if trimmed.is_empty() {
        "Untitled"
    } else {
        trimmed
    };
    let elapsed = match state.started_at_ms {
        Some(started_at) => format_elapsed(now - started_at),
        None => UNKNOWN_ELAPSED.to_string(),
    };
    Some(format!("{elapsed} · {title}"))
}

/// Which icon depicts `running`.
fn tray_icon_bytes(running: bool) -> &'static [u8] {
    if running {
        RECORDING_ICON
    } else {
        IDLE_ICON
    }
}

/// Whether the menu offers Start and Stop.
///
/// Named fields rather than a `(bool, bool)` on purpose. Both halves have the
/// same type, an inversion still compiles and still runs, and the only symptom
/// is a tray that offers Start while a timer is running — so the pairing has to
/// be legible at the call site (`enabled.start` beside `handles.start`) rather
/// than positional, where destructuring in the other order looked fine.
#[derive(Debug, PartialEq, Eq)]
struct MenuEnabled {
    start: bool,
    stop: bool,
}

fn start_stop_enabled(running: bool) -> MenuEnabled {
    MenuEnabled {
        start: !running,
        stop: running,
    }
}

/// The web app pushes every running-entry change through here.
#[tauri::command]
fn timer_state(app: AppHandle, running: bool, title: String, started_at_ms: Option<i64>) {
    {
        let shared = app.state::<Shared>();
        *shared.state.lock().unwrap() = TimerState {
            running,
            title,
            started_at_ms,
        };
    }
    refresh_tray(&app);
}

/// Asks for the tray to be rewritten from the current state. Safe to call from
/// any thread; see `render_tray` for why it must go through the main thread as
/// one piece.
fn refresh_tray(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || render_tray(&handle));
}

/// Rewrites icon, tooltip and menu from the current state. **Main thread only**
/// — go through `refresh_tray`.
///
/// The snapshot is taken *here*, inside the main-thread task, and every native
/// write happens before this function returns. That is load-bearing rather than
/// tidy. Each of `set_tooltip`, `set_text` and `set_enabled` is a blocking
/// round trip to the main thread (tauri's `run_item_main_thread!`), and when
/// they are issued from a worker thread the main thread goes back to its event
/// loop between them. An IPC `timer_state(running: false)` could therefore run
/// to completion in the middle of the ticker's refresh, and the ticker's
/// remaining writes — taken from a snapshot that was true a moment ago — would
/// land last and win: recording icon, a stale "0:12 · Foo", Stop enabled, for a
/// timer that has already stopped. The ticker's own guard is `if running`, so
/// nothing would ever come back to correct it; the tray stayed wrong until the
/// user started something else.
///
/// Dispatching the whole render as one task closes that. `run_on_main_thread`
/// from a worker queues a task the event loop runs to completion, and the
/// nested round trips inside it resolve inline rather than re-entering the loop
/// (tauri-runtime-wry 2.11.4, `send_user_message` at src/lib.rs:235 — the
/// `current_thread().id() == context.main_thread_id` branch at :239 runs the
/// message directly instead of posting it to the proxy; re-check that on a
/// tauri major bump), so no second render can interleave. Called from the main
/// thread it runs inline and synchronously — same guarantee, no deadlock. And
/// because `timer_state` writes the state *before* asking for a refresh,
/// whichever render runs last necessarily reads the newest state.
///
/// LOCKS: nothing here may hold a `MutexGuard` across a tray or menu call. The
/// current shape is deliberate — `state` is cloned out of a temporary scope,
/// and `shown_running` is read into a `bool` and only re-locked afterwards — so
/// no guard is alive when a native call blocks.
///
/// As written today that costs nothing: every caller reaches this through
/// `refresh_tray`, so the body always runs ON the main thread and the native
/// calls inside it resolve inline without blocking on anything. The invariant
/// is here because it goes live again the instant either of two things stops
/// being true — someone calls `render_tray` directly from the ticker or another
/// worker thread, or tauri stops running a same-thread `send_user_message`
/// inline and starts queuing it. Then a hoisted named guard hangs the app: the
/// worker holds the mutex while blocking on the main-thread round trip, the
/// main thread blocks in `lock()` inside `timer_state`, and both are wedged —
/// tray dead, window frozen, only the task manager left. It is a two-line
/// change to cause and gives no warning at compile time, so keep the scopes
/// tight even while they are only insurance.
fn render_tray(app: &AppHandle) {
    let state = { app.state::<Shared>().state.lock().unwrap().clone() };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };

    // Once a second forever is a lot of PNG decoding and native icon swapping
    // for an image that changes when a timer starts or stops. Only touch it
    // when the state it depicts actually changed.
    let shown_running = *handles.shown_running.lock().unwrap();
    if shown_running != Some(state.running) {
        if let Ok(icon) = tauri::image::Image::from_bytes(tray_icon_bytes(state.running)) {
            if tray.set_icon(Some(icon)).is_ok() {
                *handles.shown_running.lock().unwrap() = Some(state.running);
            }
        }
    }

    match tray_line(&state, now_ms()) {
        Some(line) => {
            let _ = tray.set_tooltip(Some(&line));
            let _ = handles.status.set_text(&line);
        }
        None => {
            let _ = tray.set_tooltip(Some(IDLE_TOOLTIP));
            let _ = handles.status.set_text(IDLE_STATUS);
        }
    }

    let enabled = start_stop_enabled(state.running);
    let _ = handles.start.set_enabled(enabled.start);
    let _ = handles.stop.set_enabled(enabled.stop);
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let builder = tauri::Builder::default();

    // Close only hides the window and Quit lives ONLY in the tray menu, so a
    // user whose tray icon is buried in Windows 11's overflow flyout sees no
    // window and no icon and does the obvious thing: runs the exe again. Without
    // this guard that is a whole second instance — second webview, second tray
    // icon, second 1 Hz ticker — and neither one is obviously the impostor.
    // Hand the second launch's intent to the first instance instead.
    //
    // Registered before everything else so the second process gives up before it
    // builds a tray. Desktop only; the plugin does not exist on mobile.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        show_main_window(app);
    }));

    builder
        .manage(Shared {
            state: Mutex::new(TimerState::default()),
        })
        .invoke_handler(tauri::generate_handler![timer_state])
        .setup(|app| {
            let status = MenuItem::with_id(app, "status", IDLE_STATUS, false, None::<&str>)?;
            let start = MenuItem::with_id(app, "start", "Start timer", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop timer", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Chroneli", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&status, &start, &stop, &open, &quit])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(tauri::image::Image::from_bytes(tray_icon_bytes(false))?)
                .tooltip(IDLE_TOOLTIP)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    // The webview owns the mutations (auth lives there); the
                    // tray only asks. See use-desktop-bridge.ts.
                    "start" => {
                        let _ = app.emit(TRAY_START_EVENT, ());
                    }
                    "stop" => {
                        let _ = app.emit(TRAY_STOP_EVENT, ());
                    }
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            app.manage(TrayHandles {
                status,
                start,
                stop,
                // The builder above just drew the idle icon.
                shown_running: Mutex::new(Some(false)),
            });

            // Second-hand for the tray: the web app pushes only state CHANGES,
            // the elapsed text ticks here. Idle needs no tick — the line does
            // not change — and a stale tray can no longer outlive the push that
            // made it stale, so there is nothing for an idle tick to repair.
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

#[cfg(test)]
mod tests {
    use super::{
        format_elapsed, start_stop_enabled, tray_icon_bytes, tray_line, MenuEnabled, TimerState,
        IDLE_ICON, MAIN_WINDOW_LABEL, RECORDING_ICON, TIMER_STATE_COMMAND, TRAY_START_EVENT,
        TRAY_STOP_EVENT,
    };

    /// A running entry started `ago` ms before `NOW`.
    const NOW: i64 = 1_700_000_000_000;

    /// The same context `run()` builds the app from — `tauri.conf.json`, the
    /// capabilities in `capabilities/`, and the ACL `build.rs` generated from
    /// them — so what these tests interrogate is the real resolved ACL and not a
    /// hand-built stand-in. Written once: `generate_context!` embeds the config
    /// at every call site it expands at.
    fn acl_context() -> tauri::Context<tauri::Wry> {
        tauri::generate_context!()
    }

    /// The production origin the shipped window actually loads.
    fn remote_origin() -> tauri::ipc::Origin {
        tauri::ipc::Origin::Remote {
            url: "https://chroneli.com/".parse().unwrap(),
        }
    }

    fn running(title: &str, ago: i64) -> TimerState {
        TimerState {
            running: true,
            title: title.to_string(),
            started_at_ms: Some(NOW - ago),
        }
    }

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

    #[test]
    fn a_running_entry_reads_elapsed_then_title() {
        assert_eq!(
            tray_line(&running("Invoice run", 12_000), NOW).as_deref(),
            Some("0:12 · Invoice run")
        );
    }

    #[test]
    fn an_idle_state_has_no_line_at_all() {
        assert_eq!(tray_line(&TimerState::default(), NOW), None);
        // A stopped entry keeps its title and start time in the struct; neither
        // may leak into the tray.
        let stopped = TimerState {
            running: false,
            ..running("Invoice run", 12_000)
        };
        assert_eq!(tray_line(&stopped, NOW), None);
    }

    #[test]
    fn an_empty_or_blank_title_falls_back_to_untitled() {
        assert_eq!(
            tray_line(&running("", 5_000), NOW).as_deref(),
            Some("0:05 · Untitled")
        );
        assert_eq!(
            tray_line(&running("   \t ", 5_000), NOW).as_deref(),
            Some("0:05 · Untitled")
        );
    }

    #[test]
    fn a_title_is_trimmed_but_otherwise_left_alone() {
        assert_eq!(
            tray_line(&running("  Invoice run  ", 5_000), NOW).as_deref(),
            Some("0:05 · Invoice run")
        );
    }

    #[test]
    fn the_line_rolls_over_into_hours() {
        assert_eq!(
            tray_line(&running("Long one", 3_600_000 + 5_000), NOW).as_deref(),
            Some("1:00:05 · Long one")
        );
    }

    #[test]
    fn a_clock_that_went_backwards_shows_zero_not_a_negative() {
        // The entry claims to start ten seconds in the future.
        assert_eq!(
            tray_line(&running("Skewed", -10_000), NOW).as_deref(),
            Some("0:00 · Skewed")
        );
    }

    #[test]
    fn running_without_a_start_time_admits_it_does_not_know() {
        let state = TimerState {
            running: true,
            title: "Orphan".to_string(),
            started_at_ms: None,
        };
        // Not "0:00" — that is indistinguishable from a timer that just began
        // and would sit frozen there forever.
        assert_eq!(tray_line(&state, NOW).as_deref(), Some("—:— · Orphan"));
    }

    #[test]
    fn the_icon_follows_the_running_state() {
        assert_eq!(tray_icon_bytes(true), RECORDING_ICON);
        assert_eq!(tray_icon_bytes(false), IDLE_ICON);
        assert_ne!(tray_icon_bytes(true), tray_icon_bytes(false));
    }

    #[test]
    fn the_menu_offers_stop_while_running_and_start_while_idle() {
        // This pins the DECISION, and only that. It cannot reach `render_tray`'s
        // call site, which needs a live app handle: swap the two `set_enabled`
        // arguments there and every test in this file still passes. Naming the
        // fields on `MenuEnabled` is what covers the other half — `enabled.start`
        // beside `handles.start` reads wrong as soon as it is wrong, which a
        // positional `(bool, bool)` did not.
        assert_eq!(
            start_stop_enabled(true),
            MenuEnabled {
                start: false,
                stop: true
            }
        );
        assert_eq!(
            start_stop_enabled(false),
            MenuEnabled {
                start: true,
                stop: false
            }
        );
    }

    #[test]
    fn the_wire_identifiers_are_pinned() {
        // Matched by bare literals in src/lib/desktop-bridge.ts and by the
        // window label in tauri.conf.json. Changing one of these strings means
        // changing them there too, in the same commit.
        assert_eq!(TIMER_STATE_COMMAND, "timer_state");
        assert_eq!(TRAY_START_EVENT, "tray-start");
        assert_eq!(TRAY_STOP_EVENT, "tray-stop");
        assert_eq!(MAIN_WINDOW_LABEL, "main");
    }

    #[test]
    fn the_command_const_matches_the_handler_function() {
        // `#[tauri::command]` puts the function's IDENTIFIER on the wire, so the
        // const alone would not notice a rename. Naming the item here makes a
        // rename a compile error, and `stringify!` pins the spelling that the
        // web side's `invoke(...)` has to match.
        let _handler = super::timer_state;
        assert_eq!(TIMER_STATE_COMMAND, stringify!(timer_state));
    }

    /// The one test in this file that crosses the IPC boundary, and the reason
    /// the others were not enough.
    ///
    /// Everything above is a pure function. They all passed while the shell was
    /// completely inert: the window loads the REMOTE origin, a remote origin can
    /// only call a command that resolves an explicit ACL entry, `core:default`
    /// grants core plugins and never app commands, and `build.rs` generated no
    /// app manifest at all — so every `invoke("timer_state", …)` was rejected,
    /// the tray never heard about a timer, and the web side's `.catch(() => {})`
    /// swallowed the evidence. It compiled and shipped broken.
    ///
    /// So assert the thing that was actually false: the ACL baked into the
    /// binary lets the production origin call the command, on the main window.
    #[test]
    fn the_acl_lets_chroneli_com_call_timer_state() {
        let mut context = acl_context();
        let authority = context.runtime_authority_mut();

        let remote = remote_origin();
        assert!(
            authority
                .resolve_access(
                    TIMER_STATE_COMMAND,
                    MAIN_WINDOW_LABEL,
                    MAIN_WINDOW_LABEL,
                    &remote,
                )
                .is_some(),
            "the remote origin cannot invoke {TIMER_STATE_COMMAND}: no capability grants it"
        );

        // Declaring an app manifest flips tauri's app-ACL check on, which starts
        // gating the LOCAL origin too. The capability does not opt out of local,
        // so a dev build pointed at a bundled frontend must keep working.
        assert!(
            authority
                .resolve_access(
                    TIMER_STATE_COMMAND,
                    MAIN_WINDOW_LABEL,
                    MAIN_WINDOW_LABEL,
                    &tauri::ipc::Origin::Local,
                )
                .is_some(),
            "the local origin cannot invoke {TIMER_STATE_COMMAND}"
        );
    }

    /// The tray's Start/Stop are `app.emit`s, which the page only receives if it
    /// may run `plugin:event|listen` — and `onTrayCommand` calls the unlisten it
    /// returns. Narrowing the capability away from `core:default` is exactly the
    /// kind of change that takes those away without any other symptom.
    #[test]
    fn the_acl_lets_chroneli_com_listen_for_tray_events() {
        let mut context = acl_context();
        let authority = context.runtime_authority_mut();

        let remote = remote_origin();
        for command in ["plugin:event|listen", "plugin:event|unlisten"] {
            assert!(
                authority
                    .resolve_access(command, MAIN_WINDOW_LABEL, MAIN_WINDOW_LABEL, &remote)
                    .is_some(),
                "the remote origin cannot call {command}"
            );
        }
    }

    /// The other half of narrowing the capability: what the shell must NOT hand
    /// a hijacked chroneli.com.
    ///
    /// `core:default` used to grant all of these. `core:image:allow-from-path`
    /// plus `allow-rgba` is an arbitrary local file read for anything that
    /// decodes as an image — in a shell with no `fs` plugin at all. `TRAY_ID` is
    /// a public const, so `core:tray:allow-remove-by-id` lets the page delete
    /// Chroneli's own tray icon; since close only hides and Quit lives only in
    /// that menu, that leaves a running, invisible, un-quittable process.
    #[test]
    fn the_acl_withholds_what_a_plain_browser_tab_could_not_do() {
        let mut context = acl_context();
        let authority = context.runtime_authority_mut();

        let remote = remote_origin();
        for command in [
            "plugin:image|from_path",
            "plugin:image|rgba",
            "plugin:tray|new",
            "plugin:tray|remove_by_id",
            "plugin:tray|set_icon",
            "plugin:tray|set_menu",
            "plugin:menu|new",
            "plugin:menu|popup",
            "plugin:menu|set_as_app_menu",
            "plugin:path|resolve_directory",
        ] {
            assert!(
                authority
                    .resolve_access(command, MAIN_WINDOW_LABEL, MAIN_WINDOW_LABEL, &remote)
                    .is_none(),
                "the capability still grants {command} to the remote origin"
            );
        }
    }
}
