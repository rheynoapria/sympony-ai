//! Files on the Mac: the Shelf (`shelf.json`, where files are, nothing copied), the share menu, dragging files out,
//! the drop tiles' actions, the Dashboard's launcher and the apps open now. The rules are services::shelf /
//! services::launcher's.
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

#[derive(Default)]
pub struct Files {
    shelf: Mutex<Vec<Value>>,
    /// a file's thumbnail or icon (a data URL) by its path and when it changed
    pics: Mutex<HashMap<String, String>>,
}

static NEXT: AtomicU64 = AtomicU64::new(0);

pub fn new_id() -> String {
    format!("{:x}{:x}", chrono::Utc::now().timestamp_millis(), NEXT.fetch_add(1, Ordering::SeqCst))
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// A file's picture for a tile: a photo's thumbnail (sips), else its Finder icon.
pub fn picture(app: &AppHandle, path: &str, photo: bool) -> Option<String> {
    let changed = std::fs::metadata(path).and_then(|m| m.modified()).ok().map(|t| format!("{t:?}")).unwrap_or_default();
    let key = format!("{path}|{changed}");
    let f = app.state::<Files>();
    if let Some(p) = f.pics.lock().unwrap().get(&key) {
        return Some(p.clone());
    }
    let pic = if photo { thumbnail(path, &app.state::<App>().data_dir.join("thumbs")) } else { None };
    let pic = pic.or_else(|| platform::macos::files::icon_png(path, 64.0).map(|b| data_url("image/png", &b)))?;
    let mut pics = f.pics.lock().unwrap();
    // ponytail: dropped whole past 300 (photos edited over months); an LRU if lists get that long
    if pics.len() > 300 {
        pics.clear();
    }
    pics.insert(key, pic.clone());
    Some(pic)
}

/// Saved whole or not at all (atomic 0600 temp file renamed over it).
pub fn save_json(path: &Path, v: &impl serde::Serialize) {
    let _ = services::paths::write_private(path, &serde_json::to_vec(v).unwrap_or_default());
}

/// A saved list; one that doesn't read is kept aside (not saved over) and the list starts empty.
pub fn load_json(app: &AppHandle, path: &Path) -> Vec<Value> {
    let Ok(b) = std::fs::read(path) else { return vec![] };
    serde_json::from_slice(&b).unwrap_or_else(|e| {
        let kept = services::paths::broken_name(path);
        let _ = std::fs::rename(path, &kept);
        app.state::<App>().log.line(&format!("{}: unreadable ({e}), kept as {}", path.display(), kept.display()));
        vec![]
    })
}

/// A photo's small JPEG (sips), as a data URL; nothing left on disk.
pub fn thumbnail(path: &str, tmp_dir: &Path) -> Option<String> {
    let _ = std::fs::create_dir_all(tmp_dir);
    let out = tmp_dir.join(format!("{}.jpg", new_id()));
    let ok = Command::new("/usr/bin/sips").args(["-Z", "192", "-s", "format", "jpeg", path, "--out"]).arg(&out).output().is_ok_and(|o| o.status.success());
    let r = ok.then(|| std::fs::read(&out).ok()).flatten().map(|b| data_url("image/jpeg", &b));
    let _ = std::fs::remove_file(&out);
    r
}

pub fn hash(s: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

// ---------------------------------------------------------------- Shelf

fn shelf_file(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.join("shelf.json")
}

fn shelf_view(app: &AppHandle) -> Value {
    let list = app.state::<Files>().shelf.lock().unwrap().clone();
    Value::Array(list.iter().map(|e| {
        let path = e["path"].as_str().unwrap_or("");
        let stat = (e["kind"] == "file").then(|| std::fs::metadata(path).ok().map(|m| (m.is_dir(), m.len()))).flatten();
        let mut v = services::shelf::view(e, stat);
        if e["kind"] == "file" && stat.is_some() {
            if let Some(p) = picture(app, path, v["photo"] == true) {
                v["thumb"] = json!(p);
            }
        }
        v
    }).collect())
}

/// Saves the Shelf and tells every window; returns what it shows.
fn shelf_changed(app: &AppHandle) -> Value {
    {
        let st = app.state::<Files>();
        let list = st.shelf.lock().unwrap();
        save_json(&shelf_file(app), &*list);
    }
    let v = shelf_view(app);
    let _ = app.emit("shelf:changed", v.clone());
    v
}

/// Adds to the Shelf (the phone's files too).
pub fn shelf_add(app: &AppHandle, items: &[Value]) -> Value {
    services::shelf::add(&mut app.state::<Files>().shelf.lock().unwrap(), items, &mut new_id, now());
    shelf_changed(app)
}

pub fn shelf_item(app: &AppHandle, id: &str) -> Option<Value> {
    app.state::<Files>().shelf.lock().unwrap().iter().find(|x| x["id"] == id).cloned()
}

fn shelf_paths(app: &AppHandle, ids: &[Value]) -> Vec<String> {
    let list = app.state::<Files>().shelf.lock().unwrap().clone();
    ids.iter().filter_map(|i| list.iter().find(|x| x["id"] == *i && x["kind"] == "file")?["path"].as_str().map(String::from)).collect()
}

fn ids_arg(a: &[Value]) -> Vec<Value> {
    match a.first() {
        Some(Value::Array(v)) => v.clone(),
        Some(v @ Value::String(_)) => vec![v.clone()],
        _ => vec![],
    }
}

/// `osascript` choosing files / a folder / an app: their POSIX paths (none: cancelled).
pub fn choose(what: &str, prompt: &str) -> Vec<String> {
    let script = match what {
        "files" => format!("set l to choose file with prompt {prompt:?} with multiple selections allowed\nset o to \"\"\nrepeat with f in l\nset o to o & POSIX path of f & linefeed\nend repeat\nreturn o"),
        "folder" => format!("POSIX path of (choose folder with prompt {prompt:?})"),
        "app" => format!("POSIX path of (choose application with prompt {prompt:?} as alias)"),
        "backup" => format!("POSIX path of (choose file with prompt {prompt:?} default location (path to downloads folder))"),
        _ => format!("POSIX path of (choose file with prompt {prompt:?} default location (path to applications folder))"),
    };
    let Ok(out) = Command::new("/usr/bin/osascript").args(["-e", &script]).output() else { return vec![] };
    if !out.status.success() {
        return vec![];
    }
    String::from_utf8_lossy(&out.stdout).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

fn open(target: &str) {
    if !target.is_empty() {
        let target = target.to_string();
        std::thread::spawn(move || {
            let _ = Command::new("/usr/bin/open").arg("--").arg(&target).status();
        });
    }
}

fn reveal(path: &str) {
    if !path.is_empty() {
        let path = path.to_string();
        std::thread::spawn(move || {
            let _ = Command::new("/usr/bin/open").args(["-R", "--"]).arg(&path).status();
        });
    }
}

/// The notch window the mouse is over (else the first): its NSView, for the share menu.
fn notch_view(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let wins: Vec<tauri::WebviewWindow> = app.webview_windows().into_values().filter(|w| w.label().starts_with("notch")).collect();
    let at = app.cursor_position().ok();
    wins.iter().find(|w| {
        let (Some(c), Ok(p), Ok(s)) = (at, w.outer_position(), w.outer_size()) else { return false };
        c.x >= p.x as f64 && c.x < (p.x + s.width as i32) as f64 && c.y >= p.y as f64 && c.y < (p.y + s.height as i32) as f64
    }).cloned().or_else(|| wins.into_iter().next())
}

/// The share menu for these files at the mouse, in `win` (else the notch under the mouse).
pub fn share(app: &AppHandle, win: Option<tauri::WebviewWindow>, paths: Vec<String>) {
    let paths: Vec<String> = paths.into_iter().filter(|p| Path::new(p).exists()).collect();
    let Some(w) = win.or_else(|| notch_view(app)) else { return };
    if paths.is_empty() {
        return;
    }
    let _ = app.run_on_main_thread(move || {
        if let Ok(v) = w.ns_view() {
            // SAFETY: the window's own NSView, on the main thread
            unsafe { platform::macos::files::share(v, &paths) };
        }
    });
}

/// A real drag of Shelf files out of `win` (to Finder, Mail…); taken off the Shelf after a drop with
/// shelfRemoveAfterDrag.
pub fn drag_out(app: &AppHandle, win: tauri::WebviewWindow, ids: Vec<Value>) {
    let paths: Vec<String> = shelf_paths(app, &ids).into_iter().filter(|p| Path::new(p).exists()).collect();
    if paths.is_empty() {
        return;
    }
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Ok(v) = win.ns_view() else { return };
        let done = Box::new(move |dropped: bool| {
            if dropped && h.state::<App>().settings.get()["shelfRemoveAfterDrag"] == true {
                h.state::<Files>().shelf.lock().unwrap().retain(|x| !ids.contains(&x["id"]));
                // (thumbnails and the save: not on the main thread)
                let h = h.clone();
                std::thread::spawn(move || { shelf_changed(&h); });
            }
        });
        // SAFETY: the window's own NSView, on the main thread, while the page's drag goes on
        unsafe { platform::macos::files::drag_out(v, &paths, done) };
    });
}

/// The Shelf's files that are there now (not folders): (id, name, path, size), for the phone.
pub fn shelf_files(app: &AppHandle) -> Vec<(String, String, String, u64)> {
    let list = app.state::<Files>().shelf.lock().unwrap().clone();
    list.iter().filter(|e| e["kind"] == "file").filter_map(|e| {
        let p = e["path"].as_str()?;
        let m = std::fs::metadata(p).ok().filter(|m| m.is_file())?;
        Some((e["id"].as_str()?.to_string(), name_of(p), p.to_string(), m.len()))
    }).collect()
}

// ---------------------------------------------------------------- drop actions

fn catalog() -> Value {
    json!([
        {"id": "shelf", "icon": "fa-solid fa-inbox", "label": "Shelf"},
        {"id": "share", "icon": "fa-solid fa-share-from-square", "label": "Share"},
        {"id": "zip", "icon": "fa-solid fa-file-zipper", "label": "Zip"},
        {"id": "unzip", "icon": "fa-solid fa-box-open", "label": "Extract"},
        {"id": "convert", "icon": "fa-solid fa-image", "label": "Convert"},
        {"id": "copy", "icon": "fa-solid fa-copy", "label": "Copy to"},
        {"id": "move", "icon": "fa-solid fa-folder-open", "label": "Move to"},
        {"id": "openwith", "icon": "fa-solid fa-up-right-from-square", "label": "Open with"},
        {"id": "trash", "icon": "fa-solid fa-trash-can", "label": "Trash"},
        {"id": "eject", "icon": "fa-solid fa-eject", "label": "Eject"},
    ])
}

pub fn unique_in(dir: &Path, name: &str) -> PathBuf {
    dir.join(services::shelf::unique_name(name, &|n| dir.join(n).exists()))
}

fn name_of(p: &str) -> String {
    Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn parent(p: &str) -> PathBuf {
    Path::new(p).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("/"))
}

fn run_ok(cmd: &mut Command) -> Result<(), String> {
    let o = cmd.output().map_err(|e| e.to_string())?;
    if o.status.success() { Ok(()) } else { Err(String::from_utf8_lossy(&o.stderr).trim().lines().last().unwrap_or("failed").to_string()) }
}

fn done(ok: bool, message: String) -> Value {
    json!({"ok": ok, "message": message})
}

fn run_action(action: &str, files: &[String]) -> Value {
    let files: Vec<String> = files.iter().filter(|p| Path::new(p.as_str()).exists()).cloned().collect();
    let Some(first) = files.first() else { return done(false, "Nothing to do".into()) };
    let what = if files.len() == 1 { name_of(first) } else { format!("{} items", files.len()) };
    match action {
        "zip" => {
            let dir = parent(first);
            let name = if files.len() == 1 { format!("{}.zip", name_of(first)) } else { "Archive.zip".into() };
            let out = unique_in(&dir, &name);
            let r = if files.len() == 1 {
                run_ok(Command::new("/usr/bin/ditto").args(["-c", "-k", "--sequesterRsrc", "--keepParent"]).arg(first).arg(&out))
            } else {
                // (names from their folder when they share it)
                let same = files.iter().all(|f| parent(f) == dir);
                // ("./": a name starting with "-" isn't an option)
                let names: Vec<String> = if same { files.iter().map(|f| format!("./{}", name_of(f))).collect() } else { files.clone() };
                run_ok(Command::new("/usr/bin/zip").current_dir(&dir).args(["-r", "-q", "-y"]).arg(&out).args(&names))
            };
            match r {
                Ok(()) => done(true, format!("Zipped to {}", name_of(&out.to_string_lossy()))),
                Err(e) => done(false, format!("Couldn’t zip: {e}")),
            }
        }
        "unzip" => {
            let zips: Vec<&String> = files.iter().filter(|f| f.to_ascii_lowercase().ends_with(".zip")).collect();
            if zips.is_empty() {
                return done(false, "No .zip to extract".into());
            }
            for z in &zips {
                let stem = name_of(z);
                let out = unique_in(&parent(z), stem.trim_end_matches(".zip").trim_end_matches(".ZIP"));
                if let Err(e) = run_ok(Command::new("/usr/bin/ditto").args(["-x", "-k"]).arg(z.as_str()).arg(&out)) {
                    return done(false, format!("Couldn’t extract {stem}: {e}"));
                }
            }
            done(true, if zips.len() == 1 { format!("Extracted {}", name_of(zips[0])) } else { format!("Extracted {} archives", zips.len()) })
        }
        "convert" => {
            let mut n = 0;
            for f in &files {
                let low = f.to_ascii_lowercase();
                if !services::shelf::is_photo(f) {
                    continue;
                }
                let (fmt, ext) = if low.ends_with(".png") { ("jpeg", "jpg") } else { ("png", "png") };
                let stem = Path::new(f).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let out = unique_in(&parent(f), &format!("{stem}.{ext}"));
                if let Err(e) = run_ok(Command::new("/usr/bin/sips").args(["-s", "format", fmt, f.as_str(), "--out"]).arg(&out)) {
                    return done(false, format!("Couldn’t convert {}: {e}", name_of(f)));
                }
                n += 1;
            }
            if n == 0 { done(false, "No pictures to convert".into()) } else { done(true, format!("Converted {}", if n == 1 { what } else { format!("{n} pictures") })) }
        }
        "copy" | "move" => {
            let verb = if action == "copy" { "Copy" } else { "Move" };
            let Some(dir) = choose("folder", &format!("{verb} {what} to")).into_iter().next() else { return json!({"ok": true, "quiet": true, "message": ""}) };
            let dir = PathBuf::from(dir);
            for f in &files {
                // (moved into its own folder: nothing to do, not a renamed copy)
                if action == "move" && parent(f) == dir.as_path() {
                    continue;
                }
                let out = unique_in(&dir, &name_of(f));
                let r = if action == "copy" { run_ok(Command::new("/bin/cp").args(["-Rp", f.as_str()]).arg(&out)) } else { run_ok(Command::new("/bin/mv").args(["-n", f.as_str()]).arg(&out)) };
                if let Err(e) = r {
                    return done(false, format!("Couldn’t {}: {e}", action));
                }
            }
            let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            done(true, format!("{} {what} to {folder}", if action == "copy" { "Copied" } else { "Moved" }))
        }
        "openwith" => {
            let Some(app) = choose("app", &format!("Open {what} with")).into_iter().next() else { return json!({"ok": true, "quiet": true, "message": ""}) };
            match run_ok(Command::new("/usr/bin/open").arg("-a").arg(&app).args(&files)) {
                Ok(()) => json!({"ok": true, "quiet": true, "message": ""}),
                Err(e) => done(false, format!("Couldn’t open: {e}")),
            }
        }
        "trash" => {
            for f in &files {
                if let Err(e) = platform::macos::files::trash(f) {
                    return done(false, format!("Couldn’t move {} to the Trash: {e}", name_of(f)));
                }
            }
            done(true, format!("Moved {what} to the Trash"))
        }
        "eject" => {
            let vols: Vec<&String> = files.iter().filter(|f| f.starts_with("/Volumes/") && f.trim_end_matches('/').matches('/').count() == 2).collect();
            if vols.is_empty() {
                return done(false, "Drop a drive from Finder to eject it".into());
            }
            for v in &vols {
                if let Err(e) = run_ok(Command::new("/usr/sbin/diskutil").arg("eject").arg(v.as_str())) {
                    return done(false, format!("Couldn’t eject {}: {e}", name_of(v)));
                }
            }
            done(true, format!("Ejected {}", if vols.len() == 1 { name_of(vols[0]) } else { format!("{} drives", vols.len()) }))
        }
        _ => done(false, "Nothing to do".into()),
    }
}

// ---------------------------------------------------------------- launcher

fn home() -> String {
    std::env::var("HOME").unwrap_or_default()
}

fn launcher_items(app: &AppHandle) -> Vec<Value> {
    let a = app.state::<App>();
    let items = a.settings.get()["launcherItems"].as_array().cloned().unwrap_or_default();
    let (mac, changed) = services::launcher::for_mac(&items, &home());
    if changed {
        save_launcher(app, &mac);
    }
    mac
}

fn save_launcher(app: &AppHandle, items: &[Value]) {
    let a = app.state::<App>();
    let patch = json!({"launcherItems": items});
    a.settings.set(patch.clone());
    (a.ctx.changed)(&patch);
}

fn launcher_view(app: &AppHandle, items: &[Value]) -> Value {
    Value::Array(items.iter().map(|it| {
        let mut v = it.clone();
        let p = it["path"].as_str().unwrap_or("");
        if p.starts_with('/') && Path::new(p).exists() {
            if let Some(pic) = picture(app, p, false) {
                v["iconUrl"] = json!(pic);
            }
        }
        v
    }).collect())
}

/// At start (the data folder is known then): the Shelf as it was.
pub fn load(app: &AppHandle) {
    let list = load_json(app, &shelf_file(app));
    *app.state::<Files>().shelf.lock().unwrap() = list;
    // (an older build kept thumbnails here)
    let _ = std::fs::remove_dir_all(app.state::<App>().data_dir.join("thumbs"));
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Files::default());
    macro_rules! add {
        ($name:expr, |$h:ident, $a:ident| $body:expr) => {{
            let $h = app.clone();
            reg.add($name, Box::new(move |_, $a: Vec<Value>| { let _ = &$a; Ok($body) }));
        }};
    }
    add!("shelf.list", |h, a| shelf_view(&h));
    add!("shelf.add", |h, a| shelf_add(&h, a.first().and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])));
    add!("shelf.remove", |h, a| {
        let ids = ids_arg(&a);
        h.state::<Files>().shelf.lock().unwrap().retain(|x| !ids.contains(&x["id"]));
        shelf_changed(&h)
    });
    add!("shelf.clear", |h, a| {
        h.state::<Files>().shelf.lock().unwrap().clear();
        shelf_changed(&h)
    });
    add!("shelf.pick", |h, a| {
        let items: Vec<Value> = choose("files", "Add to the Shelf").into_iter().map(|p| json!({"kind": "file", "path": p})).collect();
        if items.is_empty() { shelf_view(&h) } else { shelf_add(&h, &items) }
    });
    add!("shelf.open", |h, a| {
        if let Some(e) = shelf_item(&h, a.first().and_then(Value::as_str).unwrap_or("")) {
            match e["kind"].as_str() {
                Some("file") => open(e["path"].as_str().unwrap_or("")),
                Some("link") => {
                    let u = e["text"].as_str().unwrap_or("").trim();
                    if services::shelf::is_link(u) {
                        open(u);
                    }
                }
                _ => { platform::macos::files::write_text(e["text"].as_str().unwrap_or("")); }
            }
        }
        Value::Null
    });
    add!("shelf.reveal", |h, a| {
        if let Some(p) = shelf_item(&h, a.first().and_then(Value::as_str).unwrap_or("")).and_then(|e| e["path"].as_str().map(String::from)) {
            reveal(&p);
        }
        Value::Null
    });
    add!("shelf.copy", |h, a| {
        let e = shelf_item(&h, a.first().and_then(Value::as_str).unwrap_or(""));
        let t = e.as_ref().and_then(|e| e["path"].as_str().or(e["text"].as_str())).unwrap_or("");
        json!(!t.is_empty() && platform::macos::files::write_text(t))
    });
    add!("shelf.share", |h, a| {
        share(&h, None, shelf_paths(&h, &ids_arg(&a)));
        Value::Null
    });
    reg.add("actions.catalog", Box::new(|_, _| Ok(catalog())));
    reg.add("actions.run", Box::new(|_, a| {
        let files: Vec<String> = a.get(1).and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
        Ok(run_action(a.first().and_then(Value::as_str).unwrap_or(""), &files))
    }));
    reg.add("actions.reveal", Box::new(|_, a| {
        if let Some(p) = a.first().and_then(Value::as_str).filter(|p| Path::new(p).exists()) {
            reveal(p);
        }
        Ok(Value::Null)
    }));
    add!("launcher.list", |h, a| launcher_view(&h, &launcher_items(&h)));
    add!("launcher.add", |h, a| {
        let folder = a.first().and_then(Value::as_str) == Some("folder");
        let mut items = launcher_items(&h);
        if let Some(p) = choose(if folder { "folder" } else { "file" }, if folder { "Add a folder" } else { "Add an app or a file" }).into_iter().next() {
            let p = p.trim_end_matches('/').to_string();
            let name = name_of(&p);
            let name = name.strip_suffix(".app").unwrap_or(&name).to_string();
            if !items.iter().any(|x| x["path"] == p) {
                items.push(json!({"name": name, "path": p}));
                save_launcher(&h, &items);
            }
        }
        launcher_view(&h, &items)
    });
    add!("launcher.remove", |h, a| {
        let mut items = launcher_items(&h);
        if let Some(i) = a.first().and_then(Value::as_u64).map(|i| i as usize).filter(|i| *i < items.len()) {
            items.remove(i);
            save_launcher(&h, &items);
        }
        launcher_view(&h, &items)
    });
    add!("launcher.open", |h, a| {
        let items = launcher_items(&h);
        if let Some(p) = a.first().and_then(Value::as_u64).and_then(|i| items.get(i as usize)).and_then(|x| x["path"].as_str()).filter(|p| !p.is_empty()) {
            open(p);
        }
        Value::Null
    });
    reg.add("apps.open", Box::new(|_, _| {
        Ok(Value::Array(platform::macos::apps::open_apps().into_iter().map(|(id, name)| json!({"exe": id.to_ascii_lowercase(), "name": name})).collect()))
    }));
}
