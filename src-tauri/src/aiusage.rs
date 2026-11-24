//! AI usage: the Claude and Codex plan limits for the tab, the ring in the closed notch and the warning
//! (services::aiusage reads the answers). Claude: Claude Code's own sign-in (the Keychain, else its
//! `.credentials.json`) asks Anthropic's usage endpoint, as Claude Code's /usage does; Codex: its session logs,
//! offline. Only a service that's on is read, and only while something shows it.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

/// The tab says it shows every minute; without that for this long it's gone.
const WATCH: Duration = Duration::from_secs(180);
/// Minimum interval between automatic `claude -p /usage` token-refresh invocations.
const CLI_REFRESH_COOLDOWN: Duration = Duration::from_secs(300);

#[derive(Default)]
pub struct AiUsage {
    data: Mutex<serde_json::Map<String, Value>>,
    watched: Mutex<Option<Instant>>,
    kick: AtomicBool,
    warned: Mutex<HashMap<String, i64>>,
    /// the sign-in read last, kept till it expires or is refused (so the Keychain is asked rarely)
    oauth: Mutex<Option<services::aiusage::Oauth>>,
    /// last time we asked `claude -p /usage` to refresh an expired OAuth sign-in
    last_cli_refresh: Mutex<Option<Instant>>,
    /// the Keychain was asked / said no (turning Claude off and on asks again)
    asked: AtomicBool,
    denied: AtomicBool,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn claude_config_dir() -> Option<String> {
    std::env::var("CLAUDE_CONFIG_DIR").ok().filter(|s| !s.trim().is_empty())
}

fn claude_file() -> PathBuf {
    claude_config_dir().map(PathBuf::from).unwrap_or_else(|| home().join(".claude")).join(".credentials.json")
}

fn codex_sessions() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".codex")).join("sessions")
}

/// `security`, given a minute (macOS may be asking the user); after that it counts as a no.
#[cfg(target_os = "macos")]
fn security(args: &[&str]) -> std::io::Result<std::process::Output> {
    use std::process::Stdio;
    let mut c = std::process::Command::new("/usr/bin/security").args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let t = Instant::now();
    while c.try_wait()?.is_none() {
        if t.elapsed() > Duration::from_secs(60) {
            let _ = c.kill();
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    c.wait_with_output()
}

#[cfg(target_os = "macos")]
fn claude_keychain_exists() -> bool {
    let dir = claude_config_dir();
    services::aiusage::claude_keychain_items(dir.as_deref())
        .iter()
        .any(|item| security(&["find-generic-password", "-s", item]).is_ok_and(|o| o.status.success()))
}

#[cfg(not(target_os = "macos"))]
fn claude_keychain_exists() -> bool {
    false
}

/// Finds the `claude` CLI binary across macOS/Linux (using login-shell PATH) and Windows.
fn find_claude_bin() -> Option<PathBuf> {
    #[cfg(not(target_os = "windows"))]
    {
        crate::agents::which("claude")
    }
    #[cfg(target_os = "windows")]
    {
        let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|p| std::env::split_paths(&p).collect())
            .unwrap_or_default();
        if let Some(h) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
            dirs.push(h.join(".local").join("bin"));
        }
        if let Some(a) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(a.join("npm"));
        }
        for d in dirs {
            for name in ["claude.exe", "claude.cmd", "claude"] {
                let p = d.join(name);
                if p.is_file() {
                    return Some(p);
                }
            }
        }
        None
    }
}

/// Runs Claude Code's built-in `/usage` slash command (zero LLM tokens) to let Claude Code refresh its own expired
/// OAuth access token in Keychain / `.credentials.json` and returns its stdout as an optional fallback.
fn refresh_claude_via_cli() -> Option<String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    let bin = find_claude_bin()?;
    let mut cmd = Command::new(&bin);
    cmd.args(["-p", "/usage", "--no-session-persistence", "--tools", "", "--max-turns", "1"]);
    #[cfg(not(target_os = "windows"))]
    cmd.env("PATH", crate::agents::path());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    platform::process::own_group(cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()));
    let mut child = cmd.spawn().ok()?;
    let pid = child.id();
    let stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.take(512 * 1024).read_to_end(&mut buf);
        String::from_utf8_lossy(&buf).into_owned()
    });
    let start = Instant::now();
    let ok = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.success(),
            Ok(None) if start.elapsed() < Duration::from_secs(20) => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                platform::process::kill_group(pid);
                let _ = child.wait();
                return None;
            }
        }
    };
    let out = reader.join().ok().unwrap_or_default();
    if ok { Some(out) } else { None }
}

