//! AI through the agents installed on the Mac (services::agents): found on the login shell's PATH, run once per answer
//! in read-only mode from an empty folder, killed after 3 minutes. AI Chat, Translate and the lyrics' extras.
use serde_json::{json, Value};
use services::agents::{
    answer, args, chat_rules_with_caps, claude_user_message, env, lines_answer, lines_prompt,
    needs_update, prompt, signed_in, supported, tools_for, translate_prompt, with_stream,
    with_tools, ClaudeEvent, ClaudeStream, AGENTS,
};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const LIMIT: Duration = Duration::from_secs(180);

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// The PATH a terminal has (an app started from the Dock gets a bare one), with the usual install folders after it.
pub(crate) fn path() -> &'static str {
    static P: OnceLock<String> = OnceLock::new();
    P.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut p = run_capture(Command::new(shell).args(["-ilc", "printf '%s' \"$PATH\""]), Duration::from_secs(5))
            .ok()
            .filter(|(ok, out, _)| *ok && out.contains('/'))
            .map(|(_, out, _)| out.lines().last().unwrap_or("").to_string())
            .unwrap_or_default();
        let h = home();
        for d in [".local/bin", ".opencode/bin", ".bun/bin", ".npm-global/bin", ".cargo/bin", ".hermes/bin"].map(|d| h.join(d).to_string_lossy().to_string())
            .into_iter()
            .chain(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(String::from))
        {
            if !p.split(':').any(|x| x == d) {
                if !p.is_empty() {
                    p.push(':');
                }
                p.push_str(&d);
            }
        }
        p
    })
}

pub(crate) fn which(bin: &str) -> Option<PathBuf> {
    path().split(':').map(|d| PathBuf::from(d).join(bin)).find(|p| p.is_file())
}

/// Runs a command to its end (or `limit`): (exited well, stdout, stderr). It gets a process group of its own, killed
/// whole afterwards (a CLI's helpers and MCP servers go with it); its output is read as it comes (a chatty child never
/// blocks on a full pipe), at most 4 MB each, and a pipe a leftover keeps open is waited on a few seconds only.
/// `started` gets the group's id (to stop it from elsewhere).
fn run_capture_in(cmd: &mut Command, limit: Duration, started: Option<&Mutex<Option<u32>>>) -> Result<(bool, String, String), String> {
    let mut child = platform::process::own_group(cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())).spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    if let Some(slot) = started {
        *slot.lock().unwrap() = Some(pid);
    }
    let reader = |mut r: Box<dyn Read + Send>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = vec![];
            let _ = (&mut r).take(4 << 20).read_to_end(&mut buf);
            let _ = tx.send(String::from_utf8_lossy(&buf).to_string());
        });
        rx
    };
    let (out, err) = (reader(Box::new(child.stdout.take().unwrap())), reader(Box::new(child.stderr.take().unwrap())));
    let kill_group = || platform::process::kill_group(pid);
    let start = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if start.elapsed() > limit || started.is_some_and(|s| *s.lock().unwrap() != Some(pid)) {
            kill_group();
            let _ = child.wait();
            return Err(if start.elapsed() > limit { "timeout".into() } else { "stopped".into() });
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let o = out.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
    let e = err.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    kill_group(); // (whatever it left running)
    Ok((status.success(), o, e))
}

pub(crate) fn run_capture(cmd: &mut Command, limit: Duration) -> Result<(bool, String, String), String> {
    run_capture_in(cmd, limit, None)
}

#[derive(Default)]
pub struct Agents {
    list: Mutex<Option<(Instant, Vec<Value>)>>,
    probing: std::sync::atomic::AtomicBool, // (a check of the CLIs is under way: no second one)
    lyrics: Mutex<HashMap<String, Value>>, // what an agent made of a song's lines (romanized / translated), kept on disk
    chat_runs: Mutex<HashMap<String, std::sync::Arc<Mutex<Option<u32>>>>>, // each chat run's agent process (Stop ends it)
    roman_run: Mutex<Option<u32>>,         // the lyrics runs going on, one per kind (a newer song stops its kind's)
    trans_run: Mutex<Option<u32>>,
}

