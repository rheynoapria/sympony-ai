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

/// The floating Pony chat window: transparent rounded panel, native macOS shadow, focusable,
/// optionally pinned above normal apps (level 3) across Spaces and fullscreen apps. Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn style_floating_chat_window(ns_window: *mut std::ffi::c_void, always_on_top: bool) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    win.setOpaque(false);
    win.setBackgroundColor(Some(&objc2_app_kit::NSColor::clearColor()));
    win.setHasShadow(true);
    unsafe { set_floating_chat_pin(ns_window, always_on_top) };
}

/// Switches the floating Pony chat window between pinned floating (level 3, all Spaces)
/// and standard window level (level 0, active Space). Main thread.
///
/// # Safety
/// `ns_window` must be a live NSWindow. Null is ignored.
pub unsafe fn set_floating_chat_pin(ns_window: *mut std::ffi::c_void, always_on_top: bool) {
    let Some(win) = (unsafe { (ns_window as *const NSWindow).as_ref() }) else { return };
    if always_on_top {
        win.setLevel(3);
        win.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
    } else {
        win.setLevel(0);
        win.setCollectionBehavior(NSWindowCollectionBehavior::MoveToActiveSpace);
    }
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

/// What the app in front does on Sympony's display, for the notch to make way ("full", "max" or "normal"): a Mac's
/// notch never hides or tucks for another app, so always "normal".
///
/// # Safety
/// Nothing is dereferenced.
pub unsafe fn foreground_state(_ns_window: *mut std::ffi::c_void) -> &'static str {
    "normal"
}

/// Out of sight for a fullscreen app, which a Mac's notch never is: nothing to do.
///
/// # Safety
/// Nothing is dereferenced.
pub unsafe fn set_cloaked(_ns_window: *mut std::ffi::c_void, _cloaked: bool) {}

/// Keep windows below Sympony is Windows' (a Mac's menu bar already keeps windows below the notch): nothing to do.
///
/// # Safety
/// Nothing is dereferenced.
pub unsafe fn reserve_top(_ns_window: *mut std::ffi::c_void, _height: f64) {}

/// How Keep windows below Sympony's strip looks (Windows): no strip on a Mac.
pub fn reserve_look(_frost: f64, _match_app: bool) {}

/// The album art's colours for that strip (Windows): no strip on a Mac.
pub fn reserve_art(_art: Option<(u32, u32, i32)>) {}
