//! Back up and restore (pure): which files a backup holds, what it counts, its manifest, and the settings put in place.
use serde_json::{json, Map, Value};

pub const FORMAT: &str = "sympony-backup";
pub const VERSION: u64 = 1;

/// The data files a backup holds (never secrets, the Shelf, histories, caches or logs).
pub const FILES: &[&str] = &["settings.json", "todo.json", "notes.json", "chats.json", "bookmarks.json", "radio.json", "health.json",
    "pomodoro.json", "timer.json", "screentime.json", "teleprompter.json"];

/// The holding folder an import is unpacked into; `ready` in it (written last) says it's whole.
pub const PENDING: &str = "pending-import";

/// An adhan file kept by Sympony (`<data>/adhan/`): a plain name.
pub fn adhan_name(n: &str) -> bool {
    !n.is_empty() && !n.starts_with('.') && !n.contains(['/', '\\']) && n.len() < 100
}

fn len(v: &Value) -> usize {
    if let Some(a) = v.as_array() {
        return a.len();
    }
    // (tasks in the trash aren't counted)
    if let Some(items) = v["items"].as_array() {
        return items.iter().filter(|i| i["deletedAt"].is_null()).count();
    }
    ["items", "notes", "list", "favs"].iter().find_map(|k| v[*k].as_array()).map_or(0, Vec::len)
}

/// What a backup holds, as Settings lists it.
pub fn counts(settings: &Value, todo: &Value, notes: &Value, chats: &Value, bookmarks: &Value, radio: &Value, files: usize) -> Value {
    let n = |k: &str| settings[k].as_array().map_or(0, Vec::len);
    json!({"tasks": len(todo), "notes": len(notes), "chats": len(chats), "bookmarks": len(bookmarks), "radio": len(radio), "dock": 0,
        "launcher": n("launcherItems"), "events": n("localEvents"), "calendars": n("icsFeeds"), "briefs": n("chatBriefs"), "files": files})
}

pub fn manifest_ok(m: &Value) -> bool {
    m["format"] == FORMAT && m["version"] == VERSION
}

fn without_flags(s: &Value) -> Map<String, Value> {
    s.as_object().cloned().unwrap_or_default().into_iter().filter(|(k, _)| !k.starts_with("has_") && k != "backupImported").collect()
}

/// The settings that go in a backup: not which secrets this Mac has, nor its last import.
pub fn settings_for_export(s: &Value) -> Value {
    Value::Object(without_flags(s))
}

