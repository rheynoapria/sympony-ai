//! Outside tools: external MCP servers connected to Pony (Settings → Pony Assistant → Abilities).
//! Servers are `ponyMcp` in settings
//! (`[{id, name, on, kind: stdio|http, command, args, url, mode: ask|allow, allowTools}]`), their environment values
//! and headers the secret `ponyMcpSecrets` (`{<id>: {env: {}, headers: {}}}`). A stdio server starts on first use and
//! keeps running until it sits idle for 10 minutes. Every engine gets the tools: Pony's own engine directly, a CLI
//! agent through Sympony's MCP server (mcp.rs). A call asks first on a card unless the server or the tool is allowed;
//! a tool whose name says it deletes always asks.
use serde_json::{json, Value};
use services::mcp_client::{self, Client, Spec};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{apply_settings_patch, App};

const SECRETS: &str = "ponyMcpSecrets";
const CONNECT: Duration = Duration::from_secs(60);
const CALL: Duration = Duration::from_secs(60);
const IDLE: Duration = Duration::from_secs(600);
/// Outside tools in one request at most.
const MAX_TOOLS: usize = 80;

struct Conn {
    client: Client,
    used: Mutex<Instant>,
}

#[derive(Default)]
pub struct Out {
    conns: Mutex<HashMap<String, Arc<Conn>>>,
    /// per server: "starting" | "ready" | "failed", and the error
    state: Mutex<HashMap<String, (String, String)>>,
    /// one connect at a time per server
    connecting: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

/// What the model's tool name stands for.
#[derive(Clone)]
pub struct Target {
    pub id: String,
    pub server: String,
    pub tool: String,
}

fn servers(app: &AppHandle) -> Vec<Value> {
    app.state::<App>().settings.get()["ponyMcp"].as_array().cloned().unwrap_or_default()
}

fn secrets(app: &AppHandle) -> Value {
    app.state::<App>().settings.secret_value(SECRETS).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(json!({}))
}

fn pairs(v: &Value) -> Vec<(String, String)> {
    v.as_object().into_iter().flatten().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect()
}

fn spec(app: &AppHandle, s: &Value) -> Result<Spec, String> {
    let sec = &secrets(app)[s["id"].as_str().unwrap_or("")];
    if s["kind"] == "http" {
        let url = s["url"].as_str().unwrap_or("").trim().to_string();
        if !services::http::safe_endpoint_url(&url) {
            return Err("The address must start with https://".into());
        }
        return Ok(Spec::Http { url, headers: pairs(&sec["headers"]) });
    }
    let command = s["command"].as_str().unwrap_or("").trim().to_string();
    if command.is_empty() {
        return Err("No command".into());
    }
    let args = s["args"].as_array().into_iter().flatten().filter_map(|a| a.as_str().map(String::from)).collect();
    Ok(Spec::Stdio { command, args, env: pairs(&sec["env"]), path: crate::agents::path().to_string() })
}

fn set_state(app: &AppHandle, id: &str, st: &str, err: &str) {
    app.state::<Out>().state.lock().unwrap().insert(id.to_string(), (st.into(), err.into()));
    let _ = app.emit("pony:mcp", json!({"id": id, "state": st, "error": err}));
}

/// The server connected, starting it when it isn't running.
fn conn(app: &AppHandle, s: &Value) -> Result<Arc<Conn>, String> {
    let id = s["id"].as_str().unwrap_or("").to_string();
    let out = app.state::<Out>();
    let gate = out.connecting.lock().unwrap().entry(id.clone()).or_default().clone();
    let _one = gate.lock().unwrap();
    if let Some(c) = out.conns.lock().unwrap().get(&id).cloned() {
        if c.client.alive() {
            return Ok(c);
        }
    }
    out.conns.lock().unwrap().remove(&id);
    set_state(app, &id, "starting", "");
    let started = Instant::now();
    match spec(app, s).and_then(|sp| Client::connect(&sp, CONNECT)) {
        Ok(client) => {
            let c = Arc::new(Conn { client, used: Mutex::new(Instant::now()) });
            out.conns.lock().unwrap().insert(id.clone(), c.clone());
            set_state(app, &id, "ready", "");
            app.state::<App>().log.line(&format!("mcp out: {} ready ({:.1} s)", s["name"].as_str().unwrap_or(&id), started.elapsed().as_secs_f32()));
            Ok(c)
        }
        Err(e) => {
            set_state(app, &id, "failed", &e);
            app.state::<App>().log.line(&format!("mcp out: {} failed: {e}", s["name"].as_str().unwrap_or(&id)));
            Err(e)
        }
    }
}

/// Stops a server (turned off, changed or removed).
fn drop_conn(app: &AppHandle, id: &str) {
    app.state::<Out>().conns.lock().unwrap().remove(id);
    app.state::<Out>().state.lock().unwrap().remove(id);
}

/// The tools of every server that is on, as MCP lists them (`name` is the model's name), and what each name stands
/// for. Servers start here when they aren't running; one that fails is left out (Settings shows why).
pub fn tools(app: &AppHandle) -> (Vec<Value>, HashMap<String, Target>) {
    let on: Vec<Value> = servers(app).into_iter().filter(|s| s["on"] != false).collect();
    let found: Vec<(Value, Option<Arc<Conn>>)> = std::thread::scope(|sc| {
        let jobs: Vec<_> = on.iter().map(|s| sc.spawn(move || (s.clone(), conn(app, s).ok()))).collect();
        jobs.into_iter().filter_map(|j| j.join().ok()).collect()
    });
    let (mut list, mut map) = (vec![], HashMap::new());
    for (s, c) in found {
        let Some(c) = c else { continue };
        let server = s["name"].as_str().unwrap_or("server").to_string();
        for t in c.client.tools.iter() {
            if list.len() >= MAX_TOOLS {
                break;
            }
            let tool = t["name"].as_str().unwrap_or("").to_string();
            let name = mcp_client::tool_name(&server, &tool);
            if tool.is_empty() || map.contains_key(&name) {
                continue;
            }
            let about = format!("[{server}] {}", t["description"].as_str().unwrap_or("").trim());
            list.push(json!({"name": name, "description": about, "inputSchema": if t["inputSchema"].is_object() { t["inputSchema"].clone() } else { json!({"type": "object"}) }}));
            map.insert(name, Target { id: s["id"].as_str().unwrap_or("").into(), server: server.clone(), tool });
        }
    }
    (list, map)
}

/// As `tools`, for Pony's own engine (OpenAI function tools).
pub fn functions(app: &AppHandle) -> (Vec<Value>, HashMap<String, Target>) {
    let (list, map) = tools(app);
    let f = list.into_iter().map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}})).collect();
    (f, map)
}

