//! macOS notifications under the notch: banners read the moment they appear (Accessibility, every 250 ms) and,
//! with "Don't show them twice" (`notifHideBanners`), closed so they show only in Sympony; usernoted's database read
//! every second for silent/missed notifications, while rows for already-shown banners only populate app metadata. Each new one is sent as `notif` and kept in the history.
use base64::Engine;
use platform::macos::{apps, notifications};
use serde_json::{json, Value};
use services::notif::{banner_app, parse_record, History, Recent};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

#[derive(Default)]
pub struct Notifs {
    history: Mutex<Option<History>>,
    access: Mutex<Value>,
    apps: Mutex<HashMap<String, (String, Value)>>, // bundle id → (name, icon data URL or null)
    recent: Mutex<Recent>,                          // banners shown, until their database row comes
}

/// The history's key, in `notif-history.key` (readable by this account only), made the first time. Not in the
/// Keychain: an app without an Apple Team ID is known there by its code hash, which changes with every build, so
/// macOS asked again after each update. Err when it can't be read or kept: the history then stays in memory.
fn key(dir: &std::path::Path) -> Result<[u8; 32], String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let b64 = base64::engine::general_purpose::STANDARD;
    let path = dir.join("notif-history.key");
    match std::fs::read_to_string(&path) {
        Ok(s) => b64.decode(s.trim()).ok().and_then(|v| <[u8; 32]>::try_from(v).ok()).ok_or_else(|| "the key file is damaged".to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let k = services::notif::new_key();
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path).map_err(|e| e.to_string())?;
            f.write_all(b64.encode(k).as_bytes()).map_err(|e| e.to_string())?;
            Ok(k)
        }
        Err(e) => Err(e.to_string()),
    }
}

fn with_history<T>(app: &AppHandle, f: impl FnOnce(&mut History) -> T) -> T {
    let n = app.state::<Notifs>();
    if n.history.lock().unwrap().is_none() {
        let dir = app.state::<App>().data_dir.clone();
        let h = match key(&dir) {
            Ok(k) => History::open(&dir, k),
            Err(e) => {
                app.state::<App>().log.line(&format!("notifications: history kept in memory only, its key: {e}"));
                History::memory(&dir)
            }
        };
        let mut slot = n.history.lock().unwrap();
        if slot.is_none() {
            *slot = Some(h);
        }
    }
    let mut h = n.history.lock().unwrap();
    f(h.as_mut().unwrap())
}

/// History off: what was kept goes, file and all (also copies kept aside).
fn drop_history(app: &AppHandle) -> bool {
    let had = app.state::<Notifs>().history.lock().unwrap().take().is_some();
    let dir = app.state::<App>().data_dir.clone();
    let mut removed = false;
    for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with("notif-history.") && (name.ends_with(".json") || name.ends_with(".unreadable")) {
            removed |= std::fs::remove_file(e.path()).is_ok();
        }
    }
    had || removed
}

fn changed(app: &AppHandle) {
    let s = with_history(app, |h| h.summary());
    let _ = app.emit("notif:history", s);
}

fn app_info(app: &AppHandle, id: &str) -> (String, Value) {
    let n = app.state::<Notifs>();
    let mut cache = n.apps.lock().unwrap();
    cache.entry(id.to_string()).or_insert_with(|| {
        let name = apps::app_name(id).unwrap_or_else(|| id.rsplit('.').next().unwrap_or(id).to_string());
        let icon = apps::icon_png(id, 64.0).and_then(|p| services::media::data_url(&p)).map(Value::String).unwrap_or(Value::Null);
        (name, icon)
    }).clone()
}

/// One new notification: under the notch (`popup`) and into the history.
#[allow(clippy::too_many_arguments)]
fn deliver(app: &AppHandle, s: &Value, id: &str, aumid: &str, name: &str, icon: Value, title: &str, subtitle: &str, body: &str, at: i64, popup: bool) {
    let title: String = match (title.is_empty(), subtitle.is_empty()) {
        (_, true) => title.to_string(),
        (true, false) => subtitle.to_string(),
        (false, false) => format!("{title} · {subtitle}"),
    };
    let title: String = title.chars().take(200).collect();
    let body: String = body.chars().take(500).collect();
    if popup {
        let msg = json!({ "id": id, "hid": id, "app": name, "title": title, "body": body, "icon": icon, "at": at,
            "aumid": aumid, "launch": "", "activation": "" });
        let _ = app.emit("notif", &msg);
    }
    if s["notifHistory"] != false {
        let days = s["notifHistoryDays"].as_i64().unwrap_or(3);
        let max = s["notifHistoryMax"].as_u64().unwrap_or(200) as usize;
        let item = json!({ "id": id, "aumid": aumid, "app": name, "title": title, "body": body, "at": at });
        with_history(app, |h| h.add(item, chrono::Utc::now().timestamp_millis(), days, max));
        changed(app);
    }
}