fn try_cli_refresh(u: &AiUsage) -> Option<String> {
    {
        let mut last = u.last_cli_refresh.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < CLI_REFRESH_COOLDOWN) {
            return None;
        }
        *last = Some(Instant::now());
    }
    refresh_claude_via_cli()
}

/// Claude Code's sign-in: Err("notfound" | "denied").
fn claude_sign_in(u: &AiUsage) -> Result<services::aiusage::Oauth, &'static str> {
    u.asked.store(true, Ordering::SeqCst);
    let now_ms = now();
    #[cfg(target_os = "macos")]
    let (kc_oauth, kc_denied) = {
        let mut kc_oauth: Option<services::aiusage::Oauth> = None;
        let mut kc_denied = false;
        let dir = claude_config_dir();
        for item in services::aiusage::claude_keychain_items(dir.as_deref()) {
            let out = security(&["find-generic-password", "-s", &item, "-w"]);
            match out {
                Ok(o) if o.status.success() => {
                    u.denied.store(false, Ordering::SeqCst);
                    if let Some(a) = services::aiusage::claude_oauth(String::from_utf8_lossy(&o.stdout).trim()) {
                        kc_oauth = services::aiusage::pick_freshest_oauth(kc_oauth, Some(a), now_ms);
                    }
                }
                Ok(o) if o.status.code() != Some(44) => {
                    // (44: errSecItemNotFound; anything else from the Keychain means access was denied/cancelled)
                    kc_denied = true;
                }
                _ => {}
            }
        }
        (kc_oauth, kc_denied)
    };
    #[cfg(not(target_os = "macos"))]
    let (kc_oauth, kc_denied): (Option<services::aiusage::Oauth>, bool) = (None, false);

    let file_oauth = std::fs::read_to_string(claude_file()).ok().and_then(|t| services::aiusage::claude_oauth(&t));
    // Never mask an explicit Keychain denial behind an already-expired `.credentials.json` file.
    if kc_denied && kc_oauth.is_none() {
        let file_fresh = file_oauth.as_ref().is_some_and(|a| a.expires_at == 0 || a.expires_at >= now_ms);
        if !file_fresh {
            u.denied.store(true, Ordering::SeqCst);
            return Err("denied");
        }
    }
    if let Some(best) = services::aiusage::pick_freshest_oauth(kc_oauth, file_oauth, now_ms) {
        return Ok(best);
    }
    if kc_denied {
        u.denied.store(true, Ordering::SeqCst);
        Err("denied")
    } else {
        Err("notfound")
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn fetch_claude_api(token: &str) -> Result<(u16, Value), String> {
    let auth = format!("Bearer {token}");
    services::http::get_json_with(
        "https://api.anthropic.com/api/oauth/usage",
        &[("Authorization", &auth), ("anthropic-beta", "oauth-2025-04-20")],
    )
    .map_err(|e| e.to_string())
}

/// Claude's numbers; a note (expired, error…) keeps the rows read before.
fn read_claude(u: &AiUsage, old: &Value) -> Value {
    let keep = |note: &str, plan: Option<&str>, err: Option<String>| {
        let mut v = json!({"rows": old["rows"].as_array().cloned().unwrap_or_default(), "updatedAt": old["updatedAt"], "note": note});
        if let Some(p) = plan.map(String::from).or_else(|| old["plan"].as_str().map(String::from)) {
            v["plan"] = json!(p);
        }
        if let Some(e) = err {
            v["error"] = json!(e);
        }
        v
    };
    let expired = |a: &services::aiusage::Oauth| a.expires_at > 0 && a.expires_at < now();
    let cli_fallback = |stdout: &str, plan: Option<&str>| -> Option<Value> {
        let rows = services::aiusage::claude_cli_rows(stdout);
        if rows.is_empty() {
            return None;
        }
        let mut v = json!({"rows": rows, "updatedAt": now()});
        if let Some(p) = plan.filter(|p| !p.is_empty()).map(String::from).or_else(|| old["plan"].as_str().map(String::from)) {
            v["plan"] = json!(p);
        }
        Some(v)
    };

    // the one kept, else (none, or it ran out: Claude Code may have refreshed it since) read again
    let kept = u.oauth.lock().unwrap().clone().filter(|a| !expired(a));
    let mut cli_out: Option<String> = None;
    let mut sign_in = kept.map(Ok).unwrap_or_else(|| claude_sign_in(u));

    // When the short-lived access token expired (or macOS Keychain denied access after an update), ask Claude Code's
    // own zero-token `/usage` command to refresh its sign-in, then re-read Keychain/file (or parse its output).
    let needs_refresh = match &sign_in {
        Ok(a) => expired(a),
        Err("denied") => true,
        Err(_) => false,
    };
    if needs_refresh {
        if let Some(out) = try_cli_refresh(u) {
            cli_out = Some(out);
            sign_in = claude_sign_in(u);
        }
    }

    let a = match sign_in {
        Ok(a) if !expired(&a) => a,
        Ok(a) => {
            *u.oauth.lock().unwrap() = None;
            if let Some(v) = cli_out.as_deref().and_then(|s| cli_fallback(s, Some(&a.plan))) {
                return v;
            }
            return keep("expired", Some(&a.plan), None);
        }
        Err(n) => {
            if let Some(v) = cli_out.as_deref().and_then(|s| cli_fallback(s, None)) {
                u.denied.store(false, Ordering::SeqCst);
                return v;
            }
            return json!({"rows": [], "note": n});
        }
    };

    *u.oauth.lock().unwrap() = Some(a.clone());
    match fetch_claude_api(&a.token) {
        Ok((200, v)) => {
            let rows = services::aiusage::claude_rows(&v);
            if rows.is_empty() {
                return keep("error", Some(&a.plan), Some("an answer Sympony doesn't know".into()));
            }
            json!({"rows": rows, "plan": a.plan, "updatedAt": now()})
        }
        Ok((401, _)) | Ok((403, _)) => {
            *u.oauth.lock().unwrap() = None;
            // Token revoked/rotated early: ask Claude Code to refresh once, then retry API or use CLI output.
            if cli_out.is_none() {
                if let Some(out) = try_cli_refresh(u) {
                    if let Ok(fresh) = claude_sign_in(u) {
                        if !expired(&fresh) && fresh.token != a.token {
                            *u.oauth.lock().unwrap() = Some(fresh.clone());
                            if let Ok((200, v)) = fetch_claude_api(&fresh.token) {
                                let rows = services::aiusage::claude_rows(&v);
                                if !rows.is_empty() {
                                    return json!({"rows": rows, "plan": fresh.plan, "updatedAt": now()});
                                }
                            }
                        }
                    }
                    if let Some(v) = cli_fallback(&out, Some(&a.plan)) {
                        return v;
                    }
                }
            }
            keep("expired", Some(&a.plan), None)
        }
        Ok((s, _)) => keep("error", Some(&a.plan), Some(format!("HTTP {s}"))),
        Err(e) => keep("error", Some(&a.plan), Some(e)),
    }
}

/// Codex's session logs, newest first (by when they were written).
fn codex_logs() -> Vec<PathBuf> {
    fn walk(d: &std::path::Path, out: &mut Vec<(std::time::SystemTime, PathBuf)>) {
        for e in std::fs::read_dir(d).into_iter().flatten().flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            // (not through links: a loop would never end)
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                walk(&p, out);
            } else if name.starts_with("rollout-") && name.ends_with(".jsonl") {
                out.push((e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH), p));
            }
        }
    }
    // ponytail: walks every log each minute; fine for hundreds, look only at the newest day's folder if it grows slow
    let mut v = vec![];
    walk(&codex_sessions(), &mut v);
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().map(|x| x.1).collect()
}

