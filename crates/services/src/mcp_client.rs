//! An MCP client for external servers connected to Pony: stdio (a process, JSON-RPC one line each way) or
//! Streamable HTTP (a POST per message, answered as JSON or an event stream). `initialize`, `tools/list`, `tools/call`
//! and cancelling; plus what is pure: tool names for the model, a result as text, reading Claude's config files.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const PROTOCOL: &str = "2025-06-18";
/// Characters of a tool's result the model reads.
pub const MAX_RESULT: usize = 20_000;

/// How to reach a server.
#[derive(Debug, Clone, PartialEq)]
pub enum Spec {
    Stdio { command: String, args: Vec<String>, env: Vec<(String, String)>, path: String },
    Http { url: String, headers: Vec<(String, String)> },
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Value>>>>;

enum Link {
    Stdio { child: Child, stdin: Arc<Mutex<ChildStdin>>, pending: Pending, stderr: Arc<Mutex<String>>, ended: Arc<std::sync::atomic::AtomicBool> },
    Http { url: String, headers: Vec<(String, String)>, session: Mutex<Option<String>> },
}

/// One connected server: its tools as it listed them, and what it said about itself.
pub struct Client {
    link: Link,
    next: AtomicU64,
    pub tools: Vec<Value>,
    pub instructions: String,
}

impl Drop for Client {
    fn drop(&mut self) {
        if let Link::Stdio { child, .. } = &mut self.link {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn write_line(stdin: &Mutex<ChildStdin>, v: &Value) -> Result<(), String> {
    let mut s = stdin.lock().unwrap();
    writeln!(s, "{v}").and_then(|_| s.flush()).map_err(|_| "The server closed".to_string())
}

/// What a stdio server keeps of Sympony's own environment (the rest is cleared): where things are and how text reads,
/// never keys or tokens. Windows programs also need their system's places to start at all (Node and Python fail
/// without SYSTEMROOT; npx keeps its cache under APPDATA / LOCALAPPDATA).
fn inherited_env() -> Vec<&'static str> {
    let mut keys = vec!["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PATH"];
    if cfg!(windows) {
        keys.extend([
            "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "USERNAME", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
            "PROGRAMFILES", "PROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
        ]);
    }
    keys
}

impl Client {
    /// Starts or reaches the server, says hello and reads its tools, within `limit`.
    pub fn connect(spec: &Spec, limit: Duration) -> Result<Client, String> {
        let link = match spec {
            Spec::Stdio { command, args, env, path } => {
                let mut cmd = Command::new(command);
                cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
                // Clear parent process env so third-party stdio MCP servers never inherit unrelated API keys or tokens.
                cmd.env_clear();
                for k in inherited_env() {
                    if let Ok(v) = std::env::var(k) {
                        cmd.env(k, v);
                    }
                }
                if !path.is_empty() {
                    cmd.env("PATH", path);
                }
                for (k, v) in env {
                    cmd.env(k, v);
                }
                let mut child = cmd.spawn().map_err(|e| format!("Couldn’t start {command}: {e}"))?;
                let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("no stdin")?));
                let stdout = child.stdout.take().ok_or("no stdout")?;
                let pending: Pending = Default::default();
                let stderr = Arc::new(Mutex::new(String::new()));
                // (what the server says on stderr: its last lines explain a failure)
                if let Some(mut e) = child.stderr.take() {
                    let keep = stderr.clone();
                    std::thread::spawn(move || {
                        let mut buf = [0u8; 4096];
                        while let Ok(n) = e.read(&mut buf) {
                            if n == 0 {
                                break;
                            }
                            let mut k = keep.lock().unwrap();
                            k.push_str(&String::from_utf8_lossy(&buf[..n]));
                            if k.len() > 4000 {
                                let cut = k.len() - 2000;
                                let cut = (cut..k.len()).find(|i| k.is_char_boundary(*i)).unwrap_or(k.len());
                                k.drain(..cut);
                            }
                        }
                    });
                }
                // (answers go to whoever waits on that id; the server's own requests get answered here)
                let ended = Arc::new(std::sync::atomic::AtomicBool::new(false));
                let (p, w, e) = (pending.clone(), stdin.clone(), ended.clone());
                std::thread::spawn(move || {
                    const MAX_LINE: u64 = 8 << 20;
                    let mut reader = BufReader::new(stdout);
                    let mut buf = Vec::new();
                    loop {
                        buf.clear();
                        match reader.by_ref().take(MAX_LINE + 1).read_until(b'\n', &mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) if n as u64 > MAX_LINE => {
                                let mut discard = Vec::new();
                                while let Ok(k) = reader.by_ref().take(64 << 10).read_until(b'\n', &mut discard) {
                                    let done = k == 0 || discard.ends_with(b"\n");
                                    discard.clear();
                                    if done {
                                        break;
                                    }
                                }
                                continue;
                            }
                            Ok(_) => {}
                        }
                        let Ok(line) = std::str::from_utf8(&buf) else { continue };
                        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                        if v["method"].is_string() {
                            if !v["id"].is_null() {
                                let reply = if v["method"] == "ping" {
                                    json!({"jsonrpc": "2.0", "id": v["id"], "result": {}})
                                } else {
                                    json!({"jsonrpc": "2.0", "id": v["id"], "error": {"code": -32601, "message": "not supported"}})
                                };
                                let _ = write_line(&w, &reply);
                            }
                            continue;
                        }
                        if let Some(id) = v["id"].as_u64() {
                            if let Some(tx) = p.lock().unwrap().remove(&id) {
                                let _ = tx.send(v);
                            }
                        }
                    }
                    // (the server ended: everyone waiting hears so)
                    e.store(true, Ordering::SeqCst);
                    p.lock().unwrap().clear();
                });
                Link::Stdio { child, stdin, pending, stderr, ended }
            }
            Spec::Http { url, headers } => Link::Http { url: url.clone(), headers: headers.clone(), session: Mutex::new(None) },
        };
        let mut c = Client { link, next: AtomicU64::new(0), tools: vec![], instructions: String::new() };
        let started = Instant::now();
        let left = || limit.saturating_sub(started.elapsed());
        let init = c.request(
            "initialize",
            json!({"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "Sympony", "version": env!("CARGO_PKG_VERSION")}}),
            left(),
            &|| false,
        )?;
        c.instructions = init["instructions"].as_str().unwrap_or("").to_string();
        c.notify("notifications/initialized", json!({}));
        let mut cursor: Option<String> = None;
        for _ in 0..10 {
            let params = cursor.as_ref().map(|c| json!({"cursor": c})).unwrap_or(json!({}));
            let page = c.request("tools/list", params, left(), &|| false)?;
            c.tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            cursor = page["nextCursor"].as_str().map(String::from);
            if cursor.is_none() {
                break;
            }
        }
        Ok(c)
    }

    /// A tool call → (its text, whether the tool said it failed). `cancel` ends the wait (the server is told).
    pub fn call(&self, tool: &str, args: &Value, limit: Duration, cancel: &dyn Fn() -> bool) -> Result<(String, bool), String> {
        let r = self.request("tools/call", json!({"name": tool, "arguments": args}), limit, cancel)?;
        Ok((result_text(&r), r["isError"] == true))
    }

    /// Whether the server is still there (a stdio one that ended isn't).
    pub fn alive(&self) -> bool {
        match &self.link {
            Link::Stdio { ended, .. } => !ended.load(Ordering::SeqCst),
            Link::Http { .. } => true,
        }
    }

    fn notify(&self, method: &str, params: Value) {
        let msg = json!({"jsonrpc": "2.0", "method": method, "params": params});
        match &self.link {
            Link::Stdio { stdin, .. } => {
                let _ = write_line(stdin, &msg);
            }
            Link::Http { .. } => {
                let _ = self.post(&msg, Duration::from_secs(10));
            }
        }
    }

    fn request(&self, method: &str, params: Value, limit: Duration, cancel: &dyn Fn() -> bool) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let msg = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let reply = match &self.link {
            Link::Stdio { stdin, pending, stderr, .. } => {
                let (tx, rx) = channel();
                pending.lock().unwrap().insert(id, tx);
                write_line(stdin, &msg)?;
                let deadline = Instant::now() + limit;
                loop {
                    match rx.recv_timeout(Duration::from_millis(100)) {
                        Ok(v) => break v,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                            let why = last_line(&stderr.lock().unwrap());
                            return Err(if why.is_empty() { "The server stopped".into() } else { format!("The server stopped: {why}") });
                        }
                        Err(_) => {}
                    }
                    let stop = cancel();
                    if stop || Instant::now() >= deadline {
                        pending.lock().unwrap().remove(&id);
                        self.notify("notifications/cancelled", json!({"requestId": id, "reason": if stop { "stopped" } else { "timeout" }}));
                        return Err(if stop { "stopped".into() } else { format!("{method} took longer than {} s", limit.as_secs()) });
                    }
                }
            }
            // ponytail: an HTTP call isn't cut short by Stop (it ends within its limit); a thread per call if it matters
            Link::Http { .. } => self.post(&msg, limit)?,
        };
        if let Some(e) = reply.get("error").filter(|e| !e.is_null()) {
            return Err(e["message"].as_str().unwrap_or("The server refused").to_string());
        }
        Ok(reply["result"].clone())
    }

