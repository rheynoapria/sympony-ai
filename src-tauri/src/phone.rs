//! Sharing with a phone: a page Sympony serves on this Wi-Fi (phone.html), opened by the Shelf's QR code. The phone
//! sends files (into the phone folder, then onto the Shelf), texts and links (onto the clipboard), and downloads the
//! Shelf's files. Everything is under an unguessable token; it stops on Stop, after 15 minutes without use, when the
//! Wi-Fi changes or when it's turned off in Settings. The routes, names and request heads are services::phone's.
//!
//! Its own small HTTP server (one request per connection, `Connection: close`): any device on the Wi-Fi can reach
//! the port, so nothing a client says is trusted. At most 16 connections, every read has a timeout, a body is read
//! only for a known route and up to its limit, and nothing is sized by what the client claims.
use serde_json::{json, Value};
use services::phone::Route;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const PAGE: &str = include_str!("phone.html");
const IDLE: Duration = Duration::from_secs(15 * 60);
/// A phone that asked something this recently is "connected".
const SEEN: Duration = Duration::from_secs(60);
const MAX_HEAD: usize = 16 << 10;
const MAX_TEXT: u64 = 1 << 20;
/// ponytail: one file up to 8 GB (a long video); raise it if someone needs more
const MAX_FILE: u64 = 8 << 30;
const MAX_CONNECTIONS: usize = 16;
/// A client silent this long is dropped (a phone uploading keeps sending).
const READ_WAIT: Duration = Duration::from_secs(20);

/// One sharing session: what the loop and the connections share.
struct Session {
    token: String,
    host: String,
    pc: String,
    stop: AtomicBool,
    last: Mutex<Option<Instant>>,
    open: AtomicUsize,
}

impl Session {
    fn used(&self) {
        *self.last.lock().unwrap() = Some(Instant::now());
    }
}

struct Run {
    url: String,
    qr: String,
    s: Arc<Session>,
}

#[derive(Default)]
pub struct Phone {
    run: Mutex<Option<Run>>,
    /// why it stopped by itself ("idle", "wifi")
    why: Mutex<Option<&'static str>>,
    /// held while starting (two starts at once make one session)
    starting: Mutex<()>,
}

fn state(app: &AppHandle) -> Value {
    let p = app.state::<Phone>();
    let run = p.run.lock().unwrap();
    match run.as_ref() {
        Some(r) => {
            let connected = r.s.last.lock().unwrap().is_some_and(|t| t.elapsed() < SEEN);
            json!({"on": true, "qr": r.qr, "url": r.url, "address": r.s.host, "pc": r.s.pc, "connected": connected})
        }
        None => match *p.why.lock().unwrap() {
            Some(w) => json!({"on": false, "why": w}),
            None => json!({"on": false}),
        },
    }
}

fn send_state(app: &AppHandle) {
    let _ = app.emit("phone:state", state(app));
}

/// The Mac's address on the Wi-Fi / Ethernet: en0…en8 first via `getifaddrs` (zero subprocess spawns), else the default route's.
fn lan_address() -> Option<Ipv4Addr> {
    #[cfg(unix)]
    {
        let mut ifap: *mut libc::ifaddrs = std::ptr::null_mut();
        // SAFETY: `getifaddrs` populates `ifap` on success (0) and must be freed via `freeifaddrs`.
        if unsafe { libc::getifaddrs(&mut ifap) } == 0 && !ifap.is_null() {
            let mut best: Option<(usize, Ipv4Addr)> = None;
            let mut cur = ifap;
            while !cur.is_null() {
                let ifa = unsafe { &*cur };
                if !ifa.ifa_name.is_null() && !ifa.ifa_addr.is_null() && (ifa.ifa_flags as i32 & libc::IFF_UP) != 0 {
                    let sa = unsafe { &*ifa.ifa_addr };
                    if sa.sa_family as i32 == libc::AF_INET {
                        let name = unsafe { std::ffi::CStr::from_ptr(ifa.ifa_name) }.to_string_lossy();
                        if let Some(idx) = name.strip_prefix("en").and_then(|s| s.parse::<usize>().ok()).filter(|&n| n < 9) {
                            let sin = unsafe { &*(ifa.ifa_addr as *const libc::sockaddr_in) };
                            let ip = Ipv4Addr::from(u32::from_be(sin.sin_addr.s_addr));
                            if services::phone::is_lan(ip) && best.is_none_or(|(b, _)| idx < b) {
                                best = Some((idx, ip));
                            }
                        }
                    }
                }
                cur = ifa.ifa_next;
            }
            unsafe { libc::freeifaddrs(ifap) };
            if let Some((_, ip)) = best {
                return Some(ip);
            }
        }
    }
    // (no packet is sent: connecting a UDP socket only picks the way out)
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.168.255.255:9").ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if services::phone::is_lan(ip) => Some(ip),
        _ => None,
    }
}

