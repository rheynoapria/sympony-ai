//! YouTube video mode.
//! The player page: helper/yt.html served on a loopback port, loaded by the notch as http://localhost:<port>/yt.html.
//! The video: looked up in the playing browser's tabs (macOS: helper/yt_tabs.js, its own short osascript, after the
//! Automation permission; Windows: the address bar of the browser window showing it) only while the open notch shows
//! Music (`yt.want`), and sent as `video` with the media.
use crate::commands::App;
use platform::os::automation;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
const TABS: &str = include_str!("../helper/yt_tabs.js");
#[cfg(target_os = "macos")]
static TABS_WRITTEN: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn ensure_tabs_script(data_dir: &std::path::Path) -> std::path::PathBuf {
    let p = data_dir.join("helper/yt_tabs.js");
    if !TABS_WRITTEN.load(Ordering::Relaxed) || !p.exists() {
        if let Some(parent) = p.parent() {
            let _ = services::paths::ensure_private_dir(parent);
        }
        if services::paths::write_private(&p, TABS.as_bytes()).is_ok() {
            TABS_WRITTEN.store(true, Ordering::Relaxed);
        }
    }
    p
}

struct Slot {
    key: String,
    id: Option<String>,
    avatar: Option<String>, // the channel's picture: the cover when the song has none
    busy: bool,
    at: Instant,
}

struct Yt {
    want: AtomicBool,
    // browsers macOS already lets Sympony read (checked once each, without asking): looked up while the notch is
    // closed too, so the video is ready the moment Music opens
    allowed: Mutex<std::collections::HashMap<String, bool>>,
    denied: Mutex<Option<String>>, // the browser macOS said no for (no more lookups for it this run)
    slot: Mutex<Slot>,
}

/// Adds `video` (the id, or null) to the media about to be sent; starts a lookup when one is due.
pub fn fill(app: &AppHandle, m: &mut Value) {
    m["video"] = Value::Null;
    let Some(y) = app.try_state::<Yt>() else { return };
    let bid = m["app"].as_str().unwrap_or("").to_string();
    if m["active"] != true || !services::youtube::is_browser(&bid) || !app.state::<App>().settings.bool_or("ytVideo", true)
        || y.denied.lock().unwrap().as_deref() == Some(&bid)
    {
        return;
    }
    // (asking macOS only ever happens while Music is open; before that, only for a browser already allowed)
    // (the open notch showing Music, or the floating video: both want the video)
    let want = y.want.load(Ordering::SeqCst) || app.get_webview_window(FLOAT).is_some();
    if !want && !*y.allowed.lock().unwrap().entry(bid.clone()).or_insert_with(|| automation::status(&bid, false) == "granted") {
        return;
    }
    let key = services::youtube::lookup_key(m);
    let mut s = y.slot.lock().unwrap();
    // (again every 2 s on Windows, where a lookup reads one address bar; 5 s on macOS, an osascript each time)
    let every = Duration::from_secs(if cfg!(windows) { 2 } else { 5 });
    if services::youtube::due_every(&s.key, &key, s.id.is_some(), m["playing"] == true, s.busy, want, s.at.elapsed(), every) {
        let (id, avatar) = if s.key == key { (s.id.take(), s.avatar.take()) } else { (None, None) };
        *s = Slot { key: key.clone(), id, avatar, busy: true, at: Instant::now() };
        let (app, title, key) = (app.clone(), m["title"].as_str().unwrap_or("").to_string(), key.clone());
        let need_avatar = services::youtube::wants_avatar(m);
        std::thread::spawn(move || {
            let found = find(&app, &bid, &title);
            // the id first (sent with the next poll, within a second); the channel picture after, never holding it up
            let fetch = {
                let y = app.state::<Yt>();
                let mut s = y.slot.lock().unwrap();
                s.busy = false;
                s.at = Instant::now();
                if s.key != key {
                    return;
                }
                s.id = found.clone();
                found.filter(|_| need_avatar && s.avatar.is_none())
            };
            if let Some(avatar) = fetch.as_deref().and_then(channel_avatar) {
                let y = app.state::<Yt>();
                let mut s = y.slot.lock().unwrap();
                if s.key == key {
                    s.avatar = Some(avatar);
                }
            }
        });
    }
    if s.key == key {
        if let Some(id) = &s.id {
            m["video"] = Value::String(id.clone());
            if m["artwork"].is_null() {
                if let Some(a) = &s.avatar {
                    m["artwork"] = Value::String(a.clone());
                }
            }
        }
    }
}

/// The video's channel picture: YouTube's oEmbed names the channel, its page's og:image is the picture.
fn channel_avatar(id: &str) -> Option<String> {
    let oembed = services::http::get_json(&format!("https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={id}")).ok()?;
    let page = services::http::get_text(&services::youtube::channel_url(&oembed)?).ok()?;
    services::youtube::avatar_from_page(&page)
}