fn read_codex() -> Value {
    let logs = codex_logs();
    if logs.is_empty() {
        return json!({"rows": [], "note": "notfound"});
    }
    // (a session just started has no limits yet: the ones before it)
    for p in logs.iter().take(5) {
        if let Some((rows, plan, at)) = services::aiusage::read_tail(p, 256 * 1024).and_then(|t| services::aiusage::codex_rows(&t)) {
            // (when Codex wrote them: limits from months ago say so)
            let mut v = json!({"rows": rows, "updatedAt": at.unwrap_or_else(now)});
            if let Some(pl) = plan {
                v["plan"] = json!(pl);
            }
            return v;
        }
    }
    json!({"rows": [], "note": "nodata"})
}

fn send(app: &AppHandle) {
    let v = Value::Object(app.state::<AiUsage>().data.lock().unwrap().clone());
    let _ = app.emit("aiusage", v);
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(AiUsage::default());
    let h = app.clone();
    reg.add("aiusage.get", Box::new(move |_, _| Ok(Value::Object(h.state::<AiUsage>().data.lock().unwrap().clone()))));
    let h = app.clone();
    reg.add("aiusage.watch", Box::new(move |_, a| {
        let u = h.state::<AiUsage>();
        let on = a.first().and_then(Value::as_bool).unwrap_or(false);
        let mut w = u.watched.lock().unwrap();
        let needs_recover = {
            let d = u.data.lock().unwrap();
            let c = d.get("claude");
            c.is_some_and(|v| v["note"] == "expired" || v["rows"].as_array().is_none_or(Vec::is_empty))
        };
        if on && needs_recover {
            let mut last_cli = u.last_cli_refresh.lock().unwrap();
            if last_cli.is_some_and(|t| t.elapsed() >= Duration::from_secs(30)) {
                *last_cli = None;
            }
            u.kick.store(true, Ordering::SeqCst);
        }
        // (the tab just opened: read now)
        if on && w.is_none_or(|t| t.elapsed() > WATCH) {
            u.kick.store(true, Ordering::SeqCst);
        }
        *w = on.then(Instant::now);
        Ok(Value::Null)
    }));
    let h = app.clone();
    reg.add("aiusage.status", Box::new(move |_, _| {
        let u = h.state::<AiUsage>();
        // (without reading the secret: macOS asks for that, so it's only read once Claude is on)
        let item = claude_keychain_exists();
        let file = std::fs::read_to_string(claude_file()).ok().and_then(|t| services::aiusage::claude_oauth(&t));
        let codex = !codex_logs().is_empty();
        let (asked, denied) = (u.asked.load(Ordering::SeqCst), u.denied.load(Ordering::SeqCst));
        let d = u.data.lock().unwrap();
        let c = d.get("claude").cloned().unwrap_or(Value::Null);
        let has_live_rows = c["rows"].as_array().is_some_and(|r| !r.is_empty()) && c["note"].is_null();
        let plan = c["plan"].as_str().map(String::from).or_else(|| file.as_ref().map(|f| f.plan.clone())).filter(|p| !p.is_empty());
        let found = has_live_rows || (!denied && (file.is_some() || (item && asked)));
        Ok(json!({
            // found: readable (a Keychain item not read yet, or refused, isn't: Settings says why)
            "claude": {"found": found, "asked": asked, "denied": denied,
                "expired": !has_live_rows && c["note"] == "expired", "plan": plan},
            "codex": {"found": codex},
        }))
    }));
}

