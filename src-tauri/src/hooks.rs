//! Agents asking under the notch (services::hooks): an agent's hook (`sympony --hook claude <Event>`) comes over
//! `agent.sock` and waits; the card goes to every notch window (`claude`), the first answer (`claude.answer`) goes back,
//! or nothing after a minute (the agent then asks in its own window). Claude Code's hooks are put in and taken out of
//! its settings here (`claude.status` / `install` / `remove`). And the scheduled briefs (`chat:brief`).
use serde_json::{json, Value};
use services::hooks::{brief_due, install, item, remove, reply, state};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

/// How long a card waits for a click before the agent asks in its own window.
const WAIT: Duration = Duration::from_secs(60);

struct Pending {
    item: Value,
    session: String,
    ppid: i32,
    /// the hook's line of parents, taken when it ran (Windows)
    up: Vec<i32>,
    shown: Instant,
    answer: Option<Sender<(String, Option<Value>, Option<Value>)>>,
}

#[derive(Default)]
pub struct Hooks {
    items: Mutex<Vec<Pending>>,
    next: AtomicU64,
    paseo: Mutex<Vec<Value>>,      // Paseo's waiting permissions as cards
    paseo_seen: Mutex<Value>,      // its state for Settings → Integrations
    paseo_req: Mutex<std::collections::HashMap<String, (String, Value)>>, // card id → (agent id, Paseo's request)
    paseo_hidden: Mutex<std::collections::HashSet<String>>, // closed, opened or answered here: not shown again
    paseo_seen_ids: Mutex<std::collections::HashSet<String>>, // shown once (a chime only for new ones)
}

fn all(app: &AppHandle) -> Vec<Value> {
    let h = app.state::<Hooks>();
    let mut v: Vec<Value> = h.items.lock().unwrap().iter().map(|p| p.item.clone()).collect();
    v.extend(h.paseo.lock().unwrap().iter().cloned());
    v
}

fn send(app: &AppHandle, sound: bool) {
    let _ = app.emit("claude", json!({"items": all(app), "sound": sound}));
}

/// Drops cards that only told something (a done, a card that can't be answered here) after a while.
fn tidy(app: &AppHandle) {
    let st = app.state::<Hooks>();
    let mut items = st.items.lock().unwrap();
    let before = items.len();
    items.retain(|p| p.answer.is_some() || p.shown.elapsed() < if p.item["kind"] == "done" { Duration::from_secs(600) } else { WAIT });
    let gone = items.len() != before;
    drop(items);
    if gone {
        send(app, false);
    }
}

/// A hook from an agent: `{agent, event, payload, ppid}` → `{stdout}` (what the hook prints; none: nothing).
pub fn on_hook(app: &AppHandle, req: &Value, stream: Option<&crate::mcp::UnixStream>) -> Value {
    let s = app.state::<App>().settings.get();
    let (agent, event, payload) = (req["agent"].as_str().unwrap_or(""), req["event"].as_str().unwrap_or(""), &req["payload"]);
    if s["claudeHooks"] != true || (event == "Stop" && s["claudeDone"] == false) {
        return json!({});
    }
    let Some(mut it) = item(agent, event, payload, s["claudeAnswer"] != false) else { return json!({}) };
    let h = app.state::<Hooks>();
    let id = format!("h{}", h.next.fetch_add(1, Ordering::SeqCst) + 1);
    it["id"] = json!(id);
    let session = payload["session_id"].as_str().unwrap_or("").to_string();
    let waits = it["answer"] == true;
    let (tx, rx) = channel();
    {
        let mut items = h.items.lock().unwrap();
        // that session moved on: its cards that only told something go
        items.retain(|p| p.answer.is_some() || p.session != session || session.is_empty());
        let up = req["up"].as_array().into_iter().flatten().filter_map(Value::as_i64).map(|p| p as i32).collect();
        items.push(Pending { item: it, session, ppid: req["ppid"].as_i64().unwrap_or(0) as i32, up, shown: Instant::now(), answer: waits.then_some(tx) });
    }
    send(app, s["claudeSound"] != false);
    if !waits {
        return json!({});
    }
    // (in short steps: the agent may drop the hook (Esc, an interrupt), and then the card goes at once)
    let start = Instant::now();
    let got = loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(v) => break Some(v),
            Err(_) if start.elapsed() >= WAIT || stream.is_some_and(gone) => break None,
            Err(_) => {}
        }
    };
    let mut items = h.items.lock().unwrap();
    items.retain(|p| p.item["id"] != id.as_str());
    drop(items);
    send(app, false);
    match got.and_then(|(choice, picks, texts)| reply(event, payload, &choice, picks.as_ref(), texts.as_ref())) {
        Some(out) => json!({"stdout": out}),
        None => json!({}),
    }
}

