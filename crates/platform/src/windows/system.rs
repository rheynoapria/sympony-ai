//! Sound, screen, power, and the System tab's readings. Sound is read and set (Core Audio: `audio.rs`); the rest is
//! a stand-in for now (nothing read yet).
use crate::geometry::Rect;
use serde_json::{json, Value};

pub use super::audio::{audio_devices, mic, set_default_device, set_volume, toggle_mic, toggle_mute, volume};

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

pub fn screen_locked() -> bool {
    false
}
