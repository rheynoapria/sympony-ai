//! AI usage (pure): how much of the Claude and Codex plan limits is used, as the frontend's rows
//! (`{kind: session|week, hours?, pct, resetsAt (ms), model?, share?}`). Claude: Anthropic's `/api/oauth/usage`
//! answer (as Claude Code's /usage reads it); Codex: the `token_count` events in its session logs.
use serde_json::{json, Map, Value};
use std::collections::HashMap;

fn ms(v: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v.as_str()?).ok().map(|t| t.timestamp_millis())
}

fn row(kind: &str, pct: f64, resets: Option<i64>) -> Value {
    let mut r = Map::new();
    r.insert("kind".into(), json!(kind));
    if kind == "session" {
        r.insert("hours".into(), json!(5));
    }
    r.insert("pct".into(), json!(pct));
    if let Some(t) = resets {
        r.insert("resetsAt".into(), json!(t));
    }
    Value::Object(r)
}

/// Claude's limits: `limits` (the session, the whole week, a model's week with its share of it), else the older
/// `five_hour` / `seven_day`. A kind Sympony doesn't know is left out.
pub fn claude_rows(u: &Value) -> Vec<Value> {
    if let Some(limits) = u["limits"].as_array().filter(|l| !l.is_empty()) {
        let shares = u["weekly_scoped_shares"].as_array().cloned().unwrap_or_default();
        let rows: Vec<Value> = limits.iter().enumerate().filter_map(|(i, l)| {
            let pct = l["percent"].as_f64()?;
            let at = ms(&l["resets_at"]);
            match l["kind"].as_str()? {
                "session" => Some(row("session", pct, at)),
                "weekly_all" => Some(row("week", pct, at)),
                "weekly_scoped" => {
                    let mut r = row("week", pct, at);
                    if let Some(m) = l["scope"]["model"]["display_name"].as_str() {
                        r["model"] = json!(m);
                    }
                    if let Some(s) = shares.iter().find(|s| s["limit_index"].as_u64() == Some(i as u64)).and_then(|s| s["allowance_percent_of_weekly"].as_f64()) {
                        r["share"] = json!(s);
                    }
                    Some(r)
                }
                _ => None,
            }
        }).collect();
        // (none of them known: the older windows below)
        if !rows.is_empty() {
            return rows;
        }
    }
    [("five_hour", "session"), ("seven_day", "week")].iter()
        .filter_map(|(k, kind)| Some(row(kind, u[*k]["utilization"].as_f64()?, ms(&u[*k]["resets_at"]))))
        .collect()
}

/// Claude Code's sign-in (its Keychain item or `.credentials.json`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Oauth {
    pub token: String,
    /// ms; 0 when it doesn't say
    pub expires_at: i64,
    pub plan: String,
}

