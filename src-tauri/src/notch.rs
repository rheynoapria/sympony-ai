//! The notch window `notch-1`: made, placed on its display around the camera notch, kept there as displays change.
use crate::commands::App;
use platform::geometry::{display_info, place, target, Rect};
use platform::os::{displays::displays_here, window::style_notch_window};
use serde_json::Value;
use std::sync::Mutex;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "notch-1";

/// Where the notch window is (desktop points) and what `notch:camera` & `notch:display` last said.
#[derive(Default)]
pub struct Notch {
    pub win: Mutex<Option<Rect>>,
    pub camera: Mutex<Option<Value>>,
    pub display: Mutex<Option<Value>>,
}

/// Main thread only (it reads NSScreen).
fn placement(app: &AppHandle) -> Option<(Rect, Option<Value>, Value)> {
    let setting = app.state::<App>().settings.get()["display"].as_str().unwrap_or("primary").to_string();
    let all = displays_here();
    target(&all, &setting).map(|d| {
        let (win, cam) = place(d);
        (win, cam, display_info(d))
    })
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Notch::default());
    let (win, cam, disp) = placement(app).unwrap_or((
        Rect { x: 0.0, y: 0.0, w: 820.0, h: 420.0 },
        None,
        serde_json::json!({ "id": 0, "w": 1512.0, "h": 982.0, "hasCamera": false }),
    ));
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("notch.html".into()))
            .initialization_script(crate::page_globals())
        .title("Sympony")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .focusable(false)
        .skip_taskbar(true)
        .position(win.x, win.y)
        .inner_size(win.w, win.h)
        .on_page_load(|w, p| {
            if p.event() == PageLoadEvent::Started {
                // a reload (or a crashed page) starts bridge.js's `seq` from 0 again
                let app = w.app_handle();
                if let Some(h) = app.try_state::<crate::hover::HoverState>() {
                    h.0.lock().unwrap().reset();
                }
                if let Some(s) = app.try_state::<crate::shell::Shell>() {
                    *s.open.lock().unwrap() = (false, 0);
                }
                crate::tele::reset(app);
            }
            if p.event() == PageLoadEvent::Finished {
                let app = w.app_handle();
                let notch = app.state::<Notch>();
                let disp = notch.display.lock().unwrap().clone();
                let cam = notch.camera.lock().unwrap().clone();
                let _ = w.emit_to(LABEL, "notch:display", disp);
                let _ = w.emit_to(LABEL, "notch:camera", cam);
                if let Some(x) = crate::shell::anchor_from_settings(app) {
                    let _ = w.emit_to(LABEL, "notch:anchor", x);
                }
            }
        })
        .build()?;
    if let Some(ns) = crate::native::window(&window) {
        // SAFETY: Tauri's own NSWindow for this window, on the main thread (setup)
        unsafe { style_notch_window(ns) };
    }
    let state = app.state::<Notch>();
    *state.win.lock().unwrap() = Some(win);
    *state.camera.lock().unwrap() = cam;
    *state.display.lock().unwrap() = Some(disp);
    watch_displays(app.clone());
    Ok(())
}

fn sync_on_main(a: &AppHandle) {
    let Some((win, cam, disp)) = placement(a) else { return };
    let state = a.state::<Notch>();
    let prev_win = *state.win.lock().unwrap();
    let moved = prev_win != Some(win);
    let size_changed = prev_win.is_some_and(|p| (p.w - win.w).abs() > 0.5 || (p.h - win.h).abs() > 0.5);
    let cam_changed = *state.camera.lock().unwrap() != cam;
    let disp_changed = state.display.lock().unwrap().as_ref() != Some(&disp);
    if moved {
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.set_position(LogicalPosition::new(win.x, win.y));
            let _ = w.set_size(LogicalSize::new(win.w, win.h));
        }
        *state.win.lock().unwrap() = Some(win);
    }
    if disp_changed {
        *state.display.lock().unwrap() = Some(disp.clone());
        let _ = a.emit_to(LABEL, "notch:display", disp);
    }
    if cam_changed {
        *state.camera.lock().unwrap() = cam.clone();
        let _ = a.emit_to(LABEL, "notch:camera", cam);
    }
    if size_changed {
        crate::shell::send_anchor(a);
    }
}

/// Immediately re-evaluates target display placement (e.g. when `Settings → Show Sympony on` changes).
pub fn sync_now(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || sync_on_main(&a));
}

/// ponytail: polls every 2 s instead of observing NSApplicationDidChangeScreenParametersNotification
fn watch_displays(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let a = app.clone();
        let _ = app.run_on_main_thread(move || sync_on_main(&a));
    });
}

/// `displays_list`: [{ id, label, name }], "(built-in)" on the one with the camera.
pub fn list(app: &AppHandle) -> Value {
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app.run_on_main_thread(move || {
        let _ = tx.send(displays_here());
    });
    let all = rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap_or_default();
    Value::Array(
        all.iter()
            .map(|d| {
                let label = if d.camera.is_some() { format!("{} (built-in)", d.name) } else { d.name.clone() };
                serde_json::json!({ "id": d.id.to_string(), "label": label, "name": d.name })
            })
            .collect(),
    )
}
