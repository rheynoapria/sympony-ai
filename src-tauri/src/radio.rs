//! The Radio tab: stations from Radio Browser (radio-browser.info, a free directory), played by AVFoundation in main
//! (platform::os::player) so it goes on while the notch is closed, with the song from the stream's ICY title. Its
//! state goes out as a `helper` message `{type: 'radio', …}`; while it plays (or nothing else plays) the closed notch
//! shows it like other music (media.rs asks `media`). Kept in `radio.json`. The rules are services::radio's.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::channel;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

#[derive(Default)]
pub struct Radio {
    /// kept: {favs, recent, country, volume, station}
    data: Mutex<Value>,
    /// now: (status, error, song)
    now: Mutex<(String, String, String)>,
    server: Mutex<Option<String>>,
    /// which play this is (the song reader and the status follow only the newest)
    play: AtomicU64,
    started: Mutex<Option<Instant>>,
}

fn file(app: &AppHandle) -> std::path::PathBuf {
    app.state::<App>().data_dir.join("radio.json")
}

fn region() -> String {
    // (asked once: it's read on every state)
    static R: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    R.get_or_init(region_now).clone()
}

/// The country set for the system (two letters), for the stations near it.
fn region_now() -> String {
    platform::os::system::region()
}

fn state(app: &AppHandle) -> Value {
    let r = app.state::<Radio>();
    let d = r.data.lock().unwrap().clone();
    let (status, error, song) = r.now.lock().unwrap().clone();
    json!({"type": "radio", "station": d["station"], "status": status, "error": error, "song": song,
        "volume": d["volume"].as_f64().unwrap_or(60.0), "favs": d["favs"].as_array().cloned().unwrap_or_default(),
        "recent": d["recent"].as_array().cloned().unwrap_or_default(), "country": d["country"].as_str().unwrap_or(""), "region": region()})
}

fn save(app: &AppHandle) {
    let d = app.state::<Radio>().data.lock().unwrap().clone();
    crate::files::save_json(&file(app), &d);
}

fn send(app: &AppHandle) -> Value {
    let s = state(app);
    let _ = app.emit("helper", s.clone());
    s
}

fn set_now(app: &AppHandle, status: &str, error: &str) -> bool {
    let r = app.state::<Radio>();
    let mut n = r.now.lock().unwrap();
    if n.0 == status && n.1 == error {
        return false;
    }
    n.0 = status.into();
    n.1 = error.into();
    // (the song stays through connecting ↔ playing; a stop or an error ends it)
    if status == "stopped" || status == "error" {
        n.2.clear();
    }
    true
}

/// A Radio Browser server (asked once, then kept).
fn server(app: &AppHandle) -> String {
    let r = app.state::<Radio>();
    if let Some(s) = r.server.lock().unwrap().clone() {
        return s;
    }
    let names: Vec<String> = services::http::get_json("https://all.api.radio-browser.info/json/servers").ok()
        .and_then(|v| v.as_array().cloned()).unwrap_or_default().iter().filter_map(|s| s["name"].as_str().map(String::from)).collect();
    let pick = names.get((chrono::Utc::now().timestamp_subsec_nanos() as usize) % names.len().max(1)).cloned()
        .unwrap_or_else(|| "de1.api.radio-browser.info".into());
    *r.server.lock().unwrap() = Some(pick.clone());
    pick
}

fn stations(app: &AppHandle, path: &str) -> Result<Vec<Value>, String> {
    let v = services::http::get_json(&format!("https://{}{path}", server(app))).map_err(|e| {
        // (a server that failed: another one next time)
        *app.state::<Radio>().server.lock().unwrap() = None;
        e.to_string()
    })?;
    Ok(v.as_array().into_iter().flatten().filter_map(services::radio::station).collect())
}

fn list(app: &AppHandle, kind: &str, arg: &str) -> Value {
    let q = services::http::q;
    if kind == "search" {
        let a = stations(app, &format!("/json/stations/search?name={}&order=clickcount&reverse=true&hidebroken=true&limit=60", q(arg)));
        let b = stations(app, &format!("/json/stations/search?tag={}&order=clickcount&reverse=true&hidebroken=true&limit=40", q(arg)));
        return match (a, b) {
            (Err(e), Err(_)) => json!({"ok": false, "list": [], "error": e}),
            (a, b) => {
                let mut all: Vec<Value> = a.unwrap_or_default();
                for s in b.unwrap_or_default() {
                    if !all.iter().any(|x| x["id"] == s["id"]) {
                        all.push(s);
                    }
                }
                json!({"ok": true, "list": all})
            }
        };
    }
    let cc = if arg.is_empty() { region() } else { arg.to_string() };
    let path = if cc.is_empty() {
        "/json/stations/topclick/80?hidebroken=true".to_string()
    } else {
        format!("/json/stations/search?countrycode={}&order=clickcount&reverse=true&hidebroken=true&limit=80", q(&cc))
    };
    match stations(app, &path) {
        Ok(l) => json!({"ok": true, "list": l, "country": cc}),
        Err(e) => json!({"ok": false, "list": [], "country": cc, "error": e}),
    }
}

fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    }).ok()?;
    rx.recv_timeout(Duration::from_secs(3)).ok()
}

fn play(app: &AppHandle, s: &Value) {
    let Some(url) = s["url"].as_str().filter(|u| u.starts_with("http")).map(String::from) else { return };
    let r = app.state::<Radio>();
    let n = r.play.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut d = r.data.lock().unwrap();
        d["station"] = s.clone();
        let mut recent = d["recent"].as_array().cloned().unwrap_or_default();
        services::radio::played(&mut recent, s);
        d["recent"] = json!(recent);
    }
    save(app);
    *r.started.lock().unwrap() = Some(Instant::now());
    // the player first, then the status (a status read in between would see no player and say stopped)
    let vol = r.data.lock().unwrap()["volume"].as_f64().unwrap_or(60.0) as f32 / 100.0;
    let h = app.clone();
    let started = on_main(app, move || h.state::<Radio>().play.load(Ordering::SeqCst) == n && platform::os::player::play(&url, vol));
    if started != Some(true) {
        set_now(app, "error", "This station can’t be played");
        send(app);
        return;
    }
    set_now(app, "connecting", "");
    send(app);
    // (Radio Browser counts a play: its popular lists come from these)
    if let Some(id) = s["id"].as_str().map(String::from) {
        let h = app.clone();
        std::thread::spawn(move || {
            let _ = services::http::get_text(&format!("https://{}/json/url/{}", server(&h), services::http::q(&id)));
        });
    }
    song_reader(app, n, s.clone());
}

fn stop(app: &AppHandle) {
    app.state::<Radio>().play.fetch_add(1, Ordering::SeqCst);
    on_main(app, platform::os::player::stop);
    set_now(app, "stopped", "");
    send(app);
}

