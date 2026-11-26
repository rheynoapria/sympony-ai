//! Sympony's own windows. `handle` is the window's HWND where macOS takes its NSWindow (`native::window` in the app).
//! Whether a window takes the keyboard stays with Tauri (`set_focusable`): nothing here touches WS_EX_NOACTIVATE.
use std::ffi::c_void;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetWindowLongPtrW, SetForegroundWindow, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_BOTTOM, HWND_NOTOPMOST, HWND_TOPMOST,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_SHOWNA, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

/// macOS's floating level (3) and up keep a window above ordinary ones: on Windows, topmost.
const FLOATING: isize = 3;

/// Adds and removes extended styles, then has Windows apply them.
unsafe fn ex_style(h: HWND, add: u32, remove: u32) {
    // SAFETY (callers): `h` is a live window of this process.
    unsafe {
        let old = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
        let new = (old | add) & !remove;
        if new != old {
            SetWindowLongPtrW(h, GWL_EXSTYLE, new as isize);
            SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }
}

unsafe fn topmost(h: HWND, on: bool) {
    // SAFETY (callers): `h` is a live window of this process.
    unsafe { SetWindowPos(h, if on { HWND_TOPMOST } else { HWND_NOTOPMOST }, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
}

/// The notch window: above every ordinary window (fullscreen apps included), and no entry in Alt+Tab (the taskbar
/// already leaves it out: `skip_taskbar`).
///
/// # Safety
/// `handle` must be a live HWND of this process (Tauri's). Null is ignored.
pub unsafe fn style_notch_window(handle: *mut c_void) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        ex_style(h, WS_EX_TOOLWINDOW, 0);
        topmost(h, true);
    }
}

/// The onboarding window at `level` (25 above everything, 3 floating, 0 ordinary), no Alt+Tab entry.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn style_onboarding_window(handle: *mut c_void, level: isize) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        ex_style(h, WS_EX_TOOLWINDOW, 0);
        topmost(h, level >= FLOATING);
    }
}

/// `level` as on macOS (floating and up: topmost), and `lower`: behind every other window (true) or shown in front
/// without taking the keyboard (false).
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn set_window_level(handle: *mut c_void, level: isize, lower: Option<bool>) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        match lower {
            Some(true) => {
                topmost(h, false);
                SetWindowPos(h, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            Some(false) => {
                ShowWindow(h, SW_SHOWNA);
                topmost(h, level >= FLOATING);
            }
            None => topmost(h, level >= FLOATING),
        }
    }
}

/// Undecorated windows have no shadow on Windows (Tauri's `.shadow(false)` keeps it so): nothing to change.
///
/// # Safety
/// Nothing is dereferenced.
pub unsafe fn set_window_shadow(_handle: *mut c_void, _shadow: bool) {}

/// Hides the window at once (`alpha` 0) or shows it again (anything more), as macOS's alpha does for the onboarding
/// stepping aside (its page fades itself first, with CSS). Windows has no in-between here: a WebView2 window's
/// see-through look comes from composition, and the layered window an alpha needs breaks it. DWM cloaks it instead
/// (as a virtual desktop hides its windows), which leaves the composition as it is; a cloaked window takes no clicks.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn set_window_alpha(handle: *mut c_void, alpha: f64) {
    unsafe { set_cloaked(handle, alpha <= 0.0) };
}

/// Lets clicks pass through to what's under the window (an overlay that only shows).
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn set_click_through(handle: *mut c_void, through: bool) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    // (WS_EX_TRANSPARENT only passes clicks on a layered window; Tauri's set_ignore_cursor_events does the same)
    unsafe {
        if through {
            ex_style(h, WS_EX_TRANSPARENT | WS_EX_LAYERED, 0);
        } else {
            ex_style(h, 0, WS_EX_TRANSPARENT);
        }
    }
}

/// The floating Pony chat window: no Alt+Tab/taskbar clutter, optionally pinned topmost.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn style_floating_chat_window(handle: *mut c_void, always_on_top: bool) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        ex_style(h, WS_EX_TOOLWINDOW, 0);
        topmost(h, always_on_top);
    }
}

