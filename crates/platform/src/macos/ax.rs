//! Other apps' windows through Accessibility, for Pony's Eyes (read the front window as a list of elements) and Hands
//! (focus, press, type real keys). Needs the Accessibility permission (`banners::trusted`).
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::NSWorkspace;
use objc2_foundation::{NSArray, NSNumber, NSString, NSURL};
use std::ffi::c_void;

type Ref = *const c_void;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Pt {
    x: f64,
    y: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> Ref;
    fn AXUIElementCopyAttributeValue(el: Ref, attr: Ref, out: *mut Ref) -> i32;
    fn AXUIElementSetAttributeValue(el: Ref, attr: Ref, value: Ref) -> i32;
    fn AXUIElementPerformAction(el: Ref, action: Ref) -> i32;
    fn AXUIElementSetMessagingTimeout(el: Ref, secs: f32) -> i32;
    fn AXValueGetValue(v: Ref, kind: u32, out: *mut c_void) -> u8;
    fn AXValueGetType(v: Ref) -> u32;
    fn AXUIElementCopyMultipleAttributeValues(el: Ref, names: Ref, options: u32, out: *mut Ref) -> i32;
    fn CFRetain(cf: Ref) -> Ref;
    fn CFRelease(cf: Ref);
    fn CFEqual(a: Ref, b: Ref) -> u8;
    fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
    fn CGEventKeyboardSetUnicodeString(ev: *mut c_void, len: usize, chars: *const u16);
    fn CGEventPost(tap: u32, ev: *mut c_void);
    fn CGWindowListCopyWindowInfo(option: u32, relative: u32) -> *mut c_void;
    fn CGEventSetFlags(ev: *mut c_void, flags: u64);
    fn CGEventCreateMouseEvent(source: *mut c_void, kind: u32, at: Pt, button: u32) -> *mut c_void;
    fn CGEventSetIntegerValueField(ev: *mut c_void, field: u32, value: i64);
    fn CGEventCreateScrollWheelEvent(source: *mut c_void, units: u32, count: u32, wheel1: i32, ...) -> *mut c_void;
    fn CGEventSetLocation(ev: *mut c_void, at: Pt);
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[link(name = "CoreServices", kind = "framework")]
unsafe extern "C" {
    fn LSCopyDefaultHandlerForURLScheme(scheme: Ref) -> Ref;
}

/// The bundle id of the app that opens web links (the default browser).
pub fn default_browser() -> Option<String> {
    objc2::rc::autoreleasepool(|_| {
        let s = ns("https");
        let r = unsafe { LSCopyDefaultHandlerForURLScheme(Retained::as_ptr(&s) as Ref) };
        if r.is_null() {
            return None;
        }
        let v: Retained<NSString> = unsafe { Retained::from_raw(r as *mut NSString)? };
        Some(v.to_string())
    })
}

const AX_POINT: u32 = 1;
const AX_SIZE: u32 = 2;

fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

/// An AX element we hold (released when dropped).
pub struct El(Ref);
unsafe impl Send for El {}
impl Drop for El {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) }
        }
    }
}
impl Clone for El {
    fn clone(&self) -> Self {
        if self.0.is_null() {
            El(std::ptr::null())
        } else {
            El(unsafe { CFRetain(self.0) })
        }
    }
}
impl PartialEq for El {
    fn eq(&self, o: &Self) -> bool {
        if self.0.is_null() || o.0.is_null() {
            self.0 == o.0
        } else {
            unsafe { CFEqual(self.0, o.0) != 0 }
        }
    }
}

