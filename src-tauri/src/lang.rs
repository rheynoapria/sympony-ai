//! Sympony's language (General → Language): English is the code itself; another language's table is downloaded
//! once into `<data>/lang/<code>.json` and put in every page before its scripts (`SYMPONY_STRINGS`, i18n.js).
//! Picked in Settings it's fetched first, then saved, and the save restarts Sympony. The rules are services::i18n's.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const BASE: &str = "https://raw.githubusercontent.com/rheynoapria/sympony-ai/main/translations/";
const DAY_S: i64 = 86_400;

/// The page globals for this run (the language is fixed until Sympony restarts).
static GLOBALS: OnceLock<String> = OnceLock::new();
/// The language this run uses.
static USING: OnceLock<String> = OnceLock::new();

#[derive(Default)]
pub struct Lang {
    /// a download going on or failed: {code, state, error?, missing?}
    job: Mutex<Option<Value>>,
}

pub fn globals() -> &'static str {
    GLOBALS.get().map(String::as_str).unwrap_or("")
}

pub fn using() -> String {
    USING.get().cloned().unwrap_or_else(|| "en".into())
}

fn dir(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.join("lang")
}

fn file(app: &AppHandle, code: &str) -> PathBuf {
    dir(app).join(format!("{code}.json"))
}

