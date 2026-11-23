//! Sound, screen, power, and the System tab's readings (stand-in: nothing read yet).
use crate::geometry::Rect;
use serde_json::{json, Value};

/// (id, name, is the default) of each output (`input` false) or input device.
pub fn audio_devices(_input: bool) -> Vec<(u32, String, bool)> {
    vec![]
}

pub fn set_default_device(_id: u32, _input: bool) -> bool {
    false
}

/// (level 0-100, muted)
pub fn volume() -> Option<(u8, bool)> {
    None
}

pub fn set_volume(_level: u8) {}

pub fn toggle_mute() {}

pub fn brightness() -> Option<u8> {
    None
}

pub fn set_brightness(_level: u8) {}

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

/// (a mic in use, muted)
pub fn mic() -> (bool, bool) {
    (false, false)
}

pub fn toggle_mic() {}

pub fn screen_locked() -> bool {
    false
}