    /// One message over HTTP → the answer with its id (JSON or an event stream), or Null for a notification.
    fn post(&self, msg: &Value, limit: Duration) -> Result<Value, String> {
        let Link::Http { url, headers, session } = &self.link else { return Err("not http".into()) };
        let mut h: Vec<(String, String)> = headers.clone();
        h.push(("Accept".into(), "application/json, text/event-stream".into()));
        h.push(("MCP-Protocol-Version".into(), PROTOCOL.into()));
        if let Some(s) = session.lock().unwrap().clone() {
            h.push(("Mcp-Session-Id".into(), s));
        }
        let (status, sid, text) = crate::http::post_mcp(url, &h, msg, limit.as_secs().max(5)).map_err(|_| "Couldn’t reach the server".to_string())?;
        if let Some(s) = sid {
            *session.lock().unwrap() = Some(s);
        }
        if status == 401 || status == 403 {
            return Err("The server refused the sign-in (check its header in Settings)".into());
        }
        if !(200..300).contains(&status) {
            return Err(format!("The server answered {status}"));
        }
        if msg["id"].is_null() {
            return Ok(Value::Null);
        }
        let id = &msg["id"];
        text.lines()
            .filter_map(|l| l.strip_prefix("data:"))
            .filter_map(|d| serde_json::from_str::<Value>(d.trim()).ok())
            .find(|v| &v["id"] == id)
            .or_else(|| serde_json::from_str::<Value>(text.trim()).ok().filter(|v| &v["id"] == id))
            .ok_or_else(|| "The server answered oddly".to_string())
    }
}

