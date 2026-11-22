//! macOS's notification banners as they appear on screen, read through Accessibility (instant, where usernoted's
//! database gets them 6-7 s later), and closed so they show only in Sympony. Needs the Accessibility permission.
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};
use std::ffi::c_void;

type Ref = *const c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> u8;
    fn AXIsProcessTrustedWithOptions(options: Ref) -> u8;
    fn AXUIElementCreateApplication(pid: i32) -> Ref;
    fn AXUIElementCopyAttributeValue(el: Ref, attr: Ref, out: *mut Ref) -> i32;
    fn AXUIElementPerformAction(el: Ref, action: Ref) -> i32;
    fn AXUIElementCopyActionNames(el: Ref, out: *mut Ref) -> i32;
    fn CFRetain(cf: Ref) -> Ref;
    fn CFRelease(cf: Ref);
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

fn ns(s: &str) -> Retained<NSString> {
    NSString::from_str(s)
}

impl El {
    fn attr(&self, name: &str) -> Option<Retained<AnyObject>> {
        let mut out: Ref = std::ptr::null();
        let n = ns(name);
        if unsafe { AXUIElementCopyAttributeValue(self.0, Retained::as_ptr(&n) as Ref, &mut out) } != 0 || out.is_null() {
            return None;
        }
        unsafe { Retained::from_raw(out as *mut AnyObject) } // (a copy: ours)
    }
    fn text(&self, name: &str) -> String {
        self.attr(name).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string()).unwrap_or_default()
    }
    fn children(&self) -> Vec<El> {
        let Some(v) = self.attr("AXChildren") else { return vec![] };
        let Ok(arr) = v.downcast::<NSArray>() else { return vec![] };
        arr.iter().map(|c| El(unsafe { CFRetain(Retained::as_ptr(&c) as Ref) })).collect()
    }
}

/// Whether Sympony may read other apps' windows; `ask` shows macOS's prompt (once) when not.
pub fn trusted(ask: bool) -> bool {
    if !ask {
        return unsafe { AXIsProcessTrusted() != 0 };
    }
    objc2::rc::autoreleasepool(|_| {
        let key = ns("AXTrustedCheckOptionPrompt");
        let val = NSNumber::new_bool(true);
        let opts = NSDictionary::from_slices(&[&*key], &[&*val as &AnyObject]);
        unsafe { AXIsProcessTrustedWithOptions(Retained::as_ptr(&opts) as Ref) != 0 }
    })
}

pub struct Banner {
    /// the notification's id (its banner's AXIdentifier)
    pub id: String,
    /// "<app>, <title>, <subtitle>, <body>"
    pub description: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
    pub el: El,
}

fn find(el: El, depth: u32, out: &mut Vec<Banner>) {
    if el.text("AXSubrole") == "AXNotificationCenterBanner" {
        let mut b = Banner { id: el.text("AXIdentifier"), description: el.text("AXDescription"), title: String::new(), subtitle: String::new(), body: String::new(), el };
        for c in b.el.children() {
            match c.text("AXIdentifier").as_str() {
                "title" => b.title = c.text("AXValue"),
                "subtitle" => b.subtitle = c.text("AXValue"),
                "body" => b.body = c.text("AXValue"),
                _ => {}
            }
        }
        out.push(b);
        return;
    }
    if depth < 8 {
        for c in el.children() {
            find(c, depth + 1, out);
        }
    }
}

/// The banners on screen now (none without the permission or Notification Center).
pub fn banners() -> Vec<Banner> {
    objc2::rc::autoreleasepool(|_| {
        let Some(pid) = super::apps::pid_of("com.apple.notificationcenterui") else { return vec![] };
        let app = El(unsafe { AXUIElementCreateApplication(pid) });
        if app.0.is_null() {
            return vec![];
        }
        let mut out = vec![];
        let Some(wins) = app.attr("AXWindows").and_then(|v| v.downcast::<NSArray>().ok()) else { return out };
        for w in wins.iter() {
            find(El(unsafe { CFRetain(Retained::as_ptr(&w) as Ref) }), 0, &mut out);
        }
        out
    })
}

/// Closes a banner (its "Close" action), as its X would.
pub fn close(b: &Banner) -> bool {
    objc2::rc::autoreleasepool(|_| {
        let mut names: Ref = std::ptr::null();
        if unsafe { AXUIElementCopyActionNames(b.el.0, &mut names) } != 0 || names.is_null() {
            return false;
        }
        let Some(names) = (unsafe { Retained::from_raw(names as *mut NSArray<NSString>) }) else { return false };
        let Some(close) = names.iter().find(|n| n.to_string().starts_with("Name:Close")) else { return false };
        unsafe { AXUIElementPerformAction(b.el.0, Retained::as_ptr(&close) as Ref) == 0 }
    })
}
