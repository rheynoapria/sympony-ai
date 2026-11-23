//! The computer's own calendars (stand-in: none read yet). Sympony's own events and Google sync don't need this.
use serde_json::Value;

/// The permission now, for the log.
pub fn status_name() -> &'static str {
    "not on Windows yet"
}

/// `"granted" | "denied" | "notAsked"`, as on macOS.
pub fn perm_status() -> &'static str {
    "denied"
}

pub fn request() {}

pub fn access() -> bool {
    false
}

pub fn events(_from: i64, _to: i64) -> Vec<Value> {
    vec![]
}