fn last_line(t: &str) -> String {
    t.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("").chars().take(200).collect()
}

/// A `tools/call` result as the text the model reads (at most `MAX_RESULT` characters).
pub fn result_text(r: &Value) -> String {
    let mut parts: Vec<String> = vec![];
    for c in r["content"].as_array().into_iter().flatten() {
        match c["type"].as_str().unwrap_or("") {
            "text" => parts.push(c["text"].as_str().unwrap_or("").to_string()),
            "image" => parts.push(format!("[an image, {}]", c["mimeType"].as_str().unwrap_or("image"))),
            "audio" => parts.push("[a sound clip]".into()),
            "resource" => parts.push(c["resource"]["text"].as_str().map(String::from).unwrap_or_else(|| format!("[{}]", c["resource"]["uri"].as_str().unwrap_or("a file")))),
            "resource_link" => parts.push(format!("[{}: {}]", c["name"].as_str().unwrap_or("link"), c["uri"].as_str().unwrap_or(""))),
            _ => {}
        }
    }
    if parts.is_empty() && !r["structuredContent"].is_null() {
        parts.push(r["structuredContent"].to_string());
    }
    let text = parts.join("\n");
    if text.chars().count() > MAX_RESULT {
        format!("{}\n…(cut; the result was longer)", text.chars().take(MAX_RESULT).collect::<String>())
    } else if text.trim().is_empty() {
        "(no output)".into()
    } else {
        text
    }
}

fn clean(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect()
}

/// The name the model sees: `<server>__<tool>`, letters, digits, `_` and `-`, at most 64 characters.
pub fn tool_name(server: &str, tool: &str) -> String {
    let s: String = clean(server).chars().take(20).collect();
    let t: String = clean(tool).chars().take(64 - 2 - s.len()).collect();
    format!("{s}__{t}")
}