/// Switches the floating Pony chat window between pinned topmost and normal window z-order.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn set_floating_chat_pin(handle: *mut c_void, always_on_top: bool) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        topmost(h, always_on_top);
    }
}

/// Puts one of Sympony's windows in front of the app the user is in and gives it the keyboard. Windows lets a
/// background app do that only in some cases; when it refuses, the window still comes up and its taskbar button
/// flashes.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn bring_front(handle: *mut c_void) {
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    unsafe {
        BringWindowToTop(h);
        SetForegroundWindow(h);
    }
}

/// What the app in front does on the display Sympony's window `handle` is on: "full" (a window over that whole
/// display: a game, a video, a presentation), "max" (a maximised window there) or "normal" (anything else, Sympony's
/// own windows and Windows' own over the display included: the desktop, the taskbar, Start, Search, the emoji panel…).
///
/// # Safety
/// `handle` must be a live HWND of this process. Null reads as "normal".
pub unsafe fn foreground_state(handle: *mut c_void) -> &'static str {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsZoomed};
    let notch = handle as HWND;
    if notch.is_null() {
        return "normal";
    }
    unsafe {
        let front = GetForegroundWindow();
        if front.is_null() {
            return "normal";
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(front, &mut pid);
        if pid == GetCurrentProcessId() {
            return "normal";
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(front, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        let class = String::from_utf16_lossy(&class[..n]);
        let monitor = MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(notch, MONITOR_DEFAULTTONEAREST) {
            return "normal";
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetMonitorInfoW(monitor, &mut info) == 0 || GetWindowRect(front, &mut r) == 0 {
            return "normal";
        }
        let program = super::apps::exe_path(pid).and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned())).unwrap_or_default();
        state_of(&class, &program, IsZoomed(front) != 0, r, info.rcMonitor)
    }
}

/// Windows' own windows that cover the display without being an app on it: the desktop and the taskbars, Alt+Tab
/// and Task view (by class), and (by program) Start, Search, the notification center, and the emoji panel, Win+V's
/// clipboard history and the touch keyboard (TextInputHost, a transparent window as big as the display).
const SHELL_CLASSES: [&str; 6] = ["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "XamlExplorerHostIslandWindow", "MultitaskingViewFrame"];
const SHELL_PROGRAMS: [&str; 6] = ["textinputhost.exe", "startmenuexperiencehost.exe", "searchhost.exe", "searchapp.exe", "shellexperiencehost.exe", "shellhost.exe"];

/// `foreground_state` for the window in front: its class and program (file name), whether it's maximised, its
/// rectangle and its display's.
fn state_of(class: &str, program: &str, zoomed: bool, r: windows_sys::Win32::Foundation::RECT, display: windows_sys::Win32::Foundation::RECT) -> &'static str {
    if SHELL_CLASSES.contains(&class) || SHELL_PROGRAMS.contains(&program.to_ascii_lowercase().as_str()) {
        return "normal";
    }
    if zoomed {
        return "max";
    }
    let s = display;
    if r.left <= s.left && r.top <= s.top && r.right >= s.right && r.bottom >= s.bottom { "full" } else { "normal" }
}

/// Takes the window out of sight (DWM's cloak: not drawn, not clicked) or brings it back, while Tauri keeps it as
/// shown. Hiding it through Tauri and showing it from here left Tauri thinking it hidden, and Tauri's next change to
/// the window (a hover's click-through) hid it again: the notch vanished under the mouse.
///
/// # Safety
/// `handle` must be a live HWND of this process. Null is ignored.
pub unsafe fn set_cloaked(handle: *mut c_void, cloaked: bool) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
    let h = handle as HWND;
    if h.is_null() {
        return;
    }
    let on = i32::from(cloaked);
    // SAFETY: a 4-byte BOOL for the window's own attribute
    unsafe { DwmSetWindowAttribute(h, DWMWA_CLOAK as u32, (&raw const on).cast(), 4) };
}

