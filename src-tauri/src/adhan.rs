//! The adhan: the owner's own recording (macOS's file chooser), kept in `<data>/adhan/<default|fajr>.<ext>`, handed to
//! the notch as a data URL when it's time. While it plays, the music that was playing pauses and plays again after.
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

#[derive(Default)]
pub struct Adhan {
    paused: Mutex<bool>, // the music was paused by the adhan, and plays again after it
    run: AtomicU64,      // each start's number: a late resume timer of an earlier one does nothing
}

fn slot(which: &str) -> &'static str {
    if which == "fajr" { "fajr" } else { "default" }
}

fn stored(dir: &Path, which: &str) -> Option<PathBuf> {
    let base = slot(which);
    std::fs::read_dir(dir.join("adhan")).ok()?.flatten().map(|e| e.path()).find(|p| p.file_stem().is_some_and(|s| s == base))
}

/// The OS's file dialog for one audio file; None when cancelled.
fn choose(prompt: &str) -> Option<PathBuf> {
    platform::os::files::choose("audio", prompt).into_iter().next().map(PathBuf::from)
}

fn pick(app: &AppHandle, which: &str) -> Value {
    let Some(src) = choose(if which == "fajr" { "Pick the Subuh adhan" } else { "Pick the adhan" }) else { return json!({"ok": false}) };
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let size = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
    let ext = match services::adhan::check(&name, size) {
        Ok((_, ext)) => ext,
        Err(m) => return json!({"ok": false, "message": m}),
    };
    let dir = app.state::<App>().data_dir.join("adhan");
    let _ = std::fs::create_dir_all(&dir);
    if let Some(old) = stored(&app.state::<App>().data_dir, which) {
        let _ = std::fs::remove_file(old);
    }
    if let Err(e) = std::fs::copy(&src, dir.join(format!("{}.{ext}", slot(which)))) {
        return json!({"ok": false, "message": format!("Couldn’t copy it: {e}")});
    }
    set(app, services::adhan::patch(which, &name));
    json!({"ok": true, "name": name})
}

fn set(app: &AppHandle, patch: Value) {
    let a = app.state::<App>();
    a.settings.set(patch.clone());
    (a.ctx.changed)(&patch);
}

fn data(app: &AppHandle, which: &str) -> Value {
    let Some(p) = stored(&app.state::<App>().data_dir, which) else { return json!({"ok": false}) };
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(u64::MAX);
    match (services::adhan::check(&name, size), std::fs::read(&p)) {
        (Ok((mime, _)), Ok(bytes)) => json!({"ok": true, "url": format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))}),
        _ => json!({"ok": false}),
    }
}

/// Plays the paused music again (once), if the adhan paused it.
fn resume(app: &AppHandle) {
    if std::mem::take(&mut *app.state::<Adhan>().paused.lock().unwrap()) {
        crate::media::command(app, "play", &Value::Null);
        app.state::<App>().log.line("adhan: resumed the music");
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Adhan::default());
    let which = |a: &[Value]| a.first().and_then(|v| v.as_str()).unwrap_or("default").to_string();
    let h = app.clone();
    reg.add("adhan.pick", Box::new(move |_, a| Ok(pick(&h, &which(&a)))));
    let h = app.clone();
    reg.add("adhan.clear", Box::new(move |_, a| {
        let w = which(&a);
        if let Some(p) = stored(&h.state::<App>().data_dir, &w) {
            let _ = std::fs::remove_file(p);
        }
        set(&h, services::adhan::patch(&w, ""));
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("adhan.data", Box::new(move |_, a| Ok(data(&h, &which(&a)))));
    // (id, seconds long): the music that plays pauses, and plays again when it ends (`stop`) or after its length
    let h = app.clone();
    reg.add("adhan.start", Box::new(move |_, a| {
        let secs = a.get(1).and_then(|v| v.as_u64()).unwrap_or(0).min(15 * 60);
        let run = h.state::<Adhan>().run.fetch_add(1, Ordering::SeqCst) + 1;
        let playing = h.state::<crate::media::Media>().last()["playing"] == true;
        if h.state::<App>().settings.get()["adhanPauseMedia"] != false && playing {
            crate::media::command(&h, "pause", &Value::Null);
            *h.state::<Adhan>().paused.lock().unwrap() = true;
            h.state::<App>().log.line("adhan: paused the music");
            let h2 = h.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(if secs > 0 { secs + 2 } else { 6 * 60 }));
                if h2.state::<Adhan>().run.load(Ordering::SeqCst) == run {
                    resume(&h2);
                }
            });
        }
        Ok(json!(true))
    }));
    let h = app.clone();
    reg.add("adhan.stop", Box::new(move |_, a| {
        resume(&h);
        let _ = h.emit("prayer:adhanStop", json!({"failed": a.first().and_then(|v| v.as_bool()).unwrap_or(false)}));
        Ok(Value::Null)
    }));
}
