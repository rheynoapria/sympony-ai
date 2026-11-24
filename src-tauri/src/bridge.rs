//! Pony's bridge to other agents: Pony starts,
//! messages, follows and stops coding agents. Through Paseo's MCP when Paseo runs (its agents ask for permissions in
//! the notch as they already do); without it, Claude Code headless (`claude -p` in the project's folder, file edits
//! accepted, commands as Claude Code's own permissions and Sympony's hooks allow). Starting, messaging and stopping
//! always ask on a card first. When an agent Pony started finishes, Pony's chat says so (`pony:agentDone`).
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;
use crate::hooks::{paseo_call, paseo_ready};

pub const NAMES: [&str; 5] = ["agents_list", "agent_start", "agent_send", "agent_status", "agent_stop"];
/// How long Sympony follows an agent at most.
const FOLLOW: Duration = Duration::from_secs(3 * 3600);

/// An agent Pony started with Claude Code (no Paseo).
struct Run {
    folder: String,
    title: String,
    running: bool,
    pid: Option<u32>,
    session: String,
    out: Arc<Mutex<String>>,
}

/// Cached metadata for a Paseo agent session so approvals and follow-ups show human-readable session titles.
#[derive(Clone, Default)]
struct PaseoSession {
    folder: String,
    title: String,
    short_id: String,
}

#[derive(Default)]
pub struct Bridge {
    runs: Mutex<HashMap<String, Run>>,
    sessions: Mutex<HashMap<String, PaseoSession>>,
    next: Mutex<u32>,
}

/// Whether Pony can reach any agent: Paseo running, or Claude Code installed.
pub fn available(app: &AppHandle) -> bool {
    paseo_ready() || crate::agents::bin(app, "claude").is_some()
}

/// The tools, as MCP lists them.
pub fn tools() -> Vec<Value> {
    let obj = |props: Value, req: &[&str]| json!({"type": "object", "properties": props, "required": req});
    vec![
        json!({"name": "agents_list", "description": "Lists existing coding agent sessions on this Mac (Paseo's recent sessions and the ones Pony started): id, state (running, idle, waiting on the user, closed), project folder, title, provider. ALWAYS call this BEFORE agent_start or agent_send when the user is not active in Paseo's UI, so you can continue an existing session instead of blindly creating a new one.", "inputSchema": obj(json!({}), &[])}),
        json!({"name": "agent_start", "description": "Creates a BRAND-NEW coding agent conversation/session in a project folder with a task (Sympony asks the user first). WARNING: Do NOT use this when the user is currently active in Paseo's UI (operate directly in Paseo's chat input via screen_read + screen_do instead), and do NOT use this before calling agents_list to see whether an existing session should be continued with agent_send or clarified with ask_user.",
            "inputSchema": obj(json!({"project": {"type": "string", "description": "the project's folder name (e.g. Sympony) or its full path"}, "task": {"type": "string", "description": "the task, complete and clear, in the user's words where possible"}, "provider": {"type": "string", "description": "claude or codex; leave out for the one the user used last"}}), &["project", "task"])}),
        json!({"name": "agent_send", "description": "Sends a message into an EXISTING coding agent session (Sympony asks the user first). Prefer this (after agents_list) over agent_start whenever continuing an existing Paseo/agent conversation while the user is not active in Paseo's UI. State the session title and project in your reply.", "inputSchema": obj(json!({"id": {"type": "string", "description": "the existing agent's id from agents_list or agent_start"}, "message": {"type": "string"}}), &["id", "message"])}),
        json!({"name": "agent_status", "description": "An agent's state and its last messages.", "inputSchema": obj(json!({"id": {"type": "string"}}), &["id"])}),
        json!({"name": "agent_stop", "description": "Stops what an agent is doing (Sympony asks the user first).", "inputSchema": obj(json!({"id": {"type": "string"}}), &["id"])}),
    ]
}

/// As `tools`, for Pony's own engine.
pub fn functions() -> Vec<Value> {
    tools().into_iter().map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}})).collect()
}