/// Keeps maximised windows below a strip `height` points tall across the top of the display Sympony's window
/// `handle` is on (Settings → General → Keep windows below Sympony: `appbar.rs`); 0 gives the space back.
///
/// # Safety
/// `handle` must be a live HWND of this process, or null when `height` is 0.
pub unsafe fn reserve_top(handle: *mut c_void, height: f64) {
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    let h = handle as HWND;
    if height <= 0.0 || h.is_null() {
        super::appbar::set(None);
        return;
    }
    unsafe {
        let monitor = MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return;
        }
        let (mut dpi, mut unused) = (96u32, 0u32);
        GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi, &mut unused);
        let px = (height * dpi.max(96) as f64 / 96.0).round() as i32;
        let r = info.rcMonitor;
        super::appbar::set(Some((r.left, r.top, r.right, px)));
    }
}

#[cfg(test)]
mod tests {
    use super::state_of;
    use windows_sys::Win32::Foundation::RECT;

    #[test]
    fn alpha_0_cloaks_a_window_and_more_shows_it_again() {
        use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_POPUP};
        // (a window of the test's own that's never shown)
        let h = unsafe { CreateWindowExW(0, windows_sys::core::w!("STATIC"), windows_sys::core::w!(""), WS_POPUP, 0, 0, 10, 10, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null()) };
        assert!(!h.is_null());
        let cloaked = || {
            let mut v = 0u32;
            // SAFETY: a 4-byte flags value for the test's own window
            unsafe { DwmGetWindowAttribute(h, DWMWA_CLOAKED as u32, (&raw mut v).cast(), 4) };
            v
        };
        unsafe { super::set_window_alpha(h.cast(), 0.0) };
        assert_ne!(cloaked(), 0, "cloaked at 0");
        unsafe { super::set_window_alpha(h.cast(), 1.0) };
        assert_eq!(cloaked(), 0, "shown again at 1");
        unsafe { super::set_window_alpha(std::ptr::null_mut(), 0.0) }; // (null: nothing)
        unsafe { DestroyWindow(h) };
    }

    const DISPLAY: RECT = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };

    #[test]
    fn an_app_over_the_whole_display_is_fullscreen() {
        assert_eq!(state_of("Chrome_WidgetWin_1", "chrome.exe", false, DISPLAY, DISPLAY), "full");
        assert_eq!(state_of("UnityWndClass", "game.exe", false, RECT { left: -1, top: -1, right: 1921, bottom: 1081 }, DISPLAY), "full");
    }

    #[test]
    fn maximised_and_smaller_windows_are_not() {
        assert_eq!(state_of("Chrome_WidgetWin_1", "chrome.exe", true, RECT { left: -9, top: -9, right: 1929, bottom: 1029 }, DISPLAY), "max");
        assert_eq!(state_of("Notepad", "notepad.exe", false, RECT { left: 100, top: 100, right: 900, bottom: 700 }, DISPLAY), "normal");
    }

    #[test]
    fn windows_own_overlays_over_the_display_are_no_app() {
        // (the emoji panel, Win+V's clipboard history and the touch keyboard; Start; Search; Alt+Tab and Task view)
        for (class, program) in [
            ("Windows.UI.Core.CoreWindow", "TextInputHost.exe"),
            ("Windows.UI.Core.CoreWindow", "StartMenuExperienceHost.exe"),
            ("Windows.UI.Core.CoreWindow", "SearchHost.exe"),
            ("Windows.UI.Core.CoreWindow", "ShellExperienceHost.exe"),
            ("XamlExplorerHostIslandWindow", "explorer.exe"),
            ("MultitaskingViewFrame", "explorer.exe"),
            ("WorkerW", "explorer.exe"),
            ("Shell_TrayWnd", "explorer.exe"),
        ] {
            assert_eq!(state_of(class, program, false, DISPLAY, DISPLAY), "normal", "{class} of {program}");
        }
    }
}
