//! An agent asking the user, under the notch: its hook's payload → the card (the frontend's Claude Code card, with the
//! agent's name), the card's answer → what the agent's hook prints. Claude Code's hooks put in and taken out of its
//! settings, and when a scheduled brief is due.
use serde_json::{json, Value};

const EVENTS: &[(&str, Option<&str>)] = &[("PermissionRequest", None), ("PreToolUse", Some("AskUserQuestion")), ("Stop", None), ("Notification", None)];
const MARK: &str = "--hook claude";

fn sanitize(s: &str) -> String {
    let invisible = |c: char| matches!(c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2069 | 0xFEFF);
    s.chars()
        .filter(|&c| !invisible(c))
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .filter(|&c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

fn short(s: &str, n: usize) -> String {
    let s = sanitize(s);
    if s.chars().count() <= n { s } else { format!("{}…", s.chars().take(n).collect::<String>()) }
}

fn agent_name(id: &str) -> &'static str {
    crate::agents::find(id).map(|a| a.name).unwrap_or("An agent")
}

/// What a tool call is about, in a line: the command, the file (from the project), the address… or serialized JSON
/// for custom/MCP tools; and whether it was cut to fit (then the card can't allow it: the user would approve what they can't see).
fn detail(input: &Value, cwd: &str) -> (String, bool) {
    let path = |p: &str| match std::path::Path::new(p).strip_prefix(cwd) {
        Ok(r) if !cwd.is_empty() => r.to_string_lossy().to_string(),
        _ => p.to_string(),
    };
    let d = input["command"].as_str().map(String::from)
        .or_else(|| input["file_path"].as_str().or(input["notebook_path"].as_str()).map(path))
        .or_else(|| input["url"].as_str().map(String::from))
        .or_else(|| input["pattern"].as_str().map(String::from))
        .or_else(|| input["description"].as_str().map(String::from))
        .or_else(|| input.as_object().filter(|o| !o.is_empty()).map(|_| input.to_string()))
        .unwrap_or_default();
    let clean = sanitize(&d);
    let cut = clean.chars().count() > 300;
    let shown = if cut { format!("{}…", clean.chars().take(300).collect::<String>()) } else { clean };
    (shown, cut)
}

/// The card for a hook (no id yet: the app gives it one). None: not something to show.
pub fn item(agent: &str, event: &str, p: &Value, answer: bool) -> Option<Value> {
    let cwd = p["cwd"].as_str().unwrap_or("");
    let project = std::path::Path::new(cwd).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let base = |kind: &str| json!({"agent": agent_name(agent), "kind": kind, "project": project, "answer": false});
    match event {
        "PermissionRequest" => {
            // (a payload that didn't come whole: nothing to show; a question or a plan needs its own answer, which
            // only the agent's window gives)
            let tool = p["tool_name"].as_str()?;
            if matches!(tool, "AskUserQuestion" | "ExitPlanMode") {
                return None;
            }
            let (d, cut) = detail(&p["tool_input"], cwd);
            let mut it = base("permission");
            it["tool"] = json!(tool);
            it["detail"] = json!(d);
            it["truncated"] = json!(cut);
            it["answer"] = json!(answer && !d.is_empty() && !cut);
            Some(it)
        }
        "PreToolUse" if p["tool_name"] == "AskUserQuestion" => {
            let qs = questions(&p["tool_input"]);
            if qs.is_empty() {
                return None;
            }
            let mut it = base("question");
            it["questions"] = json!(qs);
            it["answer"] = json!(answer);
            Some(it)
        }
        "Stop" => {
            let mut it = base("done");
            it["text"] = json!(short(p["last_assistant_message"].as_str().unwrap_or(""), 300));
            Some(it)
        }
        // (permissions come as PermissionRequest: a Notification shows only when it waits on the user's next message)
        "Notification" if p["notification_type"] == "idle_prompt" || p["message"].as_str().is_some_and(|m| m.contains("waiting for your input")) => {
            let mut it = base("done");
            it["text"] = json!(short(p["message"].as_str().unwrap_or(""), 300));
            Some(it)
        }
        _ => None,
    }
}

/// What the hook prints for the card's answer (`allow`, `deny`, `answer` with picks/texts per question, `skip`).
/// None: nothing, so the agent asks in its own window as it would without Sympony (Open, Close, no click in time).
pub fn reply(event: &str, p: &Value, choice: &str, picks: Option<&Value>, texts: Option<&Value>) -> Option<String> {
    let out = match (event, choice) {
        ("PermissionRequest", "allow") => json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}),
        ("PermissionRequest", "deny") => json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": "The user denied this in Sympony."}}}),
        ("PreToolUse", "answer") => {
            let updated = answered(&p["tool_input"], picks, texts, false)?;
            json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": updated}})
        }
        ("PreToolUse", "skip") => {
            json!({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "Dismissed by user"}})
        }
        _ => return None,
    };
    Some(out.to_string())
}