pub fn pc_name() -> String {
    std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Mac".into())
}

pub fn folder(app: &AppHandle) -> PathBuf {
    let default_dir = PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Downloads").join("Sympony");
    let s = app.state::<App>().settings.snapshot();
    match s["phoneFolder"].as_str().filter(|p| !p.is_empty()) {
        Some(p) if services::exec::secret_place(p).is_none() => {
            let pb = PathBuf::from(p);
            if pb.canonicalize().ok().is_some_and(|c| services::exec::secret_place(&c.to_string_lossy()).is_some()) {
                default_dir
            } else {
                pb
            }
        }
        _ => default_dir,
    }
}

// ---------------------------------------------------------------- answers

const SAFE: &str = "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n";

fn head(s: &mut TcpStream, code: u16, reason: &str, kind: &str, len: u64, extra: &str) -> std::io::Result<()> {
    write!(s, "HTTP/1.1 {code} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {len}\r\n{SAFE}{extra}\r\n")
}

fn send(s: &mut TcpStream, code: u16, reason: &str, kind: &str, body: &[u8], extra: &str) {
    if head(s, code, reason, kind, body.len() as u64, extra).is_ok() {
        let _ = s.write_all(body);
    }
}

fn text(s: &mut TcpStream, code: u16, reason: &str) {
    send(s, code, reason, "text/plain; charset=utf-8", reason.as_bytes(), "");
}

/// RFC 5987 for a download's name (no CR/LF can get into the header).
fn disposition(name: &str) -> String {
    let enc: String = name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    let ascii: String = name.chars().map(|c| if (c.is_ascii_graphic() && c != '"' && c != '\\') || c == ' ' { c } else { '_' }).collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{enc}")
}

/// A body read as it comes, ending when the session stops (a transfer doesn't outlive Stop); each chunk counts as use.
struct Body<'a> {
    inner: std::io::Take<&'a mut TcpStream>,
    s: &'a Session,
}

impl Read for Body<'_> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.s.stop.load(Ordering::SeqCst) {
            return Err(std::io::Error::other("stopped"));
        }
        let n = self.inner.read(buf)?;
        self.s.used();
        Ok(n)
    }
}

/// The request's head (up to its blank line), at most MAX_HEAD bytes; whatever of the body came with it.
fn read_head(c: &mut TcpStream) -> Option<(services::phone::Head, Vec<u8>)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    // (the whole head within 10 s: a client sending a byte now and then doesn't keep its place)
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        let left = until.checked_duration_since(Instant::now())?;
        let _ = c.set_read_timeout(Some(left.max(Duration::from_millis(10))));
        let n = c.read(&mut chunk).ok().filter(|n| *n > 0)?;
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let h = services::phone::parse_head(&buf[..i + 4]).ok()?;
            return Some((h, buf[i + 4..].to_vec()));
        }
        if buf.len() > MAX_HEAD {
            return None;
        }
    }
}

/// A new name in the folder, free also of its ".part" (an upload of the same name going on).
fn free_name(dir: &Path, name: &str) -> PathBuf {
    dir.join(services::shelf::unique_name(name, &|n| dir.join(n).exists() || dir.join(format!("{n}.part")).exists()))
}

/// A file from the phone saved whole under a name nothing else has (never over another file). Its path.
fn save_upload(dir: &Path, name: &str, body: &mut dyn Read, len: u64) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("No folder: {e}"))?;
    let safe = services::phone::safe_name(name);
    // (O_EXCL: a ".part" another upload is writing is never shared)
    let (mut target, part, mut f) = loop {
        let target = free_name(dir, &safe);
        let part = target.with_file_name(format!("{}.part", target.file_name().unwrap_or_default().to_string_lossy()));
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&part) {
            Ok(f) => break (target, part, f),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    };
    let n = std::io::copy(body, &mut f).and_then(|n| f.flush().map(|_| n));
    if n.as_ref().ok() != Some(&len) {
        let _ = std::fs::remove_file(&part);
        return Err("cut short".into());
    }
    // (a link, then the part's name removed: a file that appeared there meanwhile is never replaced)
    loop {
        match std::fs::hard_link(&part, &target) {
            Ok(()) => break,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => target = free_name(dir, &safe),
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                return Err(e.to_string());
            }
        }
    }
    let _ = std::fs::remove_file(&part);
    // (from the network: Finder asks before opening it, as for a download)
    let flag = format!("0081;{:x};Sympony;", chrono::Utc::now().timestamp());
    let _ = std::process::Command::new("/usr/bin/xattr").args(["-w", "com.apple.quarantine", &flag]).arg(&target).status();
    Ok(target)
}

