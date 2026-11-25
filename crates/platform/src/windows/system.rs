//! Sound, screen, power, the keyboard, the session, and the System tab's readings: sound (Core Audio: `audio.rs`),
//! the built-in screen's brightness (WMI: `brightness.rs`), the battery and the System tab (`readings.rs`); here
//! keeping awake, the screenshot tool, Caps Lock and the keyboard language, idle time, the lock screen, a fullscreen
//! app, the windows on screen and Do not disturb.
use crate::geometry::Rect;
use std::sync::Mutex;

pub use super::audio::{audio_devices, mic, set_default_device, set_volume, toggle_mic, toggle_mute, volume};
pub use super::brightness::{brightness, set_brightness};
pub use super::readings::{cpu_model, cpu_ticks, disk, disk_name, installed_memory, memory, memory_pressure, network, power};

/// Keep awake (Control tab): a power request keeps the screen on and the PC from sleeping, as macOS's `caffeinate -di`
/// does, until it's turned off or Sympony quits (Windows drops it with the process). `powercfg /requests` lists it.
pub fn keep_awake(on: bool) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Power::{PowerClearRequest, PowerCreateRequest, PowerSetRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired};
    use windows_sys::Win32::System::Threading::{POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0};
    // (the request's handle, as a number: a raw handle isn't Send)
    static REQUEST: Mutex<Option<usize>> = Mutex::new(None);
    const KINDS: [i32; 2] = [PowerRequestDisplayRequired, PowerRequestSystemRequired];
    let mut request = REQUEST.lock().unwrap();
    match (on, *request) {
        (true, None) => {
            let mut why = super::shell::wide("Keep awake (Sympony)");
            // (POWER_REQUEST_CONTEXT_VERSION is 0)
            let reason = REASON_CONTEXT { Version: 0, Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING, Reason: REASON_CONTEXT_0 { SimpleReasonString: why.as_mut_ptr() } };
            // SAFETY: the reason and its string outlive the call (Windows copies them); the handle is checked, kept
            // and closed below
            unsafe {
                let h = PowerCreateRequest(&reason);
                if !h.is_null() && h != INVALID_HANDLE_VALUE {
                    for k in KINDS {
                        PowerSetRequest(h, k);
                    }
                    *request = Some(h as usize);
                }
            }
        }
        (false, Some(h)) => {
            let h = h as HANDLE;
            // SAFETY: the handle PowerCreateRequest gave, closed once
            unsafe {
                for k in KINDS {
                    PowerClearRequest(h, k);
                }
                CloseHandle(h);
            }
            *request = None;
        }
        _ => {}
    }
}

/// Opens Windows' snip overlay (Snipping Tool's, what Win+Shift+S opens).
pub fn screenshot() {
    super::shell::open("ms-screenclip:");
}

/// Whether Caps Lock is on.
pub fn caps_lock() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CAPITAL};
    // SAFETY: a plain query (its low bit: the key's toggle)
    unsafe { GetKeyState(VK_CAPITAL as i32) & 1 != 0 }
}

/// The keyboard language of the app in front: (short code, its name, how many keyboard languages there are), e.g.
/// ("EN", "English (United States)", 2).
pub fn input_source() -> Option<(String, String, usize)> {
    use windows_sys::Win32::Globalization::{GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SLOCALIZEDDISPLAYNAME};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardLayout, GetKeyboardLayoutList};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    // SAFETY: plain queries; the buffers' lengths are passed with them
    unsafe {
        let thread = GetWindowThreadProcessId(GetForegroundWindow(), std::ptr::null_mut());
        // (a keyboard layout's low word is its language)
        let language = (GetKeyboardLayout(thread) as usize & 0xffff) as u32;
        let mut locale = [0u16; 85];
        let n = LCIDToLocaleName(language, locale.as_mut_ptr(), locale.len() as i32, 0);
        if n <= 1 {
            return None;
        }
        let tag = String::from_utf16_lossy(&locale[..n as usize - 1]);
        let code = tag.split(['-', '_']).next().unwrap_or("").to_uppercase();
        let mut name = [0u16; 128];
        let m = GetLocaleInfoEx(locale.as_ptr(), LOCALE_SLOCALIZEDDISPLAYNAME, name.as_mut_ptr(), name.len() as i32);
        let name = if m > 1 { String::from_utf16_lossy(&name[..m as usize - 1]) } else { tag };
        let count = GetKeyboardLayoutList(0, std::ptr::null_mut()).max(1) as usize;
        Some((code, name, count))
    }
}

