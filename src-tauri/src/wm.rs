//! Sympony over other apps' windows (on Windows; a Mac's notch never makes way, its `foreground_state` is always
//! "normal", so nothing here moves there):
//! - the app in front fullscreen on Sympony's display sends it up out of sight (Settings → General → Hide when an app
//!   is fullscreen): the frontend slides it away (`notch:leaving`), then the window is hidden (`notch:visible`);
//! - a HUD meanwhile brings it in for its moment (Settings → HUD → Show over fullscreen apps, `notch_hud`): the
//!   closed notch shows that HUD alone (`notch:hudOnly`), nothing opens it and clicks go through to the app;
//! - the app in front being fullscreen is told to the frontend (`shell:fg`), which then draws nothing.
use crate::commands::App;
use crate::notch::LABEL;
use serde_json::json;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Where Sympony is: in its place, out of sight for a fullscreen app, or in over it for a HUD.
const SHOWN: u8 = 0;
const OUT: u8 = 1;
const HUD: u8 = 2;
static PLACE: AtomicU8 = AtomicU8::new(SHOWN);

/// When the HUD's moment ends.
static HUD_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);
/// Wakes the watch at once (a HUD asked to come in).
static WAKE: OnceLock<Mutex<Sender<()>>> = OnceLock::new();

/// How long the frontend's slide away takes (notch.js `leaveTo`), before the window is hidden.
const SLIDE_AWAY: Duration = Duration::from_millis(260);

/// Out of sight, or in only for a HUD: no hover, nothing opens it.
pub fn away() -> bool {
    PLACE.load(Ordering::Relaxed) != SHOWN
}

/// A HUD wants to show for `ms` while Sympony is out of sight.
pub fn hud(app: &AppHandle, ms: f64) {
    let s = app.state::<App>().settings.get();
    if !away() || s["hudOverFullscreen"] == false {
        return;
    }
    let until = Instant::now() + Duration::from_millis(ms.clamp(300.0, 10_000.0) as u64);
    *HUD_UNTIL.lock().unwrap() = Some(until);
    if let Some(w) = WAKE.get() {
        let _ = w.lock().unwrap().send(());
    }
}

pub fn start(app: &AppHandle) {
    // (a Mac's notch never makes way: nothing to watch there)
    if cfg!(target_os = "macos") {
        return;
    }
    let (tx, rx) = channel();
    let _ = WAKE.set(Mutex::new(tx));
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = "";
        loop {
            let _ = rx.recv_timeout(Duration::from_millis(250));
            let Some(w) = app.get_webview_window(LABEL) else { continue };
            let Some(handle) = crate::native::window(&w) else { continue };
            // SAFETY: the notch window's own handle, alive while `w` is
            let front = unsafe { platform::os::window::foreground_state(handle) };
            // ("max" would tuck the notch away over every maximised window: it stays "normal" until Settings' other
            // way, Keep windows below Sympony (a reserved strip at the top), is there to choose instead)
            let front = if front == "max" { "normal" } else { front };
            if front != last {
                last = front;
                let _ = app.emit_to(LABEL, "shell:fg", json!({ "state": front }));
            }
            let s = app.state::<App>().settings.get();
            let hide = front == "full" && s["hideInFullscreen"] != false && s["shellForm"] != "drawer";
            let hud = HUD_UNTIL.lock().unwrap().is_some_and(|t| Instant::now() < t);
            match (PLACE.load(Ordering::Relaxed), hide, hud) {
                (SHOWN, true, _) => go_away(&app, &w, false),
                (OUT, false, _) => come_in(&app, handle, false),
                (OUT, true, true) => come_in(&app, handle, true),
                (HUD, true, false) => go_away(&app, &w, true),
                (HUD, false, _) => {
                    PLACE.store(SHOWN, Ordering::Relaxed);
                    let _ = app.emit_to(LABEL, "notch:hudOnly", false);
                }
                _ => {}
            }
        }
    });
}

/// Slides it away, then hides the window (unless it was asked back meanwhile).
fn go_away(app: &AppHandle, w: &tauri::WebviewWindow, from_hud: bool) {
    PLACE.store(OUT, Ordering::Relaxed);
    crate::hover::leave(app);
    let _ = app.emit_to(LABEL, "notch:leaving", true);
    std::thread::sleep(SLIDE_AWAY);
    if PLACE.load(Ordering::Relaxed) == OUT {
        let _ = w.hide();
        let _ = app.emit_to(LABEL, "notch:visible", false);
    }
    if from_hud {
        let _ = app.emit_to(LABEL, "notch:hudOnly", false);
    }
}

/// Shows the window without taking the keyboard, above the app, and slides it in: back in its place, or in for a HUD.
fn come_in(app: &AppHandle, handle: *mut std::ffi::c_void, for_hud: bool) {
    PLACE.store(if for_hud { HUD } else { SHOWN }, Ordering::Relaxed);
    let handle = handle as usize;
    let _ = app.run_on_main_thread(move || {
        // SAFETY: the notch window's handle, read just now; level 25: above everything, shown without activating
        unsafe { platform::os::window::set_window_level(handle as *mut std::ffi::c_void, 25, Some(false)) };
    });
    let _ = app.emit_to(LABEL, "notch:hudOnly", for_hud);
    let _ = app.emit_to(LABEL, "notch:visible", true);
    let _ = app.emit_to(LABEL, "notch:leaving", false);
}
