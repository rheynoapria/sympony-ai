//! Pomodoro, the Timer, Health and the clock: their state lives here (one copy for every window), a thread moves it on
//! every 250 ms and sends what changed (`pomodoro`, `timer`, `health`) and what happened (`…:done`, `health:remind`,
//! `health:goal`, `clock:changed`). Each is kept in its own file in the data folder so a restart resumes.
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use services::health::{Cfg, Health, Nudge};
use services::pomodoro::{after_timer, Config, Pomodoro, Timer};
use services::watch::Watch;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::App;

#[derive(Default)]
pub struct Everyday {
    pomo: Mutex<Pomodoro>,
    timer: Mutex<Timer>,
    health: Mutex<Health>,
    screen: Mutex<services::screentime::ScreenTime>,
    icons: Mutex<std::collections::HashMap<String, Option<String>>>, // bundle id → icon data URL
}

/// An app's icon for the Screen Time list (looked up once per app).
fn icon(app: &AppHandle, id: &str) -> Option<String> {
    let e = app.state::<Everyday>();
    if let Some(i) = e.icons.lock().unwrap().get(id) {
        return i.clone();
    }
    // (drawn outside the lock: another summary isn't held up by it)
    let i = platform::os::apps::icon_png(id, 64.0).and_then(|b| services::media::data_url(&b));
    e.icons.lock().unwrap().insert(id.to_string(), i.clone());
    i
}

