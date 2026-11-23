//! The Windows backend: the same modules, functions and types as `macos`, so the app reaches both as `platform::os`.
//!
//! Phase 1 of the Windows port (the workspace builds and its tests run on Windows): every function here is a
//! stand-in that reports "nothing there / not available" (no displays, no front app, permissions not granted, …)
//! rather than pretending to work. Real Win32 / UI Automation / WinRT code replaces them module by module; keep each
//! signature as `macos` has it, so the app needs no `cfg` of its own.
pub mod apps;
pub mod automation;
pub mod displays;
pub mod keychain;
pub mod location;
pub mod window;
pub mod system;
pub mod notifications;
pub mod banners;
pub mod ax;
pub mod radios;
pub mod calendar;
pub mod files;
pub mod player;
pub mod voice;

/// Stands for objc2's `MainThreadMarker` (AppKit wants proof of the main thread; the Win32 calls here don't), so the
/// app's `MainThreadMarker::new()` checks read the same on both.
#[derive(Debug, Clone, Copy)]
pub struct MainThreadMarker(());

impl MainThreadMarker {
    pub fn new() -> Option<Self> {
        Some(Self(()))
    }
}
