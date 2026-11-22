//! Sympony's tools for the AI agents (services::tools), over MCP. An agent starts `sympony --mcp` (`bridge`: MCP on
//! stdio); each tool call goes over `<data>/agent.sock` to the running app, which hands it to the notch window whose
//! chat is waiting on that run (`agent:tool`), where AI Chat's own action runs (with its Undo), and the window's
//! answer (`agent.result`) goes back. Only runs the app started itself (a token, a session it's waiting on) get in.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

/// How long a window may take to do an action.
const WAIT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy)]
struct Session {
    brief: bool,
    asked: bool,
    tainted: bool,
}

pub struct Mcp {
    pub token: String,
    sessions: Mutex<HashMap<String, Session>>,
    waits: Mutex<HashMap<u64, Sender<Value>>>,
    next: AtomicU64,
}

impl Mcp {
    /// A chat run that may use the tools while it lasts.
    pub fn open(&self, session: &str, brief: bool) {
        self.sessions.lock().unwrap().insert(session.to_string(), Session { brief, asked: false, tainted: false });
    }
    pub fn close(&self, session: &str) {
        self.sessions.lock().unwrap().remove(session);
    }
    pub fn mark_tainted(&self, session: &str) {
        if let Some(sess) = self.sessions.lock().unwrap().get_mut(session) {
            sess.tainted = true;
        }
    }
    pub fn is_tainted(&self, session: &str) -> bool {
        self.sessions.lock().unwrap().get(session).is_some_and(|s| s.tainted)
    }
    pub fn check_ask(&self, session: &str) -> Result<(), &'static str> {
        let sessions = self.sessions.lock().unwrap();
        let Some(sess) = sessions.get(session) else {
            return Err("This isn't a run Sympony started, or it has ended");
        };
        ask_allowed(sess.asked, sess.brief)
    }
    pub fn finish_ask(&self, session: &str, res: &Value) {
        if res["ok"] == true {
            if let Some(sess) = self.sessions.lock().unwrap().get_mut(session) {
                sess.asked = true;
            }
        }
    }
}

pub fn socket(app: &AppHandle) -> std::path::PathBuf {
    app.state::<App>().data_dir.join("agent.sock")
}

/// Whether `ask_user` may run in this session (refused during scheduled briefs or after a first ask).
fn ask_allowed(already: bool, brief: bool) -> Result<(), &'static str> {
    if brief {
        return Err("can't ask during a scheduled brief");
    }
    if already {
        return Err("already asked; end your reply");
    }
    Ok(())
}

