use crate::geometry::{Display, Rect};
use objc2::MainThreadMarker;
use objc2_app_kit::NSScreen;
use objc2_foundation::{ns_string, NSNumber};

/// Every display, in desktop coordinates with a top-left origin (AppKit's are bottom-left from the main screen).
/// The camera notch is the gap between the two "auxiliary top" areas macOS reports beside it.
pub fn displays(mtm: MainThreadMarker) -> Vec<Display> {
    let screens = NSScreen::screens(mtm);
    let Some(first) = screens.firstObject() else { return vec![] };
    let main_h = first.frame().size.height;
    screens
        .iter()
        .map(|s| {
            let f = s.frame();
            let top = main_h - (f.origin.y + f.size.height);
            let frame = Rect { x: f.origin.x, y: top, w: f.size.width, h: f.size.height };
            let inset = s.safeAreaInsets().top;
            let camera = if inset > 0.0 {
                let (l, r) = (s.auxiliaryTopLeftArea(), s.auxiliaryTopRightArea());
                let x0 = l.origin.x + l.size.width;
                let x1 = r.origin.x;
                (x1 > x0).then(|| Rect { x: x0, y: top, w: x1 - x0, h: inset })
            } else {
                None
            };
            let id = s
                .deviceDescription()
                .objectForKey(ns_string!("NSScreenNumber"))
                .and_then(|v| v.downcast::<NSNumber>().ok())
                .map(|n| n.unsignedIntValue())
                .unwrap_or(0);
            Display { id, name: s.localizedName().to_string(), frame, camera, main: f.origin.x == 0.0 && f.origin.y == 0.0 }
        })
        .collect()
}

/// `displays` from any thread on the main one's behalf: empty off the main thread.
pub fn displays_here() -> Vec<Display> {
    MainThreadMarker::new().map(displays).unwrap_or_default()
}

/// Whether any mouse button is down now.
pub fn mouse_down() -> bool {
    objc2_app_kit::NSEvent::pressedMouseButtons() != 0
}

/// The Dock's approximate rect in display-local top-left coordinates, derived from `NSScreen.frame` vs `visibleFrame`.
/// Returns `None` when the Dock is hidden or not on this display. Main thread.
pub fn dock_rect(mtm: MainThreadMarker, display_id: u32) -> Option<Rect> {
    let screens = NSScreen::screens(mtm);
    for s in screens.iter() {
        let id = s
            .deviceDescription()
            .objectForKey(ns_string!("NSScreenNumber"))
            .and_then(|v| v.downcast::<NSNumber>().ok())
            .map(|n| n.unsignedIntValue())
            .unwrap_or(0);
        if id != display_id {
            continue;
        }
        let f = s.frame();
        let v = s.visibleFrame();
        // Bottom Dock (most common): visibleFrame.origin.y sits above frame.origin.y in AppKit bottom-left coords.
        let bottom_gap = v.origin.y - f.origin.y;
        if bottom_gap > 16.0 {
            let h = (bottom_gap - 10.0).max(44.0).round();
            let w = (f.size.width * 0.44).clamp(300.0, 720.0).round();
            let x = ((f.size.width - w) * 0.5).round();
            let y = (f.size.height - h - 6.0).max(0.0).round();
            return Some(Rect { x, y, w, h });
        }
        // Left Dock
        let left_gap = v.origin.x - f.origin.x;
        if left_gap > 16.0 {
            let w = (left_gap - 10.0).max(44.0).round();
            let h = (f.size.height * 0.52).clamp(240.0, 620.0).round();
            let y = ((f.size.height - h) * 0.5).round();
            return Some(Rect { x: 6.0, y, w, h });
        }
        // Right Dock
        let right_gap = (f.origin.x + f.size.width) - (v.origin.x + v.size.width);
        if right_gap > 16.0 {
            let w = (right_gap - 10.0).max(44.0).round();
            let h = (f.size.height * 0.52).clamp(240.0, 620.0).round();
            let x = (f.size.width - w - 6.0).max(0.0).round();
            let y = ((f.size.height - h) * 0.5).round();
            return Some(Rect { x, y, w, h });
        }
        return None;
    }
    None
}

/// The mouse in desktop coordinates (top-left origin); main thread.
pub fn mouse_location(mtm: MainThreadMarker) -> (f64, f64) {
    let p = objc2_app_kit::NSEvent::mouseLocation();
    let main_h = NSScreen::screens(mtm).firstObject().map(|s| s.frame().size.height).unwrap_or(0.0);
    (p.x, main_h - p.y)
}