/// The app the agent runs in (its hook's ancestors: Terminal, VS Code, Warp, Windows Terminal…), brought forward:
/// the first with a window among `up` (the line of parents taken when the hook ran, on Windows), else walked up from
/// `ppid` now.
fn bring_forward(app: &AppHandle, ppid: i32, up: &[i32]) {
    let log = |m: String| app.state::<App>().log.line(&m);
    let (mut walk, mut looked) = (ppid, 0usize);
    for i in 0..20 {
        let pid = if up.is_empty() { walk } else { up.get(i).copied().unwrap_or(0) };
        if pid <= 1 {
            break;
        }
        looked += 1;
        if platform::os::apps::is_app(pid) {
            platform::os::apps::activate_pid(pid);
            log(format!("hooks: Open brought the agent's app forward (pid {pid}, {i} up from the hook)"));
            return;
        }
        if up.is_empty() {
            walk = platform::process::parent_of(pid).unwrap_or(0);
        }
    }
    log(format!("hooks: Open found no app with a window above the hook ({looked} looked at, from pid {ppid})"));
}

/// Paseo brought to the front (macOS opens it; on Windows a Paseo that's running comes forward).
fn open_paseo() {
    #[cfg(windows)]
    if let Some(pid) = platform::os::apps::pid_of("Paseo.exe") {
        platform::os::apps::activate_pid(pid);
    }
    #[cfg(not(windows))]
    let _ = std::process::Command::new("/usr/bin/open").args(["-b", "sh.paseo.desktop"]).status();
}

fn settings_file() -> std::path::PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".claude")).join("settings.json")
}

fn exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

/// Claude Code's settings now: Ok(json) (an empty object when there's no file yet), or Err(state, line).
fn read_settings() -> Result<Value, (&'static str, Option<usize>)> {
    let f = settings_file();
    if !f.parent().is_some_and(|d| d.is_dir()) {
        return Err(("nodir", None));
    }
    match std::fs::read_to_string(&f) {
        Err(_) => Ok(json!({})),
        Ok(t) if t.trim().is_empty() => Ok(json!({})),
        Ok(t) => serde_json::from_str::<Value>(&t).map_err(|e| ("bad", Some(e.line()))),
    }
}