/// Rust-side Pony tools (skills & memory in `~/.sympony`) handled without round-tripping to the window.
/// Errors use the same `{ok, error}` shape as `pony.*` svc handlers.
fn serve_pony(app: &AppHandle, session: &str, kind: &str, args: &str) -> Option<Value> {
    let skills_dir = crate::pony::skills_root();
    let mem_path = crate::pony::memory_file();
    match kind {
        "skill" => {
            let name = args.trim();
            let off = crate::pony::skills_off(app);
            Some(match services::pony::ensure_skill_available(&skills_dir, name, &off) {
                Ok(sk) => json!({"ok": true, "text": sk.body}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }
        "skill_file" => {
            let Some((name, rel)) = args.split_once(" | ") else {
                return Some(json!({"ok": false, "error": "read_skill_file needs name and path"}));
            };
            let name = name.trim();
            let off = crate::pony::skills_off(app);
            if let Err(e) = services::pony::ensure_skill_available(&skills_dir, name, &off) {
                return Some(json!({"ok": false, "error": e}));
            }
            Some(match services::pony::read_skill_file(&skills_dir, name, rel.trim()) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }
        "save_skill" => {
            let Ok(v) = serde_json::from_str::<Value>(args) else {
                return Some(json!({"ok": false, "error": "invalid save_skill arguments"}));
            };
            let name = v["name"].as_str().unwrap_or("");
            let desc = v["description"].as_str().unwrap_or("");
            let body = v["body"].as_str().unwrap_or("");
            let replace = v["replace"].as_bool().unwrap_or(false);
            if app.state::<Mcp>().is_tainted(session) {
                let preview: String = body.chars().take(240).collect();
                let detail = format!("Save skill “{name}”\n{desc}\n\n{preview}");
                if crate::exec::approve(app, session, json!({"tool": "save_skill", "detail": detail, "canAlways": false})) == "deny" {
                    return Some(json!({"ok": false, "error": "The user declined saving this skill."}));
                }
            }
            Some(match services::pony::save_skill_from_mcp(&skills_dir, name, desc, body, replace) {
                Ok(_) => json!({"ok": true, "text": format!("Saved skill '{name}'")}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }
        "remember" => {
            if app.state::<Mcp>().is_tainted(session) {
                let detail = format!("Remember fact:\n{}", args.chars().take(240).collect::<String>());
                if crate::exec::approve(app, session, json!({"tool": "remember", "detail": detail, "canAlways": false})) == "deny" {
                    return Some(json!({"ok": false, "error": "The user declined saving this memory fact."}));
                }
            }
            let now_ms = chrono::Utc::now().timestamp_millis();
            Some(match services::pony::remember_with_drop(&mem_path, args, now_ms) {
                Ok((f, Some(dropped))) => json!({
                    "ok": true,
                    "text": format!("Remembered [{}]: {} (memory full at 100 facts; dropped oldest [{}])", f.id, f.text, dropped.id)
                }),
                Ok((f, None)) => json!({"ok": true, "text": format!("Remembered [{}]: {}", f.id, f.text)}),
                Err(e) => json!({"ok": false, "error": e}),
            })
        }
        "recall" => {
            // (the chat the run is in is left out: it's in the conversation already)
            let chats: Value = std::fs::read(app.state::<crate::commands::App>().data_dir.join("chats.json")).ok()
                .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
            Some(json!({"ok": true, "text": services::learn::recall(&chats, args, &crate::brain::chat_of(app, session))}))
        }
        "forget" => {
            let id = args.trim();
            if services::pony::forget(&mem_path, id) {
                Some(json!({"ok": true, "text": format!("Forgot [{id}]")}))
            } else {
                Some(json!({"ok": false, "error": format!("Memory fact '{id}' not found")}))
            }
        }
        _ => None,
    }
}

/// One call from a bridge: `{token, session, kind, args}` → `{ok, text | error}`.
pub(crate) fn serve(app: &AppHandle, req: Value) -> Value {
    let m = app.state::<Mcp>();
    let session = req["session"].as_str().unwrap_or("").to_string();
    let kind = req["kind"].as_str().unwrap_or("");
    let args = req["args"].as_str().unwrap_or("");
    if req["token"].as_str() != Some(m.token.as_str()) {
        return json!({"ok": false, "error": "This isn't a run Sympony started, or it has ended"});
    }
    if !m.sessions.lock().unwrap().contains_key(&session) {
        return json!({"ok": false, "error": "This isn't a run Sympony started, or it has ended"});
    }
    if kind == "ask" {
        if let Err(msg) = m.check_ask(&session) {
            return json!({"ok": false, "error": msg});
        }
    }
    // (outside tools for a CLI agent: their list when it starts, and its calls; never in a scheduled brief)
    if kind == "out_list" || kind == "out" {
        let brief = m.sessions.lock().unwrap().get(&session).is_some_and(|x| x.brief);
        if brief {
            return if kind == "out_list" { json!({"ok": true, "text": "[]"}) } else { json!({"ok": false, "error": "Outside tools don't run in a scheduled brief"}) };
        }
        let call: Value = serde_json::from_str(args).unwrap_or(Value::Null);
        // (the bridge to other agents comes with them, when Paseo or Claude Code is here)
        let agents = crate::bridge::available(app);
        let eyes = crate::eyes::available(app);
        let askai = crate::askai::available(app);
        let hands = eyes && crate::hands::available(app);
        if kind == "out" && hands && services::routines::NAMES.contains(&call["name"].as_str().unwrap_or("")) {
            return match crate::hands::save_routine(app, &session, &call["arguments"]) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            };
        }
        if kind == "out" && hands && services::hands::NAMES.contains(&call["name"].as_str().unwrap_or("")) {
            // `screen_do` returns live screen changes/text from another app -> taint the session like `screen_read`.
            m.mark_tainted(&session);
            return match crate::hands::call(app, &session, &call["arguments"]) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            };
        }
        if kind == "out" && askai && call["name"] == "ask_ai" {
            m.mark_tainted(&session);
            return match crate::askai::call(app, &session, &call["arguments"]) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            };
        }
        if kind == "out" && eyes && services::eyes::NAMES.contains(&call["name"].as_str().unwrap_or("")) {
            m.mark_tainted(&session);
            return match crate::eyes::call(app, &session, &call["arguments"]) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            };
        }
        if kind == "out" && (agents || askai) && crate::bridge::NAMES.contains(&call["name"].as_str().unwrap_or("")) {
            let tool_name = call["name"].as_str().unwrap_or("");
            if tool_taints_turn(tool_name) {
                m.mark_tainted(&session);
            }
            return match crate::bridge::call(app, &session, tool_name, &call["arguments"]) {
                Ok(text) => json!({"ok": true, "text": text}),
                Err(e) => json!({"ok": false, "error": e}),
            };
        }
        let (mut tools, targets) = crate::mcp_out::tools(app);
        if kind == "out_list" {
            if agents {
                tools.extend(crate::bridge::tools());
            }
            if eyes {
                tools.extend(services::eyes::tools());
            }
            if hands {
                tools.extend(services::hands::tools());
                tools.extend(services::routines::tools());
            }
            if askai {
                tools.extend(services::askai::tools());
                if !agents {
                    tools.extend(crate::bridge::tools().into_iter().filter(|t| matches!(t["name"].as_str(), Some("agent_status" | "agent_send" | "agent_stop"))));
                }
            }
            return json!({"ok": true, "text": Value::from(tools).to_string()});
        }
        let Some(t) = targets.get(call["name"].as_str().unwrap_or("")) else {
            return json!({"ok": false, "error": "No such tool (its server may be off)"});
        };
        m.mark_tainted(&session);
        return match crate::mcp_out::call(app, &session, t, &call["arguments"]) {
            Ok(text) => json!({"ok": true, "text": text}),
            Err(e) => json!({"ok": false, "error": e}),
        };
    }
    // (the chat shows Pony's steps while a long answer is on its way)
    let detail: String = if matches!(kind, "skill" | "skill_file" | "open" | "music" | "pomodoro" | "recall") { args.split(" | ").next().unwrap_or("").chars().take(60).collect() } else { String::new() };
    let _ = app.emit("agent:step", json!({"session": session, "kind": kind, "detail": detail}));
    if let Some(ans) = serve_pony(app, &session, kind, args) {
        return ans;
    }
    let call = m.next.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = channel();
    m.waits.lock().unwrap().insert(call, tx);
    let _ = app.emit("agent:tool", json!({"session": session, "call": call, "kind": req["kind"], "args": req["args"]}));
    let r = rx.recv_timeout(WAIT).unwrap_or_else(|_| json!({"ok": false, "error": "Sympony's window didn't answer (closed, or Pony isn't open there)"}));
    m.waits.lock().unwrap().remove(&call);
    if kind == "ask" {
        m.finish_ask(&session, &r);
    }
    r
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let token = services::oauth::random();
    app.manage(Mcp { token, sessions: Mutex::default(), waits: Mutex::default(), next: AtomicU64::new(0) });
    let h = app.clone();
    // (a window's answer to a tool call: {ok, text})
    reg.add("agent.result", Box::new(move |_, a| {
        let call = a.first().and_then(Value::as_u64).unwrap_or(0);
        if let Some(tx) = h.state::<Mcp>().waits.lock().unwrap().remove(&call) {
            let _ = tx.send(a.get(1).cloned().unwrap_or(Value::Null));
        }
        Ok(Value::Null)
    }));
}

/// The socket the bridges call (this account only).
pub fn start(app: &AppHandle) {
    use std::os::unix::fs::PermissionsExt;
    let path = socket(app);
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            app.state::<App>().log.line(&format!("mcp: no socket: {e}"));
            return;
        }
    };
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                use std::io::Read;
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut line = String::new();
                let mut r = BufReader::new((&stream).take(2 << 20));
                if r.read_line(&mut line).is_err() {
                    return;
                }
                // (an agent's hook waits here for the card's answer; the rest are tool calls)
                let out = serde_json::from_str::<Value>(&line)
                    .map(|req| crate::hooks::route(&app, &req, &stream).unwrap_or_else(|| serve(&app, req)))
                    .unwrap_or_else(|_| json!({"ok": false, "text": "bad request"}));
                let mut s = &stream;
                let _ = writeln!(s, "{out}");
            });
        }
    });
}