/// Where an agent's executable is, when it's installed (Claude Code for the bridge's fallback).
pub(crate) fn bin(app: &AppHandle, id: &str) -> Option<String> {
    list(app).into_iter().find(|a| a["id"] == id && a["installed"] == true).and_then(|a| a["path"].as_str().map(String::from))
}

/// The agents and their state (looked at again after a minute).
fn list(app: &AppHandle) -> Vec<Value> {
    let st = app.state::<Agents>();
    let cached = st.list.lock().unwrap().clone();
    if let Some((t, v)) = cached {
        // (older than a minute: still answered at once, checked again behind it for the next time)
        if t.elapsed() >= Duration::from_secs(60) {
            let a = app.clone();
            std::thread::spawn(move || {
                probe(&a);
            });
        }
        return v;
    }
    probe(app)
}

/// Checks every agent CLI (each on its own thread) and keeps the answer; one check at a time.
pub fn probe(app: &AppHandle) -> Vec<Value> {
    use std::sync::atomic::Ordering;
    let st = app.state::<Agents>();
    if st.probing.swap(true, Ordering::SeqCst) {
        // (one is running: wait for it rather than starting the CLIs twice)
        while st.probing.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(50));
        }
        return st.list.lock().unwrap().as_ref().map(|x| x.1.clone()).unwrap_or_default();
    }
    let h = home();
    // (each agent's `--version` on its own thread: some CLIs take seconds to start)
    let v: Vec<Value> = std::thread::scope(|sc| {
        let jobs: Vec<_> = AGENTS.iter().map(|a| { let h = &h; sc.spawn(move || {
            let p = a.bins.iter().find_map(|b| which(b));
            // (one that doesn't even say its version within 8 s won't answer a chat either)
            let probe = p.as_ref().map(|p| run_capture(Command::new(p).arg("--version").env("PATH", path()), Duration::from_secs(8)));
            let responding = !matches!(probe, Some(Err(_)));
            let version = probe.and_then(|r| r.ok()).map(|(_, o, e)| {
                let s = if o.trim().is_empty() { e } else { o };
                s.lines().next().unwrap_or("").trim().to_string()
            });
            let version = version.unwrap_or_default();
            json!({"id": a.id, "name": a.name, "icon": a.icon, "installed": p.is_some(), "path": p.map(|p| p.to_string_lossy().to_string()),
                   "signedIn": signed_in(a.id, h), "version": version, "update": needs_update(a.id, &version), "install": a.install,
                   "supported": supported(a.id), "responding": responding, "tools": tools_for(a.id)})
        }) }).collect();
        jobs.into_iter().filter_map(|j| j.join().ok()).collect()
    });
    *st.list.lock().unwrap() = Some((Instant::now(), v.clone()));
    st.probing.store(false, Ordering::SeqCst);
    v
}

/// The agent a feature uses: the one picked, else the first installed and signed in.
fn pick(app: &AppHandle, key: &str) -> Option<Value> {
    let s = app.state::<App>().settings.get();
    let want = s[key].as_str().filter(|x| !x.is_empty()).or_else(|| s["chatAgent"].as_str()).unwrap_or("").to_string();
    let all = list(app);
    let usable = |a: &&Value| a["installed"] == true && a["update"] != true && a["supported"] != false && a["responding"] != false;
    all.iter().find(|a| a["id"] == want.as_str() && usable(a)).or_else(|| all.iter().filter(usable).find(|a| a["signedIn"] == true)).cloned()
}

