//! First-run onboarding logic: pick <-> settings mapping, required permissions, and skip patch.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashSet;

pub const PICKS: [&str; 8] = [
    "music",
    "calendar",
    "prayer",
    "ai",
    "focus",
    "notifications",
    "weather",
    "todo",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feel {
    pub look: String,
    #[serde(alias = "open_on_hover")]
    pub open_on_hover: bool,
    #[serde(alias = "launch_at_login")]
    pub launch_at_login: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Perm {
    Calendars,
    Location,
    Automation,
    FullDisk,
    Accessibility,
    Microphone,
    ScreenRecording,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Dialog,
    OpenPane(&'static str),
    Done,
    LaterOnPlay,
}

pub fn action(perm: Perm, status: &str) -> Action {
    if status == "granted" {
        return Action::Done;
    }
    match perm {
        Perm::Calendars => {
            if status == "notAsked" {
                Action::Dialog
            } else {
                Action::OpenPane("Privacy_Calendars")
            }
        }
        Perm::Location => {
            if status == "notAsked" {
                Action::Dialog
            } else {
                Action::OpenPane("Privacy_LocationServices")
            }
        }
        Perm::Automation => match status {
            "notRunning" => Action::LaterOnPlay,
            "notAsked" => Action::Dialog,
            _ => Action::OpenPane("Privacy_Automation"),
        },
        Perm::FullDisk => Action::OpenPane("Privacy_AllFiles"),
        Perm::Accessibility => Action::OpenPane("Privacy_Accessibility"),
        Perm::Microphone => {
            if status == "notAsked" {
                Action::Dialog
            } else {
                Action::OpenPane("Privacy_Microphone")
            }
        }
        Perm::ScreenRecording => Action::OpenPane("Privacy_ScreenCapture"),
    }
}

fn flag_on(settings: &Value, key: &str) -> bool {
    settings.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn module_on(settings: &Value, id: &str) -> bool {
    settings
        .get("modules")
        .and_then(Value::as_array)
        .and_then(|arr| arr.iter().find(|m| m.get("id").and_then(Value::as_str) == Some(id)))
        .and_then(|m| m.get("on").and_then(Value::as_bool))
        .unwrap_or(false)
}

/// Reads back the user's current settings into onboarding picks (in `PICKS` order).
/// A pick counts as selected when all of its switches (spec §5.3) are on.
pub fn picks_from(settings: &Value) -> Vec<String> {
    PICKS
        .iter()
        .copied()
        .filter(|pick| match *pick {
            "music" => flag_on(settings, "mediaEnabled"),
            "calendar" => module_on(settings, "calendar") && flag_on(settings, "calendarEnabled"),
            "prayer" => module_on(settings, "prayer") && flag_on(settings, "prayerEnabled"),
            "ai" => module_on(settings, "chat"),
            "focus" => module_on(settings, "pomodoro"),
            "notifications" => flag_on(settings, "notifEnabled"),
            "weather" => module_on(settings, "weather") && flag_on(settings, "weatherEnabled"),
            "todo" => module_on(settings, "todo") && module_on(settings, "notes"),
            _ => false,
        })
        .map(String::from)
        .collect()
}

/// Builds the single `settings_set` patch written at Finish (spec §5.3).
pub fn patch(settings: &Value, picks: &[String], feel: &Feel, now_ms: i64) -> Value {
    let picked: HashSet<&str> = picks.iter().map(String::as_str).collect();
    let has = |id: &str| picked.contains(id);

    let mut modules = settings
        .get("modules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for entry in &mut modules {
        let Some(id) = entry.get("id").and_then(Value::as_str) else {
            continue;
        };
        let mapped = match id {
            "calendar" => Some(has("calendar")),
            "prayer" => Some(has("prayer")),
            "chat" => Some(has("ai")),
            "pomodoro" => Some(has("focus")),
            "weather" => Some(has("weather")),
            "todo" | "notes" => Some(has("todo")),
            _ => None,
        };
        if let (Some(on), Some(obj)) = (mapped, entry.as_object_mut()) {
            obj.insert("on".into(), Value::Bool(on));
        }
    }

    let look = match feel.look.as_str() {
        "black" | "glass" | "color" => feel.look.as_str(),
        _ => "black",
    };

    let mut out = Map::new();
    out.insert("modules".into(), Value::Array(modules));
    out.insert("mediaEnabled".into(), Value::Bool(has("music")));
    out.insert("calendarEnabled".into(), Value::Bool(has("calendar")));
    out.insert("prayerEnabled".into(), Value::Bool(has("prayer")));
    out.insert("notifEnabled".into(), Value::Bool(has("notifications")));
    out.insert("weatherEnabled".into(), Value::Bool(has("weather")));
    out.insert("notchLook".into(), Value::String(look.into()));
    out.insert("openOnHover".into(), Value::Bool(feel.open_on_hover));
    out.insert("launchAtLogin".into(), Value::Bool(feel.launch_at_login));
    out.insert("onboarded".into(), json!({ "at": now_ms, "version": 1 }));
    Value::Object(out)
}

/// Returns the deduplicated macOS permissions required by `picks` in the spec's row order.
pub fn perms_for(picks: &[String]) -> Vec<Perm> {
    let picked: HashSet<&str> = picks.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    if picked.contains("notifications") {
        out.push(Perm::FullDisk);
        out.push(Perm::Accessibility);
    }
    if picked.contains("calendar") {
        out.push(Perm::Calendars);
    }
    if picked.contains("music") {
        out.push(Perm::Automation);
    }
    if picked.contains("prayer") || picked.contains("weather") {
        out.push(Perm::Location);
    }
    out
}

/// Patch written when the user explicitly skips onboarding (Esc → confirm).
pub fn skip_patch(now_ms: i64) -> Value {
    json!({
        "onboarded": {
            "at": now_ms,
            "version": 1,
            "skipped": true,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn defaults() -> Value {
        serde_json::from_str(include_str!("../../contract/defaults/settings.json")).unwrap()
    }

    fn svec(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn picks_from_defaults_matches_spec_order() {
        assert_eq!(
            picks_from(&defaults()),
            svec(&["music", "calendar", "ai", "focus", "weather", "todo"])
        );
    }

    #[test]
    fn picks_from_imported_settings_respects_modules() {
        let mut s = defaults();
        // Turn calendar module off while keeping chat on
        if let Some(mods) = s.get_mut("modules").and_then(Value::as_array_mut) {
            for m in mods {
                if m["id"] == "calendar" {
                    m["on"] = json!(false);
                }
                if m["id"] == "chat" {
                    m["on"] = json!(true);
                }
            }
        }
        let picked = picks_from(&s);
        assert!(!picked.contains(&"calendar".to_string()));
        assert!(picked.contains(&"ai".to_string()));
    }

    #[test]
    fn patch_updates_mapped_switches_without_touching_other_modules_or_order() {
        let def = defaults();
        let orig_order: Vec<String> = def["modules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["id"].as_str().unwrap().to_string())
            .collect();
        let orig_health = def["modules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == "health")
            .unwrap()["on"]
            .as_bool()
            .unwrap();

        let feel = Feel {
            look: "glass".into(),
            open_on_hover: false,
            launch_at_login: true,
        };
        let p = patch(&def, &svec(&["prayer"]), &feel, 1_700_000_000_000);

        assert_eq!(p["prayerEnabled"], json!(true));
        assert_eq!(p["calendarEnabled"], json!(false));
        assert_eq!(p["mediaEnabled"], json!(false));
        assert_eq!(p["notifEnabled"], json!(false));
        assert_eq!(p["weatherEnabled"], json!(false));
        assert_eq!(p["notchLook"], json!("glass"));
        assert_eq!(p["openOnHover"], json!(false));
        assert_eq!(p["launchAtLogin"], json!(true));
        assert_eq!(p["onboarded"], json!({ "at": 1_700_000_000_000i64, "version": 1 }));

        let mods = p["modules"].as_array().unwrap();
        let new_order: Vec<String> = mods
            .iter()
            .map(|m| m["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(new_order, orig_order);

        let mod_on = |id: &str| {
            mods.iter()
                .find(|m| m["id"] == id)
                .unwrap()["on"]
                .as_bool()
                .unwrap()
        };
        assert!(mod_on("prayer"));
        assert!(!mod_on("calendar"));
        assert!(!mod_on("chat"));
        assert!(!mod_on("pomodoro"));
        assert!(!mod_on("weather"));
        assert!(!mod_on("todo"));
        assert!(!mod_on("notes"));
        assert_eq!(mod_on("health"), orig_health);
    }

    #[test]
    fn perms_for_dedups_location_and_orders_rows() {
        assert_eq!(
            perms_for(&svec(&["notifications", "weather", "prayer"])),
            vec![Perm::FullDisk, Perm::Accessibility, Perm::Location]
        );
        assert!(perms_for(&svec(&["focus"])).is_empty());
        assert_eq!(
            perms_for(&svec(&["music", "calendar"])),
            vec![Perm::Calendars, Perm::Automation]
        );
    }

    #[test]
    fn skip_patch_only_marks_onboarded_skipped() {
        assert_eq!(
            skip_patch(1_700_000_000_000),
            json!({ "onboarded": { "at": 1_700_000_000_000i64, "version": 1, "skipped": true } })
        );
    }

    #[test]
    fn action_maps_perm_and_status_per_spec() {
        assert_eq!(action(Perm::Calendars, "notAsked"), Action::Dialog);
        assert_eq!(action(Perm::Calendars, "denied"), Action::OpenPane("Privacy_Calendars"));
        assert_eq!(action(Perm::Location, "granted"), Action::Done);
        assert_eq!(action(Perm::Location, "notAsked"), Action::Dialog);
        assert_eq!(action(Perm::Location, "denied"), Action::OpenPane("Privacy_LocationServices"));
        assert_eq!(action(Perm::Automation, "notRunning"), Action::LaterOnPlay);
        assert_eq!(action(Perm::Automation, "notAsked"), Action::Dialog);
        assert_eq!(action(Perm::Automation, "denied"), Action::OpenPane("Privacy_Automation"));
        assert_eq!(action(Perm::FullDisk, "denied"), Action::OpenPane("Privacy_AllFiles"));
        assert_eq!(action(Perm::Accessibility, "denied"), Action::OpenPane("Privacy_Accessibility"));
    }
}
