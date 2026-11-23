//! The Windows backend: the same modules, functions and types as `macos`, so the app reaches both as `platform::os`.
//!
//! Phase 1 of the Windows port (the workspace builds and its tests run on Windows): every function here is a
//! stand-in that reports "nothing there / not available" (no displays, no front app, permissions not granted, …)
//! rather than pretending to work. Real Win32 / UI Automation / WinRT code replaces them module by module; keep each
//! signature as `macos` has it, so the app needs no `cfg` of its own.
pub mod apps;
mod audio;
pub mod automation;
mod brightness;
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
pub mod media;
pub mod browser;
pub mod player;
pub mod shell;
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

/// COM on this thread, in the multithreaded apartment (WinRT and UI Automation calls that wait on their answers),
/// once per thread and undone when the thread ends. A thread already in another apartment stays in it.
pub(crate) fn mta() {
    struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: this thread's CoInitializeEx succeeded (below)
                unsafe { ::windows::Win32::System::Com::CoUninitialize() };
            }
        }
    }
    thread_local! {
        // SAFETY: paired with CoUninitialize in Drop, on this same thread, only when it succeeded
        static COM: Com = Com(unsafe { ::windows::Win32::System::Com::CoInitializeEx(None, ::windows::Win32::System::Com::COINIT_MULTITHREADED) }.is_ok());
    }
    COM.with(|_| {});
}