/// `sympony --mcp`: MCP on stdin/stdout for an agent; each tool call goes to the running app.
pub fn bridge() {
    let sock = std::env::var("SYMPONY_SOCK").unwrap_or_default();
    let token = std::env::var("SYMPONY_TOKEN").unwrap_or_default();
    let session = std::env::var("SYMPONY_SESSION").unwrap_or_default();
    let mut run = |kind: &str, args: &str| -> Result<String, String> {
        if sock.is_empty() {
            return Err("Sympony's tools only work in a chat Sympony started".into());
        }
        let mut s = UnixStream::connect(&sock).map_err(|_| "Sympony isn't running".to_string())?;
        // (an outside tool may wait on the user's card, up to 5 minutes, then run for one; its server may take a minute to start)
        let wait = match kind {
            "out" => Duration::from_secs(420),
            "out_list" => Duration::from_secs(90),
            _ => WAIT + Duration::from_secs(5),
        };
        let _ = s.set_read_timeout(Some(wait));
        writeln!(s, "{}", json!({"token": token, "session": session, "kind": kind, "args": args})).map_err(|e| e.to_string())?;
        use std::io::Read;
        let mut line = String::new();
        BufReader::new((&s).take(2 << 20)).read_line(&mut line).map_err(|_| "Sympony didn't answer".to_string())?;
        let v: Value = serde_json::from_str(&line).map_err(|_| "Sympony answered oddly".to_string())?;
        let text = v["text"].as_str().or_else(|| v["error"].as_str()).unwrap_or("").to_string();
        if v["ok"] == true { Ok(text) } else { Err(text) }
    };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    // (the outside tools the app has for this run: asked for once, on the first tools/list)
    let mut outside: Option<Vec<Value>> = None;
    for line in stdin.lock().lines().map_while(Result::ok) {
        let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
        let method = req["method"].as_str().unwrap_or("");
        let name = req["params"]["name"].as_str().unwrap_or("");
        // (a tool that isn't one of Sympony's own: an outside tool or the bridge, answered by the app)
        if method == "tools/call" && !services::tools::list().iter().any(|t| t["name"] == name) {
            let a = json!({"name": name, "arguments": req["params"]["arguments"]}).to_string();
            let (text, err) = match run("out", &a) {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            let _ = writeln!(out, "{}", json!({"jsonrpc": "2.0", "id": req["id"], "result": {"content": [{"type": "text", "text": text}], "isError": err}}));
            let _ = out.flush();
            continue;
        }
        if let Some(mut resp) = services::tools::handle(&req, &mut run) {
            if method == "tools/list" {
                let extra = outside.get_or_insert_with(|| {
                    run("out_list", "").ok().and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok()).unwrap_or_default()
                });
                if let Some(list) = resp["result"]["tools"].as_array_mut() {
                    list.extend(extra.iter().cloned());
                }
            }
            let _ = writeln!(out, "{resp}");
            let _ = out.flush();
        }
    }
}