/// Seconds since the last keyboard or mouse input (any app).
pub fn idle_secs() -> f64 {
    use windows_sys::Win32::System::SystemInformation::GetTickCount;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut last = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: a struct whose cbSize says its size, for Windows to fill
    if unsafe { GetLastInputInfo(&mut last) } == 0 {
        return 0.0;
    }
    // (both in the same 32-bit milliseconds, which wrap every 49.7 days)
    f64::from(unsafe { GetTickCount() }.wrapping_sub(last.dwTime)) / 1000.0
}

/// Whether the app in front is fullscreen (a game, a video, a presentation), as Windows tells apps that would
/// otherwise interrupt (SHQueryUserNotificationState).
pub fn fullscreen_front() -> bool {
    use windows_sys::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    let mut state = 0;
    // SAFETY: one value for Windows to fill
    let asked = unsafe { SHQueryUserNotificationState(&mut state) == 0 };
    asked && [QUNS_BUSY, QUNS_RUNNING_D3D_FULL_SCREEN, QUNS_PRESENTATION_MODE].contains(&state)
}

/// Other apps' windows on screen on `display` (its own, minimised, hidden, cloaked and tool windows left out), in
/// display-local points, as macOS gives them: windows of at least 120 x 80 whose centre is on that display, clipped
/// to it, at most 12. No window title is read.
pub fn onscreen_windows(display: Rect, skip_pid: u32) -> Vec<Rect> {
    use windows_sys::core::BOOL;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowLongW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, WS_EX_TOOLWINDOW};
    unsafe extern "system" fn each(h: HWND, out: LPARAM) -> BOOL {
        // SAFETY: `out` is the Vec passed below, alive for the whole (synchronous) enumeration
        unsafe { (*(out as *mut Vec<HWND>)).push(h) };
        1
    }
    let mut all: Vec<HWND> = vec![];
    // SAFETY: each top-level window is handed to `each` before EnumWindows returns
    unsafe { EnumWindows(Some(each), &mut all as *mut Vec<HWND> as LPARAM) };
    let mut out = vec![];
    for h in all {
        // SAFETY: plain queries on a window that may go away meanwhile (they then fail, and it's skipped)
        let bounds = unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            let (mut cloaked, mut r) = (0u32, RECT { left: 0, top: 0, right: 0, bottom: 0 });
            let tool = GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0;
            let hidden = IsWindowVisible(h) == 0 || IsIconic(h) != 0 || tool || pid == skip_pid;
            let cloaked = DwmGetWindowAttribute(h, DWMWA_CLOAKED as u32, (&raw mut cloaked).cast(), 4) == 0 && cloaked != 0;
            let framed = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS as u32, (&raw mut r).cast(), std::mem::size_of::<RECT>() as u32) == 0;
            (!hidden && !cloaked && framed).then(|| super::displays::points_of(r))
        };
        let Some(w) = bounds else { continue };
        if w.w < 120.0 || w.h < 80.0 {
            continue;
        }
        let (cx, cy) = (w.x + w.w * 0.5, w.y + w.h * 0.5);
        if cx < display.x || cx > display.x + display.w || cy < display.y || cy > display.y + display.h {
            continue;
        }
        let (l, t) = ((w.x - display.x).max(0.0), (w.y - display.y).max(0.0));
        let (r, b) = ((w.x + w.w - display.x).min(display.w), (w.y + w.h - display.y).min(display.h));
        if r - l >= 100.0 && b - t >= 60.0 {
            out.push(Rect { x: l.round(), y: t.round(), w: (r - l).round(), h: (b - t).round() });
            if out.len() >= 12 {
                break;
            }
        }
    }
    out
}