/// The stream's song: a short read with ICY metadata every 30 s, while this play goes on (not for HLS).
fn song_reader(app: &AppHandle, n: u64, s: Value) {
    if s["hls"] == true {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let url = s["url"].as_str().unwrap_or("").to_string();
        while app.state::<Radio>().play.load(Ordering::SeqCst) == n {
            // (no ICY titles in this stream: asked no more)
            let Ok(block) = services::http::icy_block(&url) else { return };
            let title = block.and_then(|b| services::radio::icy_title(&b));
            let changed = {
                let r = app.state::<Radio>();
                let mut now = r.now.lock().unwrap();
                // (an error or a stop meanwhile: this play is over)
                if !matches!(now.0.as_str(), "playing" | "connecting") {
                    return;
                }
                let t = title.unwrap_or_default();
                let c = now.2 != t;
                now.2 = t;
                c
            };
            if changed && app.state::<Radio>().play.load(Ordering::SeqCst) == n {
                send(&app);
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

/// What the closed notch shows while the radio plays: a media message (None when the radio is stopped).
pub fn media(app: &AppHandle) -> Option<Value> {
    let r = app.try_state::<Radio>()?;
    let (status, _, song) = r.now.lock().unwrap().clone();
    if status != "playing" && status != "connecting" {
        return None;
    }
    let st = r.data.lock().unwrap()["station"].clone();
    let name = st["name"].as_str().unwrap_or("Radio").to_string();
    let (title, artist) = if song.is_empty() { (name.clone(), String::new()) } else { (song, name) };
    let art = st["favicon"].as_str().filter(|f| !f.is_empty()).map(|f| json!(f)).unwrap_or(Value::Null);
    Some(json!({"type": "media", "active": true, "playing": status == "playing", "source": "radio", "id": st["id"], "title": title,
        "artist": artist, "album": "", "app": "sympony.radio", "artwork": art, "arts": 0, "duration": 0, "position": 0,
        "positionUpdated": 0, "canShuffle": false, "canRepeat": false, "canSeek": false, "canPrev": false, "canNext": false, "radio": true}))
}

/// The notch's play / pause for the radio (a live stream: pausing stops it).
pub fn command(app: &AppHandle, action: &str) {
    let playing = matches!(app.state::<Radio>().now.lock().unwrap().0.as_str(), "playing" | "connecting");
    match action {
        "pause" => stop(app),
        "toggle" if playing => stop(app),
        "play" | "toggle" => {
            let s = app.state::<Radio>().data.lock().unwrap()["station"].clone();
            play(app, &s);
        }
        _ => {}
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Radio::default());
    *app.state::<Radio>().now.lock().unwrap() = ("stopped".into(), String::new(), String::new());
    macro_rules! add {
        ($name:expr, |$h:ident, $a:ident| $body:expr) => {{
            let $h = app.clone();
            reg.add($name, Box::new(move |_, $a: Vec<Value>| { let _ = &$a; Ok($body) }));
        }};
    }
    add!("radio.state", |h, a| state(&h));
    add!("radio.play", |h, a| {
        if let Some(s) = a.first().filter(|s| s["url"].is_string()) {
            play(&h, s);
        }
        Value::Null
    });
    add!("radio.stop", |h, a| {
        stop(&h);
        Value::Null
    });
    add!("radio.volume", |h, a| {
        let v = a.first().and_then(Value::as_f64).unwrap_or(60.0).clamp(0.0, 100.0);
        h.state::<Radio>().data.lock().unwrap()["volume"] = json!(v);
        save(&h);
        on_main(&h, move || platform::os::player::set_volume(v as f32 / 100.0));
        send(&h);
        Value::Null
    });
    add!("radio.fav", |h, a| {
        if let Some(s) = a.first().filter(|s| s["id"].is_string()) {
            let st = h.state::<Radio>();
            let mut d = st.data.lock().unwrap();
            let mut favs = d["favs"].as_array().cloned().unwrap_or_default();
            services::radio::fav(&mut favs, s);
            d["favs"] = json!(favs);
        }
        save(&h);
        send(&h)
    });
    add!("radio.forget", |h, a| {
        let id = a.first().cloned().unwrap_or(Value::Null);
        {
            let st = h.state::<Radio>();
            let mut d = st.data.lock().unwrap();
            let recent: Vec<Value> = d["recent"].as_array().cloned().unwrap_or_default().into_iter().filter(|s| s["id"] != id).collect();
            d["recent"] = json!(recent);
        }
        save(&h);
        send(&h)
    });
    add!("radio.country", |h, a| {
        let cc = a.first().and_then(Value::as_str).filter(|c| c.len() == 2 && c.chars().all(|ch| ch.is_ascii_alphabetic())).unwrap_or("").to_ascii_uppercase();
        h.state::<Radio>().data.lock().unwrap()["country"] = json!(cc);
        save(&h);
        send(&h)
    });
    add!("radio.list", |h, a| list(&h, a.first().and_then(Value::as_str).unwrap_or("top"), a.get(1).and_then(Value::as_str).unwrap_or("")));
    add!("radio.countries", |h, a| {
        let v = services::http::get_json(&format!("https://{}/json/countries?order=stationcount&reverse=true&hidebroken=true", server(&h))).unwrap_or(Value::Null);
        Value::Array(v.as_array().into_iter().flatten().filter_map(|c| {
            let code = c["iso_3166_1"].as_str().filter(|s| s.len() == 2)?;
            let n = c["stationcount"].as_u64().filter(|n| *n > 0)?;
            Some(json!({"code": code, "count": n}))
        }).collect())
    });
}

/// At start: what was kept; then once a second while it plays, AVFoundation's status.
pub fn start(app: &AppHandle) {
    let kept = std::fs::read(file(app)).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    *app.state::<Radio>().data.lock().unwrap() = kept;
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let r = app.state::<Radio>();
        if !matches!(r.now.lock().unwrap().0.as_str(), "playing" | "connecting") {
            continue;
        }
        let since = r.started.lock().unwrap().map(|t| t.elapsed()).unwrap_or_default();
        let young = since < Duration::from_secs(4);
        // (the play this reading is about: a newer one meanwhile makes it stale)
        let n = r.play.load(Ordering::SeqCst);
        let Some(st) = on_main(&app, platform::os::player::state) else { continue };
        if r.play.load(Ordering::SeqCst) != n {
            continue;
        }
        use platform::os::player::State;
        let (status, error) = match st {
            State::Playing => ("playing", String::new()),
            // (no answer for 20 s: the network or the station is gone)
            State::Connecting if since > Duration::from_secs(20) && r.now.lock().unwrap().0 == "connecting" => ("error", "The station doesn’t answer".to_string()),
            State::Connecting => ("connecting", String::new()),
            // (just started: AVPlayer reports paused, or nothing yet, before it begins)
            State::Failed(e) if young && e.is_empty() => ("connecting", String::new()),
            State::Stopped if young => ("connecting", String::new()),
            State::Failed(e) => ("error", if e.is_empty() { "The station stopped sending".to_string() } else { e }),
            State::Stopped => ("stopped", String::new()),
        };
        if status == "error" {
            // (this play only: a newer one isn't stopped; and its song reader ends)
            if r.play.compare_exchange(n, n + 1, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                on_main(&app, platform::os::player::stop);
            }
        }
        if set_now(&app, status, &error) {
            send(&app);
        }
    });
}
