//! Volume, brightness, Caps Lock and the input language every 200 ms, the battery every 30 s: a `helper` message
//! only when a reading changed. The System tab's numbers (`stats`, and `net` for the speeds) every second.
use platform::macos::{radios, system};
use serde_json::{json, Value};
use services::watch::{lockkeys_changed, Watch};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// The last `stats` reading (`stats.now`: AI Chat tells the model about this Mac).
static STATS: Mutex<Value> = Mutex::new(Value::Null);

#[derive(Default)]
pub struct Latest(Mutex<HashMap<&'static str, Value>>);

impl Latest {
    pub fn all(&self) -> HashMap<&'static str, Value> {
        self.0.lock().unwrap().clone()
    }
}

fn send(app: &AppHandle, kind: &'static str, mut m: Value) {
    m["type"] = json!(kind);
    let _ = app.emit("helper", &m);
    if let Some(o) = m.as_object_mut() {
        o.remove("changed");
    }
    app.state::<Latest>().0.lock().unwrap().insert(kind, m);
}

pub fn start(app: &AppHandle) {
    app.manage(Latest::default());
    let app = app.clone();
    std::thread::spawn(move || {
        let (mut vol, mut bri, mut caps, mut lang, mut pow) = (Watch::default(), Watch::default(), Watch::default(), Watch::default(), Watch::default());
        let mut power_at: Option<Instant> = None;
        let mut stats_at: Option<Instant> = None;
        let mut ticks = system::cpu_ticks();
        let (mut radios, mut theme, mut mic, mut bt) = (Watch::default(), Watch::default(), Watch::default(), Watch::default());
        let mut idle_watch: Watch<(bool, bool)> = Watch::default();
        let mut beat = 0u64;
        let mut disk_vol: Option<String> = None;
        let (model, cores) = (system::cpu_model(), std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1));
        loop {
            if let Some(((level, muted), _)) = system::volume().and_then(|v| vol.update(v)) {
                send(&app, "volume", json!({ "level": level, "muted": muted }));
            }
            if let Some((b, _)) = bri.update(system::brightness()) {
                send(&app, "brightness", json!({ "level": b.unwrap_or(0), "supported": b.is_some() }));
            }
            if let Some((c, prev)) = caps.update(system::caps_lock()) {
                let (now, before) = (json!({ "caps": c }), json!({ "caps": prev }));
                let changed = prev.and_then(|_| lockkeys_changed(&before, &now));
                send(&app, "lockkeys", json!({ "caps": c, "changed": changed }));
            }
            if let Some(((code, name, count), prev)) = system::input_source().and_then(|v| lang.update(v)) {
                send(&app, "inputlang", json!({ "code": code, "name": name, "count": count, "changed": prev.is_some() }));
            }
            if power_at.is_none_or(|t| t.elapsed() >= Duration::from_secs(2)) {
                power_at = Some(Instant::now());
                if let Some((p, _)) = pow.update(system::power()) {
                    send(&app, "power", p);
                }
            }
            if stats_at.is_none_or(|t| t.elapsed() >= Duration::from_secs(1)) {
                stats_at = Some(Instant::now());
                let now = system::cpu_ticks();
                let cpu = match (ticks, now) {
                    (Some(a), Some(b)) => services::stats::cpu_busy(a, b),
                    _ => 0.0,
                };
                ticks = now;
                let mem = system::memory().map(|(t, [page, internal, purgeable, wired, compressed])| {
                    (t, services::stats::mem_breakdown(page, internal, purgeable, wired, compressed, t))
                });
                let (mem_total, mem_used, mem_app, mem_wired, mem_compressed) = match mem {
                    Some((t, b)) => (t, b.used, Some(b.app), Some(b.wired), Some(b.compressed)),
                    None => (0, 0, None, None, None),
                };
                let mem_pressure = system::memory_pressure().and_then(services::stats::memory_pressure_label);
                if beat % 30 == 0 || disk_vol.is_none() {
                    disk_vol = system::disk_name().and_then(|s| services::stats::clean_volume_name(&s));
                }
                let disk = system::disk().map(|(total, free)| {
                    let mut obj = json!({ "total": total, "free": free });
                    if let Some(ref name) = disk_vol {
                        obj["name"] = json!(name);
                    }
                    obj
                });
                let reading = json!({
                    "cpu": cpu, "cores": cores, "cpuModel": model,
                    "memTotal": mem_total, "memFree": mem_total.saturating_sub(mem_used),
                    "memApp": mem_app, "memWired": mem_wired, "memCompressed": mem_compressed,
                    "memPressure": mem_pressure,
                    "disk": disk, "diskName": disk_vol, "wifi": wifi(),
                    "at": chrono::Utc::now().timestamp_millis(),
                });
                *STATS.lock().unwrap() = reading.clone();
                let _ = app.emit("stats", reading);
                let on = |b: bool| if b { "on" } else { "off" };
                let r = json!({ "wifi": radios::wifi_on().map(on), "bluetooth": on(radios::bluetooth_on()), "airplane": null });
                if let Some((r, _)) = radios.update(r) {
                    send(&app, "radios", r);
                }
                if beat % 5 == 0 {
                    if let Some((d, _)) = bt.update(bt_devices()) {
                        send(&app, "bluetooth", json!({ "devices": d }));
                    }
                }
                beat += 1;
                if let Some((d, _)) = theme.update(radios::dark_mode()) {
                    send(&app, "theme", json!({ "dark": d }));
                }
                if let Some(((available, muted), _)) = mic.update(system::mic()) {
                    send(&app, "mic", json!({ "available": available, "muted": muted }));
                }
                let idle_ms = (system::idle_secs().max(0.0) * 1000.0).round() as u64;
                let locked = system::screen_locked();
                let asleep = idle_ms >= 600_000;
                if idle_watch.update((asleep, locked)).is_some() || (idle_ms >= 60_000 && beat % 15 == 0) {
                    send(&app, "idle", json!({ "idleMs": idle_ms, "locked": locked }));
                }
                keep_awake(app.state::<crate::commands::App>().settings.bool_or("keepAwake", false));
                let (rx, tx, wired) = system::network();
                let _ = app.emit("helper", json!({ "type": "net", "rx": rx, "tx": tx, "t": chrono::Utc::now().timestamp_millis(), "wired": wired }));
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}

/// `helper_cmd` for the Control tab's sliders and the mute button. True when handled here.
pub fn command(cmd: &Value) -> bool {
    let level = || cmd["value"].as_f64().unwrap_or(0.0).round().clamp(0.0, 100.0) as u8;
    match cmd["cmd"].as_str().unwrap_or("") {
        "volume.set" => system::set_volume(level()),
        "volume.mute" => system::toggle_mute(),
        "brightness.set" => system::set_brightness(level()),
        "mic.toggle" => system::toggle_mic(),
        _ => return false,
    }
    true
}

/// `audio.devices(input)` and `audio.setDefault(id)` for the Control tab's Sound output (ids "out:<n>" / "in:<n>":
/// a device can be both).
pub fn register_audio(reg: &mut services::Registry) {
    reg.add("audio.devices", Box::new(|_, args| {
        let input = args.first().and_then(Value::as_bool).unwrap_or(false);
        let pre = if input { "in" } else { "out" };
        Ok(Value::Array(system::audio_devices(input).into_iter()
            .map(|(id, name, default)| json!({ "id": format!("{pre}:{id}"), "name": name, "default": default }))
            .collect()))
    }));
    reg.add("audio.setDefault", Box::new(|_, args| {
        let id = args.first().and_then(Value::as_str).unwrap_or("");
        let ok = match id.split_once(':') {
            Some((kind, n)) => n.parse().is_ok_and(|n| system::set_default_device(n, kind == "in")),
            None => false,
        };
        Ok(Value::Bool(ok))
    }));
}

/// The network now: `{ssid, quality}` (null when not on Wi-Fi, or macOS doesn't tell the name).
fn wifi() -> Value {
    radios::wifi_ssid().map(|s| json!({ "ssid": s, "quality": services::stats::wifi_quality(radios::wifi_rssi()) })).unwrap_or(Value::Null)
}

/// Keep awake (Control tab): macOS's own `caffeinate` keeps the display on while it runs, tied to Sympony's life.
fn keep_awake(on: bool) {
    static CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
    let mut c = CHILD.lock().unwrap();
    match (on, c.is_some()) {
        (true, false) => {
            *c = std::process::Command::new("/usr/bin/caffeinate").args(["-di", "-w", &std::process::id().to_string()]).spawn().ok();
        }
        (false, true) => {
            if let Some(mut ch) = c.take() {
                let _ = ch.kill();
                let _ = ch.wait();
            }
        }
        _ => {}
    }
}

/// `system.toggle(id)` (the Control tab's tiles) and `stats.wifi`.
pub fn register_system(reg: &mut services::Registry, app: &AppHandle) {
    reg.add("stats.wifi", Box::new(|_, _| Ok(wifi())));
    reg.add("stats.now", Box::new(|_, _| Ok(STATS.lock().unwrap().clone())));
    // a Mac has no thermal zones an app can read without private APIs: Settings says so
    reg.add("temp.zones", Box::new(|_, _| Ok(json!({ "checked": true, "zones": [] }))));
    reg.add("wifi.list", Box::new(|_, a| {
        let scan = a.first().and_then(Value::as_bool).unwrap_or(false);
        let Some(mut nets) = radios::wifi_scan(scan) else { return Ok(json!({ "ok": false, "message": "This Mac has no Wi-Fi" })) };
        if nets.is_empty() && !scan {
            nets = radios::wifi_scan(true).unwrap_or_default();
        }
        if nets.is_empty() {
            return Ok(json!({ "ok": false, "message": "Couldn’t look for networks just now. Try Refresh in a moment." }));
        }
        // macOS gives the names only to apps allowed Location (asked for the weather)
        if !nets.is_empty() && nets.iter().all(|n| n.0.is_none()) {
            return Ok(json!({ "ok": false, "reason": "location" }));
        }
        let scans: Vec<services::wifi::Scan> = nets
            .into_iter()
            .filter_map(|(ssid, rssi, secure, enterprise, band)| Some(services::wifi::Scan { ssid: ssid?, rssi, secure, enterprise, band }))
            .collect();
        Ok(services::wifi::to_networks(&scans, &radios::wifi_saved(), radios::wifi_ssid().as_deref()))
    }));
    reg.add("wifi.connect", Box::new(|_, a| {
        let ssid = a.first().and_then(Value::as_str).unwrap_or("");
        let pass = a.get(1).and_then(Value::as_str).unwrap_or("");
        Ok(match radios::wifi_join(ssid, pass) {
            Ok(()) => json!({ "ok": true }),
            Err(m) => {
                let need = pass.is_empty() && !radios::wifi_saved().iter().any(|s| s == ssid);
                json!({ "ok": false, "message": m, "needPassword": need })
            }
        })
    }));
    for (name, on) in [("bluetooth.connect", true), ("bluetooth.disconnect", false)] {
        reg.add(name, Box::new(move |_, a| {
            let id = a.first().and_then(Value::as_str).unwrap_or("");
            if !radios::bluetooth_devices().iter().any(|d| d.0 == id) {
                return Ok(json!({ "ok": false, "message": "That device isn’t paired any more" }));
            }
            Ok(match radios::bluetooth_connect(id, on) {
                Ok(()) => json!({ "ok": true }),
                Err(code) => json!({ "ok": false, "message": services::bluetooth::connect_error(code) }),
            })
        }));
    }
    reg.add("wifi.disconnect", Box::new(|_, _| {
        radios::wifi_leave();
        Ok(json!({ "ok": true }))
    }));
    let h = app.clone();
    reg.add("system.toggle", Box::new(move |ctx, a| {
        let flip = |k: &str| {
            let s = h.state::<crate::commands::App>();
            let patch = json!({ k: s.settings.get()[k] != true });
            s.settings.set(patch.clone());
            (ctx.changed)(&patch);
        };
        match a.first().and_then(Value::as_str).unwrap_or("") {
            "wifi" => {
                radios::set_wifi(!radios::wifi_on().unwrap_or(false));
            }
            "bluetooth" => radios::set_bluetooth(!radios::bluetooth_on()),
            "dark" => {
                radios::set_dark_mode(!radios::dark_mode());
            }
            "mic" => system::toggle_mic(),
            "mute" => system::toggle_mute(),
            "keepAwake" => flip("keepAwake"),
            "eyeBreaks" => flip("healthEyeBreaks"),
            "lock" => radios::lock_screen(),
            "screenshot" => {
                let _ = std::process::Command::new("/usr/bin/open").args(["-b", "com.apple.screenshot.launcher"]).status();
            }
            other => (ctx.log)(&format!("system.toggle: {other} isn't on a Mac")),
        }
        Ok(Value::Null)
    }));
}

/// The paired devices as the Bluetooth tab lists them (no battery level on a Mac yet: -1).
fn bt_devices() -> Value {
    if !radios::bluetooth_on() {
        return json!([]);
    }
    radios::bluetooth_devices()
        .into_iter()
        .map(|(id, name, connected, major, minor)| {
            let (kind, audio) = services::bluetooth::kind(major, minor);
            json!({ "id": id, "name": name, "connected": connected, "kind": kind, "battery": -1, "audio": audio })
        })
        .collect()
}
