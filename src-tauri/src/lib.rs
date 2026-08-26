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

/// Rewrites icon, tooltip and menu from the current state. Called on every
/// state push and once a second by the ticker while running.
fn refresh_tray(app: &AppHandle) {
    let state = { app.state::<Shared>().state.lock().unwrap().clone() };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return;
    };

    let icon_bytes = if state.running {
        RECORDING_ICON
    } else {
        IDLE_ICON
    };
    if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
        let _ = tray.set_icon(Some(icon));
    }

    if state.running {
        let title = if state.title.trim().is_empty() {
            "Untitled"
        } else {
            state.title.trim()
        };
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
        .manage(Shared {
            state: Mutex::new(TimerState::default()),
        })
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
                    "start" => {
                        let _ = app.emit("tray-start", ());
                    }
                    "stop" => {
                        let _ = app.emit("tray-stop", ());
                    }
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