fn command(exe: &str, event: &str) -> String {
    // Single-quote the executable path so `$`, backticks, or `"` in unusual install paths cannot expand in POSIX shells.
    format!("'{}' {MARK} {event}", exe.replace('\'', "'\\''"))
}

fn ours(entry: &Value) -> bool {
    entry["hooks"].as_array().is_some_and(|h| h.iter().any(|x| x["command"].as_str().is_some_and(|c| c.contains(MARK))))
}

/// Claude Code's settings without Sympony's hooks (everything else as it was).
pub fn remove(settings: &Value) -> Value {
    let mut s = settings.clone();
    if let Some(h) = s.get_mut("hooks").and_then(Value::as_object_mut) {
        for list in h.values_mut() {
            if let Some(a) = list.as_array_mut() {
                a.retain(|e| !ours(e));
            }
        }
        h.retain(|_, v| !v.as_array().is_some_and(|a| a.is_empty()));
        if h.is_empty() {
            s.as_object_mut().map(|o| o.remove("hooks"));
        }
    }
    s
}

/// …with Sympony's hooks (this Sympony's path), once.
pub fn install(settings: &Value, exe: &str) -> Value {
    let mut s = remove(settings);
    if !s.is_object() {
        s = json!({});
    }
    if !s["hooks"].is_object() {
        s["hooks"] = json!({});
    }
    for (event, matcher) in EVENTS {
        let mut entry = json!({"hooks": [{"type": "command", "command": command(exe, event), "timeout": 70}]});
        if let Some(m) = matcher {
            entry["matcher"] = json!(m);
        }
        let list = s["hooks"].as_object_mut().unwrap().entry(event.to_string()).or_insert_with(|| json!([]));
        if let Some(a) = list.as_array_mut() {
            a.push(entry);
        }
    }
    s
}

/// installed (all of this Sympony's), other (another Sympony's), partial, or none.
pub fn state(settings: &Value, exe: &str) -> &'static str {
    let mut mine = 0;
    let mut other = false;
    for (event, _) in EVENTS {
        let cmds: Vec<String> = settings["hooks"][event].as_array().into_iter().flatten().filter(|e| ours(e))
            .flat_map(|e| e["hooks"].as_array().cloned().unwrap_or_default()).filter_map(|x| x["command"].as_str().map(String::from)).collect();
        if cmds.iter().any(|c| *c == command(exe, event)) {
            mine += 1;
        } else if !cmds.is_empty() {
            other = true;
        }
    }
    match (mine, other) {
        (4, false) => "installed",
        (0, true) => "other",
        (0, false) => "none",
        _ => "partial",
    }
}