impl El {
    pub fn app(pid: i32) -> El {
        let e = El(unsafe { AXUIElementCreateApplication(pid) });
        if !e.0.is_null() {
            unsafe { AXUIElementSetMessagingTimeout(e.0, 1.5) };
        }
        e
    }
    fn raw(&self, name: &str) -> Option<Retained<AnyObject>> {
        if self.0.is_null() {
            return None;
        }
        let mut out: Ref = std::ptr::null();
        let n = ns(name);
        if unsafe { AXUIElementCopyAttributeValue(self.0, Retained::as_ptr(&n) as Ref, &mut out) } != 0 || out.is_null() {
            return None;
        }
        unsafe { Retained::from_raw(out as *mut AnyObject) }
    }
    pub fn text(&self, name: &str) -> String {
        self.raw(name).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string()).unwrap_or_default()
    }
    /// A text value, or a number's (a checkbox's 0 / 1)
    pub fn value(&self, name: &str) -> String {
        let Some(v) = self.raw(name) else { return String::new() };
        match v.downcast::<NSString>() {
            Ok(s) => s.to_string(),
            Err(v) => v.downcast::<NSNumber>().map(|n| n.stringValue().to_string()).unwrap_or_default(),
        }
    }
    pub fn flag(&self, name: &str) -> Option<bool> {
        self.raw(name).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.as_bool())
    }
    pub fn number(&self, name: &str) -> Option<f64> {
        self.raw(name).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.as_f64())
    }
    pub fn url(&self) -> String {
        self.raw("AXURL").and_then(|v| v.downcast::<NSURL>().ok()).and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default()
    }
    pub fn strings(&self, name: &str) -> Vec<String> {
        let Some(v) = self.raw(name) else { return vec![] };
        let Ok(arr) = v.downcast::<NSArray>() else { return vec![] };
        arr.iter().filter_map(|s| s.downcast::<NSString>().ok().map(|s| s.to_string())).collect()
    }
    pub fn el(&self, name: &str) -> Option<El> {
        let v = self.raw(name)?;
        Some(El(unsafe { CFRetain(Retained::as_ptr(&v) as Ref) }))
    }
    pub fn children(&self) -> Vec<El> {
        let Some(v) = self.raw("AXChildren") else { return vec![] };
        let Ok(arr) = v.downcast::<NSArray>() else { return vec![] };
        arr.iter().map(|c| El(unsafe { CFRetain(Retained::as_ptr(&c) as Ref) })).collect()
    }
    /// (x, y, width, height) on screen
    pub fn frame(&self) -> (f64, f64, f64, f64) {
        let get = |name: &str, kind: u32| {
            let mut p = Pt::default();
            if let Some(v) = self.raw(name) {
                unsafe { AXValueGetValue(Retained::as_ptr(&v) as Ref, kind, &mut p as *mut Pt as *mut c_void) };
            }
            p
        };
        // (a CGSize is two f64 like a CGPoint: width in x, height in y)
        let (p, s) = (get("AXPosition", AX_POINT), get("AXSize", AX_SIZE));
        (p.x, p.y, s.x, s.y)
    }
    pub fn set_flag(&self, name: &str, on: bool) -> bool {
        if self.0.is_null() {
            return false;
        }
        let v = NSNumber::new_bool(on);
        let n = ns(name);
        unsafe { AXUIElementSetAttributeValue(self.0, Retained::as_ptr(&n) as Ref, Retained::as_ptr(&v) as Ref) == 0 }
    }
    pub fn set_text(&self, name: &str, value: &str) -> bool {
        if self.0.is_null() {
            return false;
        }
        let v = ns(value);
        let n = ns(name);
        unsafe { AXUIElementSetAttributeValue(self.0, Retained::as_ptr(&n) as Ref, Retained::as_ptr(&v) as Ref) == 0 }
    }
    pub fn set_number(&self, name: &str, value: f64) -> bool {
        if self.0.is_null() {
            return false;
        }
        let v = NSNumber::new_f64(value);
        let n = ns(name);
        unsafe { AXUIElementSetAttributeValue(self.0, Retained::as_ptr(&n) as Ref, Retained::as_ptr(&v) as Ref) == 0 }
    }
    pub fn act(&self, action: &str) -> bool {
        if self.0.is_null() {
            return false;
        }
        let a = ns(action);
        unsafe { AXUIElementPerformAction(self.0, Retained::as_ptr(&a) as Ref) == 0 }
    }
}