/// Whether calling `tool` on server config `s` needs an approval card (returns `(needs_card, can_always)`).
/// Servers in `mode: "allow"` or tools listed in `allowTools` run without asking, unless the tool name deletes.
fn approval_policy(s: &Value, tool: &str) -> (bool, bool) {
    let deletes = mcp_client::deletes(tool);
    let allowed = s["mode"] == "allow" || s["allowTools"].as_array().is_some_and(|a| a.iter().any(|x| x == tool));
    (deletes || !allowed, !deletes)
}

/// One call, after the user's OK when the server asks first (or the tool deletes).
pub fn call(app: &AppHandle, session: &str, t: &Target, args: &Value) -> Result<String, String> {
    let Some(s) = servers(app).into_iter().find(|s| s["id"] == t.id.as_str() && s["on"] != false) else {
        return Err("That server was turned off".into());
    };
    let (needs_card, can_always) = approval_policy(&s, &t.tool);
    if needs_card {
        let deletes = !can_always;
        let detail = format!("{} · {}\n{}", t.server, t.tool, serde_json::to_string_pretty(args).unwrap_or_default());
        match crate::exec::approve(app, session, json!({"tool": if deletes { "mcp_delete" } else { "mcp" }, "detail": detail, "canAlways": can_always, "prefix": t.tool})).as_str() {
            "always" if can_always => remember_tool(app, &t.id, &t.tool),
            "once" | "always" => {}
            _ => return Err("The user said no. Don't try another way; ask them what they'd like instead.".into()),
        }
    }
    let _ = app.emit("agent:step", json!({"session": session, "kind": "mcp", "detail": format!("{} · {}", t.server, t.tool).chars().take(60).collect::<String>()}));
    let c = conn(app, &s)?;
    *c.used.lock().unwrap() = Instant::now();
    let started = Instant::now();
    let r = c.client.call(&t.tool, args, CALL, &|| crate::brain::stopped(app, session));
    *c.used.lock().unwrap() = Instant::now();
    // (the log names the server and the tool, never what went in or came out)
    app.state::<App>().log.line(&format!("mcp out: {} · {}: {} ({:.1} s)", t.server, t.tool, if matches!(r, Ok((_, false))) { "ok" } else { "failed" }, started.elapsed().as_secs_f32()));
    match r {
        Ok((text, false)) => Ok(text),
        Ok((text, true)) => Err(text),
        Err(e) => Err(e),
    }
}

fn remember_tool(app: &AppHandle, id: &str, tool: &str) {
    let mut all = servers(app);
    for s in all.iter_mut().filter(|s| s["id"] == id) {
        let mut list = s["allowTools"].as_array().cloned().unwrap_or_default();
        if !list.iter().any(|x| x == tool) {
            list.push(json!(tool));
        }
        s["allowTools"] = Value::from(list);
    }
    apply_settings_patch(app, json!({"ponyMcp": all}));
}