/// The briefs due now (`chatBriefs`): on, today one of its days (`weekday` 0 = Sunday), its time passed by less than
/// an hour (the Mac may have slept through it), not sent today (`fired`: "id|day").
pub fn brief_due(briefs: &Value, day: &str, weekday: u32, hhmm: &str, fired: &[String]) -> Vec<(String, String)> {
    let mins = |t: &str| -> Option<i32> {
        let (h, m) = t.split_once(':')?;
        Some(h.parse::<i32>().ok()? * 60 + m.parse::<i32>().ok()?)
    };
    let Some(now) = mins(hhmm) else { return vec![] };
    briefs.as_array().into_iter().flatten().filter_map(|b| {
        let id = b["id"].as_str()?;
        let text = b["text"].as_str().filter(|t| !t.trim().is_empty())?;
        let at = mins(b["time"].as_str()?)?;
        let today = b["days"].as_array()?.iter().any(|d| d.as_u64() == Some(weekday as u64));
        let ok = b["on"] != false && today && now >= at && now - at <= 60 && !fired.contains(&format!("{id}|{day}"));
        ok.then(|| (id.to_string(), text.to_string()))
    }).collect()
}

/// The questions of an AskUserQuestion input, as the card shows them.
fn questions(input: &Value) -> Vec<Value> {
    input["questions"].as_array().into_iter().flatten().map(|q| {
        let mut obj = json!({
            "q": q["question"].as_str().unwrap_or(""),
            "o": q["options"].as_array().into_iter().flatten().map(|o| json!({
                "l": o["label"].as_str().unwrap_or(""),
                "d": o["description"].as_str().unwrap_or(""),
            })).collect::<Vec<_>>(),
            "m": q["multiSelect"] == true,
        });
        if let Some(h) = q["header"].as_str().filter(|s| !s.is_empty()) {
            obj["header"] = json!(h);
        }
        if q["allowOther"] == true || q["isOther"] == true {
            obj["allowOther"] = json!(true);
        }
        if q["allowEmpty"] == true {
            obj["allowEmpty"] = json!(true);
        }
        if let Some(ph) = q["placeholder"].as_str().filter(|s| !s.is_empty()) {
            obj["placeholder"] = json!(ph);
        }
        obj
    }).collect()
}

/// The input with picks + optional typed texts as `answers`.
/// - single choice: typed text if non-empty, otherwise picked label;
/// - multi choice: picked labels plus typed text (if non-empty), joined with ", ";
/// - no-option question with `allowEmpty`: "" when left blank.
/// `by_header`: keyed by `header` (falling back to `question`) for Paseo and Codex; `false` keys by `question` for Claude Code hooks.
fn answered(input: &Value, picks: Option<&Value>, texts: Option<&Value>, by_header: bool) -> Option<Value> {
    if picks.is_none() && texts.is_none() {
        return None;
    }
    let qs = input["questions"].as_array()?;
    let picks_arr = picks.and_then(Value::as_array);
    let texts_arr = texts.and_then(Value::as_array);
    let answers: serde_json::Map<String, Value> = qs.iter().enumerate().filter_map(|(i, q)| {
        let key = if by_header {
            q["header"].as_str().filter(|h| !h.is_empty()).or(q["question"].as_str())?
        } else {
            q["question"].as_str()?
        };
        let labels: Vec<&str> = picks_arr
            .and_then(|a| a.get(i))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).filter(|s| !s.is_empty()).collect())
            .unwrap_or_default();
        let text = texts_arr
            .and_then(|a| a.get(i))
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        let multi = q["multiSelect"] == true;
        let has_opts = q["options"].as_array().is_some_and(|o| !o.is_empty());
        let allow_empty = q["allowEmpty"] == true;
        let val = if !has_opts && allow_empty && text.is_empty() && labels.is_empty() {
            String::new()
        } else if multi {
            let mut parts: Vec<&str> = labels;
            if !text.is_empty() {
                parts.push(text);
            }
            parts.join(", ")
        } else if !text.is_empty() {
            text.to_string()
        } else {
            labels.join(", ")
        };
        Some((key.to_string(), json!(val)))
    }).collect();
    let mut updated = input.clone();
    updated["answers"] = Value::Object(answers);
    Some(updated)
}