pub use crate::ax::Node;

/// Finds a running GUI app by localized name or bundle id (exact match first, then case-insensitive substring):
/// `(pid, localized_name, bundle_id)`. Never matches `me`.
pub fn find_running_app(query: &str, me: i32) -> Option<(i32, String, String)> {
    let q = query.trim().to_ascii_lowercase();
    if q.is_empty() {
        return None;
    }
    objc2::rc::autoreleasepool(|_| {
        let apps = NSWorkspace::sharedWorkspace().runningApplications();
        let mut partial: Option<(i32, String, String)> = None;
        for a in apps.iter() {
            let pid = a.processIdentifier();
            if pid == me {
                continue;
            }
            let name = a.localizedName().map(|s| s.to_string()).unwrap_or_default();
            let bid = a.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
            let nl = name.to_ascii_lowercase();
            let bl = bid.to_ascii_lowercase();
            if nl == q || bl == q || format!("{nl}.app") == q {
                return Some((pid, name, bid));
            }
            if partial.is_none() && (nl.contains(&q) || bl.contains(&q)) {
                partial = Some((pid, name, bid));
            }
        }
        partial
    })
}

/// The front window of the topmost app that isn't Sympony (`me`): (pid, app name, bundle id).
pub fn front_app(me: i32) -> Option<(i32, String, String)> {
    objc2::rc::autoreleasepool(|_| {
        // Prefer the truly focused app from LaunchServices when it's not Sympony and has a window.
        let apps = NSWorkspace::sharedWorkspace().runningApplications();
        if let Some(fpid) = focused_pid() {
            if fpid != me {
                for a in apps.iter() {
                    if a.processIdentifier() == fpid {
                        let name = a.localizedName().map(|s| s.to_string()).unwrap_or_default();
                        let bid = a.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
                        if !bid.is_empty() && window(fpid).is_some() {
                            return Some((fpid, name, bid));
                        }
                    }
                }
            }
        }
        // (fallback: the window list is front to back: the first ordinary window not ours)
        let list = unsafe { CGWindowListCopyWindowInfo(1 | 16, 0) }; // on screen only, excluding desktop
        if list.is_null() {
            return None;
        }
        let arr: Retained<NSArray> = unsafe { Retained::from_raw(list as *mut NSArray)? };
        let k_layer = ns("kCGWindowLayer");
        let k_pid = ns("kCGWindowOwnerPID");
        for w in arr.iter() {
            let Ok(d) = w.downcast::<objc2_foundation::NSDictionary>() else { continue };
            let num = |k: &NSString| d.objectForKey(k).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.as_i64());
            if num(&k_layer) != Some(0) {
                continue;
            }
            let Some(pid) = num(&k_pid).map(|p| p as i32) else { continue };
            if pid == me {
                continue;
            }
            for a in apps.iter() {
                if a.processIdentifier() == pid {
                    let name = a.localizedName().map(|s| s.to_string()).unwrap_or_default();
                    let bid = a.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
                    return Some((pid, name, bid));
                }
            }
        }
        None
    })
}

/// The app's focused (or main, or first) window, with web content and Electron trees turned on.
pub fn window(pid: i32) -> Option<El> {
    objc2::rc::autoreleasepool(|_| {
        let app = El::app(pid);
        // (Chromium and Electron build their page tree only for assistive apps that ask)
        app.set_flag("AXManualAccessibility", true);
        app.set_flag("AXEnhancedUserInterface", true);
        app.el("AXFocusedWindow").or_else(|| app.el("AXMainWindow")).or_else(|| {
            let v = app.raw("AXWindows")?;
            let arr = v.downcast::<NSArray>().ok()?;
            let first = arr.iter().next()?;
            Some(El(unsafe { CFRetain(Retained::as_ptr(&first) as Ref) }))
        })
    })
}