/// Screen Time counts this second: someone's at the Mac, the screen isn't locked, the app isn't excluded.
fn screen_second(app: &AppHandle, s: &Value, day: &str) {
    if s["screenTimeEnabled"] == false {
        return;
    }
    let idle_max = s["screenTimeIdle"].as_f64().unwrap_or(120.0);
    if platform::os::system::idle_secs() >= idle_max || platform::os::system::screen_locked() {
        return;
    }
    let Some((id, name)) = platform::os::apps::frontmost() else { return };
    // (locked, the screen saver, or Sympony's own notch in front: not an app being used)
    const LOCKED: &[&str] = &["com.apple.loginwindow", "com.apple.ScreenSaver.Engine", "app.sympony"];
    let excluded = s["screenTimeExcluded"].as_array().into_iter().flatten().filter_map(|x| x.as_str()).any(|x| {
        let x = x.trim().to_lowercase();
        x == id.to_lowercase() || x == name.to_lowercase() || x.trim_end_matches(".app") == name.to_lowercase()
    });
    if LOCKED.contains(&id.as_str()) || excluded {
        return;
    }
    use chrono::Timelike;
    app.state::<Everyday>().screen.lock().unwrap().tick(&id, &name, day, chrono::Local::now().hour());
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn load<T: DeserializeOwned + Default>(dir: &Path, name: &str) -> T {
    std::fs::read(dir.join(name)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn save<T: Serialize>(dir: &Path, name: &str, v: &T) {
    let tmp = dir.join(format!("{name}.tmp"));
    if serde_json::to_vec(v).is_ok_and(|b| std::fs::write(&tmp, b).is_ok()) {
        let _ = std::fs::rename(tmp, dir.join(name));
    }
}

fn settings(app: &AppHandle) -> std::sync::Arc<Value> {
    app.state::<App>().settings.snapshot()
}

pub fn register(reg: &mut services::Registry, app: &AppHandle, dir: &Path) {
    app.manage(Everyday {
        pomo: Mutex::new(load(dir, "pomodoro.json")),
        timer: Mutex::new(load(dir, "timer.json")),
        health: Mutex::new(load(dir, "health.json")),
        screen: Mutex::new(load(dir, "screentime.json")),
        icons: Mutex::new(Default::default()),
    });
    let h = app.clone();
    reg.add("screentime.summary", Box::new(move |_, a| {
        let range = a.first().and_then(|v| v.as_str()).unwrap_or("today").to_string();
        let current = platform::os::apps::frontmost().map(|(_, n)| n);
        let st = h.state::<Everyday>().screen.lock().unwrap().clone();
        Ok(st.summary(&range, &today(), current.as_deref(), &|id| icon(&h, id)))
    }));
    let ms = |a: &[Value], i: usize| a.get(i).and_then(|v| v.as_f64()).unwrap_or(0.0) as i64;
    macro_rules! pomo {
        ($name:literal, |$p:ident, $c:ident, $a:ident| $body:expr) => {{
            let h = app.clone();
            reg.add($name, Box::new(move |_, $a| {
                let e = h.state::<Everyday>();
                let $c = Config::from_settings(&settings(&h));
                #[allow(unused_mut)]
                let mut $p = e.pomo.lock().unwrap();
                let _ = &$a;
                $body;
                Ok($p.view(&$c, &today()))
            }));
        }};
    }
    pomo!("pomodoro.get", |p, c, a| ());
    pomo!("pomodoro.start", |p, c, a| p.start(now(), &c));
    pomo!("pomodoro.pause", |p, c, a| p.pause(now()));
    pomo!("pomodoro.toggle", |p, c, a| p.toggle(now(), &c));
    pomo!("pomodoro.reset", |p, c, a| p.reset(&c));
    pomo!("pomodoro.skip", |p, c, a| p.skip(now(), &c));
    pomo!("pomodoro.setPhase", |p, c, a| p.set_phase(a.first().and_then(|v| v.as_str()).unwrap_or("work"), &c));

    macro_rules! timer {
        ($name:literal, |$t:ident, $a:ident| $body:expr) => {{
            let h = app.clone();
            reg.add($name, Box::new(move |_, $a| {
                let e = h.state::<Everyday>();
                #[allow(unused_mut)]
                let mut $t = e.timer.lock().unwrap();
                let _ = &$a;
                $body;
                Ok($t.view())
            }));
        }};
    }
    timer!("timer.get", |t, a| ());
    timer!("timer.start", |t, a| t.start(ms(&a, 0), now()));
    timer!("timer.toggle", |t, a| t.toggle(now()));
    timer!("timer.stop", |t, a| t.stop());
    timer!("timer.add", |t, a| t.add(ms(&a, 0), now()));

    macro_rules! health {
        ($name:literal, |$h:ident, $c:ident, $a:ident| $body:expr) => {{
            let app = app.clone();
            reg.add($name, Box::new(move |_, $a| {
                let e = app.state::<Everyday>();
                let $c = Cfg::from_settings(&settings(&app));
                #[allow(unused_mut)]
                let mut $h = e.health.lock().unwrap();
                let _ = &$a;
                $body;
                Ok($h.view(&$c, &today()))
            }));
        }};
    }
    health!("health.get", |h, c, a| ());
    health!("health.breakDone", |h, c, a| h.break_done(now(), &today()));
    health!("health.mindful", |h, c, a| h.mindful(ms(&a, 0).max(1), &today()));
    let h = app.clone();
    reg.add("health.water", Box::new(move |_, a| {
        let c = Cfg::from_settings(&settings(&h));
        let v = h.state::<Everyday>().health.lock().unwrap().water(ms(&a, 0), now(), &c, &today());
        if v["goalReached"] == true {
            let _ = h.emit("health:goal", json!({"glasses": v["today"]["water"], "goal": v["goals"]["water"]}));
        }
        Ok(v)
    }));
    let h = app.clone();
    reg.add("health.eyeBreakNow", Box::new(move |_, _| {
        let secs = Cfg::from_settings(&settings(&h)).eye_secs;
        eye_break(&h, secs);
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("health.eyeBreakDone", Box::new(move |_, _| {
        h.state::<Everyday>().health.lock().unwrap().eye_done(now());
        let w = h.clone();
        let _ = h.run_on_main_thread(move || {
            if let Some(win) = w.get_webview_window("eyebreak") {
                let _ = win.close();
            }
        });
        Ok(Value::Null)
    }));

    reg.add("clock.quiet", Box::new(|_, _| {
        use platform::os::system::{focus_on, fullscreen_front};
        Ok(json!({"dnd": focus_on(), "fullscreen": fullscreen_front()}))
    }));
}

/// The eye-break page over the main display, on top of everything, for `secs` (it closes itself, or Skip / Esc).
fn eye_break(app: &AppHandle, secs: i64) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if a.get_webview_window("eyebreak").is_some() {
            return;
        }
        let Some(m) = a.primary_monitor().ok().flatten() else { return };
        let (s, p) = (m.size().to_logical::<f64>(m.scale_factor()), m.position().to_logical::<f64>(m.scale_factor()));
        let built = WebviewWindowBuilder::new(&a, "eyebreak", WebviewUrl::App(format!("eyebreak.html?secs={secs}").into()))
            .initialization_script(crate::page_globals())
            .title("Eye break")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .position(p.x, p.y)
            .inner_size(s.width, s.height)
            .build();
        match built {
            Ok(w) => {
                let _ = w.set_focus();
            }
            Err(e) => a.state::<App>().log.line(&format!("eye break window: {e}")),
        }
    });
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let (mut wp, mut wt, mut wh) = (Watch::<Value>::default(), Watch::<Value>::default(), Watch::<Value>::default());
        let mono = Instant::now();
        let reading = || (now(), mono.elapsed().as_millis() as i64, chrono::Local::now().offset().local_minus_utc());
        let mut clock = reading();
        let mut beat = 0u64;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            beat += 1;
            let (t, day, s) = (now(), today(), settings(&app));
            let (pc, hc) = (Config::from_settings(&s), Cfg::from_settings(&s));
            let e = app.state::<Everyday>();
            let (pv, tv, hv, mut out) = {
                let (mut p, mut tm, mut h) = (e.pomo.lock().unwrap(), e.timer.lock().unwrap(), e.health.lock().unwrap());
                let mut out: Vec<(&str, Value)> = vec![];
                if let Some(d) = p.tick(t, &pc, &day) {
                    out.push(("pomodoro:done", d));
                }
                if let Some(total) = tm.tick(t) {
                    out.push(("timer:done", json!({"total": total, "sound": pc.sound})));
                    after_timer(&mut p, &pc, s["timerThenBreak"] == true, t);
                }
                // health every 5 s (it counts minutes)
                if beat % 20 == 0 {
                    let idle = (platform::os::system::idle_secs() * 1000.0) as i64;
                    for n in h.tick(t, idle, &hc, &day) {
                        match n {
                            Nudge::Remind(v) => out.push(("health:remind", v)),
                            Nudge::EyeBreak(secs) => eye_break(&app, secs),
                        }
                    }
                }
                (p.view(&pc, &day), tm.view(), h.view(&hc, &day), out)
            };
            let dir = &app.state::<App>().data_dir;
            if wp.update(pv.clone()).is_some() {
                out.insert(0, ("pomodoro", pv));
                save(dir, "pomodoro.json", &*e.pomo.lock().unwrap());
            }
            if wt.update(tv.clone()).is_some() {
                out.insert(0, ("timer", tv));
                save(dir, "timer.json", &*e.timer.lock().unwrap());
            }
            if wh.update(hv.clone()).is_some() {
                out.insert(0, ("health", hv));
                save(dir, "health.json", &*e.health.lock().unwrap());
            }
            if beat % 4 == 0 {
                screen_second(&app, &s, &day);
                if beat % 240 == 0 {
                    save(dir, "screentime.json", &*e.screen.lock().unwrap());
                }
                let r = reading();
                if services::schedule::clock_changed(clock, r) {
                    out.push(("clock:changed", Value::Null));
                }
                clock = r;
            }
            for (ch, v) in out {
                let _ = app.emit(ch, v);
            }
        }
    });
}
