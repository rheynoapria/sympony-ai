//! Sympony's tools for the AI agents, the same for every agent (MCP): each is one of AI Chat's actions (the frontend's
//! `run(kind, args)`, with its Undo), so a call only becomes `(kind, "A | B | C")`. And the MCP JSON-RPC answers
//! (`sympony --mcp` speaks it on stdio).
use serde_json::{json, Value};

const WHEN: &str = "minutes from now (3m, 90m), a 24-hour time (14:30, the next time it comes) or a date and time (2026-10-24 09:00); a day without a time gets 09:00; always still to come";

struct Tool {
    name: &'static str,
    kind: &'static str,
    about: &'static str,
    /// When true, `to_action` passes the raw JSON arguments object as a string without `|` rewriting.
    raw: bool,
    /// (field, JSON type, required, what it is), in the order the action takes them
    fields: &'static [(&'static str, &'static str, bool, &'static str)],
}

const TOOLS: &[Tool] = &[
    Tool { name: "get_context", kind: "context", raw: false, about: "What Sympony knows about the user right now: the next 14 days of the calendar (including Google Calendar events with their [gc_...] ids), open todos and reminders with their [ids] (synced with Google Tasks when connected), notes' titles, weather, prayer times, Pomodoro, the stopwatch, today's water, launcher apps, how the Mac is doing, sound and screen. Call it before answering about the user's day or before changing an item (for its id).", fields: &[] },
    Tool { name: "add_reminder", kind: "remind", raw: false, about: "A reminder that rings when it's due.", fields: &[("when", "string", true, WHEN), ("what", "string", true, "short, in the user's language")] },
    Tool { name: "add_todo", kind: "todo", raw: false, about: "A task without a time (synced to Google Tasks when connected).", fields: &[("what", "string", true, "short, in the user's language")] },
    Tool { name: "add_repeating_todo", kind: "repeat", raw: false, about: "A todo that comes back on those days at that time (\"remind me to take my pill every day at 8\").", fields: &[("days", "string", true, "daily, weekdays, weekends, or days like mon,wed,fri"), ("time", "string", true, "HH:MM, 24-hour"), ("what", "string", true, "short")] },
    Tool { name: "change_repeat", kind: "repeat", raw: false, about: "Changes when an existing todo repeats, or stops it repeating (days: none).", fields: &[("id", "string", true, "the todo's id from get_context"), ("days", "string", true, "daily, weekdays, weekends, days like mon,wed,fri, or none"), ("time", "string", false, "HH:MM, not needed with none")] },
    Tool { name: "update_item", kind: "update", raw: false, about: "Moves, reschedules, or renames an existing Google Calendar event ([gc_...] id), Sympony event, or todo / reminder: changes its time and/or title/text. Call only when the user asks.", fields: &[("id", "string", true, "the item's id from get_context (e.g. gc_... for Google Calendar events)"), ("when", "string", false, "a new time (e.g. 2026-11-25 11:00 or 11:00), or none to clear a todo's time; leave out to keep it"), ("text", "string", false, "new title/text; leave out to keep it")] },
    Tool { name: "complete_todo", kind: "done", raw: false, about: "Marks a todo done (synced to Google Tasks when connected).", fields: &[("id", "string", true, "the todo's id from get_context")] },
    Tool { name: "remove_item", kind: "remove", raw: false, about: "Deletes a todo, Google Calendar event ([gc_...] id), or Sympony event. Ask the user to confirm via ask_user before deleting.", fields: &[("id", "string", true, "the item's id from get_context")] },
    Tool { name: "add_note", kind: "note", raw: false, about: "Saves a note; its first line is the title.", fields: &[("text", "string", true, "the note")] },
    Tool { name: "add_event", kind: "event", raw: false, about: "Adds an event to the user's Google Calendar (when connected) or Sympony calendar. Call only when the user asks.", fields: &[("when", "string", true, WHEN), ("duration", "string", true, "like 30m or 1h"), ("title", "string", true, "short")] },
    Tool { name: "pomodoro", kind: "pomodoro", raw: false, about: "Pomodoro: start a focus session, start a break, or stop (pause) it.", fields: &[("action", "string", true, "start, break or stop")] },
    Tool { name: "stopwatch", kind: "stopwatch", raw: false, about: "The stopwatch in the Pomodoro tab.", fields: &[("action", "string", true, "start, stop or reset")] },
    Tool { name: "music", kind: "music", raw: false, about: "Controls the music or video playing on the Mac now.", fields: &[("action", "string", true, "play, pause, next or previous")] },
    Tool { name: "set_volume", kind: "volume", raw: false, about: "Sets the sound volume, or mutes / unmutes it.", fields: &[("level", "string", true, "a percent like 40, or mute, or unmute")] },
    Tool { name: "open_app", kind: "open", raw: false, about: "Opens an app from the user's launcher (one of the names get_context lists).", fields: &[("name", "string", true, "the app's name")] },
    Tool { name: "add_link", kind: "link", raw: false, about: "A button under your answer that opens this web page when the user clicks it (http or https; Sympony never opens it by itself).", fields: &[("url", "string", true, "http(s) address"), ("label", "string", true, "the button's text")] },
    // Pony M1 tools (Sympony-only; handled in Rust or the notch question card)
    Tool { name: "read_skill", kind: "skill", raw: false, about: "Loads the Markdown instructions of an enabled skill from the Skills list.", fields: &[("name", "string", true, "the skill name from the Skills list")] },
    Tool { name: "read_skill_file", kind: "skill_file", raw: false, about: "Reads a UTF-8 text file inside a skill's folder (e.g. references/guide.md).", fields: &[("name", "string", true, "the skill name"), ("path", "string", true, "relative path inside the skill folder")] },
    Tool { name: "save_skill", kind: "save_skill", raw: true, about: "Creates or updates a skill at ~/.sympony/skills/<name>/SKILL.md. Ask the user via ask_user before overwriting an existing skill, then pass replace: true.", fields: &[("name", "string", true, "1-64 chars: lowercase a-z, 0-9, hyphens"), ("description", "string", true, "what the skill does and when to use it (1-1024 chars)"), ("body", "string", true, "the Markdown instructions for SKILL.md"), ("replace", "boolean", false, "set to true only after asking the user via ask_user to overwrite an existing skill")] },
    Tool { name: "remember", kind: "remember", raw: false, about: "Saves something lasting in Pony's memory: a fact about the user, or how they want you to answer or work (a preference, a correction). <= 300 chars; never passwords, keys, or secrets.", fields: &[("text", "string", true, "short lasting note about the user, in their language")] },
    Tool { name: "recall", kind: "recall", raw: false, about: "Searches the user's earlier chats with Pony (not this one) by words, for when they refer to a past conversation (\"what we talked about yesterday\"). Returns the best matching passages with each chat's title and date.", fields: &[("query", "string", true, "a few distinctive words from that conversation")] },
    Tool { name: "forget", kind: "forget", raw: false, about: "Removes a remembered fact by its [id] from the remembered facts list.", fields: &[("id", "string", true, "the fact's id from the remembered facts list")] },
    Tool { name: "ask_user", kind: "ask", raw: true, about: "Asks the user one or more questions in the notch card (confirmations or ambiguous requests). After calling it, end your reply immediately with one short line; Sympony resumes with their answer.", fields: &[("questions", "array", true, "array of {question, header, options: [{label, description?}], multiSelect?, allowOther?, allowEmpty?, placeholder?}")] },
    // Custom Modules Phase 1 tools (local declarative OLED widgets under custom:<slug>; built-in modules remain immutable)
    Tool { name: "list_custom_modules", kind: "cm_list", raw: true, about: "Lists installed local custom OLED modules (slug, id, name, defaultSize, httpDomains, approvedDomains).", fields: &[] },
    Tool { name: "read_custom_module", kind: "cm_read", raw: true, about: "Reads an installed custom module's manifest.json and non-secret config keys so you can edit or refine it.", fields: &[("slug", "string", true, "bare custom module slug without 'custom:' prefix")] },
    Tool { name: "preview_custom_module", kind: "cm_preview", raw: true, about: "Validates a candidate schemaVersion: 1 custom OLED module manifest before installing; optionally runs a live dryRun fetch for already-approved domains.", fields: &[("manifest", "object", true, "candidate schemaVersion: 1 custom module manifest JSON"), ("dryRun", "boolean", false, "set true to test fetching already-approved dataSources")] },
    Tool { name: "save_custom_module", kind: "cm_save", raw: true, about: "Installs or updates a validated local custom OLED module (custom:<slug>) and hot-reloads it into the Notch & Settings. Built-in modules cannot be modified. Pass replace: true only when updating an existing custom module after user confirmation.", fields: &[("manifest", "object", true, "validated schemaVersion: 1 custom module manifest JSON"), ("replace", "boolean", false, "set true when overwriting an existing custom module")] },
    Tool { name: "delete_custom_module", kind: "cm_delete", raw: true, about: "Deletes an installed local custom module (never built-in modules) after user confirmation.", fields: &[("slug", "string", true, "bare custom module slug without 'custom:' prefix")] },
];