fn handle(app: &AppHandle, s: &Session, mut c: TcpStream) {
    let _ = c.set_read_timeout(Some(READ_WAIT));
    let _ = c.set_write_timeout(Some(Duration::from_secs(60)));
    let Some((h, early)) = read_head(&mut c) else { return };
    let _ = c.set_read_timeout(Some(READ_WAIT));
    // (a name other than the Mac's address: a page somewhere pointing a hostname at it)
    if h.host != s.host {
        return text(&mut c, 421, "Misdirected Request");
    }
    let route = services::phone::route(&h.method, &h.path, &s.token);
    if route == Route::None {
        return text(&mut c, 404, "Not Found");
    }
    s.used();
    let mut stream = c.try_clone().ok();
    match route {
        Route::None => {}
        // (the page's own links are relative: it must end in "/")
        Route::Page if !h.path.split('?').next().unwrap_or("").ends_with('/') => {
            send(&mut c, 301, "Moved Permanently", "text/plain", b"", &format!("Location: /{}/\r\n", s.token));
        }
        Route::Page => send(&mut c, 200, "OK", "text/html; charset=utf-8", PAGE.as_bytes(),
            "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:\r\n"),
        Route::Info => {
            let files: Vec<Value> = crate::files::shelf_files(app).into_iter().map(|(id, name, _, size)| json!({"id": id, "name": name, "size": size})).collect();
            send(&mut c, 200, "OK", "application/json", json!({"pc": s.pc, "files": files}).to_string().as_bytes(), "");
        }
        Route::File(id) => {
            let Some((_, name, path, _)) = crate::files::shelf_files(app).into_iter().find(|f| f.0 == id) else { return text(&mut c, 404, "Not on the Shelf") };
            let Ok(mut f) = std::fs::File::open(&path) else { return text(&mut c, 404, "Gone") };
            // (its size now, from the open file)
            let len = f.metadata().map(|m| m.len()).unwrap_or(0);
            if head(&mut c, 200, "OK", "application/octet-stream", len, &format!("Content-Disposition: {}\r\n", disposition(&name))).is_ok() {
                let _ = std::io::copy(&mut (&mut f).take(len), &mut c);
            }
        }
        Route::Text => {
            if !h.x_sympony {
                return text(&mut c, 403, "Forbidden");
            }
            if h.length > MAX_TEXT {
                return text(&mut c, 413, "Too long");
            }
            let mut body = early;
            body.truncate(h.length as usize);
            let rest = h.length - body.len() as u64;
            if let Some(st) = stream.as_mut() {
                let mut r = Body { inner: st.take(rest), s };
                if r.read_to_end(&mut body).is_err() || body.len() as u64 != h.length {
                    return;
                }
            }
            let t = String::from_utf8_lossy(&body).to_string();
            if t.trim().is_empty() {
                return text(&mut c, 400, "Empty");
            }
            if platform::macos::files::write_text(&t) {
                let _ = app.emit("phone:text", json!({"link": services::shelf::is_link(&t)}));
                text(&mut c, 200, "OK");
            } else {
                text(&mut c, 500, "Couldn't copy");
            }
        }
        Route::Upload(name) => {
            if !h.x_sympony {
                return text(&mut c, 403, "Forbidden");
            }
            if h.length > MAX_FILE {
                return text(&mut c, 413, "Too big");
            }
            let mut early = early;
            early.truncate(h.length as usize);
            let rest = h.length - early.len() as u64;
            let Some(st) = stream.as_mut() else { return };
            let mut body = std::io::Cursor::new(early).chain(Body { inner: st.take(rest), s });
            match save_upload(&folder(app), &name, &mut body, h.length) {
                Ok(target) if !s.stop.load(Ordering::SeqCst) => {
                    crate::files::shelf_add(app, &[json!({"kind": "file", "path": target.to_string_lossy(), "from": "phone"})]);
                    let _ = app.emit("phone:received", json!({"name": target.file_name().map(|n| n.to_string_lossy().to_string())}));
                    send(&mut c, 200, "OK", "application/json", b"{\"ok\":true}", "");
                }
                Ok(target) => {
                    // (stopped while it came: not kept)
                    let _ = std::fs::remove_file(target);
                }
                Err(_) => text(&mut c, 500, "Couldn't save it"),
            }
        }
    }
}