/// The window's elements in reading order, with the elements themselves (for Hands), at most `max`. One IPC round
/// trip per element (all its attributes at once), and parts of the page far out of view are skipped.
pub fn read(win: &El, max: usize) -> (Vec<Node>, Vec<El>) {
    objc2::rc::autoreleasepool(|_| {
        const NAMES: [&str; 15] = [
            "AXRole", "AXSubrole", "AXDescription", "AXTitle", "AXPlaceholderValue", "AXValue", "AXEnabled", "AXFocused",
            "AXPosition", "AXSize", "AXChildren", "AXDOMClassList", "AXURL", "AXMinValue", "AXMaxValue",
        ];
        let names: Vec<Retained<NSString>> = NAMES.iter().map(|n| ns(n)).collect();
        let refs: Vec<&NSString> = names.iter().map(|n| &**n).collect();
        let arr = NSArray::from_slice(&refs);
        let (mut nodes, mut els) = (vec![], vec![]);
        let wf = win.frame();
        // (what lies further than a window's height beyond it isn't read: a long page's far end costs time, not use)
        let near = |f: (f64, f64, f64, f64)| f.2 <= 0.0 || f.3 <= 0.0 || wf.3 <= 0.0
            || (f.1 + f.3 > wf.1 - wf.3 && f.1 < wf.1 + 2.0 * wf.3 && f.0 + f.2 > wf.0 - wf.2 && f.0 < wf.0 + 2.0 * wf.2);
        let mut stack: Vec<(El, u16)> = vec![(win.clone(), 0)];
        while let Some((e, depth)) = stack.pop() {
            if nodes.len() >= max || depth > 60 || e.0.is_null() {
                continue;
            }
            objc2::rc::autoreleasepool(|_| {
                let mut out: Ref = std::ptr::null();
                if unsafe { AXUIElementCopyMultipleAttributeValues(e.0, Retained::as_ptr(&arr) as Ref, 0, &mut out) } != 0 || out.is_null() {
                    return;
                }
                let Some(vals): Option<Retained<NSArray>> = (unsafe { Retained::from_raw(out as *mut NSArray) }) else { return };
                let get = |i: usize| vals.objectAtIndex(i);
                let text = |i: usize| get(i).downcast::<NSString>().ok().map(|s| s.to_string()).unwrap_or_default();
                let num = |i: usize| get(i).downcast::<NSNumber>().ok();
                let role = text(0);
                if role == "AXMenuBar" || role == "AXMenu" {
                    return;
                }
                let pt = |i: usize, kind: u32| {
                    let mut p = Pt::default();
                    let v = get(i);
                    let r = Retained::as_ptr(&v) as Ref;
                    if unsafe { AXValueGetType(r) } == kind {
                        unsafe { AXValueGetValue(r, kind, &mut p as *mut Pt as *mut c_void) };
                    }
                    p
                };
                let (p, sz) = (pt(8, AX_POINT), pt(9, AX_SIZE));
                let frame = (p.x, p.y, sz.x, sz.y);
                if depth > 0 && !near(frame) {
                    return;
                }
                let subrole = text(1);
                let mut label = text(2);
                if label.is_empty() {
                    label = text(3);
                }
                if label.is_empty() && (role == "AXTextField" || role == "AXTextArea") {
                    label = text(4);
                }
                // (a password field's value is never read; a checkbox's value is a number)
                let value = if subrole == "AXSecureTextField" { String::new() } else { num(5).map(|n| n.stringValue().to_string()).unwrap_or_else(|| text(5)) };
                let min_val = if role == "AXSlider" || role == "AXIncrementor" { num(13).map(|n| n.as_f64()) } else { None };
                let max_val = if role == "AXSlider" || role == "AXIncrementor" { num(14).map(|n| n.as_f64()) } else { None };
                let classes = get(11).downcast::<NSArray>().map(|a| a.iter().filter_map(|c| c.downcast::<NSString>().ok().map(|s| s.to_string())).collect()).unwrap_or_default();
                let url = if role == "AXWebArea" { get(12).downcast::<NSURL>().ok().and_then(|u| u.absoluteString()).map(|s| s.to_string()).unwrap_or_default() } else { String::new() };
                let kids: Vec<El> = get(10).downcast::<NSArray>().map(|a| a.iter().map(|c| El(unsafe { CFRetain(Retained::as_ptr(&c) as Ref) })).collect()).unwrap_or_default();
                nodes.push(Node {
                    depth,
                    enabled: num(6).map(|n| n.as_bool()).unwrap_or(true),
                    focused: num(7).map(|n| n.as_bool()).unwrap_or(false),
                    frame,
                    classes,
                    url,
                    role,
                    subrole,
                    label,
                    value,
                    min_val,
                    max_val,
                });
                els.push(e);
                // (children in reading order: pushed last-first)
                for c in kids.into_iter().rev() {
                    stack.push((c, depth + 1));
                }
            });
        }
        (nodes, els)
    })
}