fn declined() -> Result<String, String> {
    Err("The user said no. Don't try another way; ask them what they'd like instead.".into())
}

fn ask(app: &AppHandle, session: &str, tool: &str, detail: String) -> bool {
    matches!(crate::exec::approve(app, session, json!({"tool": tool, "detail": detail, "canAlways": false})).as_str(), "once" | "always")
}

fn step(app: &AppHandle, session: &str, detail: &str) {
    let _ = app.emit("agent:step", json!({"session": session, "kind": "agent", "detail": detail.chars().take(60).collect::<String>()}));
}

/// Paseo's activity text without its "Showing 1 of 2 activities" header.
fn activity(v: &Value) -> String {
    let t = v["content"].as_str().unwrap_or("").trim();
    match t.split_once("\n\n") {
        Some((head, rest)) if head.starts_with("Showing ") => rest.trim().to_string(),
        _ => t.to_string(),
    }
}

fn cut(t: &str, n: usize) -> String {
    let t = t.trim();
    if t.chars().count() <= n { t.to_string() } else { format!("{}…", t.chars().take(n).collect::<String>()) }
}

/// Folders a project name may mean: Paseo's workspaces, then folders under the usual code places (two levels).
fn folders() -> Vec<String> {
    let mut out: Vec<String> = vec![];
    if let Ok(v) = paseo_call("list_workspaces", json!({})) {
        out.extend(v["workspaces"].as_array().into_iter().flatten().filter_map(|w| w["cwd"].as_str().map(String::from)));
    }
    let home = std::env::var("HOME").unwrap_or_default();
    for root in ["Playground", "Projects", "Developer", "Code", "code", "src", "dev", "GitHub", "Sites", "Documents"] {
        let Ok(rd) = std::fs::read_dir(format!("{home}/{root}")) else { continue };
        for e in rd.flatten().filter(|e| e.path().is_dir()) {
            out.push(e.path().to_string_lossy().to_string());
            if let Ok(inner) = std::fs::read_dir(e.path()) {
                out.extend(inner.flatten().filter(|i| i.path().join(".git").exists()).map(|i| i.path().to_string_lossy().to_string()));
            }
        }
    }
    out
}

fn short_id(id: &str) -> String {
    id.chars().take(7).collect()
}

fn cache_paseo_list(app: &AppHandle, v: &Value) {
    let Some(arr) = v["agents"].as_array() else { return };
    let bridge = app.state::<Bridge>();
    let mut map = bridge.sessions.lock().unwrap();
    for a in arr {
        let id = a["id"].as_str().unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let sid = a["shortId"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| short_id(id));
        map.insert(id.to_string(), PaseoSession {
            folder: a["cwd"].as_str().unwrap_or("").to_string(),
            title: a["title"].as_str().unwrap_or("").to_string(),
            short_id: sid,
        });
    }
}

fn resolve_paseo_session(app: &AppHandle, id: &str) -> PaseoSession {
    if let Some(s) = app.state::<Bridge>().sessions.lock().unwrap().get(id).cloned() {
        return s;
    }
    if let Ok(st) = paseo_call("get_agent_status", json!({"agentId": id})) {
        let folder = st["snapshot"]["cwd"].as_str().or(st["cwd"].as_str()).unwrap_or("").to_string();
        let title = st["snapshot"]["title"].as_str().or(st["title"].as_str()).unwrap_or("").to_string();
        let info = PaseoSession { folder, title, short_id: short_id(id) };
        if !info.folder.is_empty() || !info.title.is_empty() {
            app.state::<Bridge>().sessions.lock().unwrap().insert(id.to_string(), info.clone());
        }
        return info;
    }
    PaseoSession { folder: String::new(), title: String::new(), short_id: short_id(id) }
}