/// Every few seconds: what's on and shown is read when it's due (the tab: each minute; the ring / the warning only:
/// Claude every 5 minutes, Codex each minute); a service turned off drops its numbers.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last: [Option<Instant>; 2] = [None, None];
        let mut was_on = [false, false];
        loop {
            let s = app.state::<App>().settings.get();
            let u = app.state::<AiUsage>();
            let watched = u.watched.lock().unwrap().is_some_and(|t| t.elapsed() < WATCH);
            let kick = u.kick.swap(false, Ordering::SeqCst);
            let warn = s["aiUsageWarn"].as_u64().unwrap_or(0);
            let shown = watched || s["aiUsageMark"] != false || warn > 0;
            let mut changed = false;
            for (i, (k, key, every)) in [("claude", "aiUsageClaude", 300), ("codex", "aiUsageCodex", 60)].into_iter().enumerate() {
                let on = s[key] == true;
                if !on {
                    if u.data.lock().unwrap().remove(k).is_some() {
                        changed = true;
                    }
                    last[i] = None;
                    if k == "claude" {
                        *u.oauth.lock().unwrap() = None;
                        *u.last_cli_refresh.lock().unwrap() = None;
                    }
                } else if !was_on[i] && k == "claude" {
                    // (turned on again: the Keychain and CLI refresh may be tried again immediately)
                    u.denied.store(false, Ordering::SeqCst);
                    *u.last_cli_refresh.lock().unwrap() = None;
                }
                was_on[i] = on;
                let every = Duration::from_secs(if watched { 60 } else { every });
                // ponytail: a Keychain "no" is asked again only by turning Claude off and on, not every 5 minutes
                let denied = k == "claude" && u.denied.load(Ordering::SeqCst);
                if !on || !shown || denied || !(kick || last[i].is_none_or(|t| t.elapsed() >= every)) {
                    continue;
                }
                last[i] = Some(Instant::now());
                let old = u.data.lock().unwrap().get(k).cloned().unwrap_or(Value::Null);
                let v = if k == "claude" { read_claude(&u, &old) } else { read_codex() };
                let n = v["rows"].as_array().map_or(0, Vec::len);
                app.state::<App>().log.line(&format!("ai usage: {k}: {n} limits {} {}", v["note"].as_str().unwrap_or(""), v["error"].as_str().unwrap_or("")).trim_end());
                u.data.lock().unwrap().insert(k.to_string(), v);
                changed = true;
            }
            if changed {
                send(&app);
                let data = Value::Object(u.data.lock().unwrap().clone());
                for a in services::aiusage::alerts(&data, warn, now(), &mut u.warned.lock().unwrap()) {
                    let _ = app.emit("aiusage:alert", a);
                }
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}
