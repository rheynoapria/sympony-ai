//! The Dashboard's launcher (`launcherItems`): maps Windows default paths to their macOS equivalents.
use serde_json::{json, Value};

/// The items for this Mac, and whether that changed them (to save).
pub fn for_mac(items: &[Value], home: &str) -> (Vec<Value>, bool) {
    let mut changed = false;
    let out = items.iter().filter_map(|it| {
        let p = it["path"].as_str().unwrap_or("");
        let low = p.to_ascii_lowercase();
        let mac = |name: &str, path: &str| Some(json!({"name": name, "path": path}));
        let m = if low.ends_with("\\explorer.exe") { mac("Finder", "/System/Library/CoreServices/Finder.app") }
            else if p.is_empty() && it["name"] == "Downloads" { mac("Downloads", &format!("{home}/Downloads")) }
            else if low.ends_with("\\calc.exe") { mac("Calculator", "/System/Applications/Calculator.app") }
            else if low.ends_with("\\notepad.exe") { mac("TextEdit", "/System/Applications/TextEdit.app") }
            else if low.ends_with("\\taskmgr.exe") { mac("Activity Monitor", "/System/Applications/Utilities/Activity Monitor.app") }
            else if low.starts_with("ms-settings:") { mac("System Settings", "/System/Applications/System Settings.app") }
            // (another Windows place: nothing on a Mac opens it)
            else if p.contains('\\') || (p.len() > 1 && p.as_bytes()[1] == b':') { None }
            else { return Some(it.clone()) };
        changed = true;
        m
    }).collect();
    (out, changed)
}
