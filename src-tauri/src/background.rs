//! Timed and on-change work off the main thread: the weather (and in Task 4 the prayer times).
use crate::commands::App;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// Refreshes the weather on a thread of its own.
pub fn weather_soon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _one = WEATHER_RUN.lock().unwrap();
        let a = app.state::<App>();
        if let Err(e) = services::weather::refresh_now(&a.ctx, &a.deps.settings, &a.deps.weather) {
            a.log.line(&format!("weather: {e:#}"));
        }
    });
}

/// Recomputes the prayer times (from the month cache when it has them) and sends them as a `helper` message.
pub fn prayer_soon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _one = PRAYER_RUN.lock().unwrap();
        let a = app.state::<App>();
        let m = a.deps.prayer.compute(&a.settings.get(), services::weather::now_ms(), &services::http::get_json);
        if m["ok"] != true {
            a.log.line(&format!("prayer: {}", m["error"].as_str().unwrap_or("no times")));
        }
        let _ = app.emit("helper", m);
    });
}

/// "Use my current location": a new place when the Mac moved (then weather and prayer times follow it).
pub fn location_soon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let a = app.state::<App>();
        if a.settings.get()["locationAuto"] != true {
            return;
        }
        match services::location::auto_tick(&a.deps.settings, a.deps.locator.as_ref()) {
            Ok(Some(place)) => {
                a.log.line(&format!("location: moved to {}", place["name"].as_str().unwrap_or("an unnamed place")));
                let _ = app.emit("settings", a.settings.get());
                weather_soon(&app);
                prayer_soon(&app);
            }
            Ok(None) => {}
            Err(e) => {
                // said once per reason (off, denied, nothing yet)
                let msg = format!("location: none ({e:?})");
                let mut last = LAST_LOCATION_NOTE.lock().unwrap();
                if *last != msg {
                    a.log.line(&msg);
                    *last = msg;
                }
            }
        }
    });
}

// one refresh of each kind at a time; each reads the settings when it starts, so the last change wins
static WEATHER_RUN: std::sync::Mutex<()> = std::sync::Mutex::new(());
static PRAYER_RUN: std::sync::Mutex<()> = std::sync::Mutex::new(());
static LAST_LOCATION_NOTE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// After a settings change: what has to follow it.
pub fn settings_changed(app: &AppHandle, patch: &serde_json::Value) {
    let has = |keys: &[&str]| keys.iter().any(|k| patch.get(k).is_some());
    if has(&["weatherLocation", "weatherUnit"]) {
        weather_soon(app);
    }
    if has(&["weatherLocation", "prayerLocation", "prayerMethod", "prayerKemenag", "prayerEnabled"]) {
        prayer_soon(app);
    }
    if has(&["githubEnabled", "githubIncludeMine", "has_githubToken"]) {
        crate::github::kick(app);
    }
    if has(&["icsFeeds", "localEvents", "calendarEnabled"]) {
        crate::calendar::kick(app, patch.get("icsFeeds").is_some());
    }
    // (General → Language: Sympony starts again in it)
    if patch.get("language").is_some() {
        crate::lang::changed(app);
    }
    if patch.get("locationAuto") == Some(&serde_json::Value::Bool(true)) {
        location_soon(app);
    }
    crate::voice::settings_changed(app, patch);
    crate::updater::settings_changed(app, patch);
}

/// At start, then whenever services::schedule::due says (every 30 wall-clock minutes, and right after waking).
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = (services::weather::now_ms(), std::time::Instant::now());
        let run = |app: &AppHandle| {
            crate::calendar::kick(app, true); // (at start a no-op: the calendar isn't there yet; after waking, fresh feeds)
            location_soon(app);
            weather_soon(app);
            prayer_soon(app);
        };
        run(&app);
        loop {
            std::thread::sleep(Duration::from_secs(60));
            let wall = services::weather::now_ms() - last.0;
            let awake = last.1.elapsed().as_millis() as i64;
            if services::schedule::due(wall, awake) {
                run(&app);
                last = (services::weather::now_ms(), std::time::Instant::now());
            }
        }
    });
}
