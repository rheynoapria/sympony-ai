//! macOS asks the user before one app scripts another (Automation); Windows has no such permission.

/// `"granted" | "denied" | "notAsked" | "notRunning"`, as on macOS: always granted here.
pub fn status(_bundle_id: &str, _ask: bool) -> &'static str {
    "granted"
}