/// The playing tab's video: asks macOS for the Automation permission the first time (the one prompt), then reads
/// the browser's tabs. (Windows asks nothing: `automation::status` is "granted" there.)
fn find(app: &AppHandle, bid: &str, title: &str) -> Option<String> {
    let a = app.state::<App>();
    let st = match automation::status(bid, false) {
        "notAsked" => automation::status(bid, true),
        s => s,
    };
    if st == "denied" {
        a.log.line(&format!("youtube: automation denied for {bid}"));
        *app.state::<Yt>().denied.lock().unwrap() = Some(bid.to_string());
        return None;
    }
    if st != "granted" {
        return None;
    }
    app.state::<Yt>().allowed.lock().unwrap().insert(bid.to_string(), true);
    services::youtube::pick_tab(&tabs(app, bid, title)?, title)
}

/// The browser's video tabs `(address, title)`, from helper/yt_tabs.js.
#[cfg(target_os = "macos")]
fn tabs(app: &AppHandle, bid: &str, _title: &str) -> Option<Vec<(String, String)>> {
    let a = app.state::<App>();
    let path = ensure_tabs_script(&a.data_dir);
    let mut child = Command::new("/usr/bin/osascript").args(["-l", "JavaScript"]).arg(&path).arg(bid)
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    // (read while it runs: a full pipe would block it until the timeout)
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = String::new();
        let _ = stdout.take(1 << 20).read_to_string(&mut out);
        out
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(5) => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                a.log.line(&format!("youtube: {bid} tabs took too long"));
                return None;
            }
        }
    }
    let out = reader.join().ok()?;
    let tabs = services::youtube::parse_tabs(&out);
    if tabs.is_none() {
        a.log.line(&format!("youtube: {bid} tabs: {}", out.trim()));
    }
    tabs
}

/// Windows: the address bar of each of the browser's windows whose title names what plays (only those are read),
/// with that title. A window shows its current tab: a video in a tab behind another is found once it's in front.
#[cfg(windows)]
fn tabs(_app: &AppHandle, bid: &str, title: &str) -> Option<Vec<(String, String)>> {
    let exe = services::youtube::windows_browser(bid)?;
    Some(platform::os::browser::addresses(exe, &|t| services::youtube::names(t, title)))
}

/// The floating video (picture in picture): its window, frontend/ytfloat.html.
pub const FLOAT: &str = "ytfloat";
/// Its place and size (logical points) as last moved or resized, kept in Settings (`ytFloat`) when it closes.
static FLOAT_BOUNDS: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

/// Opens the floating video over every window (where it was last time, else the primary display's bottom-right
/// corner; without taking the keyboard from the app in front) or closes it.
fn float(app: &AppHandle, open: bool) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window(FLOAT) {
            if !open {
                let _ = w.close();
            }
            return;
        }
        if !open {
            return;
        }
        let (x, y, w, h) = float_bounds(&a);
        let built = WebviewWindowBuilder::new(&a, FLOAT, WebviewUrl::App("ytfloat.html".into()))
            .initialization_script(crate::page_globals())
            .title("Sympony video")
            .decorations(false)
            .shadow(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .skip_taskbar(true)
            .resizable(true)
            .focused(false)
            .min_inner_size(240.0, 135.0)
            .inner_size(w, h)
            .position(x, y)
            .build();
        match built {
            Ok(win) => {
                *FLOAT_BOUNDS.lock().unwrap() = Some((x, y, w, h));
                let h = a.clone();
                win.on_window_event(move |e| match e {
                    tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                        if let Some(w) = h.get_webview_window(FLOAT) {
                            let k = w.scale_factor().unwrap_or(1.0);
                            if let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) {
                                let (p, s) = (p.to_logical::<f64>(k), s.to_logical::<f64>(k));
                                *FLOAT_BOUNDS.lock().unwrap() = Some((p.x, p.y, s.width, s.height));
                            }
                        }
                    }
                    tauri::WindowEvent::Destroyed => {
                        if let Some((x, y, w, h2)) = *FLOAT_BOUNDS.lock().unwrap() {
                            h.state::<App>().settings.set(json!({ "ytFloat": { "x": x, "y": y, "w": w, "h": h2 } }));
                        }
                    }
                    _ => {}
                });
            }
            Err(e) => a.state::<App>().log.line(&format!("floating video window: {e}")),
        }
    });
}

/// Where the floating video opens: where it was, while that's still on a display; else 400×225 in the primary
/// display's bottom-right corner, above the taskbar / Dock.
fn float_bounds(app: &AppHandle) -> (f64, f64, f64, f64) {
    let saved = &app.state::<App>().settings.snapshot()["ytFloat"];
    let num = |k: &str| saved[k].as_f64();
    let on_a_display = |x: f64, y: f64| {
        app.available_monitors().unwrap_or_default().iter().any(|m| {
            let k = m.scale_factor();
            let (p, s) = (m.position().to_logical::<f64>(k), m.size().to_logical::<f64>(k));
            x >= p.x && y >= p.y && x < p.x + s.width && y < p.y + s.height
        })
    };
    if let (Some(x), Some(y), Some(w), Some(h)) = (num("x"), num("y"), num("w"), num("h")) {
        if w >= 240.0 && h >= 135.0 && on_a_display(x + w / 2.0, y + h / 2.0) {
            return (x, y, w, h);
        }
    }
    let (w, h, margin) = (400.0, 225.0, 24.0);
    match app.primary_monitor().ok().flatten() {
        Some(m) => {
            let (k, area) = (m.scale_factor(), m.work_area());
            let (p, s) = (area.position.to_logical::<f64>(k), area.size.to_logical::<f64>(k));
            (p.x + s.width - w - margin, p.y + s.height - h - margin, w, h)
        }
        None => (margin, margin, w, h),
    }
}