fn write_settings(v: &Value) -> bool {
    // (a dotfiles manager's link: its target is written, the link stays)
    let f = std::fs::canonicalize(settings_file()).unwrap_or_else(|_| settings_file());
    // (the file as it was before Sympony first changed it, kept)
    let backup = f.with_extension("json.sympony-backup");
    if f.exists() && !backup.exists() {
        let _ = std::fs::copy(&f, &backup);
    }
    let tmp = f.with_extension("json.sympony-tmp");
    serde_json::to_string_pretty(v).is_ok_and(|t| std::fs::write(&tmp, t + "\n").is_ok()) && std::fs::rename(&tmp, &f).is_ok()
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Hooks::default());
    let h = app.clone();
    reg.add("claude.list", Box::new(move |_, _| {
        tidy(&h);
        Ok(Value::Array(all(&h)))
    }));
    let h = app.clone();
    reg.add("claude.answer", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("").to_string();
        let choice = a.get(1).and_then(Value::as_str).unwrap_or("").to_string();
        let picks = a.get(2).cloned().filter(|p| !p.is_null());
        let texts = a.get(3).cloned().filter(|t| !t.is_null());
        if id.starts_with("p:") {
            paseo_answer(&h, &id, &choice, picks, texts);
            return Ok(Value::Null);
        }
        let found = {
            let st = h.state::<Hooks>();
            let mut items = st.items.lock().unwrap();
            items.iter().position(|p| p.item["id"] == id.as_str()).map(|i| items.remove(i))
        };
        if let Some(p) = found {
            if choice == "open" {
                bring_forward(&h, p.ppid, &p.up);
            }
            if let Some(tx) = p.answer {
                let _ = tx.send((choice, picks, texts));
            }
            send(&h, false);
        }
        Ok(Value::Null)
    }));
    reg.add("claude.status", Box::new(|_, _| {
        let file = settings_file().to_string_lossy().to_string();
        Ok(match read_settings() {
            Ok(v) => json!({"state": state(&v, &exe()), "file": file}),
            Err((st, line)) => json!({"state": st, "file": file, "line": line}),
        })
    }));
    for (name, put) in [("claude.install", true), ("claude.remove", false)] {
        reg.add(name, Box::new(move |_, _| {
            let v = match read_settings() {
                Ok(v) if v.is_object() && (v.get("hooks").is_none() || v["hooks"].is_object()) => v,
                Err(("nodir", _)) => return Ok(json!({"ok": false, "error": "nodir"})),
                _ => return Ok(json!({"ok": false, "error": "bad"})),
            };
            let next = if put { install(&v, &exe()) } else { remove(&v) };
            Ok(if next == v || write_settings(&next) { json!({"ok": true}) } else { json!({"ok": false, "error": "write"}) })
        }));
    }
    let h = app.clone();
    reg.add("paseo.status", Box::new(move |_, _| Ok(paseo_status(&h))));
    reg.add("paseo.open", Box::new(|_, _| {
        open_paseo();
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("brief.now", Box::new(move |_, a| {
        if let Some(t) = a.first().and_then(Value::as_str).filter(|t| !t.trim().is_empty()) {
            let _ = h.emit("chat:brief", json!({"text": t}));
        }
        Ok(Value::Null)
    }));
}

/// The briefs' clock (every 30 s) and the cards' tidying.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let file = app.state::<App>().data_dir.join("briefs-sent.json");
        let mut fired: Vec<String> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        // (a brief due at login waits for the notch page to listen; up to an hour late is still in time)
        std::thread::sleep(Duration::from_secs(45));
        loop {
            tidy(&app);
            use chrono::Datelike;
            let now = chrono::Local::now();
            let briefs = app.state::<App>().settings.get()["chatBriefs"].clone();
            let day = now.format("%Y-%m-%d").to_string();
            for (id, text) in brief_due(&briefs, &day, now.weekday().num_days_from_sunday(), &now.format("%H:%M").to_string(), &fired) {
                fired.push(format!("{id}|{day}"));
                let _ = app.emit("chat:brief", json!({"text": text}));
                app.state::<App>().log.line(&format!("brief {id} sent"));
            }
            if fired.len() > 60 {
                fired.drain(..fired.len() - 60);
            }
            if std::fs::read(&file).ok() != serde_json::to_vec(&fired).ok() {
                let _ = std::fs::write(&file, serde_json::to_vec(&fired).unwrap_or_default());
            }
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}

/// For the socket (mcp.rs): a hook waits here.
pub fn route(app: &AppHandle, req: &Value, stream: &crate::mcp::UnixStream) -> Option<Value> {
    (req["type"] == "hook").then(|| on_hook(app, req, Some(stream)))
}

/// Whether the hook's end closed (the bridge sends nothing after its request: a read finds the end, or nothing yet).
fn gone(s: &crate::mcp::UnixStream) -> bool {
    use std::io::Read;
    if s.set_nonblocking(true).is_err() {
        return false;
    }
    let mut b = [0u8; 1];
    let closed = matches!((&*s).read(&mut b), Ok(0));
    let _ = s.set_nonblocking(false);
    closed
}

// ---- Paseo (its agents' waiting permissions, from its daemon's MCP on 127.0.0.1, with Paseo's local credential)

fn paseo_home() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".paseo")
}

