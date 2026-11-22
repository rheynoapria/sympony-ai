//! Clipboard history (`clipboard.json` + `clipboard/` for pictures; the rules are services::clipboard's): while
//! it's on, the pasteboard's change count is looked at twice a second and each new copy kept (not a private one, not
//! files copied in Finder). And the bookmarks' lookups: a page's title and icon, the clipboard's link.
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;
use platform::macos::files::{self as pb, Clip};

/// A copied text over this isn't kept (a whole file's worth).
const MAX_TEXT: usize = 1 << 20;

#[derive(Default)]
pub struct Clipboard {
    list: Mutex<Vec<Value>>,
}

fn dir(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.join("clipboard")
}

fn file(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.join("clipboard.json")
}

fn image_path(app: &AppHandle, id: &str) -> PathBuf {
    dir(app).join(format!("{id}.png"))
}

/// What fell off (their pictures go too).
fn forget(app: &AppHandle, gone: &[Value]) {
    for g in gone.iter().filter(|g| g["kind"] == "image") {
        let _ = std::fs::remove_file(image_path(app, g["id"].as_str().unwrap_or("")));
    }
}

fn changed(app: &AppHandle) -> Value {
    let list = {
        let st = app.state::<Clipboard>();
        let l = st.list.lock().unwrap();
        crate::files::save_json(&file(app), &*l);
        l.clone()
    };
    let v = Value::Array(list);
    let _ = app.emit("clipboard:changed", v.clone());
    v
}

fn max(app: &AppHandle) -> usize {
    app.state::<App>().settings.snapshot()["clipboardMax"].as_u64().unwrap_or(30).clamp(5, 100) as usize
}

/// A PNG's size from its header.
fn png_size(b: &[u8]) -> (u32, u32) {
    if b.len() < 24 || &b[1..4] != b"PNG" {
        return (0, 0);
    }
    (u32::from_be_bytes([b[16], b[17], b[18], b[19]]), u32::from_be_bytes([b[20], b[21], b[22], b[23]]))
}

fn image_item(app: &AppHandle, png: &[u8]) -> Option<Value> {
    let id = crate::files::new_id();
    let hash = format!("{:x}", crate::files::hash(&base64::engine::general_purpose::STANDARD.encode(&png[..png.len().min(1 << 16)])) ^ png.len() as u64);
    // the same picture copied again: no new file
    if let Some(old) = app.state::<Clipboard>().list.lock().unwrap().iter().find(|x| x["hash"] == hash.as_str()) {
        let mut v = old.clone();
        v["at"] = json!(chrono::Utc::now().timestamp_millis());
        return Some(v);
    }
    let _ = std::fs::create_dir_all(dir(app));
    let path = image_path(app, &id);
    std::fs::write(&path, png).ok()?;
    let (w, h) = png_size(png);
    // (kept in the item: no cached copy to outlive it)
    let thumb = crate::files::thumbnail(&path.to_string_lossy(), &app.state::<App>().data_dir.join("thumbs"));
    Some(json!({"id": id, "kind": "image", "text": "", "len": 0, "thumb": thumb, "w": w, "h": h, "size": png.len(), "hash": hash,
        "pinned": false, "at": chrono::Utc::now().timestamp_millis()}))
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Clipboard::default());
    let h = app.clone();
    reg.add("clipboard.list", Box::new(move |_, _| Ok(Value::Array(h.state::<Clipboard>().list.lock().unwrap().clone()))));
    let h = app.clone();
    reg.add("clipboard.copy", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("");
        let Some(it) = h.state::<Clipboard>().list.lock().unwrap().iter().find(|x| x["id"] == id).cloned() else { return Ok(json!(false)) };
        Ok(json!(if it["kind"] == "image" {
            std::fs::read(image_path(&h, id)).is_ok_and(|b| pb::write_png(&b))
        } else {
            pb::write_text(it["text"].as_str().unwrap_or(""))
        }))
    }));
    let h = app.clone();
    reg.add("clipboard.pin", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("");
        let on = a.get(1).and_then(Value::as_bool).unwrap_or(true);
        {
            let st = h.state::<Clipboard>();
            let mut l = st.list.lock().unwrap();
            services::clipboard::pin(&mut l, id, on);
            let gone = services::clipboard::trim(&mut l, max(&h));
            drop(l);
            forget(&h, &gone);
        }
        Ok(changed(&h))
    }));
    let h = app.clone();
    reg.add("clipboard.remove", Box::new(move |_, a| {
        let gone = services::clipboard::remove(&mut h.state::<Clipboard>().list.lock().unwrap(), a.first().and_then(Value::as_str).unwrap_or(""));
        forget(&h, &gone.into_iter().collect::<Vec<_>>());
        Ok(changed(&h))
    }));
    let h = app.clone();
    reg.add("clipboard.clear", Box::new(move |_, _| {
        let gone = services::clipboard::clear(&mut h.state::<Clipboard>().list.lock().unwrap());
        forget(&h, &gone);
        Ok(changed(&h))
    }));
    let h = app.clone();
    reg.add("clipboard.open", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("");
        let link = h.state::<Clipboard>().list.lock().unwrap().iter().find(|x| x["id"] == id && x["kind"] == "link").and_then(|x| x["text"].as_str().map(|t| t.trim().to_string()));
        if let Some(u) = link.filter(|u| services::shelf::is_link(u)) {
            std::thread::spawn(move || {
                let _ = std::process::Command::new("/usr/bin/open").arg("--").arg(&u).status();
            });
        }
        Ok(Value::Null)
    }));
    reg.add("bookmarks.clipboard", Box::new(|_, _| {
        Ok(match pb::read_clip() {
            Clip::Text(t) if services::shelf::is_link(&t) => json!(t.trim()),
            _ => Value::Null,
        })
    }));
    reg.add("bookmarks.meta", Box::new(|_, a| Ok(meta(a.first().and_then(Value::as_str).unwrap_or("")))));
}

