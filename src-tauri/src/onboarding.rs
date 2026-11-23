//! First-run onboarding window (`onboarding`): Phase A fullscreen over the notch display (real notch hidden),
//! Phase B centered card window (real notch back), plus IPC commands for hints, lowering, finish, and skip.
use crate::commands::{apply_settings_patch, App};
use crate::notch;
use platform::geometry::Display;
use platform::os::displays::{displays_here, dock_rect};
use platform::os::system::onscreen_windows;
use serde_json::{json, Value};
use services::onboarding::{patch, perms_for, picks_from, skip_patch, Feel};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "onboarding";

#[derive(Default)]
pub struct Onboarding {
    pub imported: Mutex<bool>,
    pub phase: Mutex<String>,
    pub display: Mutex<Option<Display>>,
    pub windows: Mutex<Vec<Value>>,
    pub deferred_settings: Mutex<Option<Option<String>>>,
}

pub fn is_opening(app: &AppHandle) -> bool {
    app.try_state::<Onboarding>()
        .is_some_and(|o| o.phase.lock().unwrap().as_str() == "opening")
}

pub fn defer_settings(app: &AppHandle, section: Option<String>) {
    if let Some(o) = app.try_state::<Onboarding>() {
        *o.deferred_settings.lock().unwrap() = Some(section);
    }
}

fn flush_deferred_settings(app: &AppHandle) {
    let pending = app
        .try_state::<Onboarding>()
        .and_then(|o| o.deferred_settings.lock().unwrap().take());
    if let Some(section) = pending {
        crate::settings_window::open(app, section);
    }
}

fn pick_display() -> Option<Display> {
    let all = displays_here();
    let mut chosen = all
        .iter()
        .find(|d| d.camera.is_some())
        .or_else(|| all.iter().find(|d| d.main))
        .or_else(|| all.first())
        .cloned();
    // Dev helper to test external-display (camera: null) behavior on a notched MacBook.
    if std::env::var("SYMPONY_ONBOARDING_FLAT").as_deref() == Ok("1") {
        if let Some(d) = chosen.as_mut() {
            d.camera = None;
        }
    }
    chosen
}

fn set_notch_visible(app: &AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window(notch::LABEL) {
        if visible {
            let _ = w.show();
        } else {
            let _ = w.hide();
        }
    }
}

/// Opens the onboarding window (single instance). Starts in Phase A ("opening").
pub fn open(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.show();
            let _ = w.set_focus();
            return;
        }
        let Some(disp) = pick_display() else {
            a.state::<App>().log.line("onboarding: no display found");
            return;
        };
        let frame = disp.frame;
        // Capture on-screen window bounds (kCGWindowBounds only, no titles -> no Screen Recording) + Dock rect.
        let mut wins: Vec<Value> = onscreen_windows(frame, std::process::id())
            .into_iter()
            .map(|r| json!({ "x": r.x, "y": r.y, "w": r.w, "h": r.h, "kind": "win" }))
            .collect();
        if let Some(mtm) = platform::os::MainThreadMarker::new() {
            if let Some(dock) = dock_rect(mtm, disp.id) {
                wins.push(json!({ "x": dock.x, "y": dock.y, "w": dock.w, "h": dock.h, "kind": "dock" }));
            }
        }
        a.state::<App>().log.line(&format!(
            "onboarding: open on {:?} (camera={:?}, windows={}), perm.status={}",
            disp.name,
            disp.camera,
            wins.len(),
            crate::perm::status_value()
        ));
        if let Some(st) = a.try_state::<Onboarding>() {
            *st.display.lock().unwrap() = Some(disp);
            *st.windows.lock().unwrap() = wins;
            *st.phase.lock().unwrap() = "opening".into();
        }

        // Hide real notch during Phase A (opening overlay)
        set_notch_visible(&a, false);

        #[cfg(target_os = "macos")]
        let _ = a.set_activation_policy(tauri::ActivationPolicy::Regular);

        let url = WebviewUrl::App("settings-dist/onboarding.html".into());
        let built = WebviewWindowBuilder::new(&a, LABEL, url)
            .initialization_script(crate::page_globals())
            .title("Sympony")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .focusable(true)
            .skip_taskbar(true)
            .position(frame.x, frame.y)
            .inner_size(frame.w, frame.h)
            .build();

        match built {
            Ok(w) => {
                if let Some(ns) = crate::native::window(&w) {
                    // SAFETY: live NSWindow on the main thread
                    unsafe { platform::os::window::style_onboarding_window(ns, 25) };
                }
                let _ = w.set_focus();
                let h = a.clone();
                w.on_window_event(move |e| {
                    if matches!(e, WindowEvent::Destroyed) {
                        if let Some(st) = h.try_state::<Onboarding>() {
                            st.phase.lock().unwrap().clear();
                        }
                        set_notch_visible(&h, true);
                        #[cfg(target_os = "macos")]
                        if h.get_webview_window(crate::settings_window::LABEL).is_none() {
                            let _ = h.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                        flush_deferred_settings(&h);
                    }
                });
            }
            Err(e) => {
                if let Some(st) = a.try_state::<Onboarding>() {
                    st.phase.lock().unwrap().clear();
                }
                set_notch_visible(&a, true);
                #[cfg(target_os = "macos")]
                if a.get_webview_window(crate::settings_window::LABEL).is_none() {
                    let _ = a.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
                a.state::<App>().log.line(&format!("onboarding window: {e}"));
            }
        }
    });
}

