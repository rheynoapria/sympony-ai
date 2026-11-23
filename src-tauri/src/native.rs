//! The OS's own handle for one of Sympony's windows, for `platform::os::window` and `platform::os::files`: the
//! NSWindow (or its NSView) on macOS, the HWND on Windows.
use std::ffi::c_void;
use tauri::{Runtime, WebviewWindow};

/// The window itself: its NSWindow on macOS, its HWND on Windows.
pub(crate) fn window<R: Runtime>(w: &WebviewWindow<R>) -> Option<*mut c_void> {
    #[cfg(target_os = "macos")]
    {
        w.ns_window().ok()
    }
    #[cfg(target_os = "windows")]
    {
        w.hwnd().ok().map(|h| h.0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = w;
        None
    }
}

/// What the window shows: its NSView on macOS (a drag or a share starts from a view), its HWND on Windows.
pub(crate) fn view<R: Runtime>(w: &WebviewWindow<R>) -> Option<*mut c_void> {
    #[cfg(target_os = "macos")]
    {
        w.ns_view().ok()
    }
    #[cfg(target_os = "windows")]
    {
        w.hwnd().ok().map(|h| h.0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = w;
        None
    }
}