/// A tool whose name says it deletes: it always asks, and is never "always allowed".
pub fn deletes(tool: &str) -> bool {
    let t = tool.to_lowercase();
    ["delete", "remove", "drop", "destroy", "purge", "erase", "wipe", "trash"].iter().any(|w| t.contains(w))
}

/// The servers in Claude Desktop's and Claude Code's configs (their `mcpServers`), as Sympony would add them:
/// `{name, kind, command, args, env, url, headers, from, ok}` (`ok` false: a kind Sympony can't use, the old SSE).
pub fn importable(desktop: &Value, code: &Value) -> Vec<Value> {
    let mut out: Vec<Value> = vec![];
    for (from, cfg) in [("Claude Desktop", desktop), ("Claude Code", code)] {
        for (name, s) in cfg["mcpServers"].as_object().into_iter().flatten() {
            if out.iter().any(|o| o["name"] == name.as_str()) {
                continue;
            }
            let ty = s["type"].as_str().unwrap_or(if s["url"].is_string() { "http" } else { "stdio" });
            let kind = if ty == "stdio" { "stdio" } else { "http" };
            out.push(json!({"name": name, "kind": kind, "command": s["command"], "args": s["args"], "env": s["env"], "url": s["url"],
                "headers": s["headers"], "from": from, "ok": ty != "sse" && (s["command"].is_string() || s["url"].is_string())}));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The fake servers' interpreter: Windows names it `python`.
    fn python() -> String {
        if cfg!(windows) { "python" } else { "python3" }.into()
    }

    #[test]
    fn stdio_servers_inherit_places_not_secrets() {
        let keys = inherited_env();
        for k in &keys {
            let up = k.to_ascii_uppercase();
            assert!(!["KEY", "TOKEN", "SECRET", "PASS", "AUTH", "CRED"].iter().any(|s| up.contains(s)), "{k} looks like a secret");
        }
        // (without these, Windows programs such as node/npx and python don't start)
        #[cfg(windows)]
        for k in ["SYSTEMROOT", "TEMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "PATHEXT"] {
            assert!(keys.contains(&k), "{k} missing on Windows");
        }
    }

    /// A tiny MCP server on stdio (python3), enough for the client's round trips.
    const FAKE: &str = r#"
import sys, json, time
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m: continue
    meth = m["method"]
    if meth == "initialize": r = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "fake"}, "instructions": "hi"}
    elif meth == "tools/list" and not m["params"].get("cursor"): r = {"tools": [{"name": "echo", "inputSchema": {"type": "object"}}], "nextCursor": "2"}
    elif meth == "tools/list": r = {"tools": [{"name": "slow", "inputSchema": {"type": "object"}}]}
    elif m["params"]["name"] == "slow": time.sleep(5); r = {"content": []}
    else: r = {"content": [{"type": "text", "text": "you said " + m["params"]["arguments"]["text"]}], "isError": False}
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
"#;

    fn fake() -> Client {
        let spec = Spec::Stdio { command: python(), args: vec!["-I".into(), "-c".into(), FAKE.into()], env: vec![], path: String::new() };
        Client::connect(&spec, Duration::from_secs(10)).expect("fake server")
    }

    #[test]
    fn talks_to_a_stdio_server() {
        let c = fake();
        assert_eq!(c.instructions, "hi");
        let names: Vec<&str> = c.tools.iter().filter_map(|t| t["name"].as_str()).collect();
        assert_eq!(names, vec!["echo", "slow"]);
        assert_eq!(c.call("echo", &json!({"text": "halo"}), Duration::from_secs(5), &|| false).unwrap(), ("you said halo".to_string(), false));
        // (Stop ends the wait at once)
        let t = Instant::now();
        assert_eq!(c.call("slow", &json!({}), Duration::from_secs(30), &|| t.elapsed() > Duration::from_millis(300)).unwrap_err(), "stopped");
        assert!(t.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn a_server_that_wont_start_says_why() {
        let spec = Spec::Stdio { command: "/nonexistent/mcp".into(), args: vec![], env: vec![], path: String::new() };
        assert!(Client::connect(&spec, Duration::from_secs(2)).err().unwrap().starts_with("Couldn’t start"));
        let spec = Spec::Stdio { command: "sh".into(), args: vec!["-c".into(), "echo 'npm ERR! not found' >&2".into()], env: vec![], path: String::new() };
        assert_eq!(Client::connect(&spec, Duration::from_secs(5)).err().unwrap(), "The server stopped: npm ERR! not found");
    }

    #[test]
    fn talks_to_an_http_server() {
        use std::net::TcpListener;
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut st in l.incoming().flatten() {
                let mut r = BufReader::new(st.try_clone().unwrap());
                let (mut len, mut sid, mut auth) = (0usize, String::new(), String::new());
                loop {
                    let mut h = String::new();
                    if r.read_line(&mut h).unwrap_or(0) == 0 || h == "\r\n" {
                        break;
                    }
                    let low = h.to_lowercase();
                    if let Some(v) = low.strip_prefix("content-length:") { len = v.trim().parse().unwrap_or(0); }
                    if let Some(v) = low.strip_prefix("mcp-session-id:") { sid = v.trim().to_string(); }
                    if let Some(v) = low.strip_prefix("authorization:") { auth = v.trim().to_string(); }
                }
                let mut b = vec![0u8; len];
                r.read_exact(&mut b).unwrap();
                let m: Value = serde_json::from_slice(&b).unwrap();
                let (ctype, extra, body) = match m["method"].as_str().unwrap_or("") {
                    _ if auth != "bearer k" => ("application/json", "", String::new()),
                    "initialize" => ("application/json", "Mcp-Session-Id: s1\r\n", json!({"jsonrpc": "2.0", "id": m["id"], "result": {"capabilities": {}}}).to_string()),
                    "notifications/initialized" => ("application/json", "", String::new()),
                    "tools/list" => ("text/event-stream", "", format!("event: message\ndata: {}\n\n", json!({"jsonrpc": "2.0", "id": m["id"], "result": {"tools": [{"name": if sid == "s1" { "kept" } else { "lost" }}]}}))),
                    _ => ("application/json", "", json!({"jsonrpc": "2.0", "id": m["id"], "result": {"content": [{"type": "text", "text": "ok"}]}}).to_string()),
                };
                let status = if auth != "bearer k" { "401 No" } else if body.is_empty() { "202 Accepted" } else { "200 OK" };
                let _ = write!(st, "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        let url = format!("http://127.0.0.1:{port}/mcp");
        let spec = Spec::Http { url: url.clone(), headers: vec![("Authorization".into(), "Bearer k".into())] };
        let c = Client::connect(&spec, Duration::from_secs(5)).unwrap();
        assert_eq!(c.tools[0]["name"], "kept");
        assert_eq!(c.call("x", &json!({}), Duration::from_secs(5), &|| false).unwrap().0, "ok");
        let bad = Spec::Http { url, headers: vec![] };
        assert!(Client::connect(&bad, Duration::from_secs(5)).err().unwrap().contains("refused the sign-in"));
    }

    #[test]
    fn names_results_and_imports() {
        assert_eq!(tool_name("My Notion", "create.page"), "My_Notion__create_page");
        assert!(tool_name(&"s".repeat(40), &"t".repeat(80)).len() <= 64);
        assert!(deletes("delete_page") && deletes("RemoveItem") && !deletes("create_page"));
        let r = json!({"content": [{"type": "text", "text": "a"}, {"type": "image", "mimeType": "image/png", "data": "x"}, {"type": "resource", "resource": {"uri": "f://x", "text": "body"}}]});
        assert_eq!(result_text(&r), "a\n[an image, image/png]\nbody");
        assert_eq!(result_text(&json!({"structuredContent": {"n": 1}})), "{\"n\":1}");
        assert_eq!(result_text(&json!({"content": []})), "(no output)");
        assert!(result_text(&json!({"content": [{"type": "text", "text": "x".repeat(30_000)}]})).ends_with("(cut; the result was longer)"));
        let desktop = json!({"mcpServers": {"fs": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]}}});
        let code = json!({"mcpServers": {"fs": {"command": "other"}, "linear": {"type": "http", "url": "https://mcp.linear.app/mcp"}, "old": {"type": "sse", "url": "https://x/sse"}}});
        let all = importable(&desktop, &code);
        assert_eq!(all.len(), 3);
        assert_eq!((all[0]["name"].as_str(), all[0]["from"].as_str(), all[0]["kind"].as_str()), (Some("fs"), Some("Claude Desktop"), Some("stdio")));
        assert_eq!((all[1]["kind"].as_str(), all[1]["ok"].as_bool()), (Some("http"), Some(true)));
        assert_eq!(all[2]["ok"], false);
    }

    #[test]
    fn m03_stdio_server_does_not_inherit_parent_secret_env() {
        // Set an arbitrary secret env var in the parent process; stdio MCP servers must NOT inherit it,
        // while env vars explicitly configured in Spec::Stdio.env ARE visible.
        std::env::set_var("SYMPONY_TEST_PARENT_SECRET", "top-secret-parent-value");
        let script = r#"
import os, sys, json
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m: continue
    meth = m["method"]
    if meth == "initialize": r = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "envcheck"}}
    elif meth == "tools/list": r = {"tools": [{"name": "check", "inputSchema": {"type": "object"}}]}
    else:
        val = json.dumps({
            "leaked": os.environ.get("SYMPONY_TEST_PARENT_SECRET"),
            "explicit": os.environ.get("EXPLICIT_MCP_VAR")
        })
        r = {"content": [{"type": "text", "text": val}], "isError": False}
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
"#;
        let spec = Spec::Stdio {
            command: python(),
            args: vec!["-I".into(), "-c".into(), script.into()],
            env: vec![("EXPLICIT_MCP_VAR".into(), "allowed-value".into())],
            path: String::new(),
        };
        let c = Client::connect(&spec, Duration::from_secs(10)).expect("envcheck server");
        let (text, err) = c.call("check", &json!({}), Duration::from_secs(5), &|| false).unwrap();
        std::env::remove_var("SYMPONY_TEST_PARENT_SECRET");
        assert!(!err);
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert!(parsed["leaked"].is_null(), "parent secret leaked into stdio MCP server: {parsed}");
        assert_eq!(parsed["explicit"], "allowed-value");
    }

    /// Real servers: the official filesystem server (npx) and Paseo's HTTP MCP (bearer, read-only call).
    /// `cargo test -p services --lib mcp_client::tests::live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live() {
        let dir = std::env::temp_dir().join("sympony-mcp-live");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("note.txt"), "halo dari sympony").unwrap();
        let path = format!("/opt/homebrew/bin:/usr/local/bin:{}", std::env::var("PATH").unwrap_or_default());
        let spec = Spec::Stdio { command: "npx".into(), args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into(), dir.to_string_lossy().into()], env: vec![], path };
        let t = Instant::now();
        let c = Client::connect(&spec, Duration::from_secs(120)).expect("filesystem server");
        let names: Vec<&str> = c.tools.iter().filter_map(|t| t["name"].as_str()).collect();
        println!("filesystem: {} tools in {:.1} s: {names:?}", names.len(), t.elapsed().as_secs_f32());
        let real = dir.canonicalize().unwrap();
        let (text, err) = c.call("read_text_file", &json!({"path": real.join("note.txt")}), Duration::from_secs(30), &|| false).unwrap();
        println!("read_text_file → {text:?} (error: {err})");
        assert_eq!(text.trim(), "halo dari sympony");
        let (text, err) = c.call("read_text_file", &json!({"path": "/etc/hosts"}), Duration::from_secs(30), &|| false).unwrap();
        println!("outside its folder → {:?} (error: {err})", text.chars().take(120).collect::<String>());
        assert!(err);

        let home = std::path::PathBuf::from(std::env::var("HOME").unwrap()).join(".paseo");
        let cfg: Value = serde_json::from_str(&std::fs::read_to_string(home.join("paseo.pid")).unwrap()).unwrap();
        let url = format!("http://{}/mcp/agents", cfg["listen"].as_str().unwrap());
        let token = std::fs::read_to_string(home.join("local-credential")).unwrap();
        let spec = Spec::Http { url, headers: vec![("Authorization".into(), format!("Bearer {}", token.trim()))] };
        let c = Client::connect(&spec, Duration::from_secs(20)).expect("paseo http");
        println!("paseo: {} tools", c.tools.len());
        let (text, err) = c.call("list_agents", &json!({"limit": 2}), Duration::from_secs(20), &|| false).unwrap();
        println!("list_agents → {} chars (error: {err})", text.len());
        assert!(!err && text.contains("agents"));
    }
}