/// The backup's settings, with this Mac's secrets flags (the secrets themselves stay here).
/// Security-sensitive execution & automation settings are always disarmed on import so a shared backup cannot
/// silently enable shell execution, YOLO mode, arbitrary stdio MCP servers, or scheduled briefs.
/// Preserves legitimate `phoneFolder` (unless pointing at a secret or LaunchAgents/shell-profile path) and `brainUrl`
/// (when `has_brain_key` is true on this Mac and the imported `brainUrl` differs, this Mac's existing `here["brainUrl"]`
/// is kept instead of the imported URL so the local `brainKey` cannot be exfiltrated to an untrusted server).
/// Limitation: `apply_pending` checks encrypted `secrets.json` (`FileSecrets::has_key`) before app startup; a legacy
/// Mac whose `brainKey` exists only in macOS Keychain and was never migrated into `secrets.json` is not queried there.
/// Returns `(settings, disarmed)` listing each category that was turned off or cleared for safety.
pub fn settings_for_import_checked(from: &Value, here: &Value, has_brain_key: bool) -> (Value, Vec<&'static str>) {
    let mut m = without_flags(from);
    let mut disarmed: Vec<&'static str> = Vec::new();
    let mut note = |tag: &'static str| {
        if !disarmed.contains(&tag) {
            disarmed.push(tag);
        }
    };
    if m.contains_key("ponyExec") {
        if m.get("ponyExec") == Some(&Value::Bool(true)) {
            note("commands");
        }
        m.insert("ponyExec".into(), Value::Bool(false));
    }
    if m.contains_key("ponyExecMode") {
        if m.get("ponyExecMode").and_then(Value::as_str) != Some("ask") {
            note("commands");
        }
        m.insert("ponyExecMode".into(), Value::from("ask"));
    }
    if m.contains_key("ponyExecAllow") {
        if m.get("ponyExecAllow").and_then(Value::as_array).is_some_and(|a| !a.is_empty()) {
            note("commands");
        }
        m.insert("ponyExecAllow".into(), json!([]));
    }
    if m.contains_key("ponyHands") {
        if m.get("ponyHands") == Some(&Value::Bool(true)) {
            note("hands");
        }
        m.insert("ponyHands".into(), Value::Bool(false));
    }
    if m.contains_key("ponyAutoUi") {
        if m.get("ponyAutoUi") == Some(&Value::Bool(true)) {
            note("hands");
        }
        m.insert("ponyAutoUi".into(), Value::Bool(false));
    }
    if m.contains_key("voiceAutoUi") {
        if m.get("voiceAutoUi").and_then(Value::as_str) == Some("on") {
            note("hands");
        }
        m.insert("voiceAutoUi".into(), Value::from("follow"));
    }
    if m.contains_key("ponyAskAi") {
        if m.get("ponyAskAi") == Some(&Value::Bool(true)) {
            note("askAi");
        }
        m.insert("ponyAskAi".into(), Value::Bool(false));
    }
    if let Some(pf) = m.get("phoneFolder").and_then(Value::as_str) {
        if crate::exec::secret_place(pf).is_some() || crate::exec::protected_config_path_at(pf, None, None) {
            m.remove("phoneFolder");
            note("phoneFolder");
        }
    }
    if has_brain_key {
        let imported_url = m.get("brainUrl").and_then(Value::as_str).unwrap_or("").trim();
        let current_url = here["brainUrl"].as_str().unwrap_or("").trim();
        if !imported_url.is_empty() && !imported_url.eq_ignore_ascii_case(current_url) {
            if !current_url.is_empty() {
                m.insert("brainUrl".into(), Value::from(current_url));
            } else {
                m.remove("brainUrl");
            }
            note("brainUrl");
        }
    }
    if let Some(Value::Array(servers)) = m.get_mut("ponyMcp") {
        for s in servers.iter_mut() {
            if let Some(obj) = s.as_object_mut() {
                if obj.get("on") != Some(&Value::Bool(false))
                    || obj.get("mode").and_then(Value::as_str) == Some("allow")
                    || obj.get("allowTools").and_then(Value::as_array).is_some_and(|a| !a.is_empty())
                {
                    note("mcp");
                }
                obj.insert("on".into(), Value::Bool(false));
                obj.insert("mode".into(), Value::from("ask"));
                obj.insert("allowTools".into(), json!([]));
            }
        }
    }
    if let Some(Value::Array(briefs)) = m.get_mut("chatBriefs") {
        for b in briefs.iter_mut() {
            if let Some(obj) = b.as_object_mut() {
                if obj.get("on") != Some(&Value::Bool(false)) {
                    note("briefs");
                }
                obj.insert("on".into(), Value::Bool(false));
            }
        }
    }
    if m.contains_key("customModApprovedDomains") {
        let had_domains = m
            .get("customModApprovedDomains")
            .and_then(Value::as_object)
            .is_some_and(|map| map.values().any(|v| v.as_array().is_some_and(|a| !a.is_empty())));
        if had_domains {
            note("customModules");
        }
        m.insert("customModApprovedDomains".into(), json!({}));
    }
    for (k, v) in here.as_object().into_iter().flatten().filter(|(k, _)| k.starts_with("has_")) {
        m.insert(k.clone(), v.clone());
    }
    (Value::Object(m), disarmed)
}

/// Convenience wrapper returning only the sanitized settings map.
pub fn settings_for_import(from: &Value, here: &Value) -> Value {
    settings_for_import_checked(from, here, here["has_brainKey"] == true).0
}

