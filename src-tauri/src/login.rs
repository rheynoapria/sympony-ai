//! Launch at login (Settings → General, and the onboarding): the OS's list of apps started at login follows the
//! `launchAtLogin` setting, and the setting follows that list when it's changed there (Windows: Task Manager →
//! Startup apps, Settings → Apps → Startup). `platform::os::startup` keeps the list.
use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::commands::App;

/// The name Sympony is listed under (on Windows `Run\Sympony`, which Tauri's uninstaller also removes)
const NAME: &str = "Sympony";

/// A debug or test (`dev-drive`) build never lists itself: it would start `target\…` at login. Taking Sympony off the
/// list is fine from any build.
const MAY_LIST: bool = !cfg!(debug_assertions) && !cfg!(feature = "dev-drive");

fn note(app: &AppHandle, msg: &str) {
    app.state::<App>().log.line(&format!("launch at login: {msg}"));
}

fn list_this_app(app: &AppHandle) {
    let r = std::env::current_exe().map_err(|e| e.to_string()).and_then(|exe| platform::os::startup::register(NAME, &exe));
    match r {
        Ok(()) => note(app, "on"),
        Err(e) => note(app, &e),
    }
}

/// After a settings change: turning Launch at login on lists Sympony, turning it off takes it off the list.
pub fn settings_changed(app: &AppHandle, patch: &Value) {
    match patch.get("launchAtLogin").and_then(Value::as_bool) {
        Some(true) if MAY_LIST => list_this_app(app),
        Some(true) => note(app, "not listed from a debug or test build"),
        Some(false) => match platform::os::startup::unregister(NAME) {
            Ok(()) => note(app, "off"),
            Err(e) => note(app, &e),
        },
        None => {}
    }
}

/// At start and when Settings opens: the list and the setting agree again. While Sympony is on the list, the list
/// decides (it may have been turned off or on in Task Manager); while it isn't, the setting does, at start (so an
/// install that has it on, from the onboarding or before this, gets listed).
pub fn sync(app: &AppHandle, at_start: bool) {
    if !MAY_LIST {
        return;
    }
    let state = app.state::<App>();
    let on = state.settings.get()["launchAtLogin"] == true;
    match platform::os::startup::entry(NAME) {
        Some(entry) => {
            // (an entry left pointing at a copy that's gone, moved or installed elsewhere, now starts this one)
            if entry.enabled && !Path::new(platform::os::startup::program_of(&entry.command)).exists() {
                list_this_app(app);
            }
            if entry.enabled != on {
                // (straight into the settings: the change hook would list or unlist Sympony again)
                let out = state.settings.set(json!({ "launchAtLogin": entry.enabled }));
                (state.ctx.emit)("settings", out);
                note(app, if entry.enabled { "turned on outside Sympony" } else { "turned off outside Sympony" });
            }
        }
        None if on && at_start => list_this_app(app),
        None => {}
    }
}