/// Whether the user is typing in `pid` now: its focused element is a text field or area (a web page's too).
pub fn typing_in(pid: i32) -> bool {
    objc2::rc::autoreleasepool(|_| {
        let app = El::app(pid);
        app.set_flag("AXManualAccessibility", true);
        let Some(e) = app.el("AXFocusedUIElement") else { return false };
        let role = e.text("AXRole");
        matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox") || e.flag("AXEditable") == Some(true)
    })
}

/// The selected text in the app's focused element (never reads password fields).
pub fn selection(pid: i32) -> String {
    objc2::rc::autoreleasepool(|_| {
        El::app(pid)
            .el("AXFocusedUIElement")
            .filter(|e| e.text("AXSubrole") != "AXSecureTextField")
            .map(|e| e.text("AXSelectedText"))
            .unwrap_or_default()
    })
}

/// The app that has the keyboard, from LaunchServices (`lsappinfo front`): NSWorkspace's answer goes stale on a
/// thread without a run loop, and the topmost window isn't always the app in front.
fn focused_pid() -> Option<i32> {
    let run = |args: &[&str]| std::process::Command::new("/usr/bin/lsappinfo").args(args).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let asn = run(&["front"])?;
    let info = run(&["info", "-only", "pid", &asn])?;
    info.split("pid").nth(1)?.trim_start_matches(|c: char| c == '"' || c == '=' || c.is_whitespace()).split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

/// Whether `pid` is the app in front (keys go to it).
pub fn is_front(pid: i32) -> bool {
    focused_pid() == Some(pid)
}

/// Brings the app forward and raises the window, and waits until it's in front (≤ 1.5 s). Through Accessibility
/// (`AXFrontmost`), else LaunchServices (`open -b`, as when the user opens it): a plain activate from an app in the
/// background is refused by macOS now.
pub fn bring(pid: i32, win: &El) -> bool {
    objc2::rc::autoreleasepool(|_| {
        win.set_flag("AXMain", true);
        win.act("AXRaise");
        El::app(pid).set_flag("AXFrontmost", true);
        for i in 0..15 {
            if is_front(pid) {
                win.act("AXRaise");
                return true;
            }
            if i == 2 {
                if let Some(b) = objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid).and_then(|a| a.bundleIdentifier()) {
                    let _ = std::process::Command::new("/usr/bin/open").args(["-b", &b.to_string()]).status();
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        false
    })
}

/// Real key events for `text` (they go to the app in front).
pub fn type_text(text: &str) {
    let u: Vec<u16> = text.encode_utf16().collect();
    for down in [true, false] {
        unsafe {
            let ev = CGEventCreateKeyboardEvent(std::ptr::null_mut(), 0, down);
            if ev.is_null() {
                return;
            }
            CGEventKeyboardSetUnicodeString(ev, u.len(), u.as_ptr());
            CGEventPost(0, ev);
            CFRelease(ev);
        }
    }
}

/// One key by its virtual key code (36 Return), with Shift when `shift` (a new line in a chat box, not Send).
pub fn press_key(code: u16, shift: bool) {
    for down in [true, false] {
        unsafe {
            let ev = CGEventCreateKeyboardEvent(std::ptr::null_mut(), code, down);
            if !ev.is_null() {
                if shift {
                    CGEventSetFlags(ev, 0x0002_0000);
                }
                CGEventPost(0, ev);
                CFRelease(ev);
            }
        }
    }
}

/// `text` as keys, in pieces a key event carries (≤ 16 characters), new lines as Shift+Return.
pub fn type_all(text: &str) {
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            press_key(36, true);
        }
        let chars: Vec<char> = line.chars().collect();
        for piece in chars.chunks(16) {
            type_text(&piece.iter().collect::<String>());
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    }
}

// ---- the rest of what Eyes and Ask other AIs need, so they call `platform::ax` only (a Windows backend gives the
// same names: UI Automation for the tree, ValuePattern / InvokePattern, SendInput, SetForegroundWindow)

/// Whether Sympony may read and drive other apps; `ask` shows the OS's prompt.
pub fn trusted(ask: bool) -> bool {
    super::banners::trusted(ask)
}
/// A password field has the keyboard (nothing is read or typed then).
pub fn secure_input() -> bool {
    super::voice::is_secure_input_enabled()
}
pub fn pid_of(app: &str) -> Option<i32> {
    super::apps::pid_of(app)
}
pub fn installed(app: &str) -> bool {
    super::apps::app_name(app).is_some()
}
pub fn app_name(app: &str) -> Option<String> {
    super::apps::app_name(app)
}
pub fn open_apps() -> Vec<(String, String)> {
    super::apps::open_apps()
}
/// The app in front (to give the keyboard back to it), and giving it back.
pub fn front_pid() -> Option<i32> {
    focused_pid().or_else(super::apps::frontmost_pid)
}
/// Gives the front back to `pid` (the user's app), the same way as `bring`.
pub fn activate(pid: i32) {
    if let Some(w) = window(pid) {
        bring(pid, &w);
    }
}
/// Opens `url` in `app` without bringing it forward (a new tab in its last window), or a deep link (`claude://…`)
/// when `app` is empty.
pub fn open_background(app: &str, url: &str) {
    let mut c = std::process::Command::new("/usr/bin/open");
    c.arg("-g");
    if !app.is_empty() {
        c.args(["-b", app]);
    }
    let _ = c.arg(url).status();
}
/// Starts `app` with command-line arguments (a browser's profile and new window): it comes forward.
pub fn open_with(app: &str, args: &[String]) {
    let _ = std::process::Command::new("/usr/bin/open").args(["-nb", app, "--args"]).args(args).status();
}


// ---- Hands: keys with modifiers, a click or a scroll at a point, a menu's option

/// A key with modifier flags (`services::hands::keys`), to the app in front.
pub fn press_combo(code: u16, flags: u64) {
    for down in [true, false] {
        unsafe {
            let ev = CGEventCreateKeyboardEvent(std::ptr::null_mut(), code, down);
            if !ev.is_null() {
                CGEventSetFlags(ev, flags);
                CGEventPost(0, ev);
                CFRelease(ev);
            }
        }
    }
}

/// Moves the real mouse pointer to a point on screen (wakes hover-only UI like QuickTime/YouTube controls).
pub fn mouse_move(x: f64, y: f64) {
    unsafe {
        let ev = CGEventCreateMouseEvent(std::ptr::null_mut(), 5, Pt { x, y }, 0); // kCGEventMouseMoved = 5
        if !ev.is_null() {
            CGEventPost(0, ev);
            CFRelease(ev);
        }
    }
}

/// A left click at a point on screen (hovers there first so floating player controls wake up).
pub fn click_at(x: f64, y: f64) {
    mouse_move(x, y);
    std::thread::sleep(std::time::Duration::from_millis(35));
    for kind in [1u32, 2] {
        unsafe {
            let ev = CGEventCreateMouseEvent(std::ptr::null_mut(), kind, Pt { x, y }, 0);
            if !ev.is_null() {
                CGEventPost(0, ev);
                CFRelease(ev);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
}

/// A native double-click at `(x, y)` (for opening files/folders in Finder and list items).
pub fn double_click_at(x: f64, y: f64) {
    mouse_move(x, y);
    std::thread::sleep(std::time::Duration::from_millis(35));
    for click_state in [1i64, 2] {
        for kind in [1u32, 2] {
            unsafe {
                let ev = CGEventCreateMouseEvent(std::ptr::null_mut(), kind, Pt { x, y }, 0);
                if !ev.is_null() {
                    CGEventSetIntegerValueField(ev, 1, click_state); // kCGMouseEventClickState = 1
                    CGEventPost(0, ev);
                    CFRelease(ev);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        if click_state == 1 {
            std::thread::sleep(std::time::Duration::from_millis(45));
        }
    }
}

/// Smooth left-mouse drag from `(x1, y1)` to `(x2, y2)` (for sliders, scrubbars, and draggable controls).
pub fn drag(x1: f64, y1: f64, x2: f64, y2: f64) {
    mouse_move(x1, y1);
    std::thread::sleep(std::time::Duration::from_millis(40));
    unsafe {
        let down = CGEventCreateMouseEvent(std::ptr::null_mut(), 1, Pt { x: x1, y: y1 }, 0); // LeftMouseDown = 1
        if !down.is_null() {
            CGEventPost(0, down);
            CFRelease(down);
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(35));
    let steps = 14usize;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let x = x1 + (x2 - x1) * t;
        let y = y1 + (y2 - y1) * t;
        unsafe {
            let ev = CGEventCreateMouseEvent(std::ptr::null_mut(), 6, Pt { x, y }, 0); // LeftMouseDragged = 6
            if !ev.is_null() {
                CGEventPost(0, ev);
                CFRelease(ev);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(14));
    }
    std::thread::sleep(std::time::Duration::from_millis(25));
    unsafe {
        let up = CGEventCreateMouseEvent(std::ptr::null_mut(), 2, Pt { x: x2, y: y2 }, 0); // LeftMouseUp = 2
        if !up.is_null() {
            CGEventPost(0, up);
            CFRelease(up);
        }
    }
}

/// Scrolls what's under a point by `dy` pixels (negative: down).
pub fn scroll_at(x: f64, y: f64, dy: i32) {
    unsafe {
        let ev = CGEventCreateScrollWheelEvent(std::ptr::null_mut(), 0, 1, dy);
        if !ev.is_null() {
            CGEventSetLocation(ev, Pt { x, y });
            CGEventPost(0, ev);
            CFRelease(ev);
        }
    }
}

/// Opens a popup / menu button and picks the item called `option` (case-insensitive, whole or start of its title).
pub fn choose(el: &El, option: &str) -> bool {
    objc2::rc::autoreleasepool(|_| {
        if !el.act("AXPress") {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
        let want = option.trim().to_lowercase();
        fn find(e: &El, want: &str, depth: u8) -> Option<El> {
            if depth > 6 {
                return None;
            }
            for c in e.children() {
                let t = c.text("AXTitle").to_lowercase();
                if c.text("AXRole") == "AXMenuItem" && (t == want || (!want.is_empty() && t.starts_with(want))) {
                    return Some(c);
                }
                if let Some(f) = find(&c, want, depth + 1) {
                    return Some(f);
                }
            }
            None
        }
        match find(el, &want, 0) {
            Some(item) => item.act("AXPress"),
            None => {
                press_key(53, false); // (Esc closes the menu again)
                false
            }
        }
    })
}

/// Runs a menu bar item by its path (`["File", "Export…"]`, titles matched whole or by their start, any case),
/// without opening the menus on screen.
pub fn menu_path(pid: i32, path: &[String]) -> bool {
    objc2::rc::autoreleasepool(|_| {
        let Some(bar) = El::app(pid).el("AXMenuBar") else { return false };
        let mut items = bar.children();
        for (i, name) in path.iter().enumerate() {
            let want = name.trim().trim_end_matches(['…', '.']).to_lowercase();
            let Some(found) = items.into_iter().find(|c| {
                let t = c.text("AXTitle").trim_end_matches(['…', '.']).to_lowercase();
                !t.is_empty() && (t == want || t.starts_with(&want))
            }) else {
                return false;
            };
            if i + 1 == path.len() {
                return found.flag("AXEnabled") != Some(false) && found.act("AXPress");
            }
            // (a bar item or a submenu item holds one AXMenu, which holds the items)
            items = found.children().into_iter().flat_map(|m| m.children()).collect();
        }
        false
    })
}

/// Waits until the window stops changing after an action (its title and the focused element stay the same for two
/// looks), at most `max_ms`. Cheap: a few attributes, not the whole tree.
pub fn settle(pid: i32, win: &El, max_ms: u64) {
    let app = El::app(pid);
    let look = || {
        objc2::rc::autoreleasepool(|_| {
            let f = app.el("AXFocusedUIElement");
            (win.text("AXTitle"), f.as_ref().map(|e| (e.text("AXRole"), e.text("AXDescription"), e.value("AXValue").len())))
        })
    };
    let t0 = std::time::Instant::now();
    let (mut last, mut same) = (look(), 0);
    while t0.elapsed().as_millis() < max_ms as u128 {
        std::thread::sleep(std::time::Duration::from_millis(90));
        let now = look();
        if now == last {
            same += 1;
            if same >= 2 && t0.elapsed().as_millis() > 180 {
                return;
            }
        } else {
            same = 0;
            last = now;
        }
    }
}

/// A running app's version (CFBundleShortVersionString), for routines learned in it.
pub fn app_version(bundle: &str) -> Option<String> {
    let path = objc2::rc::autoreleasepool(|_| {
        let ws = NSWorkspace::sharedWorkspace();
        ws.runningApplications().iter().find(|a| a.bundleIdentifier().is_some_and(|b| b.to_string() == bundle))?.bundleURL()?.path().map(|s| s.to_string())
    })?;
    let out = std::process::Command::new("/usr/bin/defaults").args(["read", &format!("{path}/Contents/Info"), "CFBundleShortVersionString"]).output().ok()?;
    let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

/// Whether Sympony may take a picture of a window (Screen Recording); `ask` shows macOS's prompt.
pub fn screen_access(ask: bool) -> bool {
    unsafe { CGPreflightScreenCaptureAccess() || (ask && CGRequestScreenCaptureAccess()) }
}

/// The id of `pid`'s frontmost ordinary window on screen (for `screencapture -l`).
pub fn window_id(pid: i32) -> Option<u32> {
    objc2::rc::autoreleasepool(|_| {
        let list = unsafe { CGWindowListCopyWindowInfo(1 | 16, 0) };
        if list.is_null() {
            return None;
        }
        let arr: Retained<NSArray> = unsafe { Retained::from_raw(list as *mut NSArray)? };
        let k_layer = ns("kCGWindowLayer");
        let k_pid = ns("kCGWindowOwnerPID");
        let k_num = ns("kCGWindowNumber");
        arr.iter().find_map(|w| {
            let d = w.downcast::<objc2_foundation::NSDictionary>().ok()?;
            let num = |k: &NSString| d.objectForKey(k).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.as_i64());
            (num(&k_layer) == Some(0) && num(&k_pid) == Some(pid as i64)).then(|| num(&k_num).map(|n| n as u32)).flatten()
        })
    })
}
