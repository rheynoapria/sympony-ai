//! Click-through: the notch window ignores the mouse except over the frontend's hover area; entering and leaving it
//! is `notch:hover`. A 60 Hz check on the main thread (where AppKit's mouse position and the window live).
use crate::commands::App;
use crate::notch::{Notch, LABEL};
use platform::os::MainThreadMarker;
use platform::os::displays::mouse_location;
use services::hit::{HitMsg, Hover};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct HoverState(pub Mutex<Hover>);

pub fn set_area(app: &AppHandle, r: &serde_json::Value) {
    if let Some(msg) = HitMsg::parse(r) {
        let fresh = {
            let st = app.state::<HoverState>();
            let mut h = st.0.lock().unwrap();
            let fresh = !h.has_area();
            h.apply(msg);
            fresh
        };
        // a page that just loaded: on a Mac there's one notch window, so it's the one that chimes and plays the
        // focus sound
        if fresh {
            let _ = app.emit_to(LABEL, "notch:soundHere", true);
            let _ = app.emit_to(LABEL, "notch:focusHere", true);
        }
    }
}

pub fn start(app: &AppHandle) {
    app.manage(HoverState::default());
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_ignore_cursor_events(true);
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(16));
        let a = app.clone();
        let _ = app.run_on_main_thread(move || tick(&a));
    });
}

/// Sympony out of sight for a fullscreen app (`wm`): the pointer counts as gone, so the frontend hears the hover end
/// and clicks go through to the app.
pub fn leave(app: &AppHandle) {
    let (ended, peek_ended) = {
        let st = app.state::<HoverState>();
        let mut h = st.0.lock().unwrap();
        let _ = h.update_clickable((-1e6, -1e6));
        (h.update((-1e6, -1e6)), h.update_peek((-1e6, -1e6)))
    };
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.set_ignore_cursor_events(true);
    }
    if peek_ended == Some(false) {
        let _ = app.emit_to(LABEL, "pony:near", false);
    }
    if ended == Some(false) {
        let _ = app.emit_to(LABEL, "notch:hover", false);
    }
}

fn tick(app: &AppHandle) {
    // (no hover while it's out of sight, or in only for a HUD)
    if crate::wm::away() {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else { return };
    let Some(win) = *app.state::<Notch>().win.lock().unwrap() else { return };
    let (mx, my) = mouse_location(mtm);
    let (x, y) = (mx - win.x, my - win.y);
    let (changed, clickable, near, peek) = {
        let st = app.state::<HoverState>();
        let mut h = st.0.lock().unwrap();
        (h.update((x, y)), h.update_clickable((x, y)), h.update_near((x, y)), h.update_peek((x, y)))
    };
    if let Some(c) = clickable {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.set_ignore_cursor_events(!c);
        }
    }
    if let Some(n) = near {
        let _ = app.emit_to(LABEL, "notch:near", n);
    }
    if let Some(p) = peek {
        let _ = app.emit_to(LABEL, "pony:near", p);
    }
    if let Some(inside) = changed {
        let _ = app.emit_to(LABEL, "notch:hover", inside);
        app.state::<App>().log.line(&format!("hover {} at {x:.0},{y:.0}", if inside { "IN " } else { "OUT" }));
    }
}