fn paseo_found() -> bool {
    paseo_home().join("config.json").exists() || std::path::Path::new("/Applications/Paseo.app").exists()
}

/// One of Paseo's MCP tools; its text answer's JSON (after its first blank line).
fn paseo_tool(name: &str, args: Value) -> Option<Value> {
    paseo_call(name, args).ok()
}

/// As `paseo_tool`, with what went wrong (Paseo not running, or the tool's own error).
pub(crate) fn paseo_call(name: &str, args: Value) -> Result<Value, String> {
    let gone = || "Paseo isn’t running".to_string();
    let cfg: Value = std::fs::read_to_string(paseo_home().join("paseo.pid")).ok().and_then(|t| serde_json::from_str(&t).ok()).ok_or_else(gone)?;
    // (this Mac only: the port, on 127.0.0.1)
    let listen = cfg["listen"].as_str().ok_or_else(gone)?;
    let port: u16 = listen.strip_prefix("127.0.0.1:").or_else(|| listen.strip_prefix("localhost:")).and_then(|p| p.parse().ok()).ok_or_else(gone)?;
    let token = std::fs::read_to_string(paseo_home().join("local-credential")).map_err(|_| gone())?;
    let auth = format!("Bearer {}", token.trim());
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}});
    let (st, text) = services::http::post_with(&format!("http://127.0.0.1:{port}/mcp/agents"), &[("Authorization", &auth), ("Accept", "application/json, text/event-stream")], &body).map_err(|_| gone())?;
    if st != 200 {
        return Err(format!("Paseo answered {st}"));
    }
    let msg: Value = text.lines().filter_map(|l| l.strip_prefix("data:")).find_map(|d| serde_json::from_str(d.trim()).ok())
        .or_else(|| serde_json::from_str(text.trim()).ok()).ok_or("Paseo answered oddly")?;
    let out = msg["result"]["content"][0]["text"].as_str().unwrap_or("");
    // (a tool's own failure comes as a result marked isError: not a success)
    if !msg["error"].is_null() {
        return Err(msg["error"]["message"].as_str().unwrap_or("Paseo refused").to_string());
    }
    if msg["result"]["isError"] == true {
        return Err(out.chars().take(300).collect());
    }
    let json_part = out.split_once("\n\n").map(|x| x.1).unwrap_or(out);
    Ok(serde_json::from_str(json_part.trim()).or_else(|_| serde_json::from_str(out.trim())).unwrap_or(Value::Null))
}

/// Whether Paseo is on this Mac and its daemon runs.
pub(crate) fn paseo_ready() -> bool {
    paseo_found() && paseo_daemon().0
}

/// Whether Paseo's daemon runs (its pid file names a live process) and when its log last moved (an agent at work).
fn paseo_daemon() -> (bool, Option<std::time::SystemTime>) {
    let home = paseo_home();
    let pid = std::fs::read_to_string(home.join("paseo.pid")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["pid"].as_i64());
    let alive = pid.and_then(|p| i32::try_from(p).ok()).filter(|&p| p > 0).is_some_and(platform::process::alive);
    (alive, std::fs::metadata(home.join("daemon.log")).and_then(|m| m.modified()).ok())
}

fn paseo_answer(app: &AppHandle, id: &str, choice: &str, picks: Option<Value>, texts: Option<Value>) {
    let h = app.state::<Hooks>();
    let request = h.paseo_req.lock().unwrap().get(id).cloned();
    // (gone here whatever the choice: Close and Open leave it waiting in Paseo, not under the notch every 2 s)
    h.paseo_hidden.lock().unwrap().insert(id.to_string());
    h.paseo.lock().unwrap().retain(|i| i["id"] != id);
    send(app, false);
    if choice == "open" {
        open_paseo();
        return;
    }
    let Some((agent, request)) = request else { return };
    let req = request["id"].as_str().unwrap_or("").to_string();
    let Some(response) = services::hooks::paseo_response(&request, choice, picks.as_ref(), texts.as_ref()) else { return };
    if paseo_tool("respond_to_permission", json!({"agentId": agent, "requestId": req, "response": response})).is_none() {
        // (it didn't go through: the card comes back, so it can be answered again or in Paseo)
        h.paseo_hidden.lock().unwrap().remove(id);
        app.state::<App>().log.line(&format!("paseo: {choice} {req} didn't go through"));
    }
}