/// Whether Focus (Do not disturb) is on: Windows holding notifications back, by hand or by its own rules (a game, a
/// presentation…).
pub fn focus_on() -> bool {
    use ::windows::UI::Notifications::{ToastNotificationManager, ToastNotificationMode};
    super::mta();
    ToastNotificationManager::GetDefault().and_then(|m| m.NotificationMode()).is_ok_and(|m| m != ToastNotificationMode::Unrestricted)
}

/// Do not disturb on or off, as the notification centre's bell does: through Windows' quiet hours settings
/// (IQuietHoursSettings, undocumented; Do not disturb is its "priority only" profile). False when Windows refused.
pub fn set_focus(on: bool) -> bool {
    use ::windows::core::{HRESULT, PCWSTR};
    // (QuietHoursSettings, IQuietHoursSettings: get_UserSelectedProfile, then put_UserSelectedProfile, the 5th)
    const PUT_USER_SELECTED_PROFILE: usize = 4;
    type PutUserSelectedProfile = unsafe extern "system" fn(*mut std::ffi::c_void, PCWSTR) -> HRESULT;
    let Some(q) = super::Undocumented::new(0xf53321fa_34f8_4b7f_b9a3_361877cb94cf, 0x6bff4732_81ec_4ffb_ae67_b6c1bc29631f) else { return false };
    let profile = super::shell::wide(if on { "Microsoft.QuietHoursProfile.PriorityOnly" } else { "Microsoft.QuietHoursProfile.Unrestricted" });
    // SAFETY: put_UserSelectedProfile's own signature, called with its object and a NUL-terminated id that outlives it
    unsafe {
        let (this, call) = q.method::<PutUserSelectedProfile>(PUT_USER_SELECTED_PROFILE);
        call(this, PCWSTR(profile.as_ptr())).is_ok()
    }
}

/// The PC's name, as Settings → System → About shows it ("Device name"), else `COMPUTERNAME`, else "PC".
pub fn computer_name() -> String {
    use windows_sys::Win32::System::SystemInformation::{ComputerNamePhysicalDnsHostname, GetComputerNameExW};
    let mut need = 0u32;
    // SAFETY: first asked how long it is (no buffer), then given a buffer that long; it says how much it wrote
    let name = unsafe {
        GetComputerNameExW(ComputerNamePhysicalDnsHostname, std::ptr::null_mut(), &mut need);
        let mut buf = vec![0u16; need.max(1) as usize];
        let mut n = buf.len() as u32;
        if GetComputerNameExW(ComputerNamePhysicalDnsHostname, buf.as_mut_ptr(), &mut n) != 0 { String::from_utf16_lossy(&buf[..(n as usize).min(buf.len())]) } else { String::new() }
    };
    Some(name).filter(|n| !n.trim().is_empty()).or_else(|| std::env::var("COMPUTERNAME").ok().filter(|n| !n.trim().is_empty())).unwrap_or_else(|| "PC".into())
}

/// Whether this session's screen is locked (Win+L, or the lock screen after sleep).
pub fn screen_locked() -> bool {
    use windows_sys::Win32::System::RemoteDesktop::{WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK};
    let (mut info, mut size) = (std::ptr::null_mut(), 0u32);
    // SAFETY: Windows allocates the answer, read while it's held and freed once; the local server is "no handle"
    unsafe {
        if WTSQuerySessionInformationW(std::ptr::null_mut(), WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut info, &mut size) == 0 || info.is_null() {
            return false;
        }
        let ex = &*(info as *const WTSINFOEXW);
        let locked = size as usize >= std::mem::size_of::<WTSINFOEXW>() && ex.Level == 1 && ex.Data.WTSInfoExLevel1.SessionFlags as u32 == WTS_SESSIONSTATE_LOCK;
        WTSFreeMemory(info.cast());
        locked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pc_is_called_what_windows_calls_it() {
        let host = std::process::Command::new("hostname").output().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        assert!(!host.is_empty());
        assert_eq!(computer_name(), host);
    }
}