/// Runs Claude Code in `--output-format stream-json --verbose --include-partial-messages` mode,
/// emitting live `agent:delta` text chunks and `agent:step` web search/fetch chips (plus marking the MCP session
/// tainted whenever WebSearch/WebFetch runs). Optional `stdin_line` delivers multimodal user JSON on stdin.
fn run_claude_stream(
    app: &AppHandle,
    session: &str,
    cmd: &mut Command,
    stdin_line: Option<String>,
    limit: Duration,
    started: Option<&Mutex<Option<u32>>>,
) -> Result<(Result<String, String>, Vec<Value>, Vec<String>), String> {
    platform::process::own_group(cmd.stdin(if stdin_line.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped()));
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    if let Some(slot) = started {
        *slot.lock().unwrap() = Some(pid);
    }
    if let (Some(line), Some(mut stdin)) = (stdin_line, child.stdin.take()) {
        std::thread::spawn(move || {
            let _ = stdin.write_all(line.as_bytes());
            let _ = stdin.write_all(b"\n");
            let _ = stdin.flush();
        });
    }
    let stderr_rx = {
        let mut r = child.stderr.take().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = vec![];
            let _ = (&mut r).take(1 << 20).read_to_end(&mut buf);
            let _ = tx.send(String::from_utf8_lossy(&buf).to_string());
        });
        rx
    };
    let stdout_rx = {
        let r = child.stdout.take().unwrap();
        let app = app.clone();
        let sess = session.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut parser = ClaudeStream::default();
            let mut shown = Instant::now() - Duration::from_secs(1);
            let mut last_round = 0u32;
            let mut pending_delta: Option<(u32, String)> = None;
            let emit_delta = |app: &AppHandle, sess: &str, round: u32, text: &str| {
                let _ = app.emit_to(crate::notch::LABEL, "agent:delta", json!({"session": sess, "round": round, "text": text}));
            };
            for line in BufReader::new(r).lines().map_while(Result::ok) {
                for ev in parser.feed(&line) {
                    match ev {
                        ClaudeEvent::Delta { round, text } => {
                            if round != last_round || shown.elapsed() >= Duration::from_millis(50) {
                                last_round = round;
                                shown = Instant::now();
                                emit_delta(&app, &sess, round, &text);
                                pending_delta = None;
                            } else {
                                pending_delta = Some((round, text));
                            }
                        }
                        ClaudeEvent::Step { kind, detail, taints } => {
                            if taints && !sess.is_empty() {
                                app.state::<crate::mcp::Mcp>().mark_tainted(&sess);
                            }
                            let _ = app.emit("agent:step", json!({
                                "session": sess,
                                "kind": kind,
                                "detail": detail.chars().take(60).collect::<String>(),
                            }));
                        }
                        ClaudeEvent::Sources { query, sources } => {
                            let _ = app.emit("agent:step", json!({
                                "session": sess,
                                "kind": "web",
                                "detail": query.chars().take(60).collect::<String>(),
                                "update": true,
                                "sources": sources,
                            }));
                        }
                    }
                }
            }
            if let Some((round, text)) = pending_delta {
                emit_delta(&app, &sess, round, &text);
            }
            let _ = tx.send(parser);
        });
        rx
    };
    let kill_group = || platform::process::kill_group(pid);
    let start = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            break st;
        }
        if start.elapsed() > limit || started.is_some_and(|s| *s.lock().unwrap() != Some(pid)) {
            kill_group();
            let _ = child.wait();
            return Err(if start.elapsed() > limit { "timeout".into() } else { "stopped".into() });
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let parser = stdout_rx.recv_timeout(Duration::from_secs(5)).unwrap_or_default();
    let err_out = stderr_rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
    kill_group();
    let sources = parser.sources.clone();
    let searched = parser.searched.clone();
    Ok((parser.finish(&err_out, status.success()), sources, searched))
}

/// One answer from the agent `key` names (chatAgent / translateAgent). Err: what to show.
fn ask(app: &AppHandle, key: &str, prompt_text: &str, system: &str, web: bool) -> Result<String, String> {
    ask_in(app, key, prompt_text, &[], system, web, None, None, false).map(|(t, _, _)| t)
}