fn all_empty_optional(input: &Value) -> bool {
    input["questions"].as_array().is_some_and(|qs| {
        !qs.is_empty()
            && qs.iter().all(|q| {
                q["allowEmpty"] == true && q["options"].as_array().is_none_or(|o| o.is_empty())
            })
    })
}

/// Paseo's waiting permissions (its MCP `list_pending_permissions`: `{permissions: [{agentId, request: {id, provider,
/// name, kind, input, detail}}]}`) as cards. Only a tool whose command or file shows can be allowed from the card; a
/// question with its options is answered there; a plan, a mode change or anything else opens Paseo. `agents` (its
/// `list_agents`) gives each agent's folder: the card's project, and file paths shown from it.
pub fn paseo_items(perms: &Value, agents: &Value, answer: bool) -> Vec<Value> {
    perms["permissions"].as_array().into_iter().flatten().filter_map(|p| {
        let r = &p["request"];
        let (id, agent_id) = (r["id"].as_str()?, p["agentId"].as_str()?);
        let cwd = agents["agents"].as_array().into_iter().flatten().find(|a| a["id"] == agent_id).and_then(|a| a["cwd"].as_str()).unwrap_or("");
        let project = std::path::Path::new(cwd).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let provider = r["provider"].as_str().unwrap_or("");
        let cap = |s: &str| { let mut c = s.chars(); c.next().map(|f| f.to_uppercase().chain(c).collect::<String>()).unwrap_or_default() };
        let who = if provider.is_empty() { "Paseo".to_string() } else {
            format!("Paseo · {}", crate::agents::find(provider).map(|x| x.name.replace(" Code", "").replace(" CLI", "")).unwrap_or_else(|| cap(provider)))
        };
        let tool = r["name"].as_str().unwrap_or("A tool");
        let kind = r["kind"].as_str().unwrap_or("tool");
        let mut it = json!({"id": format!("p:{agent_id}:{id}"), "agent": who, "project": project, "source": "paseo"});
        let qs = questions(&r["input"]);
        if (kind == "question" || tool == "AskUserQuestion") && !qs.is_empty() {
            it["kind"] = json!("question");
            it["questions"] = json!(qs);
            it["answer"] = json!(answer);
            return Some(it);
        }
        // what it's about: its input's command / file / address, else Paseo's own detail or title
        let (mut d, mut cut) = detail(&r["input"], cwd);
        if d.is_empty() {
            let alt = r["detail"]["command"].as_str().or(r["detail"]["filePath"].as_str()).or(r["detail"]["text"].as_str()).or(r["title"].as_str()).unwrap_or("");
            (d, cut) = (short(alt, 300), alt.trim().chars().count() > 300);
        }
        it["kind"] = json!("permission");
        it["tool"] = json!(tool);
        it["detail"] = json!(d);
        it["truncated"] = json!(cut);
        it["answer"] = json!(answer && kind == "tool" && !d.is_empty() && !cut && tool != "ExitPlanMode");
        Some(it)
    }).collect()
}

/// The answer Paseo's `respond_to_permission` takes for the card's choice (none: Open / Close).
pub fn paseo_response(request: &Value, choice: &str, picks: Option<&Value>, texts: Option<&Value>) -> Option<Value> {
    match choice {
        "allow" => Some(json!({"behavior": "allow"})),
        "deny" => Some(json!({"behavior": "deny", "message": "The user denied this in Sympony."})),
        "answer" => Some(json!({"behavior": "allow", "updatedInput": answered(&request["input"], picks, texts, true)?})),
        "skip" => {
            if all_empty_optional(&request["input"]) {
                let empty = json!([]);
                Some(json!({"behavior": "allow", "updatedInput": answered(&request["input"], Some(&empty), Some(&empty), true)?}))
            } else {
                Some(json!({"behavior": "deny", "message": "Dismissed by user"}))
            }
        }
        _ => None,
    }
}
