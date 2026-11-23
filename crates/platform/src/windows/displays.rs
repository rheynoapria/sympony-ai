//! Displays and the pointer (stand-in: no displays known yet). Coordinates as on macOS: the whole desktop's, top-left
//! origin, in points.
use super::MainThreadMarker;
use crate::geometry::{Display, Rect};

pub fn displays(_mtm: MainThreadMarker) -> Vec<Display> {
    vec![]
}

pub fn displays_here() -> Vec<Display> {
    vec![]
}

pub fn mouse_down() -> bool {
    false
}

/// The taskbar's rectangle on `display_id` (the Dock's on macOS).
pub fn dock_rect(_mtm: MainThreadMarker, _display_id: u32) -> Option<Rect> {
    None
}

pub fn mouse_location(_mtm: MainThreadMarker) -> (f64, f64) {
    (0.0, 0.0)
}