/// `sympony --hook <agent> <event>`: an agent's hook (Claude Code's settings run it). Its payload (stdin) goes to the
/// running app, which shows the card and answers; what comes back is printed for the agent. Sympony not running, or
/// anything wrong: nothing printed, so the agent goes on as it would without Sympony.
pub fn hook(agent: &str, event: &str) {
    use std::io::Read;
    let mut input = String::new();
    let _ = std::io::stdin().take((1 << 20) + 1).read_to_string(&mut input);
    // (cut at 1 MB or not JSON: no card, the agent asks in its own window)
    let Some(payload) = serde_json::from_str::<Value>(&input).ok().filter(|v| v.is_object() && input.len() <= 1 << 20) else { return };
    let sock = dirs_data().join("agent.sock");
    let Ok(mut s) = UnixStream::connect(&sock) else { return };
    let _ = s.set_read_timeout(Some(Duration::from_secs(75)));
    let ppid = unsafe { libc_getppid() };
    if writeln!(s, "{}", json!({"type": "hook", "agent": agent, "event": event, "payload": payload, "ppid": ppid})).is_err() {
        return;
    }
    let mut line = String::new();
    let _ = BufReader::new((&s).take(1 << 20)).read_line(&mut line);
    if let Some(out) = serde_json::from_str::<Value>(&line).ok().and_then(|v| v["stdout"].as_str().map(String::from)) {
        println!("{out}");
    }
}