fn format_session_label(folder: &str, title: &str, sid: &str) -> String {
    let proj = folder.trim_end_matches('/').rsplit('/').next().unwrap_or("").trim();
    let t = cut(title, 56);
    match (!proj.is_empty(), !t.is_empty()) {
        (true, true) => format!("{proj} · “{t}” ({sid})"),
        (true, false) => format!("{proj} ({sid})"),
        (false, true) => format!("“{t}” ({sid})"),
        (false, false) => sid.to_string(),
    }
}

/// One of `NAMES`. Err: what the model reads.
pub fn call(app: &AppHandle, session: &str, name: &str, args: &Value) -> Result<String, String> {
    let s = |k: &str| args[k].as_str().unwrap_or("").trim().to_string();
    // (an ask_ai job: another AI in the user's browser)
    let id = s("id");
    if crate::askai::owns(app, &id) {
        return match name {
            "agent_status" => crate::askai::status(app, &id),
            "agent_send" => crate::askai::send(app, session, &id, &s("message")),
            "agent_stop" => crate::askai::stop(app, &id),
            _ => Err(format!("{name} doesn't apply to {id}")),
        };
    }
    match name {
        "agents_list" => {
            step(app, session, "");
            let mut out = vec![];
            if paseo_ready() {
                let v = paseo_call("list_agents", json!({"limit": 25, "sinceHours": 720}))?;
                cache_paseo_list(app, &v);
                out.push(services::agents::paseo_lines(&v));
            }
            for (id, r) in app.state::<Bridge>().runs.lock().unwrap().iter() {
                let folder = r.folder.rsplit('/').next().unwrap_or("");
                out.push(format!("{id} · {} · {folder} · {} (Claude Code)", if r.running { "running" } else { "idle" }, r.title));
            }
            out.extend(crate::askai::list(app));
            Ok(if out.is_empty() { "No agents yet.".into() } else { out.join("\n") })
        }
        "agent_start" => {
            let (task, provider) = (s("task"), s("provider"));
            if task.is_empty() {
                return Err("agent_start needs task".into());
            }
            let home = std::env::var("HOME").unwrap_or_default();
            let project = s("project").replacen('~', &home, 1);
            let folder = services::agents::pick_folder(&project, &folders()).filter(|f| std::path::Path::new(f).is_dir())
                .ok_or_else(|| format!("No project folder named {project} found; ask the user for its path"))?;
            let via = if paseo_ready() { "Paseo" } else { "Claude Code" };
            if !ask(app, session, "agent_start", format!("New session · {folder} · {via}{}\n{task}", if provider.is_empty() { String::new() } else { format!(" ({provider})") })) {
                return declined();
            }
            step(app, session, &format!("{} · {}", folder.rsplit('/').next().unwrap_or(""), cut(&task, 40)));
            if paseo_ready() { start_paseo(app, &folder, &task, &provider) } else { start_claude(app, &folder, &task, None) }
        }
        "agent_send" => {
            let (id, message) = (s("id"), s("message"));
            let mine = app.state::<Bridge>().runs.lock().unwrap().get(&id).map(|r| (r.folder.clone(), r.running, r.session.clone(), r.title.clone()));
            let (where_, label, follow_folder) = match &mine {
                Some((folder, _, _, title)) => {
                    let lbl = format_session_label(folder, title, &id);
                    (lbl.clone(), lbl, folder.clone())
                }
                None => {
                    let info = resolve_paseo_session(app, &id);
                    let lbl = format_session_label(&info.folder, &info.title, &info.short_id);
                    let fol = if info.folder.is_empty() { id.clone() } else { info.folder };
                    (lbl.clone(), lbl, fol)
                }
            };
            if !ask(app, session, "agent_send", format!("{where_}\n{message}")) {
                return declined();
            }
            step(app, session, &cut(&format!("{label} · {message}"), 60));
            match mine {
                Some((_, true, ..)) => Err("That agent is still working; wait for it, or stop it first".into()),
                Some((folder, false, sid, _)) => start_claude(app, &folder, &message, Some((&id, &sid))),
                None => {
                    paseo_call("send_agent_prompt", json!({"agentId": id, "prompt": message, "notifyOnFinish": false}))?;
                    follow_paseo(app, &id, &follow_folder);
                    Ok(format!("Sent to existing session {label}. Sympony tells the user when it finishes."))
                }
            }
        }
        "agent_status" => {
            let id = s("id");
            step(app, session, &id);
            if let Some(r) = app.state::<Bridge>().runs.lock().unwrap().get(&id) {
                return Ok(format!("{} in {}\n{}", if r.running { "Working" } else { "Done" }, r.folder, cut(&r.out.lock().unwrap(), 4000)));
            }
            let st = paseo_call("get_agent_status", json!({"agentId": id}))?;
            let act = paseo_call("get_agent_activity", json!({"agentId": id, "limit": 3})).unwrap_or(Value::Null);
            let waiting = st["snapshot"]["pendingPermissions"].as_array().map(|a| a.len()).unwrap_or(0);
            Ok(format!("{}{} in {}\n{}", st["status"].as_str().unwrap_or("?"), if waiting > 0 { format!(", waiting on {waiting} permission(s)") } else { String::new() },
                st["snapshot"]["cwd"].as_str().unwrap_or(""), cut(&activity(&act), 4000)))
        }
        "agent_stop" => {
            let id = s("id");
            if !ask(app, session, "agent_stop", id.clone()) {
                return declined();
            }
            step(app, session, &id);
            if let Some(r) = app.state::<Bridge>().runs.lock().unwrap().get(&id) {
                if let Some(pid) = r.pid.filter(|_| r.running) {
                    let _ = Command::new("/bin/kill").arg(pid.to_string()).status();
                }
                return Ok("Stopped.".into());
            }
            paseo_call("cancel_agent", json!({"agentId": id}))?;
            Ok("Stopped.".into())
        }
        _ => Err(format!("No tool {name}")),
    }
}

