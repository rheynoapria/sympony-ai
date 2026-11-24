//! The commands `frontend/bridge.js` invokes, with its argument names.
use serde_json::Value;
use services::{not_implemented, Ctx, Registry};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct App {
    pub settings: Arc<services::settings::Settings>,
    pub deps: services::Deps,
    pub log: std::sync::Arc<services::Log>,
    pub data_dir: std::path::PathBuf,
    pub reg: Registry,
    pub ctx: Ctx,
    pub warned: Mutex<HashSet<String>>,
}

/// Async: off the main thread, so a service doing network calls never blocks the UI.
#[tauri::command]
pub async fn svc(handle: tauri::AppHandle, name: String, method: String, args: Vec<Value>) -> Result<Value, String> {
    // (on a thread for blocking work: an AI agent's answer can take minutes, and the async workers stay free)
    tauri::async_runtime::spawn_blocking(move || {
        let app = handle.state::<App>();
        app.reg.call(&app.ctx, &format!("{name}.{method}"), args)
    })
    .await
    .map_err(|e| e.to_string())
}

/// The calendar is sent as the `calendar` event: once more now (`calendar_get`), or after fetching the feeds.
#[tauri::command]
pub fn calendar_get(handle: tauri::AppHandle) {
    crate::calendar::send_last(&handle);
    crate::calendar::kick(&handle, false);
}

#[tauri::command]
pub async fn calendar_refresh(handle: tauri::AppHandle) -> Result<(), String> {
    crate::calendar::kick(&handle, true);
    Ok(())
}

#[tauri::command]
pub fn open_calendar_app() {
    std::thread::spawn(|| {
        let _ = std::process::Command::new("/usr/bin/open").args(["-b", "com.apple.iCal"]).status();
    });
}

/// Files dropped on Share: the macOS share menu at the mouse.
#[tauri::command]
pub fn share_files(handle: tauri::AppHandle, window: tauri::WebviewWindow, files: Value) {
    let paths = files.as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
    crate::files::share(&handle, Some(window), paths);
}

/// Shelf items dragged out of the window: a real file drag (Finder, Mail…).
#[tauri::command]
pub fn shelf_start_drag(handle: tauri::AppHandle, window: tauri::WebviewWindow, ids: Value) {
    crate::files::drag_out(&handle, window, ids.as_array().cloned().unwrap_or_default());
}

/// On a Mac the notch takes ← / → by taking the keyboard itself (notch.js syncArrows → notch_focus): nothing to grab.
#[tauri::command]
pub fn notch_arrows(want: bool) {
    let _ = want;
}

/// A HUD while Sympony is out of sight for a fullscreen app: a Mac's notch never hides itself, so it shows anyway.
#[tauri::command]
pub fn notch_hud(ms: f64) {
    let _ = ms;
}

#[tauri::command]
pub fn update_state(handle: tauri::AppHandle) -> Value {
    crate::updater::state_json(&handle)
}

#[tauri::command]
pub async fn update_check(handle: tauri::AppHandle, install: Option<bool>) -> Value {
    crate::updater::check_now(handle, install.unwrap_or(false), false).await
}

#[tauri::command]
pub fn update_page(handle: tauri::AppHandle) -> Value {
    crate::updater::open_release_page(&handle)
}

#[tauri::command]
pub fn floating_chat_open(handle: tauri::AppHandle) {
    crate::floating_chat::open(&handle);
}

#[tauri::command]
pub fn floating_chat_close(handle: tauri::AppHandle) {
    crate::floating_chat::close(&handle);
}

#[tauri::command]
pub fn floating_chat_toggle(handle: tauri::AppHandle) {
    crate::floating_chat::toggle(&handle);
}

#[tauri::command]
pub fn floating_chat_pin(handle: tauri::AppHandle, pinned: bool) -> Value {
    crate::floating_chat::set_pin(&handle, pinned)
}

#[tauri::command]
pub fn floating_chat_state(handle: tauri::AppHandle) -> Value {
    crate::floating_chat::state_json(&handle)
}

#[tauri::command]
pub fn floating_chat_dock(handle: tauri::AppHandle) {
    crate::floating_chat::dock_to_notch(&handle);
}

#[tauri::command]
pub fn floating_chat_open_module(handle: tauri::AppHandle, module: String) {
    crate::floating_chat::open_notch_module(&handle, &module);
}

#[macro_export]
macro_rules! all_commands {
    () => {
        tauri::generate_handler![
            commands::svc, commands::settings_get, commands::settings_set, commands::settings_secret,
            commands::settings_reset, commands::settings_open, commands::displays_list, commands::app_info,
            commands::app_quit, commands::log, commands::open_external, commands::helper_state, commands::helper_cmd,
            commands::notch_hitrect, commands::notch_opened, commands::notch_focus, commands::notch_arrows,
            commands::notch_drag, commands::notch_hud, commands::calendar_get,
            commands::calendar_refresh, commands::open_calendar_app, commands::share_files, commands::shelf_start_drag,
            commands::update_state, commands::update_check, commands::update_page,
            commands::floating_chat_open, commands::floating_chat_close, commands::floating_chat_toggle,
            commands::floating_chat_pin, commands::floating_chat_state, commands::floating_chat_dock,
            commands::floating_chat_open_module,
            onboarding::onboarding_state, onboarding::onboarding_phase, onboarding::onboarding_lower,
            onboarding::onboarding_cancel_wait, onboarding::onboarding_hint, onboarding::onboarding_finish,
            onboarding::onboarding_skip, onboarding::onboarding_open, media::app_icon
        ]
    };
}

#[tauri::command]
pub fn log(app: State<App>, window: tauri::Window, msg: String) {
    app.log.line(&format!("[{}] {msg}", window.label()));
}

