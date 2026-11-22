//! Change detection for the system watchers: a message only when a reading really changed.
use serde_json::Value;

#[derive(Default)]
pub struct Watch<T> {
    last: Option<T>,
}

impl<T: PartialEq + Clone> Watch<T> {
    /// `Some((new, previous))` when the reading differs from the last one (the first reading counts, with no previous).
    pub fn update(&mut self, now: T) -> Option<(T, Option<T>)> {
        if self.last.as_ref() == Some(&now) {
            return None;
        }
        Some((now.clone(), self.last.replace(now)))
    }
}

/// Which lock key flipped (the frontend's HUD names it). macOS has Caps Lock only.
pub fn lockkeys_changed(prev: &Value, now: &Value) -> Option<&'static str> {
    ["caps", "num", "scroll"].into_iter().find(|k| !now[*k].is_null() && prev[*k] != now[*k])
}
