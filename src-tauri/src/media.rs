//! Now playing: the JXA helper as a child process (JSON lines), polled every second while media is on.
use crate::commands::App;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const SCRIPT: &str = include_str!("../helper/media_mac.js");
const SERVES: u32 = 1500; // the helper exits by itself after this many requests

struct Proc {
    child: Child,
    stdin: ChildStdin,
    out: Receiver<String>,
    served: u32,
}

#[derive(Default)]
struct Helper {
    proc: Option<Proc>,
    resting_until: Option<Instant>,
    streak: u32, // failures in a row
    cleaned: bool,
}

impl Helper {
    fn spawn(&mut self, dir: &std::path::Path) -> anyhow::Result<()> {
        let path = dir.join("helper/media_mac.js");
        if !self.cleaned {
            // a helper left by a Sympony that crashed
            let _ = Command::new("/usr/bin/pkill").arg("-f").arg(path.to_string_lossy().as_ref()).status();
            self.cleaned = true;
        }
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(&path, SCRIPT)?;
        let mut child = Command::new("/usr/bin/osascript")
            .args(["-l", "JavaScript"])
            .arg(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, out) = channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        self.proc = Some(Proc { child, stdin, out, served: 0 });
        Ok(())
    }

    /// One request; None when the helper is down, slow or confused (it is then restarted after a 2 s rest).
    fn request(&mut self, dir: &std::path::Path, req: &Value, wait: Duration, log: &dyn Fn(&str)) -> Option<Value> {
        if self.resting_until.is_some_and(|t| Instant::now() < t) {
            return None;
        }
        self.resting_until = None;
        if self.proc.is_none() {
            if let Err(e) = self.spawn(dir) {
                if self.streak == 0 {
                    log(&format!("media: helper didn't start: {e:#}"));
                }
                self.rest();
                return None;
            }
        }
        let p = self.proc.as_mut()?;
        while p.out.try_recv().is_ok() {} // a late answer to a request that timed out
        let sent = writeln!(p.stdin, "{req}").and_then(|_| p.stdin.flush());
        let answer = sent.ok().and_then(|_| p.out.recv_timeout(wait).ok()).and_then(|l| serde_json::from_str::<Value>(&l).ok());
        match answer {
            Some(v) => {
                if self.streak > 0 {
                    log("media: helper answering again");
                }
                self.streak = 0;
                let p = self.proc.as_mut()?;
                p.served += 1;
                if p.served >= SERVES {
                    self.stop();
                }
                Some(v)
            }
            None => {
                if self.streak == 0 {
                    log("media: helper stopped answering, restarting it (logged once until it answers)");
                }
                self.rest();
                None
            }
        }
    }

    fn rest(&mut self) {
        self.stop();
        self.streak += 1;
        self.resting_until = Some(Instant::now() + services::media::backoff(self.streak));
    }

    fn stop(&mut self) {
        if let Some(mut p) = self.proc.take() {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }
}

#[derive(Default)]
pub struct Media {
    helper: Mutex<Helper>,
    last: Mutex<Value>,
    art: Mutex<crate::artwork::Slot>,
    icons: Mutex<std::collections::HashMap<String, Value>>, // bundle id → its icon (data URL) or null
}

impl Media {
    pub fn last(&self) -> Value {
        self.last.lock().unwrap().clone()
    }
}

fn ask(app: &AppHandle, req: &Value, wait: Duration) -> Option<Value> {
    let a = app.state::<App>();
    let log = |m: &str| a.log.line(m);
    app.state::<Media>().helper.lock().unwrap().request(&a.data_dir, req, wait, &log)
}

fn spotify_pid() -> i64 {
    platform::os::apps::pid_of("com.spotify.client").unwrap_or(0) as i64
}

/// One poll: read, add the artwork, send it if it changed.
pub fn tick(app: &AppHandle) {
    let poll = ask(app, &json!({ "op": "poll", "spotify": spotify_pid(), "music": 1 }), Duration::from_secs(3)).unwrap_or(Value::Null);
    let mut m = services::media::from_poll(&poll, chrono::Utc::now().timestamp_millis());
    // Sympony's own radio: while it plays (or nothing else plays) it's what the notch shows
    match crate::radio::media(app) {
        Some(r) if r["playing"] == true || m["playing"] != true => m = r,
        _ => {
            crate::artwork::fill(app, &mut m);
            crate::youtube::fill(app, &mut m);
        }
    }
    let media = app.state::<Media>();
    if let Some(id) = m["app"].as_str().filter(|id| !id.is_empty()).map(String::from) {
        let icon = media.icons.lock().unwrap().entry(id.clone()).or_insert_with(|| {
            platform::os::apps::icon_png(&id, 64.0).and_then(|png| services::media::data_url(&png)).map(Value::String).unwrap_or(Value::Null)
        }).clone();
        m["appIcon"] = icon;
    }
    let mut last = media.last.lock().unwrap();
    if last.is_null() || services::media::changed(&last, &m) {
        let _ = app.emit("helper", &m);
    }
    *last = m;
}

pub fn start(app: &AppHandle) {
    app.manage(Media::default());
    let app = app.clone();
    std::thread::spawn(move || loop {
        if app.state::<App>().settings.bool_or("mediaEnabled", true) {
            tick(&app);
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}

/// `helper_cmd {cmd:"media", action, value}`: to the source playing now, then a poll at once.
pub fn command(app: &AppHandle, action: &str, value: &Value) {
    let source = app.state::<Media>().last()["source"].as_str().unwrap_or("music").to_string();
    if source == "radio" {
        crate::radio::command(app, action);
        tick(app);
        return;
    }
    let req = services::media::command(&source, spotify_pid(), action, value);
    if ask(app, &req, Duration::from_secs(3)).is_some_and(|r| r["ok"] != true) {
        app.state::<App>().log.line(&format!("media: {action} didn't work"));
    }
    tick(app);
}

pub(crate) fn ask_art(app: &AppHandle, path: &std::path::Path) -> bool {
    // the helper may look the cover up on iTunes first (two 6 s requests at most)
    ask(app, &json!({ "op": "art", "path": path }), Duration::from_secs(14)).is_some_and(|r| r["ok"] == true)
}

pub(crate) fn art_slot(app: &AppHandle) -> std::sync::MutexGuard<'_, crate::artwork::Slot> {
    app.state::<Media>().inner().art.lock().unwrap()
}

/// Returns a cached 64 px PNG data URL for a macOS app bundle id.
#[tauri::command]
pub fn app_icon(app: AppHandle, bundle_id: String) -> Option<String> {
    if bundle_id.is_empty() {
        return None;
    }
    let media = app.state::<Media>();
    let val = media
        .icons
        .lock()
        .unwrap()
        .entry(bundle_id.clone())
        .or_insert_with(|| {
            platform::os::apps::icon_png(&bundle_id, 64.0)
                .and_then(|png| services::media::data_url(&png))
                .map(Value::String)
                .unwrap_or(Value::Null)
        })
        .clone();
    val.as_str().map(String::from)
}

/// A cover found after the song was sent: send the song again with it, if it's still the one playing.
pub(crate) fn art_arrived(app: &AppHandle, key: &str, url: String) {
    let media = app.state::<Media>();
    let mut last = media.last.lock().unwrap();
    if last["active"] == true && services::media::art_key(&last) == key {
        last["artwork"] = Value::String(url);
        let _ = app.emit("helper", &*last);
    }
}