#[tauri::command]
pub fn app_info(app: State<App>) -> Value {
    serde_json::json!({ "version": env!("CARGO_PKG_VERSION"), "userData": app.data_dir })
}

#[tauri::command]
pub fn app_quit(handle: tauri::AppHandle) {
    handle.exit(0);
}

/// A web, mail or settings link (`services::external_url_ok`) in the app that handles it: `open` on macOS,
/// ShellExecute on Windows (`platform::os::shell`).
#[tauri::command]
pub async fn open_external(app: State<'_, App>, url: String) -> Result<bool, String> {
    if !services::external_url_ok(&url) {
        app.log.line(&format!("open_external: refused {url:?}"));
        return Ok(false);
    }
    Ok(tauri::async_runtime::spawn_blocking(move || platform::os::shell::open(&url)).await.unwrap_or(false))
}

#[tauri::command]
pub fn settings_get(app: State<App>) -> Value {
    app.settings.get()
}

/// Applies a settings patch, notifies background services and all windows, and syncs shortcut/anchor.
pub fn apply_settings_patch(handle: &tauri::AppHandle, mut patch: Value) -> Value {
    let app = handle.state::<App>();
    // Dragging any manual size slider in Settings automatically switches Size mode from Auto to Custom.
    if let Some(obj) = patch.as_object_mut() {
        let touches_manual_size = ["notchWidth", "notchHeight", "expandedWidth", "expandedHeight", "expandedHeightTall"]
            .iter()
            .any(|k| obj.contains_key(*k));
        if touches_manual_size && !obj.contains_key("notchSizeMode") {
            obj.insert("notchSizeMode".into(), Value::from("custom"));
        }
    }
    let moved = patch.get("notchPosition").is_some();
    let out = app.settings.set(patch.clone());
    crate::background::settings_changed(handle, &patch);
    (app.ctx.emit)("settings", out.clone());
    crate::shell::sync_shortcut(handle);
    crate::colorpick::sync_shortcut(handle);
    if moved {
        crate::shell::send_anchor(handle);
    }
    out
}

/// Every change goes to all windows as `settings`.
#[tauri::command]
pub fn settings_set(handle: tauri::AppHandle, _app: State<App>, patch: Value) -> Value {
    apply_settings_patch(&handle, patch)
}

#[tauri::command]
pub fn settings_reset(handle: tauri::AppHandle, app: State<App>) -> Value {
    let out = app.settings.reset();
    (app.ctx.emit)("settings", out.clone());
    crate::shell::sync_shortcut(&handle);
    crate::colorpick::sync_shortcut(&handle);
    crate::shell::send_anchor(&handle);
    out
}

#[tauri::command]
pub fn settings_secret(handle: tauri::AppHandle, app: State<App>, key: String, value: String) -> Result<Value, String> {
    app.settings.secret(&key, &value).map_err(|e| e.to_string())?;
    let out = app.settings.get();
    (app.ctx.emit)("settings", out.clone());
    crate::background::settings_changed(&handle, &serde_json::json!({ format!("has_{key}"): true }));
    Ok(out)
}

#[tauri::command]
pub async fn displays_list(handle: tauri::AppHandle) -> Value {
    crate::notch::list(&handle)
}

/// The frontend's hover area; stale ones (lower `seq`) are dropped.
#[tauri::command]
pub fn notch_hitrect(handle: tauri::AppHandle, r: Value) {
    crate::hover::set_area(&handle, &r);
}

#[tauri::command]
pub fn notch_opened(handle: tauri::AppHandle, open: bool, seq: u64) {
    crate::shell::opened(&handle, open, seq);
}

#[tauri::command]
pub fn notch_focus(handle: tauri::AppHandle, want: bool) {
    crate::shell::focus(&handle, want);
}

#[tauri::command]
pub fn notch_drag(handle: tauri::AppHandle, action: String) {
    crate::shell::drag(&handle, &action);
}

#[tauri::command]
pub fn settings_open(handle: tauri::AppHandle, section: Option<String>) {
    crate::settings_window::open(&handle, section);
}

/// What the native watchers know now.
#[tauri::command]
pub fn helper_state(
    handle: tauri::AppHandle,
    app: State<App>,
    media: State<crate::media::Media>,
    latest: State<crate::watchers::Latest>,
    notch: State<crate::notch::Notch>,
) -> Value {
    let mut s = serde_json::Map::new();
    // (not the frontend's helper data, but its events may come before the page listens: the boot reads them here)
    s.insert("camera".into(), notch.camera.lock().unwrap().clone().unwrap_or(Value::Null));
    s.insert("display".into(), notch.display.lock().unwrap().clone().unwrap_or(Value::Null));
    if let Some(x) = crate::shell::anchor_from_settings(&handle) {
        s.insert("anchor".into(), serde_json::json!(x));
    }
    for (k, v) in latest.all().into_iter().chain([("prayer", app.deps.prayer.last()), ("media", media.last())]) {
        if !v.is_null() {
            s.insert(k.into(), v);
        }
    }
    Value::Object(s)
}

/// The frontend's controls: `{cmd:"media", action, value}`, … Async: the helper may take a moment.
#[tauri::command]
pub async fn helper_cmd(handle: tauri::AppHandle, cmd: Value) {
    match cmd["cmd"].as_str().unwrap_or("") {
        "media" => crate::media::command(&handle, cmd["action"].as_str().unwrap_or(""), &cmd["value"]),
        "media.seek" => crate::media::command(&handle, "seek", &cmd["position"]),
        _ if crate::watchers::command(&cmd) => {}
        other => {
            let app = handle.state::<App>();
            not_implemented(&app.warned, &app.ctx, &format!("helper_cmd {other}"));
        }
    }
}