/// `session`: a chat run that gets Sympony's tools (when its agent can take them) and live streaming (Claude Code).
/// `images`: pictures the user attached (data URLs); supported by Pony's own engine and Claude Code.
fn ask_in(
    app: &AppHandle,
    key: &str,
    prompt_text: &str,
    images: &[String],
    system: &str,
    web: bool,
    slot: Option<&Mutex<Option<u32>>>,
    session: Option<&str>,
    brief: bool,
) -> Result<(String, Vec<Value>, Vec<String>), String> {
    if crate::brain::on(app) {
        let t = crate::brain::ask(app, &[json!({"role": "user", "content": prompt_text})], images, system, session, brief)?;
        return Ok((t, vec![], vec![]));
    }
    let a = pick(app, key).ok_or("No AI agent is set up on this Mac: install one (Settings → Pony Assistant)")?;
    let id = a["id"].as_str().unwrap_or("");
    let name = a["name"].as_str().unwrap_or(id).to_string();
    if !images.is_empty() && id != "claude" {
        return Err("Pictures need Sympony AI, your own server, or Claude Code: switch in Settings → Pony Assistant".into());
    }
    let s = app.state::<App>().settings.get();
    let model = s["agentModels"][id].as_str().map(String::from);
    let session = session.filter(|_| tools_for(id));
    // (a run with tools gets a folder of its own: its agent's MCP settings go there)
    let dir = match session {
        Some(s) => app.state::<App>().data_dir.join("agent").join(format!("run-{s}")),
        None => app.state::<App>().data_dir.join("agent"),
    };
    let _ = std::fs::create_dir_all(&dir);
    let mut argv = args(id, prompt_text, system, model.filter(|m| !m.starts_with('-')).as_deref(), web);
    let mut envs = env(id);
    if let Some(s) = session {
        let exe = std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
        let sock = crate::mcp::socket(app).to_string_lossy().to_string();
        let token = app.state::<crate::mcp::Mcp>().token.clone();
        let w = with_tools(id, argv, &exe, &[("SYMPONY_SOCK", sock.as_str()), ("SYMPONY_TOKEN", token.as_str()), ("SYMPONY_SESSION", s)]);
        for (rel, body) in &w.files {
            let f = dir.join(rel);
            if let Some(p) = f.parent() {
                let _ = std::fs::create_dir_all(p);
            }
            let _ = std::fs::write(f, body);
        }
        argv = w.args;
        envs = w.env;
        app.state::<crate::mcp::Mcp>().open(s, brief);
    }
    let stream_claude = id == "claude" && (session.is_some() || !images.is_empty());
    let stdin_line = if stream_claude && !images.is_empty() {
        Some(claude_user_message(prompt_text, images))
    } else {
        None
    };
    if stream_claude {
        argv = with_stream(id, argv, stdin_line.is_some());
    }
    let mut cmd = Command::new(a["path"].as_str().unwrap_or(""));
    cmd.args(argv).current_dir(&dir).env("PATH", path()).env("NO_COLOR", "1");
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let started = Instant::now();
    let log = |m: &str| app.state::<App>().log.line(&format!("ai: {id}: {m} ({:.1} s)", started.elapsed().as_secs_f32()));
    if stream_claude {
        let r = run_claude_stream(app, session.unwrap_or(""), &mut cmd, stdin_line, LIMIT, slot);
        if let Some(s) = session {
            app.state::<crate::mcp::Mcp>().close(s);
            let _ = std::fs::remove_dir_all(&dir);
        }
        return match r {
            Err(e) if e == "stopped" => Err(e),
            Err(e) if e == "timeout" => {
                log("no answer in time");
                Err(format!("{name} didn’t answer within 3 minutes"))
            }
            Err(e) => {
                log(&e);
                Err(format!("Couldn’t start {name}: {e}"))
            }
            Ok((Ok(t), sources, searched)) => {
                log("answered");
                Ok((t, sources, searched))
            }
            Ok((Err(e), _, _)) => {
                log(&format!("failed: {e}"));
                Err(format!("{name}: {e}"))
            }
        };
    }
    let r = run_capture_in(&mut cmd, LIMIT, slot);
    if let Some(s) = session {
        app.state::<crate::mcp::Mcp>().close(s);
        let _ = std::fs::remove_dir_all(&dir);
    }
    match r {
        Err(e) if e == "stopped" => Err(e),
        Err(e) if e == "timeout" => {
            log("no answer in time");
            Err(format!("{name} didn’t answer within 3 minutes"))
        }
        Err(e) => {
            log(&e);
            Err(format!("Couldn’t start {name}: {e}"))
        }
        Ok((ok, out, err)) => match answer(id, &out, &err, ok) {
            Ok(t) => {
                log("answered");
                Ok((t, vec![], vec![]))
            }
            Err(e) => {
                log(&format!("failed: {e}"));
                Err(format!("{name}: {e}"))
            }
        },
    }
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Agents::default());
    // Seed built-in Pony skills into ~/.sympony/skills once (marker .builtins-v1) so deleted built-ins stay deleted
    let _ = services::pony::seed_builtins_once(&services::pony::home());
    // (the agents are checked at start, so Settings and the first chat find them ready)
    let warm = app.clone();
    std::thread::spawn(move || {
        probe(&warm);
    });
    let h = app.clone();
    reg.add("ai.agents", Box::new(move |_, a| {
        // (Refresh: checked now, whatever the cache says)
        if a.first().and_then(Value::as_bool) == Some(true) {
            return Ok(Value::Array(probe(&h)));
        }
        Ok(Value::Array(list(&h)))
    }));
    let h = app.clone();
    // (steering: a message written while Pony's own engine works joins its next step; {ok: false} otherwise)
    let h2 = app.clone();
    reg.add("chat.steer", Box::new(move |_, a| {
        let (s, t) = (a.first().and_then(Value::as_str).unwrap_or(""), a.get(1).and_then(Value::as_str).unwrap_or("").trim());
        Ok(json!({"ok": !t.is_empty() && crate::brain::steer(&h2, s, t)}))
    }));
    // (Stop in the chat: the run ends now, what it wrote so far stays)
    reg.add("chat.stop", Box::new(move |_, a| {
        if let Some(s) = a.first().and_then(Value::as_str) {
            crate::brain::stop(&h, s);
            if let Some(slot) = h.state::<Agents>().chat_runs.lock().unwrap().get(s) {
                *slot.lock().unwrap() = None;
            }
        }
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("chat.send", Box::new(move |_, a| {
        let msgs = a.first().and_then(Value::as_array).cloned().unwrap_or_default();
        let context = a.get(1).and_then(Value::as_str).unwrap_or("");
        let session = a.get(2).and_then(Value::as_str).filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric()));
        let brief = a.get(3).and_then(Value::as_bool).unwrap_or(false);
        let now = chrono::Local::now().format("%A %-d %B %Y, %H:%M").to_string();
        let settings = h.state::<App>().settings.get();
        let web = settings["chatWebSearch"] == true;
        let tools = session.is_some() && (crate::brain::on(&h) || pick(&h, "chatAgent").is_some_and(|a| tools_for(a["id"].as_str().unwrap_or(""))));
        let context = if tools { "(not included: call get_context when you need it)" } else { context };

        let (pony_name, pony_preset, pony_text) = services::pony::persona_settings(&settings);
        let skills_off = crate::pony::skills_off_from(&settings);

        let loaded_skills = services::pony::load_skills(&crate::pony::skills_root());
        let skills_block = if tools {
            let idx = services::pony::skill_index(&loaded_skills, &skills_off);
            if idx.is_empty() { String::new() } else { format!("Skills (call read_skill with the name to load instructions):\n{idx}") }
        } else {
            let inl = services::pony::inline_skills(&loaded_skills, &skills_off);
            if inl.is_empty() { String::new() } else { format!("Skills:\n{inl}") }
        };
        let facts_list = services::pony::facts(&crate::pony::memory_file());
        let facts_blk = services::pony::facts_block(&facts_list);
        let persona = services::pony::persona_block(pony_name, pony_preset, pony_text);
        let own = crate::brain::on(&h);
        // Active abilities for MCP-wired CLI agents (Claude Code): full parity with Pony's own engine!
        let cli_caps = !own && tools && !brief;
        let exec_on = cli_caps && crate::exec::on(&h);
        let eyes_on = cli_caps && crate::eyes::available(&h);
        let hands_on = eyes_on && crate::hands::available(&h);
        let askai_on = cli_caps && crate::askai::available(&h);
        let agents_on = cli_caps && crate::bridge::available(&h);
        let outside_on = cli_caps && !crate::mcp_out::tools(&h).0.is_empty();

        // (Pony's own engine: its tools are its limits; an MCP-wired CLI agent gets its active abilities' rules too)
        let rules = if own {
            services::agents::engine_rules("")
        } else {
            chat_rules_with_caps("", tools, web, exec_on, eyes_on)
        };
        let mut system = services::pony::system_prompt(&rules, &persona, &skills_block, &facts_blk, &now);
        if cli_caps {
            if exec_on {
                system.push_str("\n\n");
                system.push_str(services::exec::RULES);
            }
            if outside_on {
                system.push_str("\n\n");
                system.push_str(crate::brain::OUTSIDE_RULES);
            }
            if agents_on {
                system.push_str("\n\n");
                system.push_str(crate::brain::AGENT_RULES);
            }
            if eyes_on {
                system.push_str("\n\n");
                system.push_str(services::eyes::RULES);
            }
            if hands_on {
                system.push_str("\n\n");
                system.push_str(services::hands::BRIEF);
            }
            if askai_on {
                system.push_str("\n\n");
                system.push_str(services::askai::RULES);
            }
        }
        let trimmed = services::pony::trim_history(&msgs, services::pony::HISTORY_MSGS, services::pony::HISTORY_CHARS);

        // (pictures attached to this message: data URLs, at most 4)
        let images: Vec<String> = a.get(4).and_then(Value::as_array).into_iter().flatten()
            .filter_map(|v| v.as_str().filter(|u| u.starts_with("data:image/")).map(String::from)).take(4).collect();
        // (Stop: chat.stop ends the agent's process through this slot, or Pony's own engine at its next step)
        let slot = std::sync::Arc::new(Mutex::new(None));
        if let Some(s) = session {
            h.state::<Agents>().chat_runs.lock().unwrap().insert(s.to_string(), slot.clone());
        }
        // (the chat this is: its notes on what fell out of the window, and recall leaves it out)
        let chat = a.get(5).and_then(Value::as_str).filter(|c| !c.is_empty() && c.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or("");
        if let Some(s) = session {
            crate::brain::set_chat(&h, s, Some(chat));
        }
        let mut cli_sources: Vec<Value> = vec![];
        let mut cli_searched: Vec<String> = vec![];
        let r = if session.is_some_and(|s| crate::brain::stopped(&h, s)) { Err("stopped".to_string()) }
            // (Pony's own engine: the conversation as real turns, the day and the chat's notes in the system prompt)
            else if own {
                let notes = crate::brain::notes(&h, chat);
                let mut sys = format!("{system}\n\nWhat Sympony knows about the user right now (use it when it helps):\n{}",
                    if context.trim().is_empty() { "(nothing shared)" } else { context.trim() });
                if !notes.is_empty() {
                    sys.push_str(&format!("\n\nEarlier in this chat (your notes; those messages aren't shown any more):\n{notes}"));
                }
                crate::brain::ask(&h, &services::brain::turns(&trimmed), &images, &sys, session, brief)
            } else {
                match ask_in(&h, "chatAgent", &prompt(context, &trimmed), &images, &system, web, session.map(|_| &*slot), session, brief) {
                    Ok((t, srcs, srch)) => {
                        cli_sources = srcs;
                        cli_searched = srch;
                        Ok(t)
                    }
                    Err(e) => Err(e),
                }
            };
        if let Some(s) = session {
            h.state::<Agents>().chat_runs.lock().unwrap().remove(s);
            crate::brain::forget_stop(&h, s);
            crate::brain::set_chat(&h, s, None);
        }
        if let (Ok(t), Some(_), false) = (&r, session, brief) {
            if own {
                let mut all = msgs.clone();
                all.push(json!({"role": "assistant", "content": t}));
                crate::brain::upkeep(&h, chat, all);
            }
        }
        // (what Pony's own engine or Claude Code found on the web: the chat lists it under the answer)
        let (sources, searched) = if own {
            session.map(|s| crate::brain::take_web(&h, s)).unwrap_or_default()
        } else {
            (cli_sources, cli_searched)
        };
        Ok(match r {
            Ok(t) => json!({"ok": true, "text": t, "sources": sources, "searched": searched,
                "unread": session.map(|s| crate::brain::take_unread(&h, s)).unwrap_or_default()}),
            Err(e) => json!({"ok": false, "error": e}),
        })
    }));
    let h = app.clone();
    // a file dropped on Pony's chat: a picture (base64, to shrink in the window) or a text file's text
    reg.add("pony.file", Box::new(move |_, a| {
        let _ = &h;
        let path = std::path::PathBuf::from(a.first().and_then(Value::as_str).unwrap_or(""));
        Ok(chat_file(&path))
    }));
    let h = app.clone();
    reg.add("translate.translate", Box::new(move |_, a| {
        let s = |i: usize| a.get(i).and_then(Value::as_str).unwrap_or("").to_string();
        let (text, from, to) = (s(0), s(1), s(2));
        Ok(match ask(&h, "translateAgent", &translate_prompt(&text, &from, if to.is_empty() { "English" } else { &to }), "You translate text. Reply with the translation only.", false) {
            Ok(t) => json!({"ok": true, "text": t}),
            Err(e) => json!({"ok": false, "error": e}),
        })
    }));
    let h = app.clone();
    reg.add("lyrics.romanize", Box::new(move |_, a| {
        let lines: Vec<String> = a.first().and_then(Value::as_array).into_iter().flatten().map(|l| l.as_str().unwrap_or("").to_string()).collect();
        Ok(lyric_lines(&h, "roman", &lines, "Romanize each line: write how it sounds in Latin letters (Hepburn for Japanese, Revised Romanization for Korean, pinyin with tone marks for Chinese). A line already in Latin letters stays as it is.")
            .unwrap_or(Value::Null))
    }));
    let h = app.clone();
    reg.add("lyrics.translate", Box::new(move |_, a| {
        let o = a.first().cloned().unwrap_or(Value::Null);
        let lines: Vec<String> = o["lines"].as_array().into_iter().flatten().map(|l| l.as_str().unwrap_or("").to_string()).collect();
        let to = h.state::<App>().settings.get()["lyricsTranslateTo"].as_str().unwrap_or("English").to_string();
        let what = format!("Translate each line of the song “{}” by {} into {to}, keeping its meaning and feeling; a line already in {to} stays as it is.", o["title"].as_str().unwrap_or(""), o["artist"].as_str().unwrap_or(""));
        Ok(match lyric_lines(&h, &format!("trans:{to}"), &lines, &what) {
            Some(v) => json!({"ok": true, "lines": v}),
            None => json!({"ok": false}),
        })
    }));
}

/// A song's lines through the translate agent, one out for each in. One run at a time (a newer song stops the one
/// going on); what came back is kept in `<data>/agent-lyrics.json` (an agent run costs).
fn lyric_lines(app: &AppHandle, kind: &str, lines: &[String], what: &str) -> Option<Value> {
    if lines.is_empty() {
        return None;
    }
    // (all in Latin letters already: nothing to romanize)
    if kind == "roman" && lines.iter().all(|l| l.chars().all(|c| (c as u32) < 0x250 || !c.is_alphabetic())) {
        return Some(Value::from(lines.to_vec()));
    }
    use std::hash::{Hash, Hasher};
    let mut hs = std::collections::hash_map::DefaultHasher::new();
    (kind, lines).hash(&mut hs);
    let key = format!("{:x}", hs.finish());
    let st = app.state::<Agents>();
    let file = app.state::<App>().data_dir.join("agent-lyrics.json");
    {
        let mut cache = st.lyrics.lock().unwrap();
        if cache.is_empty() {
            *cache = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        }
        if let Some(v) = cache.get(&key) {
            return Some(v.clone());
        }
    }
    let slot = if kind == "roman" { &st.roman_run } else { &st.trans_run };
    *slot.lock().unwrap() = None; // (stops the run of this kind going on: it isn't the song playing now)
    let (t, _, _) = ask_in(app, "translateAgent", &lines_prompt(lines, what), &[], "You transform song lyrics line by line and reply with JSON only.", false, Some(slot), None, false).ok()?;
    let v = Value::from(lines_answer(&t, lines.len())?);
    let mut cache = st.lyrics.lock().unwrap();
    if cache.len() > 500 {
        cache.clear();
    }
    cache.insert(key, v.clone());
    let _ = services::paths::write_private(&file, &serde_json::to_vec(&*cache).unwrap_or_default());
    Some(v)
}

/// What a file dropped on Pony's chat holds, for the window: `{ok, name, size, kind: image|text|other, mime?, data?|text?, big?}`.
fn chat_file(path: &std::path::Path) -> Value {
    use base64::Engine;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if !path.is_absolute() || services::exec::secret_place(&path.to_string_lossy()).is_some() {
        return json!({"ok": false, "name": name});
    }
    let Ok(canon) = std::fs::canonicalize(path) else { return json!({"ok": false, "name": name}) };
    if services::exec::secret_place(&canon.to_string_lossy()).is_some() {
        return json!({"ok": false, "name": name});
    }
    let Ok(meta) = std::fs::metadata(&canon) else { return json!({"ok": false, "name": name}) };
    if !meta.is_file() {
        return json!({"ok": false, "name": name});
    }
    let size = meta.len();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let image = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "heic" | "heif" => Some("image/heic"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        _ => None,
    };
    if let Some(mime) = image {
        if size > 20 << 20 {
            return json!({"ok": true, "name": name, "size": size, "kind": "image", "big": true});
        }
        return match std::fs::read(path) {
            Ok(b) => json!({"ok": true, "name": name, "size": size, "kind": "image", "mime": mime, "data": base64::engine::general_purpose::STANDARD.encode(b)}),
            Err(_) => json!({"ok": false, "name": name}),
        };
    }
    const TEXT: &[&str] = &["txt", "md", "markdown", "csv", "tsv", "json", "log", "xml", "yaml", "yml", "toml", "ini", "html", "htm", "css",
        "js", "mjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "sql"];
    if TEXT.contains(&ext.as_str()) {
        if size > 200 << 10 {
            return json!({"ok": true, "name": name, "size": size, "kind": "text", "big": true});
        }
        return match std::fs::read(path) {
            Ok(b) => json!({"ok": true, "name": name, "size": size, "kind": "text", "text": String::from_utf8_lossy(&b)}),
            Err(_) => json!({"ok": false, "name": name}),
        };
    }
    json!({"ok": true, "name": name, "size": size, "kind": "other"})
}
