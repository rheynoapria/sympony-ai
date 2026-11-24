use serde_json::json;
use services::aiusage::*;

const T0: i64 = 1_795_000_000_000;

#[test]
fn claude_limits_become_rows() {
    let usage = json!({
        "five_hour": {"utilization": 52.0, "resets_at": "2026-11-19T04:20:00.478985+00:00"},
        "seven_day": {"utilization": 32.0, "resets_at": "2026-11-25T01:00:00+00:00"},
        "limits": [
            {"kind": "session", "percent": 52, "resets_at": "2026-11-19T04:20:00.478985+00:00", "scope": null},
            {"kind": "weekly_all", "percent": 32, "resets_at": "2026-11-25T01:00:00+00:00", "scope": null},
            {"kind": "weekly_scoped", "percent": 4, "resets_at": "2026-11-25T01:00:00+00:00", "scope": {"model": {"display_name": "Fable"}}},
            {"kind": "something_new", "percent": 9, "resets_at": null}
        ],
        "weekly_scoped_shares": [{"limit_index": 2, "used_percent_of_weekly": 0, "allowance_percent_of_weekly": 50}]
    });
    let rows = claude_rows(&usage);
    assert_eq!(rows, vec![
        json!({"kind": "session", "hours": 5, "pct": 52.0, "resetsAt": 1_795_062_000_478i64}),
        json!({"kind": "week", "pct": 32.0, "resetsAt": 1_795_568_400_000i64}),
        json!({"kind": "week", "pct": 4.0, "resetsAt": 1_795_568_400_000i64, "model": "Fable", "share": 50.0}),
    ]);
    // an older answer without limits: the two windows
    let old = json!({"five_hour": usage["five_hour"], "seven_day": usage["seven_day"], "seven_day_opus": null});
    assert_eq!(claude_rows(&old), rows[..2].to_vec());
    assert!(claude_rows(&json!({})).is_empty());
}

