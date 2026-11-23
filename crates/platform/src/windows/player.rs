//! A stream player for the radio (stand-in: nothing plays yet).

#[derive(Debug, PartialEq)]
pub enum State {
    Stopped,
    Connecting,
    Playing,
    /// the player's reason
    Failed(String),
}

/// Plays `url` at `volume` (0-1) instead of what played. False: it didn't start.
pub fn play(_url: &str, _volume: f32) -> bool {
    false
}

pub fn stop() {}

pub fn set_volume(_volume: f32) {}

pub fn state() -> State {
    State::Stopped
}
