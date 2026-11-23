//! Everything OS-specific, behind traits. macOS and Windows now (Windows' modules are stand-ins being filled in);
//! Linux comes later behind `cfg(target_os)`.
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

/// This OS's backend under one name: `platform::os::system::idle_secs()` reads the same on every OS.
#[cfg(target_os = "macos")]
pub use macos as os;
#[cfg(target_os = "windows")]
pub use windows as os;

pub mod ax;
pub mod geometry;
pub mod location;
pub mod process;
pub mod voice;

/// API keys and tokens: kept by the OS (Keychain on macOS), never in settings.json.
pub trait Secrets: Send + Sync {
    fn get(&self, key: &str) -> Option<String>;
    fn set(&self, key: &str, value: &str) -> anyhow::Result<()>;
}