/// Creates the agent in Paseo: (its id, "", or the provider/model used).
fn paseo_create(folder: &str, task: &str, provider: &str) -> Result<(String, String), String> {
    let recent = paseo_call("list_agents", json!({"limit": 50, "sinceHours": 720, "includeArchived": true}))?;
    let model = services::agents::paseo_model(provider, &recent)
        .ok_or("Paseo has no agent of that kind yet to copy the model from: start one in Paseo once, then ask again")?;
    let ws = paseo_call("list_workspaces", json!({}))?;
    let wid = ws["workspaces"].as_array().into_iter().flatten().find(|w| w["cwd"] == folder).and_then(|w| w["workspaceId"].as_str().map(String::from));
    let mut body = json!({"title": cut(task, 58), "provider": model, "initialPrompt": task, "notifyOnFinish": false});
    match wid {
        Some(w) => body["workspaceId"] = json!(w),
        None => body["cwd"] = json!(folder),
    }
    let v = paseo_call("create_agent", body)?;
    let id = [&v["agentId"], &v["id"], &v["agent"]["id"], &v["snapshot"]["id"]].iter().find_map(|x| x.as_str().map(String::from)).unwrap_or_default();
    Ok((id, model))
}

fn start_paseo(app: &AppHandle, folder: &str, task: &str, provider: &str) -> Result<String, String> {
    let (id, model) = paseo_create(folder, task, provider)?;
    let title = cut(task, 58);
    if id.is_empty() {
        return Ok(format!("Started new session “{title}” in Paseo ({model}) in {folder}."));
    }
    let sid = short_id(&id);
    app.state::<Bridge>().sessions.lock().unwrap().insert(id.clone(), PaseoSession {
        folder: folder.to_string(),
        title: title.clone(),
        short_id: sid.clone(),
    });
    let lbl = format_session_label(folder, &title, &sid);
    follow_paseo(app, &id, folder);
    Ok(format!("Started new session {lbl} ({model}). It works on its own in Paseo; its questions come to the notch, and Sympony tells the user when it finishes."))
}

