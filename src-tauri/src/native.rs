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

/// Runs `f` on the main thread from its event loop, never right away. On Windows a new window can't be made while
/// WebView2 is inside one of its own callbacks: a command that isn't async runs in one, and `run_on_main_thread`
/// called on the main thread runs `f` right there, so WebView2 never finishes the new window and Sympony stops
/// answering. Asked from another thread, `run_on_main_thread` queues `f` instead (on macOS too: one turn later).
pub fn later_on_main_thread(app: &tauri::AppHandle, f: impl FnOnce() + Send + 'static) {
    let a = app.clone();
    std::thread::spawn(move || {
        let _ = a.run_on_main_thread(f);
    });
}