/// Every 2 s while Paseo's daemon runs and its requests are shown (an HTTP call on this Mac: a few ms), every 5 s
/// otherwise (so turning it on, or Paseo starting, shows soon).
pub fn paseo_start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut fails = 0;
        loop {
            let s = app.state::<App>().settings.snapshot();
            let on = s["paseoEnabled"] != false && s["claudeHooks"] == true;
            let found = paseo_found();
            let running = paseo_daemon().0;
            let h = app.state::<Hooks>();
            let mut pending = 0;
            let mut reached = false;
            let list = if on && running { paseo_tool("list_pending_permissions", json!({})) } else { None };
            fails = if list.is_some() || !(on && running) { 0 } else { fails + 1 };
            if let Some(perms) = list {
                reached = true;
                // (each agent's folder, for the card's project: only asked while something waits)
                let waiting = perms["permissions"].as_array().is_some_and(|a| !a.is_empty());
                let agents = if waiting { paseo_tool("list_agents", json!({})).unwrap_or_default() } else { Value::Null };
                let all = services::hooks::paseo_items(&perms, &agents, s["claudeAnswer"] != false);
                let live: std::collections::HashSet<String> = all.iter().filter_map(|c| c["id"].as_str().map(String::from)).collect();
                {
                    let mut reqs = h.paseo_req.lock().unwrap();
                    reqs.clear();
                    for p in perms["permissions"].as_array().into_iter().flatten() {
                        if let (Some(a), Some(r)) = (p["agentId"].as_str(), p["request"]["id"].as_str()) {
                            reqs.insert(format!("p:{a}:{r}"), (a.to_string(), p["request"].clone()));
                        }
                    }
                }
                // (what Paseo no longer lists is forgotten; what was closed here stays hidden while it waits there)
                h.paseo_hidden.lock().unwrap().retain(|i| live.contains(i));
                let hidden = h.paseo_hidden.lock().unwrap().clone();
                let cards: Vec<Value> = all.into_iter().filter(|c| !c["id"].as_str().is_some_and(|i| hidden.contains(i))).collect();
                pending = cards.len();
                let new = {
                    let mut seen = h.paseo_seen_ids.lock().unwrap();
                    seen.retain(|i| live.contains(i));
                    cards.iter().filter_map(|c| c["id"].as_str()).fold(false, |n, i| seen.insert(i.to_string()) || n)
                };
                let mut cur = h.paseo.lock().unwrap();
                let ids = |v: &[Value]| v.iter().map(|i| i["id"].to_string()).collect::<Vec<_>>();
                if ids(&cur) != ids(&cards) {
                    *cur = cards;
                    drop(cur);
                    send(&app, new && s["claudeSound"] != false);
                }
            } else if (fails >= 2 || !(on && running)) && !h.paseo.lock().unwrap().is_empty() {
                // (Paseo off, gone or not answering: its cards can't be answered, so they go)
                h.paseo.lock().unwrap().clear();
                h.paseo_req.lock().unwrap().clear();
                send(&app, false);
            }
            *h.paseo_seen.lock().unwrap() = json!({"found": found, "running": running, "enabled": on, "pending": pending,
                "reached": reached || !(on && running), "checked": chrono::Utc::now().timestamp_millis()});
            // (every second while Paseo runs: a waiting agent shows up at once; a local HTTP call, cheap)
            std::thread::sleep(Duration::from_secs(if on && running { 1 } else { 5 }));
        }
    });
}

/// Settings → Integrations: Paseo's state.
pub fn paseo_status(app: &AppHandle) -> Value {
    let v = app.state::<Hooks>().paseo_seen.lock().unwrap().clone();
    if v.is_null() { json!({"found": paseo_found(), "running": paseo_daemon().0}) } else { v }
}