/// The list as kept (`{checked, list}`).
fn list(app: &AppHandle) -> Value {
    std::fs::read(dir(app).join("languages.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).map(|v| v["list"].clone()).unwrap_or(Value::Null)
}

/// Fetches the list when it's older than a day (or missing).
fn refresh_list(app: &AppHandle) {
    let path = dir(app).join("languages.json");
    let checked = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v["checked"].as_i64()).unwrap_or(0);
    let now = chrono::Utc::now().timestamp();
    if now - checked < DAY_S {
        return;
    }
    if let Ok(v) = services::http::get_json(&format!("{BASE}languages.json")) {
        if !services::i18n::offered(&v).is_empty() {
            let _ = std::fs::create_dir_all(dir(app));
            crate::files::save_json(&path, &json!({"checked": now, "list": v}));
        }
    }
}

fn system() -> Vec<String> {
    std::process::Command::new("/usr/bin/defaults").args(["read", "-g", "AppleLanguages"]).output().ok()
        .map(|o| services::i18n::system_codes(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default()
}

fn offered_codes(app: &AppHandle) -> Vec<(String, String, bool)> {
    services::i18n::offered(&list(app))
}

/// The language the setting wants now.
fn wanted(app: &AppHandle) -> String {
    let codes: Vec<String> = offered_codes(app).into_iter().map(|x| x.0).collect();
    services::i18n::resolve(app.state::<App>().settings.get()["language"].as_str().unwrap_or("auto"), &system(), &codes)
}

fn have(app: &AppHandle, code: &str) -> bool {
    code == "en" || std::fs::read(file(app, code)).ok().is_some_and(|b| services::i18n::table(&b).is_ok())
}

/// Before the first window: this run's language (the wanted one when it's here, else English).
pub fn init(app: &AppHandle) {
    app.manage(Lang::default());
    let want = wanted(app);
    let table = (want != "en").then(|| std::fs::read(file(app, &want)).ok().and_then(|b| services::i18n::table(&b).ok())).flatten();
    let using = if table.is_some() { want.clone() } else { "en".into() };
    let rtl = offered_codes(app).iter().any(|x| x.0 == using && x.2);
    let mut g = format!(";window.SYMPONY_OS={:?};window.SYMPONY_LANG={:?};", std::env::consts::OS, using);
    if std::env::var("SYMPONY_SHELL_DEV").ok().as_deref() == Some("1") {
        g += "window.SYMPONY_SHELL_DEV=true;";
    }
    if let Some(t) = table {
        g += &format!("window.SYMPONY_STRINGS={};", Value::Object(t));
    }
    if rtl {
        g += "window.SYMPONY_DIR='rtl';";
    }
    let _ = GLOBALS.set(g);
    let _ = USING.set(using);
}

fn name_of(app: &AppHandle, code: &str) -> String {
    offered_codes(app).into_iter().find(|x| x.0 == code).map(|x| x.1).unwrap_or_else(|| code.to_string())
}

fn state(app: &AppHandle) -> Value {
    let using = USING.get().cloned().unwrap_or_else(|| "en".into());
    let want = wanted(app);
    let windows = services::i18n::resolve("auto", &system(), &offered_codes(app).into_iter().map(|x| x.0).collect::<Vec<_>>());
    let langs: Vec<Value> = offered_codes(app).into_iter().map(|(code, name, _)| json!({"have": have(app, &code), "code": code, "name": name})).collect();
    let mut v = json!({"using": using, "windows": windows, "langs": langs});
    if want != using {
        v["want"] = json!(want);
    }
    if let Some(j) = app.state::<Lang>().job.lock().unwrap().clone() {
        v["job"] = j;
    }
    v
}

/// Downloads a language's table; Err((missing, error)).
fn download(app: &AppHandle, code: &str) -> Result<(), (bool, String)> {
    if !services::i18n::valid_code(code) {
        return Err((true, "no such language".into()));
    }
    *app.state::<Lang>().job.lock().unwrap() = Some(json!({"code": code, "state": "downloading"}));
    let r = (|| {
        let (status, _, bytes) = services::http::get_bytes(&format!("{BASE}{code}.json"), 4 << 20).map_err(|e| (false, e.to_string()))?;
        if status == 404 {
            return Err((true, "not available yet".to_string()));
        }
        if status != 200 {
            return Err((false, format!("HTTP {status}")));
        }
        services::i18n::table(&bytes).map_err(|e| (false, e))?;
        std::fs::create_dir_all(dir(app)).map_err(|e| (false, e.to_string()))?;
        let tmp = file(app, code).with_extension("json.tmp");
        std::fs::write(&tmp, &bytes).and_then(|_| std::fs::rename(&tmp, file(app, code))).map_err(|e| (false, e.to_string()))
    })();
    *app.state::<Lang>().job.lock().unwrap() = match &r {
        Ok(()) => None,
        Err((missing, e)) => Some(json!({"code": code, "state": "failed", "error": e, "missing": missing})),
    };
    r
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let h = app.clone();
    reg.add("lang.state", Box::new(move |_, _| Ok(state(&h))));
    let h = app.clone();
    reg.add("lang.prepare", Box::new(move |_, a| {
        refresh_list(&h);
        let v = a.first().and_then(Value::as_str).unwrap_or("auto");
        let codes: Vec<String> = offered_codes(&h).into_iter().map(|x| x.0).collect();
        let code = services::i18n::resolve(v, &system(), &codes);
        if have(&h, &code) {
            return Ok(json!({"ok": true, "code": code}));
        }
        Ok(match download(&h, &code) {
            Ok(()) => json!({"ok": true, "code": code}),
            Err((missing, e)) => json!({"ok": false, "code": code, "missing": missing, "error": e}),
        })
    }));
    let h = app.clone();
    reg.add("lang.restart", Box::new(move |_, _| {
        restart(&h);
        Ok(Value::Null)
    }));
}

/// `language` was saved: Sympony starts again when that changes the language it uses.
pub fn changed(app: &AppHandle) {
    if USING.get().is_none_or(|u| *u != wanted(app)) {
        restart(app);
    }
}

/// A moment later (the answer and the settings are out first).
pub fn restart(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(400));
        h.restart();
    });
}

/// After start: the list kept fresh, and a language the setting wants but isn't here fetched quietly (then the
/// notch says it's ready and an open Settings shows it).
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        refresh_list(&app);
        let want = wanted(&app);
        if USING.get().is_some_and(|u| *u == want) || have(&app, &want) {
            return;
        }
        let r = download(&app, &want);
        let _ = app.emit("lang", state(&app));
        match r {
            Ok(()) => {
                let _ = app.emit("lang:ready", json!({"name": name_of(&app, &want)}));
            }
            Err((_, e)) => app.state::<App>().log.line(&format!("language {want}: {e}")),
        }
    });
}