/// The banners: read as they appear, closed with "Don't show them twice".
fn watch_banners(app: AppHandle) {
    use platform::macos::banners;
    std::thread::spawn(move || {
        let mut seen: std::collections::VecDeque<String> = Default::default();
        let mut asked = false;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let s = app.state::<App>().settings.snapshot();
            if s["notifEnabled"] != true {
                continue;
            }
            if !banners::trusted(false) {
                if !asked {
                    asked = true;
                    banners::trusted(true); // macOS's prompt, once per run
                }
                continue;
            }
            for b in banners::banners() {
                if b.id.is_empty() || seen.contains(&b.id) {
                    continue;
                }
                seen.push_back(b.id.clone());
                if seen.len() > 200 {
                    seen.pop_front();
                }
                let name = banner_app(&b.description, &b.title);
                let aumid = apps::bundle_for_name(&name).unwrap_or_default();
                let icon = if aumid.is_empty() { Value::Null } else { app_info(&app, &aumid).1 };
                let id = format!("b:{}", b.id);
                let now = chrono::Utc::now().timestamp_millis();
                app.state::<Notifs>().recent.lock().unwrap().add(&id, &b.title, &b.body, now);
                if s["notifHideBanners"] != false {
                    banners::close(&b);
                }
                deliver(&app, &s, &id, &aumid, &name, icon, &b.title, &b.subtitle, &b.body, now, true);
            }
        }
    });
}

pub fn start(app: &AppHandle) {
    app.manage(Notifs::default());
    watch_banners(app.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: Option<i64> = None;
        let mut reader = notifications::Reader::new();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let s = app.state::<App>().settings.snapshot();
            if s["notifHistory"] == false && drop_history(&app) {
                let _ = app.emit("notif:history", json!({ "unseen": 0, "rev": chrono::Utc::now().timestamp_millis() }));
            }
            if s["notifEnabled"] != true {
                reader.close();
                last = None;
                continue;
            }
            let rows = match last {
                None => reader.max_rowid().map(|m| {
                    last = Some(m);
                    vec![]
                }),
                Some(after) => reader.read_after(after),
            };
            let access = match &rows {
                Ok(_) => json!({ "ok": true }),
                Err(notifications::Access::Denied) => json!({ "ok": false, "reason": "fullDiskAccess" }),
                Err(_) => json!({ "ok": false, "reason": "missing" }),
            };
            let was = std::mem::replace(&mut *app.state::<Notifs>().access.lock().unwrap(), access.clone());
            if was != access {
                app.state::<App>().log.line(&format!("notifications: {access}"));
            }
            let Ok(rows) = rows else { continue };
            // usernoted reset its database (ids went down): start again from its newest
            if rows.is_empty() {
                if let (Some(after), Ok(max)) = (last, reader.max_rowid()) {
                    if max < after {
                        last = Some(max);
                    }
                }
                continue;
            }
            let shown_from = rows.len().saturating_sub(5); // a pile after sleep: the newest five pop up, all are kept
            for (i, r) in rows.iter().enumerate() {
                last = Some(r.id);
                let Some(n) = parse_record(&r.data, &r.app) else { continue };
                if n.title.is_empty() && n.body.is_empty() && n.subtitle.is_empty() {
                    continue;
                }
                // its banner was shown already: only its app goes to the history
                let banner = app.state::<Notifs>().recent.lock().unwrap().take(&n.title, &n.body, chrono::Utc::now().timestamp_millis());
                if let Some(bid) = banner {
                    if !n.app_id.is_empty() {
                        with_history(&app, |h| h.set_app(&bid, &n.app_id));
                        changed(&app);
                    }
                    continue;
                }
                let (name, icon) = app_info(&app, &n.app_id);
                deliver(&app, &s, &r.id.to_string(), &n.app_id, &name, icon, &n.title, &n.subtitle, &n.body, n.at, i >= shown_from);
            }
        }
    });
}