/// The servers for Settings: each with its state, error and tools.
fn listing(app: &AppHandle) -> Vec<Value> {
    let out = app.state::<Out>();
    let state = out.state.lock().unwrap().clone();
    let conns = out.conns.lock().unwrap().clone();
    let sec = secrets(app);
    servers(app)
        .into_iter()
        .map(|mut s| {
            let id = s["id"].as_str().unwrap_or("").to_string();
            let (st, err) = state.get(&id).cloned().unwrap_or_else(|| ("idle".into(), String::new()));
            let tools: Vec<Value> = conns.get(&id).map(|c| c.client.tools.iter()
                .map(|t| json!({"name": t["name"], "description": t["description"].as_str().unwrap_or("").chars().take(200).collect::<String>()})).collect()).unwrap_or_default();
            // (secrets show as their names only)
            s["envNames"] = Value::from(pairs(&sec[&id]["env"]).into_iter().map(|p| p.0).collect::<Vec<_>>());
            s["headerNames"] = Value::from(pairs(&sec[&id]["headers"]).into_iter().map(|p| p.0).collect::<Vec<_>>());
            s["state"] = json!(st);
            s["error"] = json!(err);
            s["tools"] = Value::from(tools);
            s
        })
        .collect()
}

fn new_id() -> String {
    format!("s{}", services::oauth::random().chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect::<String>().to_lowercase())
}

/// Adds or changes a server (`secret`: `{env, headers}`, or null to keep what's saved). Returns its id.
fn save(app: &AppHandle, mut server: Value, secret: Option<Value>) -> Result<String, String> {
    let name = server["name"].as_str().unwrap_or("").trim().to_string();
    if name.is_empty() {
        return Err("Give the server a name".into());
    }
    let id = server["id"].as_str().filter(|i| !i.is_empty()).map(String::from).unwrap_or_else(new_id);
    let mut all = servers(app);
    if all.iter().any(|s| s["id"] != id.as_str() && s["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(&name))) {
        return Err(format!("There is a server named {name} already"));
    }
    let old = all.iter().find(|s| s["id"] == id.as_str()).cloned().unwrap_or(json!({}));
    let kind = if server["kind"] == "http" { "http" } else { "stdio" };
    let clean = json!({"id": id, "name": name, "on": server["on"] != false, "kind": kind,
        "command": server["command"].as_str().unwrap_or("").trim(), "args": server["args"].as_array().cloned().unwrap_or_default(),
        "url": server["url"].as_str().unwrap_or("").trim(), "mode": if server["mode"] == "allow" { "allow" } else { "ask" },
        "allowTools": if server["allowTools"].is_array() { server["allowTools"].take() } else { old["allowTools"].clone() }});
    spec_check(&clean)?;
    // (the mode or the allowed tools changing doesn't restart it)
    let restart = secret.is_some() || ["on", "kind", "command", "args", "url"].iter().any(|k| old[*k] != clean[*k]);
    match all.iter_mut().find(|s| s["id"] == id.as_str()) {
        Some(s) => *s = clean,
        None => all.push(clean),
    }
    if let Some(sec) = secret {
        let mut every = secrets(app);
        every[&id] = json!({"env": sec["env"].as_object().cloned().unwrap_or_default(), "headers": sec["headers"].as_object().cloned().unwrap_or_default()});
        app.state::<App>().settings.secret(SECRETS, &every.to_string()).map_err(|e| e.to_string())?;
    }
    apply_settings_patch(app, json!({"ponyMcp": all}));
    if restart {
        drop_conn(app, &id);
    }
    Ok(id)
}

fn spec_check(s: &Value) -> Result<(), String> {
    if s["kind"] == "http" {
        let u = s["url"].as_str().unwrap_or("");
        if !services::http::safe_endpoint_url(u) {
            return Err("The address must start with https://".into());
        }
    } else if s["command"].as_str().unwrap_or("").is_empty() {
        return Err("Write the command that starts the server".into());
    }
    Ok(())
}

fn remove(app: &AppHandle, id: &str) {
    let all: Vec<Value> = servers(app).into_iter().filter(|s| s["id"] != id).collect();
    let mut every = secrets(app);
    if let Some(m) = every.as_object_mut() {
        m.remove(id);
    }
    let _ = app.state::<App>().settings.secret(SECRETS, &every.to_string());
    apply_settings_patch(app, json!({"ponyMcp": all}));
    drop_conn(app, id);
}

/// The servers in Claude Desktop's and Claude Code's settings.
fn found_elsewhere() -> Vec<Value> {
    let home = std::env::var("HOME").unwrap_or_default();
    let read = |p: String| std::fs::read(p).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).unwrap_or(Value::Null);
    #[cfg(target_os = "macos")]
    let desktop = read(format!("{home}/Library/Application Support/Claude/claude_desktop_config.json"));
    #[cfg(target_os = "windows")]
    let desktop = read(format!("{}/Claude/claude_desktop_config.json", std::env::var("APPDATA").unwrap_or_default()));
    #[cfg(all(unix, not(target_os = "macos")))]
    let desktop = read(format!("{home}/.config/Claude/claude_desktop_config.json"));
    mcp_client::importable(&desktop, &read(format!("{home}/.claude.json")))
}

