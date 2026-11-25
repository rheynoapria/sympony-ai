//! Launch at login on macOS: not done yet (rheynoapria/sympony-ai#57: a login item through `SMAppService.mainApp` on
//! macOS 13+, a LaunchAgent on 11–12). Same names and signatures as `windows::startup`, so the app calls one API.
use std::path::Path;

/// What the OS starts at login under a name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// The command as written
    pub command: String,
    /// False when it was turned off in the OS's own settings
    pub enabled: bool,
}

/// The entry under `name`; None when the OS starts nothing under it (always, until #57).
pub fn entry(_name: &str) -> Option<Entry> {
    None
}

/// Starts `exe` at login under `name`.
pub fn register(_name: &str, _exe: &Path) -> Result<(), String> {
    Err("launch at login isn't available on macOS yet".into())
}

/// Takes `name` off the login list. Already gone is fine.
pub fn unregister(_name: &str) -> Result<(), String> {
    Ok(())
}

/// The program a login command starts.
pub fn program_of(command: &str) -> &str {
    command.trim()
}
