//! About → Back up and restore: Export writes one `.sympony` file (a zip: manifest.json and the data files,
//! services::backup::FILES, with the adhan files); Import shows what a file holds, then, confirmed, keeps a copy of
//! the data from before (`before-import-<stamp>`), puts the backup's files in place and restarts Sympony. Secrets stay
//! on this Mac: they're never in a backup.
use serde_json::{json, Value};
use services::backup::{adhan_name, counts, settings_for_export, FILES, FORMAT, VERSION};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

use crate::commands::App;

/// A backup bigger than this isn't opened.
const MAX: u64 = 500 << 20;

fn data(app: &AppHandle) -> PathBuf {
    app.state::<App>().data_dir.clone()
}

fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn read(p: &Path) -> Value {
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

fn adhan_files(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir.join("adhan")).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(adhan_name)).collect()
}

fn fail(m: impl Into<String>) -> Value {
    json!({"ok": false, "message": m.into()})
}

fn export(app: &AppHandle) -> Value {
    let dir = data(app);
    // (one folder per export: two at once never share one)
    static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let stage = dir.join(format!("backup-{}-{}", stamp(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
    let _ = std::fs::remove_dir_all(&stage);
    if let Err(e) = std::fs::create_dir_all(stage.join("adhan")) {
        return fail(format!("Couldn’t make the backup: {e}"));
    }
    let r = (|| -> Result<PathBuf, String> {
        for f in FILES {
            let src = dir.join(f);
            if *f == "settings.json" {
                // (what the user set: a later version's defaults still reach them after an import)
                let s = settings_for_export(&app.state::<App>().settings.saved());
                std::fs::write(stage.join(f), serde_json::to_vec_pretty(&s).unwrap_or_default()).map_err(|e| e.to_string())?;
            } else if src.is_file() {
                std::fs::copy(&src, stage.join(f)).map_err(|e| e.to_string())?;
            }
        }
        let adhan = adhan_files(&dir);
        for a in &adhan {
            std::fs::copy(a, stage.join("adhan").join(a.file_name().unwrap_or_default())).map_err(|e| e.to_string())?;
        }
        let r = |f: &str| read(&stage.join(f));
        let manifest = json!({"format": FORMAT, "version": VERSION, "created": chrono::Utc::now().timestamp_millis(), "pc": crate::phone::pc_name(),
            "app": env!("CARGO_PKG_VERSION"), "counts": counts(&r("settings.json"), &r("todo.json"), &r("notes.json"), &r("chats.json"), &r("bookmarks.json"), &r("radio.json"), adhan.len())});
        std::fs::write(stage.join("manifest.json"), serde_json::to_vec_pretty(&manifest).unwrap_or_default()).map_err(|e| e.to_string())?;
        let downloads = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads");
        let out = crate::files::unique_in(&downloads, &format!("Sympony-backup-{}.sympony", chrono::Local::now().format("%Y-%m-%d")));
        let o = Command::new("/usr/bin/ditto").args(["-c", "-k", "--norsrc"]).arg(&stage).arg(&out).output().map_err(|e| e.to_string())?;
        if !o.status.success() {
            return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
        }
        Ok(out)
    })();
    let _ = std::fs::remove_dir_all(&stage);
    match r {
        Ok(out) => json!({"ok": true, "path": out.to_string_lossy(), "name": out.file_name().map(|n| n.to_string_lossy().to_string()),
            "size": std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0)}),
        Err(e) => fail(format!("Couldn’t save the backup: {e}")),
    }
}

/// A backup's manifest (Err: why it can't be used).
fn peek(path: &str) -> Result<Value, String> {
    let mut f = std::fs::File::open(path).map_err(|_| "That file can’t be read".to_string())?;
    let size = f.metadata().map_err(|_| "That file can’t be read".to_string())?.len();
    if size > MAX {
        return Err("That file is too big to be a Sympony backup".into());
    }
    services::backup::read_zip_manifest(&mut f)
}

fn open(_app: &AppHandle) -> Value {
    let Some(path) = crate::files::choose("backup", "Pick a Sympony backup (.sympony)").into_iter().next() else { return json!({"ok": false, "cancelled": true}) };
    match peek(&path) {
        Ok(m) => json!({"ok": true, "path": path, "created": m["created"], "pc": m["pc"], "app": m["app"], "counts": m["counts"]}),
        Err(e) => fail(e),
    }
}

/// Import, confirmed: the backup checked and unpacked from one open File handle (no TOCTOU, bounded decompressed
/// bytes, symlinks refused) into `pending-import`, then Sympony restarts and puts it in place before anything reads
/// the data (services::backup::apply_pending at start).
fn import(app: &AppHandle, path: &str) -> Value {
    use std::io::{Seek, SeekFrom};
    if !path.starts_with('/') {
        return fail("That file can’t be read");
    }
    let mut file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return fail("That file can’t be read"),
    };
    let size = file.metadata().map(|m| m.len()).unwrap_or(MAX + 1);
    if size > MAX {
        return fail("That file is too big to be a Sympony backup");
    }
    let m = match services::backup::read_zip_manifest(&mut file) {
        Ok(m) => m,
        Err(e) => return fail(e),
    };
    if file.seek(SeekFrom::Start(0)).is_err() {
        return fail("That file can’t be read");
    }
    let pending = data(app).join(services::backup::PENDING);
    let _ = std::fs::remove_dir_all(&pending);
    let when = stamp();
    let staged = (|| -> Result<(), String> {
        services::paths::ensure_private_dir(&pending).map_err(|e| e.to_string())?;
        services::backup::safe_extract_zip(file, &pending, 200, MAX, &services::backup::allowed_entry)?;
        // every file a plain one that reads; the settings an object
        for f in FILES {
            let p = pending.join(f);
            let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
            let v: Option<Value> = meta.file_type().is_file().then(|| std::fs::read(&p).ok().and_then(|b| serde_json::from_slice(&b).ok())).flatten();
            let good = match v {
                Some(v) if *f == "settings.json" => v.is_object(),
                Some(v) => v.is_object() || v.is_array(),
                None => false,
            };
            if !good {
                return Err(format!("That backup is damaged ({f})"));
            }
        }
        if !std::fs::symlink_metadata(pending.join("settings.json")).is_ok_and(|m| m.is_file()) {
            return Err("That backup has no settings".into());
        }
        if let Ok(meta) = std::fs::symlink_metadata(pending.join("adhan")) {
            if !meta.is_dir() || std::fs::read_dir(pending.join("adhan")).into_iter().flatten().flatten().any(|e| e.file_type().map_or(true, |t| !t.is_file())) {
                return Err("That backup is damaged (adhan)".into());
            }
        }
        let _ = std::fs::remove_file(pending.join("manifest.json"));
        // (written last: a whole one)
        services::paths::write_private(&pending.join("ready"), json!({"created": m["created"], "pc": m["pc"], "stamp": when}).to_string().as_bytes()).map_err(|e| e.to_string())
    })();
    match staged {
        Ok(()) => {
            app.state::<App>().log.line(&format!("backup: {path} checked, put in place at the restart"));
            crate::lang::restart(app);
            let copy = data(app).join(format!("before-import-{when}"));
            json!({"ok": true, "copy": copy.to_string_lossy()})
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&pending);
            fail(e)
        }
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let h = app.clone();
    reg.add("backup.export", Box::new(move |_, _| Ok(export(&h))));
    let h = app.clone();
    reg.add("backup.open", Box::new(move |_, _| Ok(open(&h))));
    let h = app.clone();
    reg.add("backup.import", Box::new(move |_, a| Ok(import(&h, a.first().and_then(Value::as_str).unwrap_or("")))));
}