/// Safely extracts a ZIP archive from an already-opened `File` into `dst`, enforcing hard limits on
/// entry count and actual decompressed bytes (`Read::take`), rejecting path traversal (`..` / absolute paths)
/// and Unix symlinks, and checking every entry name against `allowed`.
pub fn safe_extract_zip(
    file: std::fs::File,
    dst: &std::path::Path,
    max_entries: usize,
    max_bytes: u64,
    allowed: &dyn Fn(&str) -> bool,
) -> Result<(), String> {
    use std::io::Read;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "That archive is damaged".to_string())?;
    if archive.len() > max_entries {
        return Err(format!("Archive has too many entries (max {max_entries})"));
    }
    let mut total = 0u64;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|_| "That archive is damaged".to_string())?;
        let raw_name = entry.name().map_err(|_| "Archive has an invalid entry name".to_string())?.into_owned();
        if !allowed(&raw_name) {
            return Err(format!("Archive holds disallowed entry: {raw_name}"));
        }
        // Reject symlinks stored in ZIP external attributes (`S_IFLNK == 0o120000`).
        if entry.is_symlink() || entry.unix_mode().is_some_and(|mode| (mode & 0o170000) == 0o120000) {
            return Err("Archive contains a symbolic link".into());
        }
        let Some(rel) = entry.enclosed_name() else {
            return Err("Archive contains an unsafe path".into());
        };
        let out_path = dst.join(&rel);
        if entry.is_dir() {
            crate::paths::ensure_private_dir(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            crate::paths::ensure_private_dir(parent).map_err(|e| e.to_string())?;
        }
        let remaining = max_bytes.saturating_sub(total);
        let mut buf = Vec::new();
        let n = entry
            .take(remaining.saturating_add(1))
            .read_to_end(&mut buf)
            .map_err(|_| "That archive is damaged".to_string())? as u64;
        if n > remaining {
            return Err("That archive is too big".into());
        }
        total += n;
        crate::paths::write_private(&out_path, &buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn custom_module_entry(rest: &str) -> bool {
    if rest.is_empty() {
        return true;
    }
    if let Some(slug) = rest.strip_suffix('/') {
        return crate::custom_modules::validate_slug(slug).is_ok();
    }
    let Some((slug, file)) = rest.split_once('/') else { return false };
    crate::custom_modules::validate_slug(slug).is_ok()
        && matches!(file, "module.json" | "state.json" | "config.json")
}

/// A name a backup may hold (anything else and the file is refused).
pub fn allowed_entry(name: &str) -> bool {
    name == "manifest.json"
        || FILES.contains(&name)
        || name == "adhan/"
        || name.strip_prefix("adhan/").is_some_and(adhan_name)
        || name == "custom-modules/"
        || name.strip_prefix("custom-modules/").is_some_and(custom_module_entry)
}

/// Reads and validates `manifest.json` from an open `.sympony` ZIP archive (at most 1 MB manifest).
pub fn read_zip_manifest(file: &mut std::fs::File) -> Result<Value, String> {
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(0)).map_err(|_| "That file can’t be read".to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|_| "That isn’t a Sympony backup".to_string())?;
    let entry = archive.by_name("manifest.json").map_err(|_| "That isn’t a Sympony backup".to_string())?;
    let mut buf = Vec::new();
    let n = entry.take((1 << 20) + 1).read_to_end(&mut buf).map_err(|_| "That isn’t a Sympony backup".to_string())?;
    if n > (1 << 20) {
        return Err("That backup is damaged".into());
    }
    let m: Value = serde_json::from_slice(&buf).map_err(|_| "That isn’t a Sympony backup".to_string())?;
    if !manifest_ok(&m) {
        return Err("That isn’t a Sympony backup (or it’s from a newer Sympony)".into());
    }
    Ok(m)
}

/// The adhan files kept in the data folder `dir` (`<dir>/adhan/`), by name.
pub fn adhan_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut v: Vec<std::path::PathBuf> = std::fs::read_dir(dir.join("adhan")).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_file() && p.file_name().and_then(|n| n.to_str()).is_some_and(adhan_name)).collect();
    v.sort();
    v
}