/// Watches a Paseo agent until it stops working, then tells the chat.
fn follow_paseo(app: &AppHandle, id: &str, folder: &str) {
    let (app, id, folder) = (app.clone(), id.to_string(), folder.to_string());
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut seen_running = false;
        while started.elapsed() < FOLLOW {
            std::thread::sleep(Duration::from_secs(4));
            let Ok(st) = paseo_call("get_agent_status", json!({"agentId": id})) else { continue };
            let status = st["status"].as_str().unwrap_or("");
            if matches!(status, "running" | "initializing") {
                seen_running = true;
                continue;
            }
            // (a moment for it to begin: idle before it ever ran isn't done)
            if !seen_running && started.elapsed() < Duration::from_secs(20) {
                continue;
            }
            let act = paseo_call("get_agent_activity", json!({"agentId": id, "limit": 1})).unwrap_or(Value::Null);
            let cwd = st["snapshot"]["cwd"].as_str().map(String::from).unwrap_or(folder.clone());
            done(&app, &cwd, status == "error", &activity(&act));
            return;
        }
    });
}

/// Claude Code headless in `folder` (`resume`: (our id, its session) to go on with a run).
fn start_claude(app: &AppHandle, folder: &str, task: &str, resume: Option<(&str, &str)>) -> Result<String, String> {
    let bin = crate::agents::bin(app, "claude").ok_or("Neither Paseo nor Claude Code is on this Mac")?;
    let mut child = Command::new(&bin).args(claude_args(task, resume.map(|r| r.1))).current_dir(folder).env("PATH", crate::agents::path())
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("Couldn’t start Claude Code: {e}"))?;
    let b = app.state::<Bridge>();
    let id = match resume {
        Some((id, _)) => id.to_string(),
        None => {
            let mut n = b.next.lock().unwrap();
            *n += 1;
            format!("cc{}", *n)
        }
    };
    let out = Arc::new(Mutex::new(String::new()));
    b.runs.lock().unwrap().insert(id.clone(), Run { folder: folder.into(), title: cut(task, 58), running: true, pid: Some(child.id()), session: String::new(), out: out.clone() });
    let (app2, id2, folder2) = (app.clone(), id.clone(), folder.to_string());
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(so) = child.stdout.take() {
            let _ = so.take(8 << 20).read_to_string(&mut text);
        }
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        let (answer, sid, failed) = claude_result(&text, ok);
        *out.lock().unwrap() = answer.clone();
        if let Some(r) = app2.state::<Bridge>().runs.lock().unwrap().get_mut(&id2) {
            r.running = false;
            if !sid.is_empty() {
                r.session = sid;
            }
        }
        done(&app2, &folder2, failed, &answer);
    });
    Ok(format!("Started agent {id} (Claude Code) in {folder}. It works on its own; Sympony tells the user when it finishes."))
}

/// Claude Code's command line for a task (`resume`: the session to go on with).
fn claude_args(task: &str, resume: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into(), task.into(), "--output-format".into(), "json".into(), "--permission-mode".into(), "acceptEdits".into()];
    if let Some(sid) = resume.filter(|s| !s.is_empty()) {
        args.extend(["--resume".into(), sid.to_string()]);
    }
    args
}

/// Claude Code's JSON answer → (its last message, its session, whether it failed).
fn claude_result(text: &str, ok: bool) -> (String, String, bool) {
    let v: Value = serde_json::from_str(text.trim()).unwrap_or(Value::Null);
    let answer = v["result"].as_str().map(String::from).unwrap_or_else(|| if ok { text.trim().to_string() } else { "It stopped before it finished.".into() });
    (answer, v["session_id"].as_str().unwrap_or("").to_string(), !ok || v["is_error"] == true)
}