/// Returns the initial onboarding state: picks, perms, camera rect, imported flag, language, version, and prayer city.
#[tauri::command]
pub fn onboarding_state(handle: AppHandle) -> Value {
    let app = handle.state::<App>();
    let settings = app.settings.get();
    let picks = picks_from(&settings);
    let perms = perms_for(&picks);
    let ob = handle.state::<Onboarding>();
    let imported = *ob.imported.lock().unwrap();
    let disp = ob.display.lock().unwrap().clone();
    let windows = ob.windows.lock().unwrap().clone();
    let display_rect = disp.as_ref().map(|d| {
        json!({
            "x": d.frame.x.round(),
            "y": d.frame.y.round(),
            "w": d.frame.w.round(),
            "h": d.frame.h.round(),
        })
    });
    let camera = disp.and_then(|d| {
        d.camera.map(|c| {
            json!({
                "x": (c.x - d.frame.x).round(),
                "w": c.w.round(),
                "h": c.h.round(),
            })
        })
    });
    let lang = crate::lang::using();
    let prayer_city = settings
        .get("prayerCity")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            settings
                .get("weatherLocation")
                .and_then(|v| v.get("name"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(String::from)
        });
    json!({
        "picks": picks,
        "perms": perms,
        "display": display_rect,
        "camera": camera,
        "windows": windows,
        "imported": imported,
        "lang": lang,
        "version": env!("CARGO_PKG_VERSION"),
        "prayerCity": prayer_city,
        "look": settings.get("notchLook").and_then(Value::as_str).unwrap_or("black"),
        "openOnHover": settings.get("openOnHover").and_then(Value::as_bool).unwrap_or(true),
        "launchAtLogin": settings.get("launchAtLogin").and_then(Value::as_bool).unwrap_or(true),
    })
}

/// Switches the onboarding window between Phase A ("opening" fullscreen) and Phase B ("card" exact screen frame).
#[tauri::command]
pub fn onboarding_phase(
    handle: AppHandle,
    phase: String,
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
) {
    let a = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        let Some(win) = a.get_webview_window(LABEL) else { return };
        let ob = a.state::<Onboarding>();
        let Some(disp) = ob.display.lock().unwrap().clone() else { return };
        let prev_phase = {
            let mut p = ob.phase.lock().unwrap();
            let old = p.clone();
            *p = phase.clone();
            old
        };
        match phase.as_str() {
            "opening" => {
                set_notch_visible(&a, false);
                let _ = win.set_effects(None);
                let _ = win.set_position(LogicalPosition::new(disp.frame.x, disp.frame.y));
                let _ = win.set_size(LogicalSize::new(disp.frame.w, disp.frame.h));
                if let Some(ns) = crate::native::window(&win) {
                    unsafe {
                        platform::os::window::set_window_alpha(ns, 1.0);
                        platform::os::window::set_window_shadow(ns, false);
                        platform::os::window::set_window_level(ns, 25, Some(false));
                    }
                }
                let _ = win.set_focus();
            }
            "card" => {
                let win_w = w.unwrap_or(560.0).clamp(480.0, disp.frame.w);
                let win_h = h.unwrap_or(560.0).clamp(320.0, disp.frame.h);
                let pos_x = x
                    .unwrap_or_else(|| disp.frame.x + ((disp.frame.w - win_w) / 2.0).round())
                    .round();
                let pos_y = y
                    .unwrap_or_else(|| disp.frame.y + ((disp.frame.h - win_h) / 2.0).round())
                    .round();
                // No native vibrancy on the card window: the v6 card draws its own near-opaque background and radius,
                // leaving the 40px shadow margin around it completely transparent.
                let _ = win.set_effects(None);
                let _ = win.set_size(LogicalSize::new(win_w.round(), win_h.round()));
                let _ = win.set_position(LogicalPosition::new(pos_x, pos_y));
                if prev_phase != "card" {
                    if let Some(ns) = crate::native::window(&win) {
                        unsafe {
                            platform::os::window::set_window_alpha(ns, 1.0);
                            platform::os::window::set_window_shadow(ns, false);
                            // Floating above regular desktop windows, well below the notch (level 25)
                            platform::os::window::set_window_level(ns, 3, Some(false));
                        }
                    }
                    set_notch_visible(&a, true);
                    let _ = win.set_focus();
                    flush_deferred_settings(&a);
                }
            }
            _ => {}
        }
    });
}