/// Export: one `.sympony` file of the data folder `dir` written to `out` — the manifest, `settings` (as
/// `settings_for_export` leaves them), the other data files there are, and the adhan files: the zip that
/// `read_zip_manifest` and `safe_extract_zip` read. `created` (ms), `pc` and `app` say where and from which Sympony.
/// Written here on every OS (no `ditto`). A file already at `out` is never touched; when it fails, nothing is left there.
pub fn export(dir: &std::path::Path, settings: &Value, created: i64, pc: &str, app: &str, out: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let settings = settings_for_export(settings);
    let adhan = adhan_files(dir);
    let read = |f: &str| std::fs::read(dir.join(f)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let manifest = json!({"format": FORMAT, "version": VERSION, "created": created, "pc": pc, "app": app,
        "counts": counts(&settings, &read("todo.json"), &read("notes.json"), &read("chats.json"), &read("bookmarks.json"), &read("radio.json"), adhan.len())});
    let file = std::fs::File::create_new(out).map_err(|e| e.to_string())?;
    let r = (|| -> Result<(), String> {
        let z = |e: zip::result::ZipError| e.to_string();
        let io = |what: &str, e: std::io::Error| format!("{what}: {e}");
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o600);
        let o = match crate::archive::zip_time(std::time::SystemTime::now()) {
            Some(t) => o.last_modified_time(t),
            None => o,
        };
        for (name, v) in [("manifest.json", &manifest), ("settings.json", &settings)] {
            zip.start_file(name, o).map_err(z)?;
            zip.write_all(&serde_json::to_vec_pretty(v).unwrap_or_default()).map_err(|e| io(name, e))?;
        }
        for f in FILES.iter().filter(|f| **f != "settings.json") {
            let p = dir.join(f);
            if p.is_file() {
                let mut src = std::fs::File::open(&p).map_err(|e| io(f, e))?;
                zip.start_file(*f, o).map_err(z)?;
                std::io::copy(&mut src, &mut zip).map_err(|e| io(f, e))?;
            }
        }
        // (always there, as `ditto` kept it: an import puts the backup's adhan files in place of the ones there)
        zip.add_directory("adhan/", o.unix_permissions(0o700)).map_err(z)?;
        for a in &adhan {
            let name = a.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut src = std::fs::File::open(a).map_err(|e| io(&name, e))?;
            zip.start_file(format!("adhan/{name}"), o).map_err(z)?;
            std::io::copy(&mut src, &mut zip).map_err(|e| io(&name, e))?;
        }
        let cm_root = crate::custom_modules::root(dir);
        let cm_list = crate::custom_modules::list_manifests(dir);
        if !cm_list.is_empty() {
            zip.add_directory("custom-modules/", o.unix_permissions(0o700)).map_err(z)?;
            for m in &cm_list {
                let Some(slug) = m["slug"].as_str() else { continue };
                let src_mod = cm_root.join(slug);
                zip.add_directory(format!("custom-modules/{slug}/"), o.unix_permissions(0o700)).map_err(z)?;
                for fname in ["module.json", "state.json", "config.json"] {
                    let f = src_mod.join(fname);
                    if f.is_file() {
                        let entry_name = format!("custom-modules/{slug}/{fname}");
                        let mut src = std::fs::File::open(&f).map_err(|e| io(&entry_name, e))?;
                        zip.start_file(&entry_name, o).map_err(z)?;
                        std::io::copy(&mut src, &mut zip).map_err(|e| io(&entry_name, e))?;
                    }
                }
            }
        }
        zip.finish().map_err(z)?.flush().map_err(|e| e.to_string())
    })();
    if r.is_err() {
        let _ = std::fs::remove_file(out);
    }
    r
}

