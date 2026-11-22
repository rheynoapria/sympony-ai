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
#[derive(Clone)]
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

pub fn claude_oauth(text: &str) -> Option<Oauth> {
    let v: Value = serde_json::from_str(text).ok()?;
    let o = &v["claudeAiOauth"];
    let token = o["accessToken"].as_str().filter(|t| !t.is_empty())?.to_string();
    let kind = o["subscriptionType"].as_str().unwrap_or("");
    let tier = o["rateLimitTier"].as_str().unwrap_or("");
    let plan = if kind == "max" && tier.contains("20x") { "Max 20x".into() } else if kind == "max" && tier.contains("5x") { "Max 5x".into() } else { cap(kind) };
    Some(Oauth { token, expires_at: o["expiresAt"].as_i64().unwrap_or(0), plan })
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