/// Drops the onboarding card behind system dialogs / System Settings (`lower = true`), or brings it back (`false`).
#[tauri::command]
pub fn onboarding_lower(handle: AppHandle, lower: bool) {
    let a = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        let Some(win) = a.get_webview_window(LABEL) else { return };
        if let Some(ns) = crate::native::window(&win) {
            let level = if lower { 0 } else { 3 };
            unsafe {
                platform::os::window::set_window_alpha(ns, if lower { 0.0 } else { 1.0 });
                platform::os::window::set_window_level(ns, level, Some(lower));
            }
        }
        if !lower {
            let _ = win.set_focus();
        }
    });
}

/// Cancels an active permission wait (e.g. when the user clicks the hint toast in the real notch).
#[tauri::command]
pub fn onboarding_cancel_wait(handle: AppHandle) {
    let _ = handle.emit_to(notch::LABEL, "onboard:hint", json!({ "state": "clear", "text": "" }));
    let _ = handle.emit_to(LABEL, "onboard:cancel-wait", json!(true));
    let a = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        let Some(win) = a.get_webview_window(LABEL) else { return };
        if let Some(ns) = crate::native::window(&win) {
            unsafe {
                platform::os::window::set_window_alpha(ns, 1.0);
                platform::os::window::set_window_level(ns, 3, Some(false));
            }
        }
        let _ = win.set_focus();
    });
}

/// Sends a hint toast to the real notch window (`onboard:hint`).
#[tauri::command]
pub fn onboarding_hint(handle: AppHandle, state: String, text: String) {
    let _ = handle.emit_to(notch::LABEL, "onboard:hint", json!({ "state": state, "text": text }));
}

/// Writes the user's onboarding choices in one `settings_set`, toasts ready in the real notch, and closes onboarding.
#[tauri::command]
pub fn onboarding_finish(handle: AppHandle, picks: Vec<String>, feel: Feel) -> Value {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let cur = handle.state::<App>().settings.get();
    let p = patch(&cur, &picks, &feel, now_ms);
    let out = apply_settings_patch(&handle, p);

    let ready_text = if crate::lang::using() == "id" {
        "Sympony siap"
    } else {
        "Sympony is ready"
    };
    let _ = handle.emit_to(
        notch::LABEL,
        "onboard:hint",
        json!({ "state": "ready", "text": ready_text }),
    );

    let a = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        set_notch_visible(&a, true);
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.close();
        }
    });
    out
}

/// Marks onboarding skipped (`onboarded: {at, version: 1, skipped: true}`), leaving all other settings untouched.
#[tauri::command]
pub fn onboarding_skip(handle: AppHandle) -> Value {
    let now_ms = chrono::Utc::now().timestamp_millis();
    let out = apply_settings_patch(&handle, skip_patch(now_ms));
    let _ = handle.emit_to(notch::LABEL, "onboard:hint", json!({ "state": "clear", "text": "" }));
    let a = handle.clone();
    let _ = handle.run_on_main_thread(move || {
        set_notch_visible(&a, true);
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.close();
        }
    });
    out
}

/// Opens onboarding on demand (e.g. from Settings → About).
#[tauri::command]
pub fn onboarding_open(handle: AppHandle) {
    open(&handle);
}