/// The tools as MCP lists them.
pub fn list() -> Vec<Value> {
    TOOLS
        .iter()
        .map(|t| {
            let props: serde_json::Map<String, Value> = t
                .fields
                .iter()
                .map(|(f, ty, _, d)| {
                    let mut schema = json!({"type": ty, "description": d});
                    if *ty == "array" {
                        schema["items"] = json!({"type": "object"});
                    }
                    (f.to_string(), schema)
                })
                .collect();
            let req: Vec<&str> = t.fields.iter().filter(|f| f.2).map(|f| f.0).collect();
            json!({"name": t.name, "description": t.about, "inputSchema": {"type": "object", "properties": props, "required": req}})
        })
        .collect()
}

/// A call → the frontend's action: (kind, its "A | B | C" argument, or raw JSON for raw tools). Err: what's wrong with the call.
pub fn to_action(name: &str, args: &Value) -> Result<(String, String), String> {
    let t = TOOLS.iter().find(|t| t.name == name).ok_or_else(|| format!("Sympony has no tool {name}"))?;
    if t.raw {
        for (f, ty, required, _) in t.fields {
            if !*required {
                continue;
            }
            let v = &args[f];
            let ok = match *ty {
                "array" => v.as_array().is_some_and(|a| !a.is_empty()),
                "string" => v.as_str().is_some_and(|s| !s.trim().is_empty()),
                _ => !v.is_null(),
            };
            if !ok {
                return Err(format!("{name} needs {f}"));
            }
        }
        return Ok((t.kind.to_string(), args.to_string()));
    }
    let get = |f: &str| -> Option<String> {
        let v = &args[f];
        let s = v.as_str().map(String::from).or_else(|| v.as_f64().map(|n| if n.fract() == 0.0 { (n as i64).to_string() } else { n.to_string() }))?;
        // (a | would split the action into other fields)
        Some(s.trim().replace('|', "/")).filter(|s| !s.is_empty())
    };
    let mut parts = vec![];
    for (f, _, required, _) in t.fields {
        match get(f) {
            Some(v) => parts.push(v),
            None if *required => return Err(format!("{name} needs {f}")),
            None => parts.push("-".into()),
        }
    }
    if name == "change_repeat" && parts.get(1).is_some_and(|d| d.eq_ignore_ascii_case("none")) {
        parts.truncate(2);
    }
    Ok((t.kind.to_string(), parts.join(" | ")))
}

/// One MCP request → its answer (None for a notification). `run(kind, args)` does a tool's action.
pub fn handle(req: &Value, run: &mut dyn FnMut(&str, &str) -> Result<String, String>) -> Option<Value> {
    let id = req.get("id")?.clone();
    let ok = |result: Value| Some(json!({"jsonrpc": "2.0", "id": id, "result": result}));
    match req["method"].as_str().unwrap_or("") {
        "initialize" => ok(json!({
            "protocolVersion": req["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "sympony", "version": env!("CARGO_PKG_VERSION")},
            "instructions": "Sympony's tools: the user's day (get_context) and the actions Sympony can do for them on this Mac.",
        })),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({"tools": list()})),
        "tools/call" => {
            let p = &req["params"];
            let r = to_action(p["name"].as_str().unwrap_or(""), &p["arguments"]).and_then(|(k, a)| run(&k, &a));
            let (text, err) = match r {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            ok(json!({"content": [{"type": "text", "text": text}], "isError": err}))
        }
        _ => Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": "method not found"}})),
    }
}
