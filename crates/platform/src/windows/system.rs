//! Sound, screen, power, and the System tab's readings. Sound (Core Audio: `audio.rs`), the built-in screen's
//! brightness (WMI: `brightness.rs`), keeping awake and the screenshot tool work; the rest is a stand-in for now
//! (nothing read yet).
use crate::geometry::Rect;
use serde_json::{json, Value};
use std::sync::Mutex;

pub use super::audio::{audio_devices, mic, set_default_device, set_volume, toggle_mic, toggle_mute, volume};
pub use super::brightness::{brightness, set_brightness};

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

pub fn caps_lock() -> bool {
    false
}

pub fn input_source() -> Option<(String, String, usize)> {
    None
}

/// `{hasBattery, level, pluggedIn, charging, saver, secondsLeft}`, as on macOS: here the "no battery" reading.
pub fn power() -> Value {
    json!({ "hasBattery": false, "level": 100, "pluggedIn": true, "charging": false, "saver": false })
}

pub fn cpu_ticks() -> Option<[u32; 4]> {
    None
}

pub fn cpu_model() -> String {
    String::new()
}

pub fn memory() -> Option<(u64, [u64; 5])> {
    None
}

pub fn disk() -> Option<(u64, u64)> {
    None
}

pub fn disk_name() -> Option<String> {
    None
}

pub fn memory_pressure() -> Option<u32> {
    None
}

/// (bytes in, bytes out, online)
pub fn network() -> (u64, u64, bool) {
    (0, 0, false)
}

pub fn idle_secs() -> f64 {
    0.0
}

pub fn fullscreen_front() -> bool {
    false
}

pub fn onscreen_windows(_display: Rect, _skip_pid: u32) -> Vec<Rect> {
    vec![]
}

/// Whether Focus (Do not disturb) is on.
pub fn focus_on() -> bool {
    false
}

pub fn screen_locked() -> bool {
    false
}