#[test]
fn claude_sign_in_and_plan() {
    let file = r#"{"claudeAiOauth": {"accessToken": "tok", "expiresAt": 1795060364975, "subscriptionType": "max", "rateLimitTier": "default_claude_max_20x"}}"#;
    let o = claude_oauth(file).unwrap();
    assert_eq!((o.token.as_str(), o.expires_at, o.plan.as_str()), ("tok", 1795060364975, "Max 20x"));
    assert_eq!(claude_oauth(r#"{"claudeAiOauth": {"accessToken": "t", "subscriptionType": "team", "rateLimitTier": "default_claude_max_5x"}}"#).unwrap().plan, "Team");
    assert_eq!(claude_oauth(r#"{"claudeAiOauth": {"accessToken": "t", "subscriptionType": "max", "rateLimitTier": "default_claude_max_5x"}}"#).unwrap().plan, "Max 5x");
    assert!(claude_oauth(r#"{"claudeAiOauth": {}}"#).is_none());
    assert!(claude_oauth("not json").is_none());
}

#[test]
fn codex_reads_its_last_limits() {
    let log = [
        r#"{"timestamp":"2026-04-13T08:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":1.0,"window_minutes":300,"resets_at":1776085231}}}}"#,
        r#"{"timestamp":"2026-04-13T08:00:30.000Z","type":"event_msg","payload":{"type":"agent_message"}}"#,
        r#"{"timestamp":"2026-04-13T08:00:33.621Z","type":"event_msg","payload":{"type":"token_count","info":{},"rate_limits":{"primary":{"used_percent":7.5,"window_minutes":300,"resets_at":1776085231},"secondary":{"used_percent":0.0,"window_minutes":10080,"resets_in_seconds":600},"plan_type":"team"}}}"#,
        r#"{"timestamp":"2026-04-13T08:01:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{},"rate_limits":null}}"#,
        "broken line",
    ].join("\n");
    let (rows, plan, at) = codex_rows(&log).unwrap();
    // when the numbers are from (the event), not when they were read
    assert_eq!(at, Some(1_776_067_233_621));
    assert_eq!(plan.as_deref(), Some("Team"));
    assert_eq!(rows, vec![
        json!({"kind": "session", "hours": 5, "pct": 7.5, "resetsAt": 1_776_085_231_000i64}),
        // resets_in_seconds counts from the event's time
        json!({"kind": "week", "pct": 0.0, "resetsAt": 1_776_067_233_621i64 + 600_000}),
    ]);
    assert!(codex_rows("{}\n").is_none());
}

#[test]
fn a_session_warns_once() {
    let data = json!({
        "claude": {"rows": [{"kind": "session", "hours": 5, "pct": 91.0, "resetsAt": T0 + 3_600_000}, {"kind": "week", "pct": 95.0, "resetsAt": T0}]},
        "codex": {"rows": [{"kind": "session", "pct": 40.0, "resetsAt": T0 + 1}]}
    });
    let mut warned = std::collections::HashMap::new();
    assert!(alerts(&data, 0, T0, &mut warned).is_empty());
    let a = alerts(&data, 90, T0, &mut warned);
    assert_eq!(a, vec![json!({"service": "claude", "pct": 91.0, "resetsAt": T0 + 3_600_000})]);
    // not again in the same session
    assert!(alerts(&data, 90, T0, &mut warned).is_empty());
    // a session whose reset has passed doesn't warn
    let gone = json!({"claude": {"rows": [{"kind": "session", "pct": 99.0, "resetsAt": T0 - 1}]}});
    assert!(alerts(&gone, 80, T0, &mut warned).is_empty());
}

#[test]
fn the_same_session_a_moment_later_doesnt_warn_again() {
    // Codex's reset counted from each event: a few hundred ms apart, the same session
    let mut warned = std::collections::HashMap::new();
    let at = |t: i64| json!({"codex": {"rows": [{"kind": "session", "pct": 95.0, "resetsAt": t}]}});
    assert_eq!(alerts(&at(T0 + 3_600_000), 90, T0, &mut warned).len(), 1);
    assert!(alerts(&at(T0 + 3_600_437), 90, T0 + 60_000, &mut warned).is_empty());
    // the next session warns
    assert_eq!(alerts(&at(T0 + 3_600_000 + 5 * 3_600_000), 90, T0 + 3_700_000, &mut warned).len(), 1);
}

#[test]
fn unknown_limits_fall_back_to_the_windows() {
    let u = json!({"limits": [{"kind": "brand_new", "percent": 3}], "five_hour": {"utilization": 10.0, "resets_at": null}});
    assert_eq!(claude_rows(&u), vec![json!({"kind": "session", "hours": 5, "pct": 10.0})]);
}

#[test]
fn a_short_codex_window_is_at_least_an_hour() {
    let log = r#"{"timestamp":"2026-04-13T08:00:33.621Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":5.0,"window_minutes":30,"resets_at":1}}}}"#;
    assert_eq!(codex_rows(log).unwrap().0[0]["hours"], 1);
}

#[test]
fn a_big_log_is_read_from_its_end() {
    let dir = std::env::temp_dir().join(format!("sy-aiu-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("rollout-x.jsonl");
    let early = r#"{"timestamp":"2026-04-13T08:00:00.000Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":1.0,"window_minutes":300,"resets_at":1}}}}"#;
    let late = r#"{"timestamp":"2026-04-13T09:00:00.000Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":42.0,"window_minutes":300,"resets_at":2}}}}"#;
    let filler = format!("{{\"payload\":{{\"type\":\"x\",\"t\":\"{}\"}}}}\n", "y".repeat(1000));
    std::fs::write(&p, format!("{early}\n{}{late}\n", filler.repeat(3000))).unwrap();
    let tail = read_tail(&p, 256 * 1024).unwrap();
    assert!(tail.len() <= 256 * 1024 && !tail.contains("used_percent\":1.0"));
    assert_eq!(codex_rows(&tail).unwrap().0[0]["pct"], 42.0);
    // a small file whole
    std::fs::write(&p, early).unwrap();
    assert_eq!(read_tail(&p, 256 * 1024).unwrap(), early);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn claude_oauth_decodes_hex_encoded_keychain_output() {
    let raw = r#"{"claudeAiOauth": {"accessToken": "tok-hex", "expiresAt": 1795060364975, "subscriptionType": "team", "rateLimitTier": "default_claude_max_5x"}}"#;
    let hex: String = raw.as_bytes().iter().map(|b| format!("{b:02x}")).collect();
    let o = claude_oauth(&hex).unwrap();
    assert_eq!((o.token.as_str(), o.expires_at, o.plan.as_str()), ("tok-hex", 1795060364975, "Team"));
}

#[test]
fn claude_keychain_items_includes_hashed_config_dir_and_default() {
    assert_eq!(claude_keychain_items(None), vec!["Claude Code-credentials"]);
    let items = claude_keychain_items(Some("/Users/rheynoapria/.claude"));
    assert_eq!(items.len(), 2);
    assert_eq!(items[0], "Claude Code-credentials-299c9412");
    assert_eq!(items[1], "Claude Code-credentials");
}

#[test]
fn pick_freshest_oauth_prefers_unexpired_over_expired() {
    let expired = Oauth { token: "old".into(), expires_at: T0 - 1_000, plan: "Team".into() };
    let fresh = Oauth { token: "new".into(), expires_at: T0 + 3_600_000, plan: "Team".into() };
    let newer = Oauth { token: "newer".into(), expires_at: T0 + 7_200_000, plan: "Max 5x".into() };
    assert_eq!(pick_freshest_oauth(Some(expired.clone()), Some(fresh.clone()), T0), Some(fresh.clone()));
    assert_eq!(pick_freshest_oauth(Some(fresh.clone()), Some(expired.clone()), T0), Some(fresh.clone()));
    assert_eq!(pick_freshest_oauth(Some(fresh), Some(newer.clone()), T0), Some(newer));
}

#[test]
fn claude_cli_rows_parses_usage_command_output() {
    let out = "\x1b[1mYou are currently using your subscription to power your Claude Code usage\x1b[0m\n\n\
Current session: 63% used · resets Nov 24 at 7:30pm (Asia/Jakarta)\n\
Current week (all models): 86% used · resets Nov 25 at 7:59am (Asia/Jakarta)\n\
Current week (Fable): 0% used · resets Nov 25 at 8am (Asia/Jakarta)\n\n\
Last 24h · 654 requests · 1 session\n";
    assert_eq!(
        claude_cli_rows(out),
        vec![
            json!({"kind": "session", "hours": 5, "pct": 63.0}),
            json!({"kind": "week", "pct": 86.0}),
            json!({"kind": "week", "pct": 0.0, "model": "Fable"}),
        ]
    );
    assert!(claude_cli_rows("not logged in").is_empty());
}