fn start(app: &AppHandle) -> Value {
    if !app.state::<App>().settings.bool_or("phoneShare", true) {
        return json!({"on": false, "error": "off", "message": "Phone sharing is off in Settings"});
    }
    let p = app.state::<Phone>();
    let _one = p.starting.lock().unwrap();
    if p.run.lock().unwrap().is_some() {
        return state(app);
    }
    let Some(ip) = lan_address() else { return json!({"on": false, "error": "wifi"}) };
    let listener = match TcpListener::bind((ip, 0)) {
        Ok(l) => l,
        Err(e) => return json!({"on": false, "error": "listen", "message": e.to_string()}),
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(0);
    let _ = listener.set_nonblocking(true);
    let token: String = services::oauth::random().chars().filter(|c| c.is_ascii_alphanumeric()).take(24).collect();
    let host = format!("{ip}:{port}");
    let url = format!("http://{host}/{token}/");
    let s = Arc::new(Session { token, host, pc: pc_name(), stop: AtomicBool::new(false), last: Mutex::new(None), open: AtomicUsize::new(0) });
    *p.why.lock().unwrap() = None;
    *p.run.lock().unwrap() = Some(Run { qr: services::phone::qr_svg(&url), url, s: s.clone() });
    let app2 = app.clone();
    std::thread::spawn(move || {
        let began = Instant::now();
        let mut was_connected = false;
        let mut wifi_checked = Instant::now();
        while !s.stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((c, _)) => {
                    let _ = c.set_nonblocking(false);
                    // (over the limit: closed at once)
                    if s.open.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                        s.open.fetch_sub(1, Ordering::SeqCst);
                        continue;
                    }
                    let (a, ss) = (app2.clone(), s.clone());
                    std::thread::spawn(move || {
                        handle(&a, &ss, c);
                        ss.open.fetch_sub(1, Ordering::SeqCst);
                    });
                    continue;
                }
                Err(_) => std::thread::sleep(Duration::from_millis(100)),
            }
            let seen = *s.last.lock().unwrap();
            let connected = seen.is_some_and(|t| t.elapsed() < SEEN);
            if connected != was_connected {
                was_connected = connected;
                send_state(&app2);
            }
            let why = if !app2.state::<App>().settings.bool_or("phoneShare", true) {
                Some(None)
            } else if seen.unwrap_or(began).elapsed() > IDLE && s.open.load(Ordering::SeqCst) == 0 {
                Some(Some("idle"))
            } else if wifi_checked.elapsed() > Duration::from_secs(10) {
                wifi_checked = Instant::now();
                // (another network: the QR's address is gone, or someone else's now)
                (lan_address().map(|i| format!("{i}:{port}")).as_deref() != Some(s.host.as_str())).then_some(Some("wifi"))
            } else {
                None
            };
            if let Some(why) = why {
                app2.state::<App>().log.line(&format!("phone: stopped ({})", why.unwrap_or("off in Settings")));
                stop_session(&app2, &s, why);
                return;
            }
        }
    });
    app.state::<App>().log.line(&format!("phone: sharing on {ip}:{port}"));
    let st = state(app);
    let _ = app.emit("phone:state", st.clone());
    st
}

/// Stops this session (only if it's still the one running: an old loop never stops a newer one).
fn stop_session(app: &AppHandle, s: &Arc<Session>, why: Option<&'static str>) {
    s.stop.store(true, Ordering::SeqCst);
    let p = app.state::<Phone>();
    let mut run = p.run.lock().unwrap();
    if run.as_ref().is_some_and(|r| Arc::ptr_eq(&r.s, s)) {
        *run = None;
        drop(run);
        *p.why.lock().unwrap() = why;
        send_state(app);
    }
}

fn stop_sharing(app: &AppHandle) {
    let s = app.state::<Phone>().run.lock().unwrap().as_ref().map(|r| r.s.clone());
    match s {
        Some(s) => stop_session(app, &s, None),
        None => send_state(app),
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Phone::default());
    let h = app.clone();
    reg.add("phone.start", Box::new(move |_, _| Ok(start(&h))));
    let h = app.clone();
    reg.add("phone.stop", Box::new(move |_, _| {
        stop_sharing(&h);
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("phone.state", Box::new(move |_, _| Ok(state(&h))));
    let h = app.clone();
    reg.add("phone.folder", Box::new(move |_, _| Ok(json!({"path": folder(&h).to_string_lossy()}))));
    let h = app.clone();
    reg.add("phone.pickFolder", Box::new(move |_, _| {
        if let Some(p) = crate::files::choose("folder", "Where files from your phone go").into_iter().next() {
            let trimmed = p.trim_end_matches('/');
            if services::exec::secret_place(trimmed).is_none() {
                let a = h.state::<App>();
                let patch = json!({"phoneFolder": trimmed});
                a.settings.set(patch.clone());
                (a.ctx.changed)(&patch);
            }
        }
        Ok(Value::Null)
    }));
}