/// The `notif` service (Windows' Do not disturb methods are excluded on a Mac).
pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let id = |args: &[Value]| args.first().map(|v| v.as_str().map(String::from).unwrap_or_else(|| v.to_string())).unwrap_or_default();
    let a = app.clone();
    reg.add("notif.access", Box::new(move |_, _| {
        let mut v = notif_access(&a);
        v["banners"] = json!(platform::macos::banners::trusted(false));
        Ok(v)
    }));
    reg.add("notif.grantBanners", Box::new(|_, _| {
        if !platform::macos::banners::trusted(true) {
            let _ = std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility").status();
        }
        Ok(Value::Null)
    }));
    fn notif_access(a: &AppHandle) -> Value {
        let v = a.state::<Notifs>().access.lock().unwrap().clone();
        // not polled yet (notifications off): ask now
        if v.is_null() {
            match notifications::max_rowid() {
                Ok(_) => json!({ "ok": true }),
                Err(notifications::Access::Denied) => json!({ "ok": false, "reason": "fullDiskAccess" }),
                Err(_) => json!({ "ok": false, "reason": "missing" }),
            }
        } else {
            v
        }
    }
    reg.add("notif.grant", Box::new(|_, _| {
        let _ = std::process::Command::new("/usr/bin/open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles").status();
        Ok(Value::Null)
    }));
    reg.add("notif.open", Box::new(move |_, args| {
        let bundle = id(&args);
        if !bundle.is_empty() {
            let _ = std::process::Command::new("/usr/bin/open").args(["-b", &bundle]).status();
        }
        Ok(Value::Null)
    }));
    let a = app.clone();
    reg.add("notif.history", Box::new(move |_, _| {
        let s = a.state::<App>().settings.get();
        let days = s["notifHistoryDays"].as_i64().unwrap_or(3);
        let max = s["notifHistoryMax"].as_u64().unwrap_or(200) as usize;
        if s["notifHistory"] == false {
            return Ok(json!({ "items": [], "unseen": 0, "rev": 0, "days": days, "max": max, "apps": {} }));
        }
        let mut v = with_history(&a, |h| h.view_at(chrono::Utc::now().timestamp_millis(), days, max));
        // each app's name and icon, for the rows and the filters
        let mut apps = serde_json::Map::new();
        for it in v["items"].as_array().cloned().unwrap_or_default() {
            if let Some(id) = it["aumid"].as_str().filter(|id| !id.is_empty() && !apps.contains_key(*id)) {
                let (name, icon) = app_info(&a, id);
                apps.insert(id.to_string(), json!({ "name": name, "icon": icon }));
            }
        }
        v["apps"] = Value::Object(apps);
        Ok(v)
    }));
    let a = app.clone();
    reg.add("notif.read", Box::new(move |_, args| {
        with_history(&a, |h| h.read(&id(&args)));
        changed(&a);
        Ok(Value::Null)
    }));
    let a = app.clone();
    reg.add("notif.remove", Box::new(move |_, args| {
        with_history(&a, |h| h.remove(&id(&args)));
        changed(&a);
        Ok(Value::Null)
    }));
    let a = app.clone();
    reg.add("notif.seen", Box::new(move |_, _| {
        with_history(&a, |h| h.seen());
        changed(&a);
        Ok(Value::Null)
    }));
    let a = app.clone();
    reg.add("notif.clear", Box::new(move |_, _| {
        with_history(&a, |h| h.clear());
        changed(&a);
        Ok(Value::Null)
    }));
    // Settings → Notifications → Send a test: a macOS notification of Sympony's own (osascript posts it)
    reg.add("notif.test", Box::new(|_, _| {
        let _ = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", "display notification \"Notifications from your apps show under the notch like this.\" with title \"Sympony test\""])
            .status();
        Ok(Value::Null)
    }));
    // (Telegram on a Mac posts macOS notifications: nothing to hint)
    reg.add("notif.telegram", Box::new(|_, _| Ok(json!({ "show": false }))));
}