/// A page's title and icon (a data URL: the page's own CSP-free copy); found: the page answered.
fn meta(url: &str) -> Value {
    if !services::shelf::is_link(url) || !services::http::is_public_url(url) {
        return json!({"found": false});
    }
    let Ok((200, _, body)) = services::http::get_public_bytes(url, 2 << 20) else { return json!({"found": false}) };
    let html = String::from_utf8_lossy(&body);
    let (title, icons) = services::bookmarks::page_meta(&html, url);
    let icon = icons.iter().take(4).find_map(|i| {
        if !services::http::is_public_url(i) {
            return None;
        }
        let (s, ct, b) = services::http::get_public_bytes(i, 512 << 10).ok()?;
        let mime = if ct.starts_with("image/") { ct.split(';').next().unwrap_or("image/png").to_string() } else if i.ends_with(".ico") { "image/x-icon".into() } else { return None };
        (s == 200 && !b.is_empty()).then(|| format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&b)))
    });
    let mut v = json!({"found": true});
    if let Some(t) = title {
        v["title"] = json!(t);
    }
    if let Some(i) = icon {
        v["icon"] = json!(i);
    }
    v
}

/// Twice a second while the history is on: a new copy is kept; turned off, all but the pinned go.
pub fn start(app: &AppHandle) {
    let list = crate::files::load_json(app, &file(app));
    *app.state::<Clipboard>().list.lock().unwrap() = list;
    // (off at launch: what was kept from before goes, as when it's turned off)
    if !app.state::<App>().settings.bool_or("clipboardHistory", false) {
        let gone = services::clipboard::clear(&mut app.state::<Clipboard>().list.lock().unwrap());
        if !gone.is_empty() {
            forget(app, &gone);
            changed(app);
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut seen = pb::change_count();
        let mut was_on = None;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let on = app.state::<App>().settings.bool_or("clipboardHistory", false);
            if was_on == Some(true) && !on {
                let gone = services::clipboard::clear(&mut app.state::<Clipboard>().list.lock().unwrap());
                forget(&app, &gone);
                changed(&app);
            }
            was_on = Some(on);
            let n = pb::change_count();
            if n == seen {
                continue;
            }
            seen = n;
            if !on {
                continue;
            }
            let item = match pb::read_clip() {
                Clip::Text(t) if !t.trim().is_empty() && t.len() <= MAX_TEXT => Some(services::clipboard::text_item(&t, &mut crate::files::new_id, chrono::Utc::now().timestamp_millis())),
                Clip::Image(png) => image_item(&app, &png),
                _ => None,
            };
            if let Some(it) = item {
                let gone = services::clipboard::push(&mut app.state::<Clipboard>().list.lock().unwrap(), it, max(&app));
                forget(&app, &gone);
                changed(&app);
            }
        }
    });
}
