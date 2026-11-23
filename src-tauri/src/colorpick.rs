//! The screen colour picker (Windows: the Control tab's Color picker tile and the `colorPickShortcut` setting): a
//! magnifier over a still of the screens (`platform::os::displays::pick_color`); the colour picked is copied as
//! `colorPickFormat` says and shown in the notch (`colorpick:picked`).
use crate::commands::App;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

/// The shortcut registered for it, and the setting last refused (logged once).
static SHORTCUT: Mutex<(Option<Shortcut>, String)> = Mutex::new((None, String::new()));
static PICKING: AtomicBool = AtomicBool::new(false);

/// Starts the picker (once at a time) on a thread of its own.
pub fn pick(app: &AppHandle) {
    if PICKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let picked = platform::os::displays::pick_color();
        PICKING.store(false, Ordering::SeqCst);
        let Some(rgb) = picked else { return };
        let format = app.state::<App>().settings.get()["colorPickFormat"].as_str().unwrap_or("hex").to_string();
        let (code, css) = services::colorpick::code(rgb, &format);
        let ok = platform::os::files::write_text(&code);
        let _ = app.emit("colorpick:picked", json!({ "code": code, "css": css, "ok": ok }));
    });
}

/// (Re)registers `colorPickShortcut`, as `shell::sync_shortcut` does the toggle's.
pub fn sync_shortcut(app: &AppHandle) {
    use crate::shortcut::{decide, Decision};
    let wanted = app.state::<App>().settings.get()["colorPickShortcut"].as_str().unwrap_or("").to_string();
    let gs = app.global_shortcut();
    let mut s = SHORTCUT.lock().unwrap();
    let (current, last_bad) = &mut *s;
    let drop_current = |current: &mut Option<Shortcut>| {
        if let Some(old) = current.take() {
            let _ = gs.unregister(old);
        }
    };
    match decide(&wanted, *current, last_bad) {
        Decision::Keep => {}
        Decision::Unregister => drop_current(current),
        Decision::Bad => {
            drop_current(current);
            app.state::<App>().log.line(&format!("color picker: can't use the shortcut {wanted:?}"));
            *last_bad = wanted;
        }
        Decision::Register(sc) => {
            drop_current(current);
            match gs.register(sc) {
                Ok(()) => *current = Some(sc),
                Err(e) => {
                    app.state::<App>().log.line(&format!("color picker: can't use the shortcut {wanted:?}: {e}"));
                    *last_bad = wanted;
                }
            }
        }
    }
}

/// A shortcut pressed: the picker's (it starts), or not.
pub fn pressed(app: &AppHandle, sc: &Shortcut) -> bool {
    let ours = SHORTCUT.lock().unwrap().0.as_ref() == Some(sc);
    if ours {
        pick(app);
    }
    ours
}