/// Adds the servers picked (by name) from `found_elsewhere`, asking first, their environment and headers as secrets.
fn import(app: &AppHandle, names: &[String]) -> Vec<String> {
    let mut added = vec![];
    for f in found_elsewhere().into_iter().filter(|f| f["ok"] == true && names.iter().any(|n| f["name"] == n.as_str())) {
        let server = json!({"name": f["name"], "kind": f["kind"], "command": f["command"], "args": f["args"], "url": f["url"], "mode": "ask", "on": true});
        let secret = json!({"env": f["env"], "headers": f["headers"]});
        if save(app, server, Some(secret)).is_ok() {
            added.push(f["name"].as_str().unwrap_or("").to_string());
        }
    }
    added
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(Out::default());
    // (idle servers stop after 10 minutes)
    let h = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        h.state::<Out>().conns.lock().unwrap().retain(|id, c| {
            let keep = c.used.lock().unwrap().elapsed() < IDLE;
            if !keep {
                h.state::<Out>().state.lock().unwrap().remove(id);
            }
            keep
        });
    });
    let h = app.clone();
    reg.add("pony.mcpList", Box::new(move |_, _| Ok(Value::from(listing(&h)))));
    let h = app.clone();
    // (Settings' Connect / Try again: starts it now and answers with its tools)
    reg.add("pony.mcpConnect", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("");
        drop_conn(&h, id);
        let r = servers(&h).into_iter().find(|s| s["id"] == id).ok_or("no such server".to_string()).and_then(|s| conn(&h, &s).map(|_| ()));
        Ok(match r {
            Ok(()) => json!({"ok": true, "servers": listing(&h)}),
            Err(e) => json!({"ok": false, "error": e, "servers": listing(&h)}),
        })
    }));
    let h = app.clone();
    reg.add("pony.mcpSave", Box::new(move |_, a| {
        let server = a.first().cloned().unwrap_or(Value::Null);
        let secret = a.get(1).cloned().filter(|v| v.is_object());
        Ok(match save(&h, server, secret) {
            Ok(id) => json!({"ok": true, "id": id, "servers": listing(&h)}),
            Err(e) => json!({"ok": false, "error": e}),
        })
    }));
    let h = app.clone();
    reg.add("pony.mcpRemove", Box::new(move |_, a| {
        remove(&h, a.first().and_then(Value::as_str).unwrap_or(""));
        Ok(Value::from(listing(&h)))
    }));
    let h = app.clone();
    reg.add("pony.mcpFound", Box::new(move |_, _| {
        let have: Vec<String> = servers(&h).iter().filter_map(|s| s["name"].as_str().map(str::to_lowercase)).collect();
        // (what's found, without secrets: names of the environment values only)
        Ok(Value::from(found_elsewhere().into_iter().map(|f| json!({"name": f["name"], "kind": f["kind"], "from": f["from"], "ok": f["ok"],
            "what": if f["kind"] == "http" { f["url"].clone() } else { json!(format!("{} {}", f["command"].as_str().unwrap_or(""), f["args"].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(" ")).unwrap_or_default()).trim().to_string()) },
            "added": have.contains(&f["name"].as_str().unwrap_or("").to_lowercase())})).collect::<Vec<_>>()))
    }));
    let h = app.clone();
    reg.add("pony.mcpImport", Box::new(move |_, a| {
        let names: Vec<String> = a.first().and_then(Value::as_array).into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
        Ok(json!({"added": import(&h, &names), "servers": listing(&h)}))
    }));
}

#[cfg(test)]
mod tests {
    use super::approval_policy;
    use serde_json::json;

    #[test]
    fn mcp_allow_mode_and_allow_tools_skip_card_unless_delete() {
        let allow_srv = json!({"mode": "allow", "allowTools": []});
        assert_eq!(approval_policy(&allow_srv, "list_issues"), (false, true));
        assert_eq!(approval_policy(&allow_srv, "delete_issue"), (true, false));

        let ask_srv = json!({"mode": "ask", "allowTools": ["search_docs"]});
        assert_eq!(approval_policy(&ask_srv, "search_docs"), (false, true));
        assert_eq!(approval_policy(&ask_srv, "create_doc"), (true, true));
        assert_eq!(approval_policy(&ask_srv, "remove_doc"), (true, false));
    }
}
