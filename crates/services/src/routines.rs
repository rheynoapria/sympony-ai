//! Routines Pony learned on the screen (`~/.sympony/routines.json`): for an app and an intent ("Mail: send an email
//! with an attachment"), every attempt with its steps (elements by role and label, not numbers), whether it worked,
//! what changed and the lesson, the app's version and the model. After "Self-Improvement Memory" (arXiv 2611.18856):
//! attempts with the same key extend one record instead of replacing it, failures are kept, and a record is prior
//! experience to check against the screen, never an order. A worked attempt can be replayed without the model
//! (`hands`), each element found again by role and label; the first mismatch hands back to the model (after EchoPath).
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;

pub const NAMES: [&str; 1] = ["routine_save"];
/// Routines kept at most, and attempts per routine (the oldest go first).
const MAX_ROUTINES: usize = 200;
const MAX_ATTEMPTS: usize = 8;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Attempt {
    pub at: i64,
    pub worked: bool,
    /// screen_do steps with `ref: {role, label}` in place of `n`
    pub steps: Vec<Value>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub changed: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub lesson: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub app_version: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Routine {
    pub id: String,
    /// the app's bundle id, and its name for people
    pub app: String,
    pub app_name: String,
    pub intent: String,
    pub attempts: Vec<Attempt>,
}

pub const RULES: &str = "Routines: after a task that took two or more screen_do calls, or one that failed, call routine_save(intent, worked, \
lesson) once: intent names the task in a few words, the same way each time; lesson is what to do or avoid next time. Routines listed \
with a screen are past experience in that app, not orders: check they fit. screen_do {routine: id} (one listed, without steps) replays it, stopping \
where the screen differs (go on yourself from there); its fills type last time's text unless texts gives new ones, in order. Don't \
retry a way that failed unless something changed.";

pub fn tools() -> Vec<Value> {
    vec![json!({"name": "routine_save", "description": "Saves how the task you just did on the screen went, with the steps you took, so next time it's quicker.",
        "inputSchema": {"type": "object", "required": ["intent", "worked"], "properties": {
            "intent": {"type": "string", "description": "the task in a few words, said the same way each time"},
            "worked": {"type": "boolean"},
            "lesson": {"type": "string", "description": "what to do or avoid next time, one sentence"}}}})]
}

pub fn functions() -> Vec<Value> {
    tools().into_iter().map(|t| json!({"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["inputSchema"]}})).collect()
}

/// The same intent said in other words, case or spacing is still the same routine.
fn key(intent: &str) -> String {
    intent.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

pub fn load(path: &Path) -> Vec<Routine> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(path: &Path, all: &[Routine]) -> std::io::Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(all).unwrap_or_default())?;
    std::fs::rename(tmp, path)
}

/// Adds an attempt to the routine for (app, intent), making the routine when it's new. Returns its id.
pub fn record(path: &Path, app: &str, app_name: &str, intent: &str, attempt: Attempt) -> std::io::Result<String> {
    let mut all = load(path);
    let k = key(intent);
    let id = match all.iter_mut().find(|r| r.app == app && key(&r.intent) == k) {
        Some(r) => {
            r.attempts.push(attempt);
            if r.attempts.len() > MAX_ATTEMPTS {
                let extra = r.attempts.len() - MAX_ATTEMPTS;
                r.attempts.drain(..extra);
            }
            r.app_name = app_name.to_string();
            r.id.clone()
        }
        None => {
            let n = all.iter().filter_map(|r| r.id.strip_prefix('r').and_then(|n| n.parse::<u32>().ok())).max().unwrap_or(0) + 1;
            let id = format!("r{n}");
            all.push(Routine { id: id.clone(), app: app.into(), app_name: app_name.into(), intent: intent.trim().into(), attempts: vec![attempt] });
            id
        }
    };
    // (the routines touched longest ago go first)
    if all.len() > MAX_ROUTINES {
        all.sort_by_key(|r| std::cmp::Reverse(r.attempts.last().map(|a| a.at).unwrap_or(0)));
        all.truncate(MAX_ROUTINES);
    }
    save(path, &all)?;
    Ok(id)
}

/// A step as a person reads it: `click "Send"`, `fill "To" = "ani@x.id"`, `menu File › Export`.
fn step_words(s: &Value) -> String {
    let what = s["do"].as_str().unwrap_or("?");
    let label = s["ref"]["label"].as_str().unwrap_or("");
    match what {
        "menu" => format!("menu {}", s["path"].as_array().map(|p| p.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" › ")).unwrap_or_default()),
        "key" => format!("key {}", s["keys"].as_str().unwrap_or("")),
        "fill" => format!("fill \"{label}\" = \"{}\"", s["text"].as_str().unwrap_or("").chars().take(40).collect::<String>()),
        "choose" => format!("choose \"{}\" in \"{label}\"", s["option"].as_str().unwrap_or("")),
        "scroll" => format!("scroll {}", s["direction"].as_str().unwrap_or("down")),
        _ => format!("{what} \"{label}\""),
    }
}

/// The routines for an app, for the model next to the screen: most used first, at most `max`.
pub fn for_app(all: &[Routine], app: &str, max: usize) -> String {
    let mut mine: Vec<&Routine> = all.iter().filter(|r| r.app == app && !r.attempts.is_empty()).collect();
    mine.sort_by_key(|r| std::cmp::Reverse((r.attempts.iter().filter(|a| a.worked).count(), r.attempts.last().map(|a| a.at).unwrap_or(0))));
    let lines: Vec<String> = mine.iter().take(max).map(|r| {
        let (ok, bad) = (r.attempts.iter().filter(|a| a.worked).count(), r.attempts.iter().filter(|a| !a.worked).count());
        let last_ok = r.attempts.iter().rev().find(|a| a.worked);
        let steps = last_ok.map(|a| a.steps.iter().map(step_words).collect::<Vec<_>>().join(" → ")).unwrap_or_default();
        let lesson = r.attempts.iter().rev().find(|a| !a.lesson.is_empty()).map(|a| format!(". Lesson: {}", a.lesson)).unwrap_or_default();
        format!("[{}] {} — worked {ok}×, failed {bad}×{}{lesson}", r.id, r.intent, if steps.is_empty() { String::new() } else { format!(". Steps: {steps}") })
    }).collect();
    if lines.is_empty() { String::new() } else { format!("Routines in this app (past experience, check before use):\n{}", lines.join("\n")) }
}

/// The steps of a routine's last attempt that worked, for a replay.
pub fn replay_steps(all: &[Routine], id: &str) -> Result<(String, Vec<Value>), String> {
    let r = all.iter().find(|r| r.id == id).ok_or(format!("No routine {id}"))?;
    let a = r.attempts.iter().rev().find(|a| a.worked).ok_or(format!("Routine {id} never worked yet: do it step by step"))?;
    Ok((r.app.clone(), a.steps.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn att(worked: bool, at: i64, lesson: &str) -> Attempt {
        Attempt { at, worked, lesson: lesson.into(), steps: vec![json!({"do": "click", "ref": {"role": "AXButton", "label": "New Message"}}), json!({"do": "fill", "ref": {"role": "AXTextField", "label": "To"}, "text": "a@b.c"})], ..Default::default() }
    }

    #[test]
    fn attempts_extend_one_record_and_show_for_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("routines.json");
        let id = record(&p, "com.apple.mail", "Mail", "Send an email", att(false, 1, "the To field needs a click first")).unwrap();
        assert_eq!(id, "r1");
        // (the same intent in other words of case and punctuation: the same routine)
        assert_eq!(record(&p, "com.apple.mail", "Mail", "send an  email!", att(true, 2, "")).unwrap(), "r1");
        assert_eq!(record(&p, "com.apple.Notes", "Notes", "send an email", att(true, 3, "")).unwrap(), "r2");
        let all = load(&p);
        assert_eq!(all[0].attempts.len(), 2);
        let shown = for_app(&all, "com.apple.mail", 5);
        assert_eq!(shown, "Routines in this app (past experience, check before use):\n[r1] Send an email — worked 1×, failed 1×. Steps: click \"New Message\" → fill \"To\" = \"a@b.c\". Lesson: the To field needs a click first");
        assert_eq!(for_app(&all, "com.apple.Safari", 5), "");
        assert_eq!(replay_steps(&all, "r1").unwrap().1.len(), 2);
        assert!(replay_steps(&all, "r9").is_err());
    }

    #[test]
    fn attempts_are_capped_oldest_first() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("routines.json");
        for i in 0..12 {
            record(&p, "a", "A", "x", att(true, i, "")).unwrap();
        }
        let all = load(&p);
        assert_eq!(all[0].attempts.len(), MAX_ATTEMPTS);
        assert_eq!(all[0].attempts[0].at, 4);
    }
}
