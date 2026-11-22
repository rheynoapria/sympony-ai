//! The speed test (Bluetooth & Wi-Fi → Speed test): ping, download and upload against Cloudflare's test
//! (speed.cloudflare.com), run on a thread when Start is clicked; each step goes out as `speedtest`. A size that took
//! over ~3 s is the last of its kind, and the download stays under services::speedtest::CAP, so a slow link uses
//! less data. The last result is kept in `speedtest.json`. The maths are services::speedtest's.
use serde_json::{json, Value};
use services::speedtest::{colo, mbps, next_size, ping_stats, server_ms};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const BASE: &str = "https://speed.cloudflare.com";
const DOWN: &[u64] = &[100_000, 1_000_000, 10_000_000, 25_000_000];
const UP: &[u64] = &[100_000, 1_000_000, 10_000_000];

#[derive(Default)]
pub struct Speed {
    st: Mutex<Value>,
    cancel: AtomicBool,
}

fn file(app: &AppHandle) -> std::path::PathBuf {
    app.state::<App>().data_dir.join("speedtest.json")
}

fn update(app: &AppHandle, patch: Value) -> Value {
    let s = app.state::<Speed>();
    let mut st = s.st.lock().unwrap();
    for (k, v) in patch.as_object().cloned().unwrap_or_default() {
        st[k] = v;
    }
    let v = st.clone();
    drop(st);
    let _ = app.emit("speedtest", v.clone());
    v
}

fn run(app: &AppHandle) -> Result<Value, String> {
    let t = services::http::Timer::default();
    let cancelled = || app.state::<Speed>().cancel.load(Ordering::SeqCst);
    let e = |x: anyhow::Error| if cancelled() { "cancelled".to_string() } else { x.to_string() };
    let mut used = 0u64;
    // ping: one round trip each (the connection kept), the server's own time taken off
    let mut pings = vec![];
    let mut place = None;
    for i in 0..10 {
        if cancelled() {
            return Err("cancelled".into());
        }
        let r = t.get(&format!("{BASE}/__down?bytes=0"), &mut |_| true).map_err(e)?;
        place = place.or_else(|| colo(&r.ray));
        if i > 0 {
            pings.push((r.secs * 1000.0 - server_ms(&r.server_timing).unwrap_or(0.0)).max(0.0));
        }
        let (p, j) = ping_stats(&pings);
        update(app, json!({"phase": "ping", "progress": (i + 1) as f64 / 10.0, "ping": p, "jitter": j}));
    }
    let (ping, jitter) = ping_stats(&pings);
    // download: bigger sizes while they're quick; the best speed counts
    let mut down: f64 = 0.0;
    let mut i = 0;
    let mut size = DOWN[0];
    loop {
        let total = size;
        let mut shown = -1.0;
        let got = t.get(&format!("{BASE}/__down?bytes={size}"), &mut |n| {
            let p = (i as f64 + n as f64 / total as f64) / DOWN.len() as f64;
            // (a step of 2 %: not an event per 64 KB)
            if p - shown >= 0.02 {
                shown = p;
                update(app, json!({"phase": "down", "progress": p}));
            }
            !cancelled()
        });
        // (a bigger size that fails ends the download part: what was measured stands)
        let r = match got {
            Ok(r) => r,
            Err(x) if i > 0 && !cancelled() => {
                let _ = x;
                break;
            }
            Err(x) => return Err(e(x)),
        };
        used += r.bytes;
        down = down.max(mbps(r.bytes, r.secs));
        update(app, json!({"down": down}));
        match next_size(DOWN, i, r.secs, used) {
            Some(n) => {
                size = n;
                i += 1;
            }
            None => break,
        }
    }
    // upload
    let mut up: f64 = 0.0;
    let mut i = 0;
    let mut size = UP[0];
    loop {
        if cancelled() {
            return Err("cancelled".into());
        }
        update(app, json!({"phase": "up", "progress": i as f64 / UP.len() as f64}));
        let r = match t.post(&format!("{BASE}/__up"), size as usize) {
            Ok(r) => r,
            Err(_) if i > 0 && !cancelled() => break,
            Err(x) => return Err(e(x)),
        };
        used += r.bytes;
        up = up.max(mbps(r.bytes, r.secs));
        update(app, json!({"up": up}));
        match next_size(UP, i, r.secs, 0) {
            Some(n) => {
                size = n;
                i += 1;
            }
            None => break,
        }
    }
    Ok(json!({"at": chrono::Utc::now().timestamp_millis(), "ping": ping, "jitter": jitter, "down": down, "up": up, "colo": place, "used": used}))
}

fn start(app: &AppHandle) -> Value {
    let s = app.state::<Speed>();
    {
        // (checked and marked under one lock: a double click starts one test)
        let mut st = s.st.lock().unwrap();
        if st["running"] == true {
            return st.clone();
        }
        if st.is_null() {
            let last = std::fs::read(file(app)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
            *st = json!({"last": last});
        }
        st["running"] = json!(true);
    }
    s.cancel.store(false, Ordering::SeqCst);
    let v = update(app, json!({"running": true, "phase": "ping", "progress": 0, "ping": null, "jitter": null, "down": null, "up": null, "error": null}));
    let app = app.clone();
    std::thread::spawn(move || {
        match run(&app) {
            Ok(last) => {
                crate::files::save_json(&file(&app), &last);
                update(&app, json!({"running": false, "phase": "done", "progress": 1, "last": last}));
            }
            Err(e) if e == "cancelled" => {
                update(&app, json!({"running": false, "phase": "", "progress": 0}));
            }
            Err(e) => {
                app.state::<App>().log.line(&format!("speed test: {e}"));
                update(&app, json!({"running": false, "phase": "error", "error": format!("Couldn’t reach Cloudflare ({e})")}));
            }
        }
    });
    v
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Speed::default());
    let h = app.clone();
    reg.add("speedtest.get", Box::new(move |_, _| {
        let s = h.state::<Speed>();
        let mut st = s.st.lock().unwrap();
        if st.is_null() {
            let last = std::fs::read(file(&h)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
            *st = json!({"running": false, "phase": "", "progress": 0, "last": last});
        }
        Ok(st.clone())
    }));
    let h = app.clone();
    reg.add("speedtest.start", Box::new(move |_, _| Ok(start(&h))));
    let h = app.clone();
    reg.add("speedtest.cancel", Box::new(move |_, _| {
        h.state::<Speed>().cancel.store(true, Ordering::SeqCst);
        Ok(h.state::<Speed>().st.lock().unwrap().clone())
    }));
}
