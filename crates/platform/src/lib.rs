//! Everything OS-specific, behind traits. macOS now; Windows/Linux modules come later behind `cfg(target_os)`.
#[cfg(target_os = "macos")]
pub mod macos;
pub mod ax;
pub mod geometry;
pub mod location;
pub mod voice;

/// API keys and tokens: kept by the OS (Keychain on macOS), never in settings.json.
pub trait Secrets: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str) -> anyhow::Result<()>;
}
