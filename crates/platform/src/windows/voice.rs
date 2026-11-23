//! Dictation's key and typing (stand-in: the key isn't watched and text isn't typed yet; a low-level keyboard hook and
//! SendInput later). Recording itself is `crate::voice::CpalCapture`, which already works on Windows.
use crate::voice::{Insert, InsertResult, Trigger, TriggerEvent, VoiceKey};
use std::sync::mpsc::Sender;

/// `"granted" | "denied" | "notAsked"`, as on macOS. Windows lets desktop apps use the microphone unless the user
/// turned that off in Privacy settings, which isn't read yet.
pub fn mic_status() -> &'static str {
    "granted"
}

pub fn mic_request() {}

pub fn is_secure_input_enabled() -> bool {
    false
}

/// The dictation key's watcher (macOS: `MacTrigger`).
#[derive(Default)]
pub struct WinTrigger;

impl WinTrigger {
    pub fn new() -> Self {
        Self
    }

    pub fn reset_state(&self) {}
}

impl Trigger for WinTrigger {
    fn start(&self, _key: VoiceKey, _tx: Sender<TriggerEvent>) -> Result<(), String> {
        Err("the dictation key isn't available on Windows yet".into())
    }

    fn stop(&self) {}
}

/// Puts dictated text where the user types (macOS: `MacInsert`).
#[derive(Default)]
pub struct WinInsert;

impl WinInsert {
    pub fn new() -> Self {
        Self
    }

    pub fn copy_only(&self, _text: &str) -> InsertResult {
        InsertResult::Failed("the clipboard isn't available on Windows yet".into())
    }
}

impl Insert for WinInsert {
    fn insert(&self, _text: &str) -> InsertResult {
        InsertResult::Failed("typing isn't available on Windows yet".into())
    }
}
