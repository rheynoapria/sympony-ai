use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

/// The notch window: above the menu bar (level 25: the main menu's 24 + 1), on every Space and over fullscreen apps,
/// staying put in Exposé, no shadow. Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow: Tauri's `WebviewWindow::ns_window()`. Null is ignored.
pub unsafe fn style_notch_window(ns_window: *mut std::ffi::c_void) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setLevel(25);
    win.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    win.setHasShadow(false);
}

/// The onboarding window: transparent, no shadow, all Spaces, focusable, at `level` (25 above menu bar for opening,
/// 3 floating for card, 0 normal when lowered behind dialogs / System Settings). Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow: Tauri's `WebviewWindow::ns_window()`. Null is ignored.
pub unsafe fn style_onboarding_window(ns_window: *mut std::ffi::c_void, level: isize) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setLevel(level);
    win.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    );
    win.setHasShadow(false);
    win.setOpaque(false);
    win.setBackgroundColor(Some(&objc2_app_kit::NSColor::clearColor()));
}

/// Changes an NSWindow's level and optionally orders it behind or in front of normal windows. Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn set_window_level(ns_window: *mut std::ffi::c_void, level: isize, lower: Option<bool>) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setLevel(level);
    match lower {
        Some(true) => win.orderBack(None),
        Some(false) => win.orderFrontRegardless(),
        None => {}
    }
}

/// Toggles an NSWindow's native drop shadow. Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn set_window_shadow(ns_window: *mut std::ffi::c_void, shadow: bool) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setHasShadow(shadow);
}

/// Sets an NSWindow's alpha value (`0.0` hidden .. `1.0` opaque). Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn set_window_alpha(ns_window: *mut std::ffi::c_void, alpha: f64) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setAlphaValue(alpha);
}

/// Lets clicks pass through an NSWindow to what's under it (an overlay that only shows). Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn set_click_through(ns_window: *mut std::ffi::c_void, through: bool) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setIgnoresMouseEvents(through);
}

/// Puts one of Sympony's own windows in front of every app now and gives it the keyboard: a window shown while
/// another app is active stays behind it otherwise (macOS no longer lets a background app's plain activate through).
/// Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn bring_front(ns_window: *mut std::ffi::c_void) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.orderFrontRegardless();
    win.makeKeyWindow();
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        #[allow(deprecated)]
        objc2_app_kit::NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
    }
}