/// Import, before the restart: the backup in `file` (open already, so what's checked is what's unpacked) checked and
/// unpacked into `<dir>/pending-import` — at most 200 entries and `max` bytes, only names a backup holds, no links;
/// each data file a plain one that reads, the settings an object — and `ready` written last (with `stamp`, the name
/// the copy of the data from before gets). The next start puts it in place (`apply_pending`). Err: why it can't be
/// used, and nothing is left staged. Ok: its manifest.
pub fn stage_import(mut file: std::fs::File, dir: &std::path::Path, stamp: &str, max: u64) -> Result<Value, String> {
    use std::io::{Seek, SeekFrom};
    let m = read_zip_manifest(&mut file)?;
    file.seek(SeekFrom::Start(0)).map_err(|_| "That file can’t be read".to_string())?;
    let pending = dir.join(PENDING);
    let _ = std::fs::remove_dir_all(&pending);
    let staged = (|| -> Result<(), String> {
        crate::paths::ensure_private_dir(&pending).map_err(|e| e.to_string())?;
        safe_extract_zip(file, &pending, 200, max, &allowed_entry)?;
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
        crate::paths::write_private(&pending.join("ready"), json!({"created": m["created"], "pc": m["pc"], "stamp": stamp}).to_string().as_bytes()).map_err(|e| e.to_string())
    })();
    match staged {
        Ok(()) => Ok(m),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&pending);
            Err(e)
        }
    }
}

/// The unpacked size from `unzip -l`'s last line ("  5243000                     2 files").
pub fn unzipped_size(listing: &str) -> Option<u64> {
    listing.lines().rev().find(|l| !l.trim().is_empty())?.split_whitespace().next()?.parse().ok()
}

fn copy_custom_modules_dir(src_root: &std::path::Path, dst_root: &std::path::Path) -> std::io::Result<()> {
    let src = src_root.join("custom-modules");
    if !src.is_dir() {
        return Ok(());
    }
    let dst = dst_root.join("custom-modules");
    crate::paths::ensure_private_dir(&dst)?;
    for ent in std::fs::read_dir(&src)?.flatten() {
        let p = ent.path();
        if !p.is_dir() {
            continue;
        }
        let Some(slug) = p.file_name().and_then(|n| n.to_str()) else { continue };
        if crate::custom_modules::validate_slug(slug).is_err() {
            continue;
        }
        let dst_mod = dst.join(slug);
        crate::paths::ensure_private_dir(&dst_mod)?;
        for fname in ["module.json", "state.json", "config.json"] {
            let f = p.join(fname);
            if f.is_file() {
                std::fs::copy(&f, dst_mod.join(fname))?;
            }
        }
    }
    Ok(())
}

fn put_back(dir: &std::path::Path, copy: &std::path::Path) {
    for f in FILES {
        if copy.join(f).is_file() {
            let _ = std::fs::copy(copy.join(f), dir.join(f));
        }
    }
    let _ = std::fs::create_dir_all(dir.join("adhan"));
    for a in std::fs::read_dir(copy.join("adhan")).into_iter().flatten().flatten() {
        let _ = std::fs::copy(a.path(), dir.join("adhan").join(a.file_name()));
    }
    if copy.join("custom-modules").is_dir() {
        let _ = std::fs::remove_dir_all(dir.join("custom-modules"));
        let _ = copy_custom_modules_dir(copy, dir);
    }
}

/// After an import: Todo sync's links are to the tasks from before, so its list is unpicked (the account stays) and
/// it waits for a list to be picked again, rather than adding every task twice.
fn pause_todo_sync(dir: &std::path::Path) {
    let f = dir.join("todosync.json");
    let Some(mut v) = std::fs::read(&f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(Value::is_object) else { return };
    v["list"] = Value::Null;
    v["links"] = json!([]);
    let _ = crate::paths::write_private(&f, &serde_json::to_vec(&v).unwrap_or_default());
}

/// The newest three copies from before an import are kept; older ones go.
fn prune_copies(dir: &std::path::Path) {
    let mut c: Vec<std::path::PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|e| e.path())
        .filter(|p| p.is_dir() && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("before-import-"))).collect();
    c.sort();
    for old in c.iter().take(c.len().saturating_sub(3)) {
        let _ = std::fs::remove_dir_all(old);
    }
}