/// An agent Pony started finished: a line in Pony's chat (it opens on Pony when the notch is closed).
fn done(app: &AppHandle, folder: &str, failed: bool, last: &str) {
    let name = folder.trim_end_matches('/').rsplit('/').next().unwrap_or(folder);
    app.state::<App>().log.line(&format!("bridge: the agent in {name} {}", if failed { "stopped with an error" } else { "finished" }));
    // (to the active chat window only: the other follows its saved chat)
    let _ = app.emit_to(crate::floating_chat::chat_target(app), "pony:agentDone", json!({"project": name, "failed": failed, "text": cut(last, 1200)}));
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Bridge::default());
    let h = app.clone();
    // (Settings → Abilities: which way Pony reaches other agents)
    reg.add("pony.bridgeInfo", Box::new(move |_, _| Ok(json!({"paseo": paseo_ready(), "claude": crate::agents::bin(&h, "claude").is_some()}))));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paseo_activity_loses_its_header() {
        assert_eq!(activity(&json!({"content": "Showing 1 of 2 activities (limited to 1)\n\npong"})), "pong");
        assert_eq!(activity(&json!({"content": "just text\n\nmore"})), "just text\n\nmore");
    }

    #[test]
    fn session_labels_show_project_title_and_short_id() {
        assert_eq!(
            format_session_label("/Users/u/Playground/Sympony", "Explain Sympony project overview", &short_id("3d46d37d-3455-4438")),
            "Sympony · “Explain Sympony project overview” (3d46d37)"
        );
        assert_eq!(format_session_label("/Users/u/Sympony", "", "abc1234"), "Sympony (abc1234)");
        assert_eq!(format_session_label("", "My chat", "abc1234"), "“My chat” (abc1234)");
        assert_eq!(format_session_label("", "", "abc1234"), "abc1234");
    }

    /// Claude Code for real, in a fresh folder: a task, then going on in the same session.
    /// `cargo test -p sympony --lib bridge::tests::live_claude -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_claude() {
        let dir = std::env::temp_dir().join("sympony-bridge-claude");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |task: &str, resume: Option<&str>| {
            let o = Command::new("claude").args(claude_args(task, resume)).current_dir(&dir).stdin(Stdio::null()).output().unwrap();
            claude_result(&String::from_utf8_lossy(&o.stdout), o.status.success())
        };
        let (a, sid, failed) = run("Create a file named hello.txt containing exactly: hi from sympony. Then reply with one word: done.", None);
        println!("1: {a:?} {sid} failed={failed}");
        assert!(!failed && !sid.is_empty());
        assert_eq!(std::fs::read_to_string(dir.join("hello.txt")).unwrap().trim(), "hi from sympony");
        let (b, sid2, failed2) = run("What was the file you just created called? Reply with its name only.", Some(&sid));
        println!("2: {b:?} {sid2} failed={failed2}");
        assert!(!failed2 && b.contains("hello.txt"));
    }

    /// Paseo for real: an agent with a harmless task in a fresh folder, followed until it's done.
    /// `cargo test -p sympony --lib bridge::tests::live_paseo -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_paseo() {
        assert!(paseo_ready(), "Paseo isn't running");
        let dir = std::env::temp_dir().join("sympony-bridge-paseo");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let folder = dir.canonicalize().unwrap().to_string_lossy().to_string();
        let lines = services::agents::paseo_lines(&paseo_call("list_agents", json!({"limit": 5})).unwrap());
        println!("list:\n{lines}");
        let (id, model) = paseo_create(&folder, "Reply with exactly: pong. Do not run tools or change files.", "claude").unwrap();
        println!("created {id:?} with {model}");
        assert!(!id.is_empty(), "no id in create_agent's answer");
        let started = Instant::now();
        let mut last = String::new();
        while started.elapsed() < Duration::from_secs(240) {
            std::thread::sleep(Duration::from_secs(4));
            let st = paseo_call("get_agent_status", json!({"agentId": id})).unwrap();
            last = st["status"].as_str().unwrap_or("").to_string();
            println!("{:>3} s: {last} cwd={}", started.elapsed().as_secs(), st["snapshot"]["cwd"]);
            if last == "idle" || last == "error" {
                break;
            }
        }
        let act = paseo_call("get_agent_activity", json!({"agentId": id, "limit": 1})).unwrap();
        println!("activity: {}", act["content"]);
        assert_eq!(last, "idle");
        assert_eq!(activity(&act).to_lowercase(), "pong");
    }
}
