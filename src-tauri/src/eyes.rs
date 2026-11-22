//! Pony's Eyes: `screen_read` reads
//! the window the user is looking at through Accessibility, only when asked and only while `ponyEyes` is on. Never
//! in a scheduled brief, never password apps (`services::eyes::NEVER` + `ponyEyesSkip`), never with Secure Input on.
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;
use platform::ax;

/// Whether Pony may look at all (Settings → Pony Assistant → Abilities → Eyes).
pub fn available(app: &AppHandle) -> bool {
    app.state::<App>().settings.get()["ponyEyes"] == true
}

/// One `screen_read`. Err: what the model reads.
pub fn call(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    if !available(app) {
        return Err("Eyes are off (Settings → Pony Assistant → Abilities → Eyes)".into());
    }
    if !ax::trusted(false) {
        let _ = ax::trusted(true); // (macOS's prompt, which opens the right pane)
        return Err("Sympony needs the Accessibility permission to read the screen. Tell the user to turn it on in System Settings → Privacy & Security → Accessibility, then ask again.".into());
    }
    if ax::secure_input() {
        return Err("A password field is active on the screen, so nothing was read.".into());
    }
    let Some((pid, name, bundle)) = ax::front_app(std::process::id() as i32) else {
        return Err("There is no window in front to read.".into());
    };
    let skip: Vec<String> = app.state::<App>().settings.get()["ponyEyesSkip"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
    if services::eyes::skipped(&bundle, &skip) {
        return Err(format!("{name} is never read (the user keeps it private)."));
    }
    let Some(win) = ax::window(pid) else {
        return Err(format!("{name} shows no window Sympony can read."));
    };
    let title = win.text("AXTitle");
    let mode = args["mode"].as_str().unwrap_or("elements");
    let _ = app.emit("agent:step", json!({"session": session, "kind": "screen", "detail": format!("{name} · {title}").chars().take(60).collect::<String>()}));
    let (nodes, els) = ax::read(&win, 6000);
    let url = nodes.iter().find(|n| n.role == "AXWebArea").map(|n| n.url.clone()).unwrap_or_default();
    if services::eyes::blocked_url(&url) {
        return Err("That page is a password manager or vault, so nothing was read.".into());
    }
    let count = nodes.len();
    let body = match mode {
        "ocr" => {
            let spots = ocr(app, pid, &win)?;
            let (text, at) = services::eyes::spots(&spots, win.frame());
            // (the elements stay the view Hands acts on; the spots go with it)
            let (_, map) = services::eyes::list(&nodes);
            crate::hands::remember(app, session, pid, &name, &bundle, win.clone(), nodes, els, map);
            crate::hands::remember_spots(app, session, at);
            text
        }
        "text" => services::eyes::text(&nodes),
        "selection" => ax::selection(pid),
        _ => {
            // (the numbered view Hands acts on)
            let (list, map) = services::eyes::list(&nodes);
            crate::hands::remember(app, session, pid, &name, &bundle, win.clone(), nodes, els, map);
            // (what Pony learned in this app before, when it may act here)
            let known = if crate::hands::available(app) { crate::hands::routines_for(&bundle) } else { String::new() };
            if known.is_empty() { list } else { format!("{list}\n{known}") }
        }
    };
    // (the log says which app and how much, never what)
    app.state::<App>().log.line(&format!("eyes: read {name} ({mode}, {count} elements, {} chars)", body.len()));
    if body.trim().is_empty() {
        return Ok(format!("{name}'s window \"{title}\" shows nothing readable{}.", if mode == "selection" { " selected" } else { "" }));
    }
    let read = services::eyes::wrap(&name, &title, &url, &body);
    // (how to act comes with the first view Hands can act on: Sympony's own words, outside the screen's)
    Ok(match (mode, crate::hands::how_to_act(app, session)) {
        ("elements" | "ocr", Some(how)) => format!("{read}\n\n(Sympony, not the screen:) {how}"),
        _ => read,
    })
}

pub fn register(reg: &mut services::Registry, _app: &AppHandle) {
    // (Settings → Eyes: the apps open now, to pick ones Pony never reads, and the ones it never reads anyway)
    reg.add("pony.eyesApps", Box::new(|_, _| {
        let mut open: Vec<Value> = ax::open_apps().into_iter().map(|(id, name)| json!({"id": id, "name": name})).collect();
        open.sort_by_key(|a| a["name"].as_str().unwrap_or("").to_lowercase());
        let never: Vec<Value> = services::eyes::NEVER.iter().filter_map(|id| ax::app_name(id).map(|n| json!({"id": id, "name": n}))).collect();
        Ok(json!({"open": open, "never": never}))
    }));
}

const OCR: &str = include_str!("../helper/ocr.js");
static OCR_WRITTEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn ensure_ocr_script(data_dir: &std::path::Path) -> std::path::PathBuf {
    use std::sync::atomic::Ordering;
    let dir = data_dir.join("helper");
    let p = dir.join("ocr.js");
    if !OCR_WRITTEN.load(Ordering::Relaxed) || !p.exists() {
        let _ = services::paths::ensure_private_dir(&dir);
        if services::paths::write_private(&p, OCR.as_bytes()).is_ok() {
            OCR_WRITTEN.store(true, Ordering::Relaxed);
        }
    }
    p
}

struct TempFile(std::path::PathBuf);
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// The text in a picture of `pid`'s window, read on this Mac by Vision (`helper/ocr.js`). The picture is a private
/// temporary file inside Sympony's 0700 data folder, removed automatically on drop; it never leaves the Mac.
fn ocr(app: &AppHandle, pid: i32, _win: &ax::El) -> Result<Vec<Value>, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    if !ax::screen_access(false) {
        let _ = ax::screen_access(true);
        return Err("Reading a picture of the window needs the Screen Recording permission. Tell the user to turn it on for Sympony in System Settings → Privacy & Security → Screen Recording.".into());
    }
    let id = ax::window_id(pid).ok_or("The window isn't on screen")?;
    let data_dir = &app.state::<App>().data_dir;
    let script = ensure_ocr_script(data_dir);
    let tmp_dir = data_dir.join("tmp");
    services::paths::ensure_private_dir(&tmp_dir).map_err(|e| e.to_string())?;
    let nonce: String = services::oauth::random().chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect();
    let png = TempFile(tmp_dir.join(format!("eyes-{nonce}.png")));
    // Pre-create with 0600 permissions inside our 0700 folder before screencapture writes into it.
    services::paths::write_private(&png.0, &[]).map_err(|e| e.to_string())?;
    let shot = Command::new("/usr/sbin/screencapture").args(["-x", "-o", "-l", &id.to_string()]).arg(&png.0).status();
    if !shot.is_ok_and(|s| s.success()) {
        return Err("Couldn't take a picture of the window".into());
    }
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-l", "JavaScript"])
        .arg(&script)
        .arg(&png.0)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Couldn't read the text in the picture".to_string())?;
    let stdout = child.stdout.take().ok_or("Couldn't read the text in the picture")?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.take(4 << 20).read_to_end(&mut buf);
        buf
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(10) => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Reading the text in the picture took too long".into());
            }
        }
    }
    let out = reader.join().map_err(|_| "Couldn't read the text in the picture".to_string())?;
    let v: Value = serde_json::from_slice(&out).map_err(|_| "Couldn't read the text in the picture".to_string())?;
    if let Some(e) = v["error"].as_str() {
        return Err(format!("Couldn't read the text in the picture: {e}"));
    }
    Ok(v.as_array().cloned().unwrap_or_default())
}
