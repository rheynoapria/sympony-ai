use serde_json::json;
use services::tools::{handle, list, to_action};

#[test]
fn every_tool_has_a_schema() {
    let l = list();
    assert_eq!(l.len(), 23);
    for t in &l {
        assert!(t["name"].as_str().is_some_and(|n| !n.is_empty()));
        assert!(t["description"].as_str().is_some_and(|d| d.len() > 10));
        assert_eq!(t["inputSchema"]["type"], "object");
    }
}

#[test]
fn tools_list_has_pony_tools() {
    let l = list();
    let find = |n: &str| l.iter().find(|t| t["name"] == n).unwrap_or_else(|| panic!("missing tool {n}"));
    for name in ["read_skill", "read_skill_file", "save_skill", "remember", "recall", "forget", "ask_user"] {
        find(name);
    }
    let ask = find("ask_user");
    assert_eq!(ask["inputSchema"]["properties"]["questions"]["type"], "array");
}

#[test]
fn raw_tool_keeps_pipes() {
    let args = json!({"name": "my-skill", "description": "A | B", "body": "step 1 | step 2"});
    let (kind, raw) = to_action("save_skill", &args).unwrap();
    assert_eq!(kind, "save_skill");
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["body"], "step 1 | step 2");
    assert_eq!(parsed["description"], "A | B");

    let ask_args = json!({"questions": [{"header": "H", "question": "A | B?", "options": [{"label": "X | Y"}]}]});
    let (akind, araw) = to_action("ask_user", &ask_args).unwrap();
    assert_eq!(akind, "ask");
    let aparsed: serde_json::Value = serde_json::from_str(&araw).unwrap();
    assert_eq!(aparsed["questions"][0]["question"], "A | B?");
}

#[test]
fn calls_become_the_frontends_actions() {
    let a = |n: &str, v: serde_json::Value| to_action(n, &v).unwrap();
    assert_eq!(a("add_reminder", json!({"when": "15m", "what": "Stretch"})), ("remind".into(), "15m | Stretch".into()));
    assert_eq!(a("add_todo", json!({"what": "Buy milk"})), ("todo".into(), "Buy milk".into()));
    assert_eq!(a("add_repeating_todo", json!({"days": "daily", "time": "08:00", "what": "Pill"})), ("repeat".into(), "daily | 08:00 | Pill".into()));
    assert_eq!(a("change_repeat", json!({"id": "t1", "days": "none"})), ("repeat".into(), "t1 | none".into()));
    assert_eq!(a("change_repeat", json!({"id": "t1", "days": "mon,wed", "time": "07:30"})), ("repeat".into(), "t1 | mon,wed | 07:30".into()));
    // a part left out is kept ("-")
    assert_eq!(a("update_item", json!({"id": "t1", "text": "New"})), ("update".into(), "t1 | - | New".into()));
    assert_eq!(a("set_volume", json!({"level": 40})), ("volume".into(), "40".into()));
    assert_eq!(a("add_event", json!({"when": "2026-11-20 09:00", "duration": "1h", "title": "Dentist"})), ("event".into(), "2026-11-20 09:00 | 1h | Dentist".into()));
    assert_eq!(a("get_context", json!({})), ("context".into(), "".into()));
    // a | in the text can't split it into other fields
    assert_eq!(a("add_todo", json!({"what": "A | B"})), ("todo".into(), "A / B".into()));
    assert!(to_action("rm_rf", &json!({})).is_err());
    assert!(to_action("add_reminder", &json!({"what": "x"})).is_err());
}

#[test]
fn mcp_requests_answered() {
    let mut calls = vec![];
    let mut run = |k: &str, a: &str| {
        calls.push((k.to_string(), a.to_string()));
        Ok::<String, String>("Reminder set for 08:15".into())
    };
    let init = handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}), &mut run).unwrap();
    assert_eq!((init["id"].clone(), init["result"]["protocolVersion"].clone()), (json!(1), json!("2025-06-18")));
    assert!(init["result"]["capabilities"]["tools"].is_object());
    assert!(handle(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}), &mut run).is_none());
    let tl = handle(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}), &mut run).unwrap();
    assert_eq!(tl["result"]["tools"].as_array().unwrap().len(), 23);
    let r = handle(&json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "add_reminder", "arguments": {"when": "15m", "what": "Stretch"}}}), &mut run).unwrap();
    assert_eq!(r["result"]["content"][0], json!({"type": "text", "text": "Reminder set for 08:15"}));
    assert_eq!(r["result"]["isError"], false);
    let bad = handle(&json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "nope", "arguments": {}}}), &mut run).unwrap();
    assert_eq!(bad["result"]["isError"], true);
    let unknown = handle(&json!({"jsonrpc": "2.0", "id": 5, "method": "resources/list"}), &mut run).unwrap();
    assert_eq!(unknown["error"]["code"], -32601);
    assert_eq!(calls, vec![("remind".to_string(), "15m | Stretch".to_string())]);
}