fn cap(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// Decodes even-length ASCII hex (macOS `security find-generic-password -w` outputs hex when a Keychain value
/// contains newlines or non-ASCII bytes).
fn decode_hex_utf8(s: &str) -> Option<String> {
    if s.len() < 4 || s.len() % 2 != 0 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for pair in s.as_bytes().chunks_exact(2) {
        let hex = std::str::from_utf8(pair).ok()?;
        out.push(u8::from_str_radix(hex, 16).ok()?);
    }
    String::from_utf8(out).ok()
}

pub fn claude_oauth(text: &str) -> Option<Oauth> {
    let trimmed = text.trim();
    let v: Value = serde_json::from_str(trimmed)
        .ok()
        .or_else(|| decode_hex_utf8(trimmed).and_then(|d| serde_json::from_str(&d).ok()))?;
    let o = &v["claudeAiOauth"];
    let token = o["accessToken"].as_str().filter(|t| !t.is_empty())?.to_string();
    let kind = o["subscriptionType"].as_str().unwrap_or("");
    let tier = o["rateLimitTier"].as_str().unwrap_or("");
    let plan = if kind == "max" && tier.contains("20x") { "Max 20x".into() } else if kind == "max" && tier.contains("5x") { "Max 5x".into() } else { cap(kind) };
    Some(Oauth { token, expires_at: o["expiresAt"].as_i64().unwrap_or(0), plan })
}

/// Keychain service names Claude Code uses: custom `CLAUDE_CONFIG_DIR` gets a `-<sha256[:8]>` suffix, alongside the
/// default `"Claude Code-credentials"`.
pub fn claude_keychain_items(config_dir: Option<&str>) -> Vec<String> {
    use sha2::{Digest, Sha256};
    let mut out = Vec::new();
    if let Some(dir) = config_dir.map(str::trim).filter(|d| !d.is_empty()) {
        let hash = Sha256::digest(dir.as_bytes());
        let suffix: String = hash[..4].iter().map(|b| format!("{b:02x}")).collect();
        out.push(format!("Claude Code-credentials-{suffix}"));
    }
    out.push("Claude Code-credentials".to_string());
    out
}

/// Picks the fresher OAuth credential between two sources (e.g. Keychain vs `.credentials.json`): an unexpired token
/// always beats an expired one; ties prefer the later `expires_at`.
pub fn pick_freshest_oauth(a: Option<Oauth>, b: Option<Oauth>, now_ms: i64) -> Option<Oauth> {
    let is_fresh = |o: &Oauth| o.expires_at == 0 || o.expires_at >= now_ms;
    match (a, b) {
        (Some(x), Some(y)) => match (is_fresh(&x), is_fresh(&y)) {
            (true, false) => Some(x),
            (false, true) => Some(y),
            _ => if y.expires_at > x.expires_at { Some(y) } else { Some(x) },
        },
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next();
            for ch in chars.by_ref() {
                if ('@'..='~').contains(&ch) {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Parses human-readable `claude -p /usage` stdout lines as a fallback when Keychain cannot be read directly:
///   Current session: 63% used · resets ...
///   Current week (all models): 86% used · resets ...
///   Current week (Sonnet): 12% used · resets ...
pub fn claude_cli_rows(stdout: &str) -> Vec<Value> {
    let clean = strip_ansi(stdout);
    let mut rows = Vec::new();
    for raw in clean.lines() {
        let line = raw.trim();
        let Some((head, rest)) = line.split_once(':') else { continue };
        let pct_str = rest.trim().split('%').next().unwrap_or("").trim();
        let Ok(pct) = pct_str.parse::<f64>() else { continue };
        if !pct.is_finite() || !(0.0..=100.0).contains(&pct) {
            continue;
        }
        let low = head.trim().to_ascii_lowercase();
        if low == "current session" {
            rows.push(row("session", pct, None));
        } else if let Some(inner) = head.trim().strip_prefix("Current week (").and_then(|s| s.strip_suffix(')'))
            .or_else(|| head.trim().strip_prefix("current week (").and_then(|s| s.strip_suffix(')')))
        {
            let mut r = row("week", pct, None);
            if !inner.eq_ignore_ascii_case("all models") && !inner.trim().is_empty() {
                r["model"] = json!(inner.trim());
            }
            rows.push(r);
        } else if low == "current week" {
            rows.push(row("week", pct, None));
        }
    }
    rows
}

/// The last `token_count` event with limits in a Codex session log: its rows (primary: the session of its window,
/// secondary: the week), the plan and when that event was (ms).
pub fn codex_rows(log: &str) -> Option<(Vec<Value>, Option<String>, Option<i64>)> {
    log.lines().rev().find_map(|line| {
        let v: Value = serde_json::from_str(line).ok()?;
        let p = &v["payload"];
        if p["type"] != "token_count" || !p["rate_limits"].is_object() {
            return None;
        }
        let rl = &p["rate_limits"];
        let at = ms(&v["timestamp"]);
        let rows: Vec<Value> = [("primary", "session"), ("secondary", "week")].iter().filter_map(|(k, kind)| {
            let w = &rl[*k];
            let pct = w["used_percent"].as_f64()?;
            let resets = w["resets_at"].as_i64().map(|s| s * 1000).or_else(|| Some(at? + w["resets_in_seconds"].as_i64()? * 1000));
            let mut r = row(kind, pct, resets);
            if *kind == "session" {
                if let Some(m) = w["window_minutes"].as_i64().filter(|m| *m > 0) {
                    r["hours"] = json!((m / 60).max(1));
                }
            }
            Some(r)
        }).collect();
        (!rows.is_empty()).then(|| (rows, rl["plan_type"].as_str().map(cap), at))
    })
}

/// The sessions (still running) at or over `warn` % not warned of yet: `{service, pct, resetsAt}` each, once per
/// service per session. `warned` keeps each service's last warned reset: one within 10 minutes of it is the same
/// session (Codex's reset is counted from each event, so it moves by a moment).
pub fn alerts(data: &Value, warn: u64, now: i64, warned: &mut HashMap<String, i64>) -> Vec<Value> {
    if warn == 0 {
        return vec![];
    }
    ["claude", "codex"].iter().filter_map(|k| {
        let r = data[*k]["rows"].as_array()?.iter().find(|r| r["kind"] == "session")?;
        let (pct, at) = (r["pct"].as_f64()?, r["resetsAt"].as_i64().unwrap_or(0));
        if pct < warn as f64 || at <= now || warned.get(*k).is_some_and(|w| (w - at).abs() < 600_000) {
            return None;
        }
        warned.insert(k.to_string(), at);
        Some(json!({"service": k, "pct": pct, "resetsAt": at}))
    }).collect()
}

/// A log's last `max` bytes, from its first whole line (Codex's logs grow to hundreds of MB; their limits are at
/// the end).
pub fn read_tail(path: &std::path::Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let from = len.saturating_sub(max);
    f.seek(SeekFrom::Start(from)).ok()?;
    let mut buf = vec![];
    f.take(max).read_to_end(&mut buf).ok()?;
    let mut s = String::from_utf8_lossy(&buf).into_owned();
    if from > 0 {
        s = s.split_once('\n').map(|x| x.1.to_string()).unwrap_or_default();
    }
    Some(s)
}