fn dirs_data() -> std::path::PathBuf {
    services::paths::data_dir()
}

unsafe extern "C" {
    #[link_name = "getppid"]
    fn libc_getppid() -> i32;
}

/// Whether a built-in tool's result brings untrusted external content (web, screen, or another AI/agent's output)
/// into the turn and must taint subsequent commands, file tools, memory writes, and skill writes.
pub(crate) fn tool_taints_turn(name: &str) -> bool {
    matches!(
        name,
        "web_search" | "read_web_page" | "screen_read" | "screen_do" | "ask_ai" | "agent_status"
    )
}

#[cfg(test)]
mod tests {
    use super::{ask_allowed, tool_taints_turn, Mcp};
    use serde_json::json;
    use std::sync::{atomic::AtomicU64, Mutex};

    #[test]
    fn ask_allowed_enforces_one_ask_and_no_briefs() {
        assert_eq!(ask_allowed(false, false), Ok(()));
        assert_eq!(ask_allowed(true, false), Err("already asked; end your reply"));
        assert_eq!(ask_allowed(false, true), Err("can't ask during a scheduled brief"));
        assert_eq!(ask_allowed(true, true), Err("can't ask during a scheduled brief"));
    }

    #[test]
    fn malformed_ask_does_not_consume_one_ask_per_turn() {
        let mcp = Mcp { token: "t".into(), sessions: Mutex::default(), waits: Mutex::default(), next: AtomicU64::new(0) };
        mcp.open("s1", false);
        assert_eq!(mcp.check_ask("s1"), Ok(()));
        // Malformed ask rejected by frontend: must NOT mark asked = true
        mcp.finish_ask("s1", &json!({"ok": false, "text": "ask_user requires at least one question"}));
        assert_eq!(mcp.check_ask("s1"), Ok(()));
        // Valid ask accepted by frontend: marks asked = true
        mcp.finish_ask("s1", &json!({"ok": true, "text": "asked"}));
        assert_eq!(mcp.check_ask("s1"), Err("already asked; end your reply"));
    }

    #[test]
    fn h01_session_taint_tracks_untrusted_reads_and_clears_on_close() {
        let mcp = Mcp { token: "t".into(), sessions: Mutex::default(), waits: Mutex::default(), next: AtomicU64::new(0) };
        mcp.open("s1", false);
        assert!(!mcp.is_tainted("s1"));
        mcp.mark_tainted("s1");
        assert!(mcp.is_tainted("s1"));
        mcp.close("s1");
        assert!(!mcp.is_tainted("s1"));
        for t in ["web_search", "read_web_page", "screen_read", "screen_do", "ask_ai", "agent_status"] {
            assert!(tool_taints_turn(t), "must taint turn: {t}");
        }
        for safe in ["routine_save", "agents_list", "agent_stop", "remember"] {
            assert!(!tool_taints_turn(safe), "must not mark as taint source: {safe}");
        }
    }
}