/// At start, before anything reads the data: a whole staged import (`<dir>/pending-import/ready`) put in place. The
/// data from before is copied to `before-import-<stamp>` first; the backup's files are moved in (one not in the
/// backup goes); the settings are the backup's with this Mac's `has_*` flags and `backupImported`. A failure puts
/// the copy back. A half-staged one is dropped. Ok(Some(copy)) when one was put in place.
pub fn apply_pending(dir: &std::path::Path, now: i64, stamp: &str) -> Result<Option<std::path::PathBuf>, String> {
    let p = dir.join(PENDING);
    if !p.exists() {
        return Ok(None);
    }
    let ready: Value = match std::fs::read(p.join("ready")).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
        Some(v) => v,
        None => {
            let _ = std::fs::remove_dir_all(&p);
            return Ok(None);
        }
    };
    let read = |f: &std::path::Path| std::fs::read(f).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
    // (the stamp chosen when it was staged: the path Settings was told)
    let stamp = ready["stamp"].as_str().filter(|s| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).unwrap_or(stamp);
    let copy = dir.join(format!("before-import-{stamp}"));
    let e = |x: std::io::Error| x.to_string();
    // the copy first; if it can't be made, nothing changes
    let made = (|| -> Result<(), String> {
        std::fs::create_dir_all(copy.join("adhan")).map_err(e)?;
        for f in FILES {
            if dir.join(f).is_file() {
                std::fs::copy(dir.join(f), copy.join(f)).map_err(e)?;
            }
        }
        for a in std::fs::read_dir(dir.join("adhan")).into_iter().flatten().flatten() {
            if a.path().is_file() {
                std::fs::copy(a.path(), copy.join("adhan").join(a.file_name())).map_err(e)?;
            }
        }
        copy_custom_modules_dir(dir, &copy).map_err(e)?;
        Ok(())
    })();
    if let Err(x) = made {
        let _ = std::fs::remove_dir_all(&p);
        let _ = std::fs::remove_dir_all(&copy);
        return Err(format!("couldn’t keep the data from before ({x}); nothing was replaced"));
    }
    let here = read(&dir.join("settings.json"));
    let moved = (|| -> Result<(), String> {
        for f in FILES.iter().filter(|f| **f != "settings.json") {
            if p.join(f).is_file() {
                std::fs::rename(p.join(f), dir.join(f)).map_err(e)?;
            } else if dir.join(f).exists() {
                std::fs::remove_file(dir.join(f)).map_err(e)?;
            }
        }
        if p.join("adhan").is_dir() {
            let _ = std::fs::remove_dir_all(dir.join("adhan"));
            std::fs::rename(p.join("adhan"), dir.join("adhan")).map_err(e)?;
        }
        if p.join("custom-modules").is_dir() {
            let _ = std::fs::remove_dir_all(dir.join("custom-modules"));
            std::fs::rename(p.join("custom-modules"), dir.join("custom-modules")).map_err(e)?;
        }
        // Read ground truth from the encrypted secrets store (`secrets.json`), because `has_*` flags are never
        // persisted to `settings.json` on disk. Limitation: a legacy Mac whose `brainKey` exists only in macOS
        // Keychain (not yet migrated to `secrets.json`) is not queried during pre-init `apply_pending`.
        let has_brain_key = crate::secrets::FileSecrets::has_key(dir, "brainKey");
        let (mut s, disarmed) = settings_for_import_checked(&read(&p.join("settings.json")), &here, has_brain_key);
        s["backupImported"] = json!({"at": now, "created": ready["created"], "pc": ready["pc"], "copy": copy.to_string_lossy(), "disarmed": disarmed});
        crate::paths::write_private(&dir.join("settings.json"), &serde_json::to_vec_pretty(&s).unwrap_or_default()).map_err(e)
    })();
    let _ = std::fs::remove_dir_all(&p);
    match moved {
        Ok(()) => {
            pause_todo_sync(dir);
            prune_copies(dir);
            Ok(Some(copy))
        }
        Err(x) => {
            put_back(dir, &copy);
            Err(format!("couldn’t put the backup in place ({x}); the data from before is back"))
        }
    }
}
