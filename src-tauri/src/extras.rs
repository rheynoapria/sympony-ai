//! The notch's timed extras, once a second: warm colours after sunset (`look:warm`, warmth.get), the prayer
//! reminders (`prayer:due`), coming down when idle (`notch:standby`) and a clean slate after the Mac wakes
//! (`notch:reset`). The rules are services::warmth / prayer::due_events'.
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

#[derive(Default)]
pub struct Extras {
    warm: Mutex<f64>,
}

/// Today's sunrise and sunset (ms): Terbit and Maghrib of the prayer times when there are any, else 06:00 / 18:00.
fn sun(app: &AppHandle, now: i64) -> (i64, i64) {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let msg = app.state::<App>().deps.prayer.last();
    let day = msg["days"].as_array().into_iter().flatten().find(|d| d["date"] == today.as_str()).cloned().unwrap_or(Value::Null);
    let at = |h: u32| chrono::Local::now().date_naive().and_hms_opt(h, 0, 0).and_then(|t| t.and_local_timezone(chrono::Local).single()).map(|t| t.timestamp_millis()).unwrap_or(now);
    (day["sunrise"].as_i64().unwrap_or_else(|| at(6)), day["maghrib"].as_i64().unwrap_or_else(|| at(18)))
}

fn warmth(app: &AppHandle) -> f64 {
    let s = app.state::<App>().settings.snapshot();
    if s["warmNight"] != true {
        return 0.0;
    }
    let now = chrono::Utc::now().timestamp_millis();
    let (rise, set) = sun(app, now);
    services::warmth::level(now, rise, set, s["warmNightStrength"].as_u64().unwrap_or(60))
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Extras::default());
    let h = app.clone();
    reg.add("warmth.get", Box::new(move |_, _| Ok(json!(warmth(&h)))));
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut sent: HashSet<String> = HashSet::new();
        let mut standby = false;
        let mut last = (chrono::Utc::now().timestamp_millis(), Instant::now());
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let s = app.state::<App>().settings.snapshot();
            let now = chrono::Utc::now().timestamp_millis();
            // woke (the wall clock ran ahead of the awake time): a clean slate
            if (now - last.0) - last.1.elapsed().as_millis() as i64 > 30_000 {
                let _ = app.emit("notch:reset", ());
            }
            last = (now, Instant::now());
            // warm colours: told when they change enough to see
            let w = warmth(&app);
            {
                let x = app.state::<Extras>();
                let mut cur = x.warm.lock().unwrap();
                if (w - *cur).abs() >= 0.005 || (w == 0.0) != (*cur == 0.0) {
                    *cur = w;
                    let _ = app.emit("look:warm", w);
                }
            }
            // prayer reminders (the one notch window plays the sound)
            let msg = app.state::<App>().deps.prayer.last();
            for e in services::prayer::due_events(&msg, &s, now, &mut sent) {
                let _ = app.emit("prayer:due", e);
            }
            // (only the days still listed are remembered)
            if sent.len() > 64 {
                let days: Vec<String> = msg["days"].as_array().into_iter().flatten().filter_map(|d| d["date"].as_str().map(String::from)).collect();
                sent.retain(|id| days.iter().any(|d| id.starts_with(d.as_str())));
            }
            // come down when idle (an auto-hidden notch)
            let on = s["standbyShow"] == true && s["autoHide"] == true;
            let idle = platform::os::system::idle_secs();
            let want = on && idle >= s["standbySecs"].as_f64().unwrap_or(5.0).clamp(1.0, 3600.0);
            let next = if want { true } else if idle < 1.5 || !on { false } else { standby };
            if next != standby {
                standby = next;
                let _ = app.emit("notch:standby", standby);
            }
        }
    });
}