const PAGE: &str = include_str!("../helper/yt.html");
static PORT: OnceLock<u16> = OnceLock::new();

/// Starts the page's server once (127.0.0.1, a free port) and gives its port.
pub fn serve() -> Result<u16, String> {
    if let Some(p) = PORT.get() {
        return Ok(*p);
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    if PORT.set(port).is_err() {
        return Ok(*PORT.get().unwrap()); // (another call won the race; this listener closes)
    }
    std::thread::spawn(move || {
        for mut s in listener.incoming().flatten() {
            let deadline = Instant::now() + Duration::from_secs(2);
            // (the whole request head before answering, bounded by a wall-clock deadline against slowloris)
            let mut req = Vec::new();
            let mut buf = [0u8; 1024];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") && req.len() < 8192 {
                let Some(left) = deadline.checked_duration_since(Instant::now()) else { break };
                let _ = s.set_read_timeout(Some(left.max(Duration::from_millis(10))));
                match s.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => req.extend_from_slice(&buf[..n]),
                }
            }
            let line = String::from_utf8_lossy(&req);
            let ok = line.lines().next().is_some_and(|l| l.split(' ').nth(1) == Some("/yt.html"));
            let (head, body) = if ok { ("200 OK", PAGE) } else { ("404 Not Found", "") };
            let _ = write!(
                s,
                "HTTP/1.1 {head}\r\nContent-Type: text/html; charset=utf-8\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost http://localhost:*\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = s.shutdown(std::net::Shutdown::Write);
        }
    });
    Ok(port)
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Yt { want: AtomicBool::new(false), allowed: Mutex::new(Default::default()), denied: Mutex::new(None), slot: Mutex::new(Slot { key: String::new(), id: None, avatar: None, busy: false, at: Instant::now() }) });
    // (the host must be localhost: YouTube refuses label videos embedded from 127.0.0.1)
    reg.add("yt.url", Box::new(|_, _| Ok(Value::String(format!("http://localhost:{}/yt.html", serve().map_err(anyhow::Error::msg)?)))));
    // the open notch shows Music (true) or not any more (false): lookups only in between
    let h = app.clone();
    reg.add("yt.want", Box::new(move |_, a| {
        let on = a.first().and_then(Value::as_bool).unwrap_or(false);
        let y = h.state::<Yt>();
        y.want.store(on, Ordering::SeqCst);
        if on {
            // (allowed in System Settings since: look again)
            let mut d = y.denied.lock().unwrap();
            if d.as_deref().is_some_and(|b| automation::status(b, false) != "denied") {
                *d = None;
            }
        }
        Ok(Value::Null)
    }));
    // the floating video: open (true, also when no argument) or closed (false)
    let h = app.clone();
    reg.add("yt.float", Box::new(move |_, a| {
        float(&h, a.first().and_then(Value::as_bool).unwrap_or(true));
        Ok(Value::Null)
    }));
    // Settings → Media: the browser playing now and whether Sympony may read its tabs
    let h = app.clone();
    reg.add("yt.status", Box::new(move |_, _| {
        let last = h.state::<crate::media::Media>().last();
        let bid = last["app"].as_str().filter(|b| services::youtube::is_browser(b)).map(String::from);
        let st = bid.as_deref().map(|b| automation::status(b, false));
        Ok(json!({ "browser": bid, "automation": st }))
    }));
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    fn get(port: u16, path: &str) -> String {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        out
    }

    #[test]
    fn server_serves_the_page_only() {
        let port = super::serve().unwrap();
        assert_eq!(super::serve().unwrap(), port); // (one server)
        let page = get(port, "/yt.html");
        assert!(page.starts_with("HTTP/1.1 200"), "{page}");
        assert!(page.contains("text/html") && page.contains("iframe_api"));
        assert!(page.contains("frame-ancestors tauri://localhost"));
        assert!(get(port, "/").starts_with("HTTP/1.1 404"));
        assert!(get(port, "/yt.html/../secrets.json").starts_with("HTTP/1.1 404"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn tabs_helper_is_rewritten_if_deleted() {
        let dir = std::env::temp_dir().join(format!("sy-yt-helper-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let p = super::ensure_tabs_script(&dir);
        assert!(p.is_file());
        std::fs::remove_file(&p).unwrap();
        assert!(!p.exists());
        let p2 = super::ensure_tabs_script(&dir);
        assert!(p2.is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
