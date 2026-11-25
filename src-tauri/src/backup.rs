//! About → Back up and restore: Export writes one `.sympony` file (a zip: manifest.json and the data files,
//! services::backup::FILES, with the adhan files); Import shows what a file holds, then, confirmed, keeps a copy of
//! the data from before (`before-import-<stamp>`), puts the backup's files in place and restarts Sympony. Secrets stay
//! on this computer: they're never in a backup. The zip is written and read in Rust (services::backup) on every OS.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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

fn fail(m: impl Into<String>) -> Value {
    json!({"ok": false, "message": m.into()})
}

/// Export: a new `.sympony` file in the Downloads folder (Windows' own Downloads, wherever it was moved).
fn export(app: &AppHandle) -> Value {
    let downloads = platform::os::files::downloads();
    let _ = std::fs::create_dir_all(&downloads);
    let out = crate::files::unique_in(&downloads, &format!("Sympony-backup-{}.sympony", chrono::Local::now().format("%Y-%m-%d")));
    let settings = app.state::<App>().settings.saved();
    match services::backup::export(&data(app), &settings, chrono::Utc::now().timestamp_millis(), &crate::phone::pc_name(), env!("CARGO_PKG_VERSION"), &out) {
        Ok(()) => json!({"ok": true, "path": out.to_string_lossy(), "name": out.file_name().map(|n| n.to_string_lossy().to_string()),
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
    if !Path::new(path).is_absolute() {
        return fail("That file can’t be read");
    }
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return fail("That file can’t be read"),
    };
    if file.metadata().map(|m| m.len()).unwrap_or(MAX + 1) > MAX {
        return fail("That file is too big to be a Sympony backup");
    }
    let when = stamp();
    match services::backup::stage_import(file, &data(app), &when, MAX) {
        Ok(_) => {
            app.state::<App>().log.line(&format!("backup: {path} checked, put in place at the restart"));
            crate::lang::restart(app);
            let copy = data(app).join(format!("before-import-{when}"));
            json!({"ok": true, "copy": copy.to_string_lossy()})
        }
        Err(e) => fail(e),
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
