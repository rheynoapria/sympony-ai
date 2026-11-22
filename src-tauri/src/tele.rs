//! The Teleprompter's main side: a dropped .txt read as a script, and its reading keys taken from every app while it
//! reads (Ctrl+Option+Space / PageUp / PageDown / Backspace, and Esc while the strip is up): each one is `tele:key`
//! to the window reading.
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

const MAX: u64 = 1 << 20;

#[derive(Default)]
pub struct Tele {
    /// (the window reading, the newest ask's number, the keys taken)
    keys: Mutex<(String, f64, Vec<(Shortcut, &'static str)>)>,
    /// the files last dropped on the notch: the only ones `read` opens
    dropped: Mutex<Vec<std::path::PathBuf>>,
}

/// Files dropped on the notch window (its drag-and-drop event).
pub fn dropped(app: &AppHandle, paths: &[std::path::PathBuf]) {
    if let Some(t) = app.try_state::<Tele>() {
        *t.dropped.lock().unwrap() = paths.to_vec();
    }
}

/// The notch page (re)loads: whatever it held is let go (a reload while reading would leave Esc taken from every app).
pub fn reset(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(t) = a.try_state::<Tele>() {
            let gs = a.global_shortcut();
            let mut k = t.keys.lock().unwrap();
            for (s, _) in k.2.drain(..) {
                let _ = gs.unregister(s);
            }
            k.1 = 0.0;
        }
    });
}

fn wanted(with_esc: bool) -> Vec<(Shortcut, &'static str)> {
    let m = Some(Modifiers::CONTROL | Modifiers::ALT);
    let mut v = vec![
        (Shortcut::new(m, Code::Space), "pause"),
        (Shortcut::new(m, Code::PageUp), "faster"),
        (Shortcut::new(m, Code::PageDown), "slower"),
        (Shortcut::new(m, Code::Backspace), "back"),
    ];
    if with_esc {
        v.push((Shortcut::new(None, Code::Escape), "stop"));
    }
    v
}

/// A shortcut pressed: one of the reading keys (sent to its window), or not ours.
pub fn pressed(app: &AppHandle, sc: &Shortcut) -> bool {
    let Some(t) = app.try_state::<Tele>() else { return false };
    let k = t.keys.lock().unwrap();
    match k.2.iter().find(|(s, _)| s == sc) {
        Some((_, what)) => {
            let _ = app.emit_to(k.0.as_str(), "tele:key", *what);
            true
        }
        None => false,
    }
}

fn set_keys(app: &AppHandle, win: &str, on: bool, with_esc: bool, seq: f64) {
    let t = app.state::<Tele>();
    let mut k = t.keys.lock().unwrap();
    // (asks can arrive out of order: the newest wins)
    if seq < k.1 {
        return;
    }
    let gs = app.global_shortcut();
    let want = if on { wanted(with_esc) } else { vec![] };
    for (s, _) in k.2.iter().filter(|(s, _)| !want.iter().any(|(w, _)| w == s)) {
        let _ = gs.unregister(*s);
    }
    let mut taken = vec![];
    for (s, what) in want {
        if k.2.iter().any(|(h, _)| *h == s) || gs.register(s).is_ok() {
            taken.push((s, what));
        }
    }
    *k = (win.to_string(), seq, taken);
}

fn read(app: &AppHandle, path: &str) -> Value {
    let p = std::path::Path::new(path);
    // (a .txt dropped on the notch just now, nothing else)
    let ok = p.extension().is_some_and(|e| e.eq_ignore_ascii_case("txt")) && app.state::<Tele>().dropped.lock().unwrap().iter().any(|d| d == p);
    if !ok {
        return json!({"ok": false});
    }
    let Ok(m) = std::fs::metadata(p) else { return json!({"ok": false}) };
    if !m.is_file() {
        return json!({"ok": false});
    }
    if m.len() > MAX {
        return json!({"ok": false, "big": true});
    }
    match std::fs::read(p) {
        Ok(b) => json!({"ok": true, "name": p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(), "text": String::from_utf8_lossy(&b)}),
        Err(_) => json!({"ok": false}),
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Tele::default());
    let h = app.clone();
    reg.add("teleprompter.read", Box::new(move |_, a| Ok(read(&h, a.first().and_then(Value::as_str).unwrap_or("")))));
    let h = app.clone();
    reg.add("teleprompter.keys", Box::new(move |_, a| {
        let win = a.first().and_then(Value::as_str).unwrap_or(crate::notch::LABEL).to_string();
        let (on, esc, seq) = (a.get(1).and_then(Value::as_bool).unwrap_or(false), a.get(2).and_then(Value::as_bool).unwrap_or(false), a.get(3).and_then(Value::as_f64).unwrap_or(0.0));
        let h2 = h.clone();
        // (the shortcut plugin wants the main thread on macOS)
        let _ = h.run_on_main_thread(move || set_keys(&h2, &win, on, esc, seq));
        Ok(Value::Null)
    }));
}
