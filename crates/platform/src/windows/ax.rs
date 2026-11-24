//! Other apps' windows for Pony's Eyes and Hands on Windows. UI Automation reads a window as the same `Node`s macOS's
//! Accessibility gives: its control types under macOS's role names (`AXButton`, `AXTextField`, a text's words in its
//! value as `AXStaticText` has them…), so Eyes and Hands read both alike; an element's patterns press, toggle, set
//! and choose. SendInput types, presses keys and clicks. Keys come as macOS's virtual key codes and flags
//! (`services::hands::keys`): ⌘ and Ctrl both press Ctrl. Positions are desktop points (`displays`); a click lands on
//! the pixels under one. Windows asks no permission for any of this.
// (UI Automation's ids are constants named as Windows names them, matched on below)
#![allow(non_upper_case_globals)]
use ::windows::core::{Interface, BSTR};
use ::windows::Win32::Foundation::{HWND, RECT};
use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use ::windows::Win32::System::Variant::VARIANT;
use ::windows::Win32::UI::Accessibility::*;
use std::cell::RefCell;
use std::time::{Duration, Instant};

pub use crate::ax::Node;

thread_local! {
    static UIA: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

/// UI Automation, made once per thread (in the multithreaded apartment).
fn uia() -> Option<IUIAutomation> {
    super::mta();
    UIA.with(|u| {
        if u.borrow().is_none() {
            // SAFETY: a COM object made in this thread's apartment
            *u.borrow_mut() = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok();
        }
        u.borrow().clone()
    })
}

/// The browser that opens web links: its program's id (`chrome.exe`), as macOS gives its bundle id.
pub fn default_browser() -> Option<String> {
    let prog_id = reg_text(true, r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice", "ProgId")?;
    let command = reg_text(false, &format!(r"{prog_id}\shell\open\command"), "")?;
    // ("C:\…\chrome.exe" --single-argument %1)
    let exe = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?.to_string(),
        None => command.split(".exe").next()?.to_string() + ".exe",
    };
    std::path::Path::new(&exe).file_name().map(|n| n.to_string_lossy().to_lowercase())
}

/// A registry text value: the user's (`user`) or the classes' (HKEY_CLASSES_ROOT); `name` "" for the default one.
fn reg_text(user: bool, key: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    let key = super::shell::wide(key);
    let name = (!name.is_empty()).then(|| super::shell::wide(name));
    let (mut buf, mut size) = (vec![0u16; 2048], 4096u32);
    let root = if user { HKEY_CURRENT_USER } else { HKEY_CLASSES_ROOT };
    // SAFETY: NUL-terminated names (or none: the default value), a buffer with its size in bytes
    let read = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ref().map_or(std::ptr::null(), |n| n.as_ptr()), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return None;
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

// ---------------------------------------------------------------------------
// Roles: UI Automation's control types under macOS's names
// ---------------------------------------------------------------------------

/// What `role_of` needs to know about an element besides its control type.
#[derive(Default, Clone, Copy)]
struct Traits {
    password: bool,
    heading: bool,
    /// a value that can be typed into (an editable combo box)
    editable: bool,
    /// a web page's document (Chromium's, Firefox's), not an editor's
    web: bool,
}

/// (role, subrole) as macOS's Accessibility names them.
fn role_of(ct: UIA_CONTROLTYPE_ID, t: Traits) -> (&'static str, &'static str) {
    if t.heading && ct == UIA_TextControlTypeId {
        return ("AXHeading", "");
    }
    match ct {
        UIA_ButtonControlTypeId | UIA_HeaderItemControlTypeId => ("AXButton", ""),
        UIA_SplitButtonControlTypeId => ("AXMenuButton", ""),
        UIA_HyperlinkControlTypeId => ("AXLink", ""),
        UIA_EditControlTypeId if t.password => ("AXTextField", "AXSecureTextField"),
        UIA_EditControlTypeId => ("AXTextField", ""),
        UIA_DocumentControlTypeId if t.web => ("AXWebArea", ""),
        UIA_DocumentControlTypeId => ("AXTextArea", ""),
        UIA_TextControlTypeId => ("AXStaticText", ""),
        UIA_CheckBoxControlTypeId => ("AXCheckBox", ""),
        UIA_RadioButtonControlTypeId => ("AXRadioButton", ""),
        UIA_TabItemControlTypeId => ("AXRadioButton", "AXTabButton"),
        UIA_ComboBoxControlTypeId if t.editable => ("AXComboBox", ""),
        UIA_ComboBoxControlTypeId => ("AXPopUpButton", ""),
        UIA_SliderControlTypeId => ("AXSlider", ""),
        UIA_SpinnerControlTypeId => ("AXIncrementor", ""),
        UIA_MenuItemControlTypeId => ("AXMenuItem", ""),
        UIA_MenuBarControlTypeId => ("AXMenuBar", ""),
        UIA_MenuControlTypeId => ("AXMenu", ""),
        UIA_WindowControlTypeId => ("AXWindow", ""),
        UIA_ImageControlTypeId => ("AXImage", ""),
        UIA_ListControlTypeId => ("AXList", ""),
        UIA_ListItemControlTypeId | UIA_DataItemControlTypeId | UIA_TreeItemControlTypeId => ("AXRow", ""),
        UIA_TreeControlTypeId => ("AXOutline", ""),
        UIA_TableControlTypeId | UIA_DataGridControlTypeId => ("AXTable", ""),
        UIA_ToolBarControlTypeId => ("AXToolbar", ""),
        UIA_ScrollBarControlTypeId => ("AXScrollBar", ""),
        UIA_ProgressBarControlTypeId => ("AXProgressIndicator", ""),
        UIA_SeparatorControlTypeId => ("AXSplitter", ""),
        _ => ("AXGroup", ""),
    }
}

// ---------------------------------------------------------------------------
// El: an element, or an app as a whole (macOS's application element)
// ---------------------------------------------------------------------------

#[derive(Clone)]
enum Inner {
    App(i32),
    Ui(IUIAutomationElement),
}

/// An element of another app's window (or the app itself, as macOS's application element).
#[derive(Clone)]
pub struct El(Inner);

// SAFETY: UI Automation's client objects are free-threaded proxies
unsafe impl Send for El {}

impl std::fmt::Debug for El {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.0 {
            Inner::App(pid) => write!(f, "El(app {pid})"),
            Inner::Ui(_) => write!(f, "El(element)"),
        }
    }
}

impl PartialEq for El {
    fn eq(&self, o: &Self) -> bool {
        match (&self.0, &o.0) {
            (Inner::App(a), Inner::App(b)) => a == b,
            // SAFETY: two elements compared by UI Automation
            (Inner::Ui(a), Inner::Ui(b)) => uia().is_some_and(|u| unsafe { u.CompareElements(a, b) }.is_ok_and(|same| same.as_bool())),
            _ => false,
        }
    }
}

/// A rectangle in physical pixels as desktop points: (x, y, width, height); nothing on screen is all zeros.
fn points(r: RECT) -> (f64, f64, f64, f64) {
    if r.right <= r.left || r.bottom <= r.top {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let p = super::displays::points_of(windows_sys::Win32::Foundation::RECT { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    (p.x, p.y, p.w, p.h)
}

/// A pattern of the element's, as its interface.
fn pattern<T: Interface>(e: &IUIAutomationElement, id: UIA_PATTERN_ID) -> Option<T> {
    // SAFETY: a COM call on a live element
    unsafe { e.GetCurrentPatternAs::<T>(id) }.ok()
}

fn bstr(r: ::windows::core::Result<BSTR>) -> String {
    r.map(|b| b.to_string()).unwrap_or_default()
}

/// The element's role and subrole now (as `role_of`).
fn current_role(e: &IUIAutomationElement) -> (&'static str, &'static str) {
    // SAFETY: COM calls on a live element
    unsafe {
        let ct = e.CurrentControlType().unwrap_or(UIA_CustomControlTypeId);
        let heading = ct == UIA_TextControlTypeId && e.GetCurrentPropertyValue(UIA_HeadingLevelPropertyId).ok().and_then(|v| i32::try_from(&v).ok()).is_some_and(|h| h != HeadingLevel_None.0);
        let value: Option<IUIAutomationValuePattern> = pattern(e, UIA_ValuePatternId);
        let editable = value.as_ref().is_some_and(|v| v.CurrentIsReadOnly().is_ok_and(|r| !r.as_bool()));
        let web = matches!(bstr(e.CurrentFrameworkId()).as_str(), "Chrome" | "Gecko");
        role_of(ct, Traits { password: e.CurrentIsPassword().is_ok_and(|p| p.as_bool()), heading, editable, web })
    }
}

/// A checkbox's, radio's or tab's state as macOS's numbers ("1" on), else its value, else its number.
fn current_value(e: &IUIAutomationElement) -> String {
    // SAFETY: COM calls on a live element
    unsafe {
        if e.CurrentIsPassword().is_ok_and(|p| p.as_bool()) {
            return String::new();
        }
        if let Some(t) = pattern::<IUIAutomationTogglePattern>(e, UIA_TogglePatternId) {
            return if t.CurrentToggleState() == Ok(ToggleState_On) { "1" } else { "0" }.into();
        }
        if let Some(s) = pattern::<IUIAutomationSelectionItemPattern>(e, UIA_SelectionItemPatternId) {
            let ct = e.CurrentControlType().unwrap_or(UIA_CustomControlTypeId);
            if ct == UIA_RadioButtonControlTypeId || ct == UIA_TabItemControlTypeId {
                return if s.CurrentIsSelected().is_ok_and(|b| b.as_bool()) { "1" } else { "0" }.into();
            }
        }
        if let Some(v) = pattern::<IUIAutomationValuePattern>(e, UIA_ValuePatternId) {
            return bstr(v.CurrentValue());
        }
        if let Some(r) = pattern::<IUIAutomationRangeValuePattern>(e, UIA_RangeValuePatternId) {
            return r.CurrentValue().map(|v| v.to_string()).unwrap_or_default();
        }
        String::new()
    }
}

/// The text selected in an element (its first selected range).
fn selected_text(e: &IUIAutomationElement) -> String {
    let Some(t) = pattern::<IUIAutomationTextPattern>(e, UIA_TextPatternId) else { return String::new() };
    // SAFETY: COM calls on a live pattern and the range it hands over
    unsafe { t.GetSelection().and_then(|s| s.GetElement(0)).and_then(|r| r.GetText(-1)).map(|b| b.to_string()).unwrap_or_default() }
}

/// An element's window handle, from itself up (a web page's element sits in a window that has one).
fn hwnd_of(e: &IUIAutomationElement) -> Option<HWND> {
    let u = uia()?;
    // SAFETY: COM calls on live elements; the walker only reads
    unsafe {
        let walker = u.ControlViewWalker().ok()?;
        let mut cur = Some(e.clone());
        for _ in 0..40 {
            let el = cur?;
            if let Ok(h) = el.CurrentNativeWindowHandle() {
                if !h.0.is_null() {
                    return Some(h);
                }
            }
            cur = walker.GetParentElement(&el).ok();
        }
    }
    None
}

impl El {
    pub fn app(pid: i32) -> El {
        El(Inner::App(pid))
    }

    fn ui(&self) -> Option<&IUIAutomationElement> {
        match &self.0 {
            Inner::Ui(e) => Some(e),
            _ => None,
        }
    }

    pub fn text(&self, name: &str) -> String {
        if let Inner::App(pid) = self.0 {
            return if name == "AXTitle" { super::apps::exe_path(pid as u32).map(|p| super::apps::named(&p).1).unwrap_or_default() } else { String::new() };
        }
        let Some(e) = self.ui() else { return String::new() };
        // SAFETY: COM calls on a live element
        unsafe {
            match name {
                "AXRole" => current_role(e).0.into(),
                "AXSubrole" => current_role(e).1.into(),
                "AXTitle" | "AXDescription" => bstr(e.CurrentName()),
                "AXValue" => current_value(e),
                "AXSelectedText" => selected_text(e),
                "AXPlaceholderValue" | "AXHelp" => bstr(e.CurrentHelpText()),
                _ => String::new(),
            }
        }
    }

    /// A text value, or a number's (a checkbox's 0 / 1)
    pub fn value(&self, name: &str) -> String {
        match (name, self.ui()) {
            ("AXValue", Some(e)) => current_value(e),
            _ => self.text(name),
        }
    }

    pub fn flag(&self, name: &str) -> Option<bool> {
        let e = self.ui()?;
        // SAFETY: COM calls on a live element
        unsafe {
            match name {
                "AXFocused" => e.CurrentHasKeyboardFocus().ok().map(|b| b.as_bool()),
                "AXEnabled" => e.CurrentIsEnabled().ok().map(|b| b.as_bool()),
                "AXEditable" => Some(pattern::<IUIAutomationValuePattern>(e, UIA_ValuePatternId).is_some_and(|v| v.CurrentIsReadOnly().is_ok_and(|r| !r.as_bool()))),
                _ => None,
            }
        }
    }

    pub fn number(&self, name: &str) -> Option<f64> {
        let r = pattern::<IUIAutomationRangeValuePattern>(self.ui()?, UIA_RangeValuePatternId)?;
        // SAFETY: COM calls on a live pattern
        unsafe {
            match name {
                "AXValue" => r.CurrentValue().ok(),
                "AXMinValue" => r.CurrentMinimum().ok(),
                "AXMaxValue" => r.CurrentMaximum().ok(),
                _ => None,
            }
        }
    }

    /// A web page's address (Chromium's and Firefox's document element holds it as its value).
    pub fn url(&self) -> String {
        let Some(e) = self.ui() else { return String::new() };
        let v = current_value(e);
        if v.starts_with("http://") || v.starts_with("https://") || v.starts_with("file://") {
            v
        } else {
            String::new()
        }
    }

    pub fn strings(&self, _name: &str) -> Vec<String> {
        vec![]
    }

    pub fn el(&self, name: &str) -> Option<El> {
        let u = uia()?;
        match (&self.0, name) {
            (Inner::App(pid), "AXFocusedUIElement") => {
                // SAFETY: COM calls on the element UI Automation hands over
                let f = unsafe { u.GetFocusedElement() }.ok()?;
                (unsafe { f.CurrentProcessId() }.ok()? == *pid).then_some(El(Inner::Ui(f)))
            }
            (Inner::App(pid), "AXFocusedWindow" | "AXMainWindow") => window(*pid),
            (Inner::App(pid), "AXMenuBar") => {
                let w = window(*pid)?;
                // SAFETY: a search under a live element
                let bar = unsafe {
                    let cond = u.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_MenuBarControlTypeId.0)).ok()?;
                    w.ui()?.FindFirst(TreeScope_Children, &cond).ok()?
                };
                Some(El(Inner::Ui(bar)))
            }
            (Inner::Ui(e), "AXParent") => {
                // SAFETY: the walker only reads
                let p = unsafe { u.ControlViewWalker().and_then(|w| w.GetParentElement(e)) }.ok()?;
                Some(El(Inner::Ui(p)))
            }
            _ => None,
        }
    }

    pub fn children(&self) -> Vec<El> {
        let (Some(u), Some(e)) = (uia(), self.ui()) else { return vec![] };
        let mut out = vec![];
        // SAFETY: the walker only reads; each child is kept as its own reference
        unsafe {
            let Ok(walker) = u.ControlViewWalker() else { return out };
            let mut c = walker.GetFirstChildElement(e).ok();
            while let Some(el) = c {
                c = walker.GetNextSiblingElement(&el).ok();
                out.push(El(Inner::Ui(el)));
                if out.len() > 2000 {
                    break;
                }
            }
        }
        out
    }

    /// (x, y, width, height) on screen, in desktop points
    pub fn frame(&self) -> (f64, f64, f64, f64) {
        // SAFETY: a COM call on a live element
        self.ui().and_then(|e| unsafe { e.CurrentBoundingRectangle() }.ok()).map(points).unwrap_or_default()
    }

    pub fn set_flag(&self, name: &str, on: bool) -> bool {
        match (&self.0, name) {
            // SAFETY: a COM call on a live element
            (Inner::Ui(e), "AXFocused") if on => unsafe { e.SetFocus() }.is_ok(),
            (Inner::Ui(e), "AXMain") if on => hwnd_of(e).is_some_and(raise),
            (Inner::App(pid), "AXFrontmost") if on => window(*pid).is_some_and(|w| w.ui().and_then(hwnd_of).is_some_and(raise)),
            // (Chromium and Electron build their tree for any UI Automation client that asks: nothing to turn on)
            (_, "AXManualAccessibility" | "AXEnhancedUserInterface") => true,
            _ => false,
        }
    }

    pub fn set_text(&self, name: &str, value: &str) -> bool {
        let Some(e) = self.ui() else { return false };
        match name {
            // SAFETY: a COM call on a live pattern
            "AXValue" => pattern::<IUIAutomationValuePattern>(e, UIA_ValuePatternId).is_some_and(|v| unsafe { v.SetValue(&BSTR::from(value)) }.is_ok()),
            _ => false,
        }
    }

    pub fn set_number(&self, name: &str, value: f64) -> bool {
        let Some(e) = self.ui() else { return false };
        match name {
            // SAFETY: a COM call on a live pattern
            "AXValue" => pattern::<IUIAutomationRangeValuePattern>(e, UIA_RangeValuePatternId).is_some_and(|r| unsafe { r.SetValue(value) }.is_ok()),
            _ => false,
        }
    }

    /// macOS's actions: `AXPress` (invoke, toggle, select, or open / close, whichever the element does), `AXRaise`.
    pub fn act(&self, action: &str) -> bool {
        let Some(e) = self.ui() else { return false };
        // SAFETY: COM calls on a live element's patterns
        unsafe {
            match action {
                "AXPress" => {
                    if let Some(p) = pattern::<IUIAutomationInvokePattern>(e, UIA_InvokePatternId) {
                        return p.Invoke().is_ok();
                    }
                    if let Some(p) = pattern::<IUIAutomationTogglePattern>(e, UIA_TogglePatternId) {
                        return p.Toggle().is_ok();
                    }
                    if let Some(p) = pattern::<IUIAutomationSelectionItemPattern>(e, UIA_SelectionItemPatternId) {
                        return p.Select().is_ok();
                    }
                    if let Some(p) = pattern::<IUIAutomationExpandCollapsePattern>(e, UIA_ExpandCollapsePatternId) {
                        return if p.CurrentExpandCollapseState() == Ok(ExpandCollapseState_Expanded) { p.Collapse() } else { p.Expand() }.is_ok();
                    }
                    pattern::<IUIAutomationLegacyIAccessiblePattern>(e, UIA_LegacyIAccessiblePatternId).is_some_and(|p| p.DoDefaultAction().is_ok())
                }
                "AXRaise" => hwnd_of(e).is_some_and(raise),
                _ => false,
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Apps and windows
// ---------------------------------------------------------------------------

/// Finds a running app with a window by name or id (exact first, then part of either, any case):
/// `(pid, name, id)`. Never `me`.
pub fn find_running_app(query: &str, me: i32) -> Option<(i32, String, String)> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }
    let apps: Vec<_> = super::apps::app_list().into_iter().filter(|(pid, _, _)| *pid != me).collect();
    let exact = apps.iter().find(|(_, id, name)| {
        let (n, i) = (name.to_lowercase(), id.to_lowercase());
        n == q || i == q || i.trim_end_matches(".exe") == q || format!("{n}.exe") == q
    });
    exact.or_else(|| apps.iter().find(|(_, id, name)| name.to_lowercase().contains(&q) || id.to_lowercase().contains(&q))).map(|(p, id, n)| (*p, n.clone(), id.clone()))
}

/// The app in front that isn't Sympony (`me`), else the frontmost one with a window: (pid, name, id).
pub fn front_app(me: i32) -> Option<(i32, String, String)> {
    let list = super::apps::app_list();
    let front = super::apps::frontmost_pid().filter(|p| *p != me);
    front.and_then(|f| list.iter().find(|(p, _, _)| *p == f)).or_else(|| list.iter().find(|(p, _, _)| *p != me)).map(|(p, id, n)| (*p, n.clone(), id.clone()))
}

/// The app's window: its frontmost one on the taskbar.
pub fn window(pid: i32) -> Option<El> {
    let h = super::apps::app_windows().into_iter().find(|w| super::apps::app_pid(*w) == pid as u32)?;
    let u = uia()?;
    // SAFETY: a COM call with a live top-level window
    let e = unsafe { u.ElementFromHandle(HWND(h)) }.ok()?;
    Some(El(Inner::Ui(e)))
}

/// The window's elements in reading order, with the elements themselves (for Hands), at most `max`. One round trip
/// per element (its children with what's read of them), and parts of the page far out of view are skipped.
pub fn read(win: &El, max: usize) -> (Vec<Node>, Vec<El>) {
    let (Some(u), Some(root)) = (uia(), win.ui()) else { return (vec![], vec![]) };
    // SAFETY: COM calls on live elements; what's read comes from the cache UI Automation filled
    unsafe {
        let Ok(cache) = u.CreateCacheRequest() else { return (vec![], vec![]) };
        for p in [
            UIA_ControlTypePropertyId, UIA_NamePropertyId, UIA_IsEnabledPropertyId, UIA_HasKeyboardFocusPropertyId,
            UIA_BoundingRectanglePropertyId, UIA_IsPasswordPropertyId, UIA_ValueValuePropertyId, UIA_ValueIsReadOnlyPropertyId,
            UIA_IsValuePatternAvailablePropertyId, UIA_RangeValueValuePropertyId, UIA_RangeValueMinimumPropertyId, UIA_RangeValueMaximumPropertyId,
            UIA_ToggleToggleStatePropertyId, UIA_SelectionItemIsSelectedPropertyId, UIA_HeadingLevelPropertyId, UIA_FrameworkIdPropertyId,
            UIA_HelpTextPropertyId,
        ] {
            let _ = cache.AddProperty(p);
        }
        let Ok(cond) = u.ControlViewCondition() else { return (vec![], vec![]) };
        let _ = cache.SetTreeFilter(&cond);
        let Ok(root) = root.BuildUpdatedCache(&cache) else { return (vec![], vec![]) };
        let wf = root.CachedBoundingRectangle().map(points).unwrap_or_default();
        // (what lies further than a window's height beyond it isn't read: a long page's far end costs time, not use)
        let near = |f: (f64, f64, f64, f64)| f.2 <= 0.0 || f.3 <= 0.0 || wf.3 <= 0.0
            || (f.1 + f.3 > wf.1 - wf.3 && f.1 < wf.1 + 2.0 * wf.3 && f.0 + f.2 > wf.0 - wf.2 && f.0 < wf.0 + 2.0 * wf.2);
        let get = |e: &IUIAutomationElement, p: UIA_PROPERTY_ID| e.GetCachedPropertyValue(p).ok();
        let (mut nodes, mut els) = (vec![], vec![]);
        let mut stack: Vec<(IUIAutomationElement, u16)> = vec![(root, 0)];
        while let Some((e, depth)) = stack.pop() {
            if nodes.len() >= max || depth > 60 {
                continue;
            }
            let ct = e.CachedControlType().unwrap_or(UIA_CustomControlTypeId);
            // (the menu bar and menus are run with `menu_path`, as on macOS)
            if ct == UIA_MenuBarControlTypeId || ct == UIA_MenuControlTypeId {
                continue;
            }
            let frame = e.CachedBoundingRectangle().map(points).unwrap_or_default();
            if depth > 0 && !near(frame) {
                continue;
            }
            let flag = |p| get(&e, p).and_then(|v| bool::try_from(&v).ok());
            let num = |p| get(&e, p).and_then(|v| f64::try_from(&v).ok());
            let text = |p| get(&e, p).and_then(|v| BSTR::try_from(&v).ok()).map(|b| b.to_string()).unwrap_or_default();
            let password = flag(UIA_IsPasswordPropertyId) == Some(true);
            let has_value = flag(UIA_IsValuePatternAvailablePropertyId) == Some(true);
            let traits = Traits {
                password,
                heading: get(&e, UIA_HeadingLevelPropertyId).and_then(|v| i32::try_from(&v).ok()).is_some_and(|h| h != HeadingLevel_None.0 && h != 0),
                editable: has_value && flag(UIA_ValueIsReadOnlyPropertyId) == Some(false),
                web: matches!(text(UIA_FrameworkIdPropertyId).as_str(), "Chrome" | "Gecko"),
            };
            let (role, subrole) = role_of(ct, traits);
            let name = text(UIA_NamePropertyId);
            // (a text's words are its value, as macOS's static text has them; a heading's its label)
            let (mut label, mut value) = match role {
                "AXStaticText" => (String::new(), name),
                _ => (name, String::new()),
            };
            if value.is_empty() && !password && role != "AXStaticText" {
                value = match role {
                    "AXCheckBox" => if get(&e, UIA_ToggleToggleStatePropertyId).and_then(|v| i32::try_from(&v).ok()) == Some(ToggleState_On.0) { "1" } else { "0" }.into(),
                    "AXRadioButton" => if flag(UIA_SelectionItemIsSelectedPropertyId) == Some(true) { "1" } else { "0" }.into(),
                    "AXSlider" | "AXIncrementor" => num(UIA_RangeValueValuePropertyId).map(|v| v.to_string()).unwrap_or_default(),
                    // (a link's value is its address on Windows, none on macOS: left out, as Eyes lists it there)
                    "AXLink" => String::new(),
                    _ if has_value => text(UIA_ValueValuePropertyId),
                    _ => String::new(),
                };
            }
            if label.is_empty() && (role == "AXTextField" || role == "AXTextArea") {
                label = text(UIA_HelpTextPropertyId);
            }
            let ranged = role == "AXSlider" || role == "AXIncrementor";
            let url = if role == "AXWebArea" && (value.starts_with("http") || value.starts_with("file:")) { std::mem::take(&mut value) } else { String::new() };
            nodes.push(Node {
                depth,
                role: role.into(),
                subrole: subrole.into(),
                label,
                value,
                min_val: if ranged { num(UIA_RangeValueMinimumPropertyId) } else { None },
                max_val: if ranged { num(UIA_RangeValueMaximumPropertyId) } else { None },
                enabled: flag(UIA_IsEnabledPropertyId).unwrap_or(true),
                focused: flag(UIA_HasKeyboardFocusPropertyId).unwrap_or(false),
                frame,
                classes: vec![],
                url,
            });
            els.push(El(Inner::Ui(e.clone())));
            // (children in reading order: pushed last-first)
            if let Ok(kids) = e.FindAllBuildCache(TreeScope_Children, &cond, &cache) {
                let n = kids.Length().unwrap_or(0);
                for i in (0..n).rev() {
                    if let Ok(k) = kids.GetElement(i) {
                        stack.push((k, depth + 1));
                    }
                }
            }
        }
        (nodes, els)
    }
}

/// The element with the keyboard, when it's `pid`'s.
fn focused_in(pid: i32) -> Option<IUIAutomationElement> {
    let u = uia()?;
    // SAFETY: COM calls on the element UI Automation hands over
    unsafe {
        let f = u.GetFocusedElement().ok()?;
        (f.CurrentProcessId().ok()? == pid).then_some(f)
    }
}

/// Whether the user is typing in `pid` now: its focused element takes text.
pub fn typing_in(pid: i32) -> bool {
    let Some(f) = focused_in(pid) else { return false };
    matches!(current_role(&f).0, "AXTextField" | "AXTextArea" | "AXComboBox" | "AXWebArea") && El(Inner::Ui(f)).flag("AXEditable") == Some(true)
}

/// The selected text in the app's focused element (never a password field's).
pub fn selection(pid: i32) -> String {
    let Some(f) = focused_in(pid) else { return String::new() };
    // SAFETY: a COM call on a live element
    if unsafe { f.CurrentIsPassword() }.is_ok_and(|p| p.as_bool()) {
        return String::new();
    }
    selected_text(&f)
}

/// Whether `pid` is the app in front (keys go to it).
pub fn is_front(pid: i32) -> bool {
    super::apps::frontmost_pid() == Some(pid)
}

/// Brings a window to the front. Windows lets only the app that had the last input take the front: an unassigned key
/// sent first counts as that input (nothing types), then the window is brought forward.
fn raise(h: HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
    let h = h.0;
    // SAFETY: plain window calls with a top-level window's handle
    unsafe {
        if IsIconic(h) != 0 {
            ShowWindow(h, SW_RESTORE);
        }
        if SetForegroundWindow(h) != 0 && GetForegroundWindow() == h {
            return true;
        }
        send_keys(&[(0xE8, true, false), (0xE8, false, false)]);
        SetForegroundWindow(h);
        BringWindowToTop(h);
        GetForegroundWindow() == h
    }
}

/// Brings the app's window forward and waits until the app is in front (≤ 1.5 s).
pub fn bring(pid: i32, win: &El) -> bool {
    let Some(h) = win.ui().and_then(hwnd_of).or_else(|| window(pid).and_then(|w| w.ui().and_then(hwnd_of))) else { return false };
    let top = top_level(h);
    raise(top);
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_millis(1500) {
        if is_front(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// The top-level window a window is part of.
fn top_level(h: HWND) -> HWND {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};
    // SAFETY: a plain query
    let root = unsafe { GetAncestor(h.0, GA_ROOT) };
    if root.is_null() {
        h
    } else {
        HWND(root)
    }
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/// macOS's virtual key codes (as `services::hands::keys` gives them) as Windows' virtual keys, and whether a key is an
/// "extended" one (arrows, Home / End, Page Up / Down, Delete: Windows wants it said).
fn vk_of(mac: u16) -> Option<(u16, bool)> {
    const LETTERS: [(u16, u8); 26] = [
        (0, b'A'), (11, b'B'), (8, b'C'), (2, b'D'), (14, b'E'), (3, b'F'), (5, b'G'), (4, b'H'), (34, b'I'), (38, b'J'), (40, b'K'), (37, b'L'), (46, b'M'),
        (45, b'N'), (31, b'O'), (35, b'P'), (12, b'Q'), (15, b'R'), (1, b'S'), (17, b'T'), (32, b'U'), (9, b'V'), (13, b'W'), (7, b'X'), (16, b'Y'), (6, b'Z'),
    ];
    const DIGITS: [(u16, u8); 10] = [(29, b'0'), (18, b'1'), (19, b'2'), (20, b'3'), (21, b'4'), (23, b'5'), (22, b'6'), (26, b'7'), (28, b'8'), (25, b'9')];
    if let Some((_, c)) = LETTERS.iter().chain(DIGITS.iter()).find(|(m, _)| *m == mac) {
        return Some((*c as u16, false));
    }
    Some(match mac {
        36 => (0x0D, false),  // Return
        48 => (0x09, false),  // Tab
        49 => (0x20, false),  // Space
        51 => (0x08, false),  // Backspace
        53 => (0x1B, false),  // Esc
        117 => (0x2E, true),  // forward Delete
        115 => (0x24, true),  // Home
        119 => (0x23, true),  // End
        116 => (0x21, true),  // Page Up
        121 => (0x22, true),  // Page Down
        123 => (0x25, true),  // Left
        124 => (0x27, true),  // Right
        125 => (0x28, true),  // Down
        126 => (0x26, true),  // Up
        43 => (0xBC, false),  // ,
        47 => (0xBE, false),  // .
        44 => (0xBF, false),  // /
        41 => (0xBA, false),  // ;
        39 => (0xDE, false),  // '
        33 => (0xDB, false),  // [
        30 => (0xDD, false),  // ]
        27 => (0xBD, false),  // -
        24 => (0xBB, false),  // =
        50 => (0xC0, false),  // `
        _ => return None,
    })
}

/// macOS's modifier flags as the keys held for them: ⌘ and Ctrl are Ctrl, ⌥ Alt, ⇧ Shift.
fn modifiers_of(flags: u64) -> Vec<u16> {
    let mut held = vec![];
    if flags & (0x0010_0000 | 0x0004_0000) != 0 {
        held.push(0x11); // Ctrl
    }
    if flags & 0x0008_0000 != 0 {
        held.push(0x12); // Alt
    }
    if flags & 0x0002_0000 != 0 {
        held.push(0x10); // Shift
    }
    held
}

/// Keys sent as if typed: (virtual key, down, extended).
fn send_keys(keys: &[(u16, bool, bool)]) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP};
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|&(vk, down, ext)| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: (if down { 0 } else { KEYEVENTF_KEYUP }) | (if ext { KEYEVENTF_EXTENDEDKEY } else { 0 }), time: 0, dwExtraInfo: 0 },
            },
        })
        .collect();
    // SAFETY: an array of initialised keyboard inputs with its length and the size of one
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) as usize == inputs.len() }
}

/// A key with modifier flags (`services::hands::keys`), to the app in front.
pub fn press_combo(code: u16, flags: u64) {
    let Some((vk, ext)) = vk_of(code) else { return };
    let mods = modifiers_of(flags);
    let mut keys: Vec<(u16, bool, bool)> = mods.iter().map(|m| (*m, true, false)).collect();
    keys.push((vk, true, ext));
    keys.push((vk, false, ext));
    keys.extend(mods.iter().rev().map(|m| (*m, false, false)));
    send_keys(&keys);
}

/// One key by macOS's code (36 Return), with Shift when `shift` (a new line in a chat box, not Send).
pub fn press_key(code: u16, shift: bool) {
    press_combo(code, if shift { 0x0002_0000 } else { 0 });
}

/// `text` as typed characters (they go to the app in front), whatever the keyboard layout.
pub fn type_text(text: &str) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE};
    let inputs: Vec<INPUT> = text
        .encode_utf16()
        .flat_map(|c| [0, KEYEVENTF_KEYUP].map(|up| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: c, dwFlags: KEYEVENTF_UNICODE | up, time: 0, dwExtraInfo: 0 } } }))
        .collect();
    if inputs.is_empty() {
        return;
    }
    // SAFETY: an array of initialised keyboard inputs with its length and the size of one
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
}

/// `text` as keys, in pieces (≤ 16 characters), new lines as Shift+Enter.
pub fn type_all(text: &str) {
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            press_key(36, true);
        }
        let chars: Vec<char> = line.trim_end_matches('\r').chars().collect();
        for piece in chars.chunks(16) {
            type_text(&piece.iter().collect::<String>());
            std::thread::sleep(Duration::from_millis(4));
        }
    }
}

// ---------------------------------------------------------------------------
// The rest of what Eyes and Ask other AIs need
// ---------------------------------------------------------------------------

/// Windows asks no permission to read and drive other apps' windows.
pub fn trusted(_ask: bool) -> bool {
    true
}

/// A password field has the keyboard: macOS's Secure Input has no Windows counterpart (password fields are never
/// read: their values aren't taken).
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

/// The app in front (to give the keyboard back to it).
pub fn front_pid() -> Option<i32> {
    super::apps::frontmost_pid()
}

/// Gives the front back to `pid` (the user's app), the same way as `bring`.
pub fn activate(pid: i32) {
    if let Some(w) = window(pid) {
        bring(pid, &w);
    }
}

/// Opens `url` in `app` (a program's id, a new tab in a browser), or a link in its own app (`claude://…`) when `app`
/// is empty. Windows has no "open without bringing forward": the app may come forward.
pub fn open_background(app: &str, url: &str) {
    if app.is_empty() {
        super::shell::open(url);
        return;
    }
    open_with(app, &[url.to_string()]);
}

/// Starts `app` (a program's id, or its path) with command-line arguments: it comes forward.
pub fn open_with(app: &str, args: &[String]) {
    let path = if std::path::Path::new(app).is_absolute() { Some(std::path::PathBuf::from(app)) } else { super::apps::exe_for(app) };
    match path {
        Some(p) => {
            let _ = std::process::Command::new(p).args(args).spawn();
        }
        None => {
            for a in args {
                super::shell::open(a);
            }
        }
    }
}

/// A running app's version (its program's ProductVersion), for routines learned in it.
pub fn app_version(app: &str) -> Option<String> {
    super::apps::version(app)
}

/// Windows asks no permission to picture a window.
pub fn screen_access(_ask: bool) -> bool {
    true
}

/// The handle of `pid`'s window closest to `frame` (points), else its frontmost one.
pub fn window_id_matching(pid: i32, frame: (f64, f64, f64, f64)) -> Option<u32> {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mine: Vec<_> = super::apps::app_windows().into_iter().filter(|w| super::apps::app_pid(*w) == pid as u32).collect();
    let first = *mine.first()?;
    let has_frame = frame.2 > 1.0 && frame.3 > 1.0;
    let best = mine
        .iter()
        .filter(|_| has_frame)
        .filter_map(|w| {
            let mut r: windows_sys::Win32::Foundation::RECT = unsafe { std::mem::zeroed() };
            // SAFETY: a plain query into a RECT
            (unsafe { GetWindowRect(*w, &mut r) } != 0).then(|| {
                let p = super::displays::points_of(r);
                ((p.x - frame.0).abs() + (p.y - frame.1).abs() + (p.w - frame.2).abs() + (p.h - frame.3).abs(), *w)
            })
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, w)| w);
    Some(best.unwrap_or(first) as usize as u32)
}

/// The handle of `pid`'s frontmost window.
pub fn window_id(pid: i32) -> Option<u32> {
    window_id_matching(pid, (0.0, 0.0, 0.0, 0.0))
}

// ---------------------------------------------------------------------------
// Hands: the mouse, a popup's option, a menu bar's item, waiting for a window to settle
// ---------------------------------------------------------------------------

/// The real mouse pointer moved to a point (desktop points): wakes hover-only controls.
pub fn mouse_move(x: f64, y: f64) {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetCursorPos;
    let (px, py) = super::displays::pixels_of(x, y);
    // SAFETY: a plain call
    unsafe { SetCursorPos(px, py) };
}

/// Mouse buttons or the wheel, where the pointer is: (flags, wheel amount).
fn send_mouse(events: &[(u32, i32)]) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEINPUT};
    for &(flags, data) in events {
        let input = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
        // SAFETY: one initialised mouse input
        unsafe { SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) };
        std::thread::sleep(Duration::from_millis(30));
    }
}

/// A left click at a point (hovers there first, so floating controls wake up).
pub fn click_at(x: f64, y: f64) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
    mouse_move(x, y);
    std::thread::sleep(Duration::from_millis(35));
    send_mouse(&[(MOUSEEVENTF_LEFTDOWN, 0), (MOUSEEVENTF_LEFTUP, 0)]);
}

/// A double-click at a point (opening files and list items).
pub fn double_click_at(x: f64, y: f64) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
    mouse_move(x, y);
    std::thread::sleep(Duration::from_millis(35));
    send_mouse(&[(MOUSEEVENTF_LEFTDOWN, 0), (MOUSEEVENTF_LEFTUP, 0), (MOUSEEVENTF_LEFTDOWN, 0), (MOUSEEVENTF_LEFTUP, 0)]);
}

/// A right click at a point (context menus).
pub fn right_click_at(x: f64, y: f64) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP};
    mouse_move(x, y);
    std::thread::sleep(Duration::from_millis(35));
    send_mouse(&[(MOUSEEVENTF_RIGHTDOWN, 0), (MOUSEEVENTF_RIGHTUP, 0)]);
}

/// A smooth left-button drag from one point to another (sliders, scrubbers, draggable controls).
pub fn drag(x1: f64, y1: f64, x2: f64, y2: f64) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP};
    mouse_move(x1, y1);
    std::thread::sleep(Duration::from_millis(40));
    send_mouse(&[(MOUSEEVENTF_LEFTDOWN, 0)]);
    let steps = 14;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        mouse_move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
        std::thread::sleep(Duration::from_millis(14));
    }
    std::thread::sleep(Duration::from_millis(25));
    send_mouse(&[(MOUSEEVENTF_LEFTUP, 0)]);
}

/// Wheel amounts for macOS's scroll pixels: a notch (120) moves about 100 pixels.
fn wheel(pixels: i32) -> i32 {
    if pixels == 0 {
        return 0;
    }
    let w = (pixels as f64 * 1.2).round() as i32;
    if w == 0 {
        pixels.signum()
    } else {
        w
    }
}

/// Scrolls what's under a point by `(dx, dy)` pixels (negative `dy`: down, negative `dx`: right, as on macOS).
pub fn scroll_xy(x: f64, y: f64, dx: i32, dy: i32) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MOUSEEVENTF_HWHEEL, MOUSEEVENTF_WHEEL};
    mouse_move(x, y);
    let mut events = vec![];
    if dy != 0 {
        events.push((MOUSEEVENTF_WHEEL, wheel(dy)));
    }
    if dx != 0 {
        // (Windows' horizontal wheel goes right when positive)
        events.push((MOUSEEVENTF_HWHEEL, -wheel(dx)));
    }
    send_mouse(&events);
}

/// Scrolls what's under a point by `dy` pixels (negative: down).
pub fn scroll_at(x: f64, y: f64, dy: i32) {
    scroll_xy(x, y, 0, dy);
}

/// Whether a name is the one wanted: whole, or its start, any case, ellipses aside.
fn named_like(name: &str, want: &str) -> bool {
    let n = name.trim().trim_end_matches(['…', '.']).to_lowercase();
    !n.is_empty() && !want.is_empty() && (n == want || n.starts_with(want))
}

/// Opens a popup / combo box and picks the item called `option` (case-insensitive, whole or start of its name).
pub fn choose(el: &El, option: &str) -> bool {
    let (Some(u), Some(e)) = (uia(), el.ui()) else { return false };
    let want = option.trim().trim_end_matches(['…', '.']).to_lowercase();
    // SAFETY: COM calls on live elements and their patterns
    unsafe {
        let expand: Option<IUIAutomationExpandCollapsePattern> = pattern(e, UIA_ExpandCollapsePatternId);
        let opened = match &expand {
            Some(p) => p.Expand().is_ok(),
            None => el.act("AXPress"),
        };
        if !opened {
            return false;
        }
        std::thread::sleep(Duration::from_millis(350));
        // (a combo box's items are under it; a popup menu's in a menu window of the same app)
        let Ok(cond) = u.ControlViewCondition() else { return false };
        let pid = e.CurrentProcessId().unwrap_or(0);
        let mut places = vec![e.clone()];
        if let Ok(root) = u.GetRootElement() {
            if let Ok(menus) = root.FindAll(TreeScope_Children, &cond) {
                for i in 0..menus.Length().unwrap_or(0) {
                    if let Ok(m) = menus.GetElement(i) {
                        if m.CurrentProcessId() == Ok(pid) && m.CurrentControlType() == Ok(UIA_MenuControlTypeId) {
                            places.push(m);
                        }
                    }
                }
            }
        }
        for place in places {
            let Ok(all) = place.FindAll(TreeScope_Descendants, &cond) else { continue };
            for i in 0..all.Length().unwrap_or(0) {
                let Ok(item) = all.GetElement(i) else { continue };
                let ct = item.CurrentControlType().unwrap_or(UIA_CustomControlTypeId);
                if !matches!(ct, UIA_ListItemControlTypeId | UIA_MenuItemControlTypeId | UIA_DataItemControlTypeId) || !named_like(&bstr(item.CurrentName()), &want) {
                    continue;
                }
                let picked = match pattern::<IUIAutomationSelectionItemPattern>(&item, UIA_SelectionItemPatternId) {
                    Some(s) => s.Select().is_ok(),
                    None => El(Inner::Ui(item.clone())).act("AXPress"),
                };
                if let Some(p) = &expand {
                    let _ = p.Collapse();
                }
                return picked;
            }
        }
        // (not there: closed again)
        match &expand {
            Some(p) => {
                let _ = p.Collapse();
            }
            None => press_key(53, false),
        }
        false
    }
}

/// Runs a menu bar item by its path (`["File", "Export…"]`, names whole or by their start, any case): each level
/// opened in turn, the last one run.
pub fn menu_path(pid: i32, path: &[String]) -> bool {
    let (Some(u), Some(bar)) = (uia(), El::app(pid).el("AXMenuBar")) else { return false };
    // SAFETY: COM calls on live elements and their patterns
    unsafe {
        let Ok(cond) = u.ControlViewCondition() else { return false };
        let mut items: Vec<IUIAutomationElement> = bar.children().into_iter().filter_map(|c| c.ui().cloned()).collect();
        for (i, name) in path.iter().enumerate() {
            let want = name.trim().trim_end_matches(['…', '.']).to_lowercase();
            let Some(found) = items.iter().find(|c| named_like(&bstr(c.CurrentName()), &want)).cloned() else { return false };
            if i + 1 == path.len() {
                return found.CurrentIsEnabled().is_ok_and(|b| b.as_bool()) && El(Inner::Ui(found)).act("AXPress");
            }
            // (opened, its items are under it, or in a menu window of the app's)
            match pattern::<IUIAutomationExpandCollapsePattern>(&found, UIA_ExpandCollapsePatternId) {
                Some(p) => {
                    let _ = p.Expand();
                }
                None => {
                    El(Inner::Ui(found.clone())).act("AXPress");
                }
            }
            std::thread::sleep(Duration::from_millis(250));
            items.clear();
            if let Ok(under) = found.FindAll(TreeScope_Descendants, &cond) {
                for k in 0..under.Length().unwrap_or(0) {
                    if let Ok(e) = under.GetElement(k) {
                        if e.CurrentControlType() == Ok(UIA_MenuItemControlTypeId) {
                            items.push(e);
                        }
                    }
                }
            }
            if items.is_empty() {
                if let Ok(root) = u.GetRootElement() {
                    if let Ok(windows) = root.FindAll(TreeScope_Children, &cond) {
                        for w in 0..windows.Length().unwrap_or(0) {
                            let Ok(m) = windows.GetElement(w) else { continue };
                            if m.CurrentProcessId() != Ok(pid) || m.CurrentControlType() != Ok(UIA_MenuControlTypeId) {
                                continue;
                            }
                            if let Ok(under) = m.FindAll(TreeScope_Descendants, &cond) {
                                for k in 0..under.Length().unwrap_or(0) {
                                    if let Ok(e) = under.GetElement(k) {
                                        items.push(e);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        false
    }
}

/// Waits until the window stops changing after an action (its title and the focused element stay the same for two
/// looks), at most `max_ms`. Cheap: a few properties, not the whole tree.
pub fn settle(pid: i32, win: &El, max_ms: u64) {
    let look = || {
        let f = focused_in(pid).map(|e| {
            let el = El(Inner::Ui(e));
            (el.text("AXRole"), el.text("AXDescription"), el.value("AXValue").len())
        });
        (win.text("AXTitle"), f)
    };
    let t0 = Instant::now();
    let (mut last, mut same) = (look(), 0);
    while t0.elapsed().as_millis() < max_ms as u128 {
        std::thread::sleep(Duration::from_millis(90));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_key_codes_are_windows_keys() {
        // (the codes services::hands::keys gives for a, c, v, Return, Backspace, the arrows)
        assert_eq!(vk_of(0), Some((b'A' as u16, false)));
        assert_eq!(vk_of(8), Some((b'C' as u16, false)));
        assert_eq!(vk_of(9), Some((b'V' as u16, false)));
        assert_eq!(vk_of(29), Some((b'0' as u16, false)));
        assert_eq!(vk_of(36), Some((0x0D, false)));
        assert_eq!(vk_of(51), Some((0x08, false)));
        assert_eq!(vk_of(123), Some((0x25, true)));
        assert_eq!(vk_of(999), None);
    }

    #[test]
    fn every_key_the_parser_knows_is_one_windows_presses() {
        // (every code services::hands::keys gives: letters, digits, punctuation, then the named keys)
        let codes = [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 28, 29, 31, 32, 34, 35, 37, 38, 40, 45, 46,
            43, 47, 44, 41, 39, 33, 30, 27, 24, 50, 36, 48, 49, 51, 53, 123, 124, 125, 126, 116, 121, 115, 119, 117,
        ];
        for code in codes {
            assert!(vk_of(code).is_some(), "macOS code {code} has no Windows key");
        }
    }

    #[test]
    fn command_and_control_both_press_ctrl() {
        assert_eq!(modifiers_of(0x0010_0000), vec![0x11]);
        assert_eq!(modifiers_of(0x0004_0000), vec![0x11]);
        assert_eq!(modifiers_of(0x0010_0000 | 0x0002_0000), vec![0x11, 0x10]);
        assert_eq!(modifiers_of(0x0008_0000), vec![0x12]);
    }

    #[test]
    fn control_types_read_as_macos_roles() {
        let t = Traits::default();
        assert_eq!(role_of(UIA_ButtonControlTypeId, t), ("AXButton", ""));
        assert_eq!(role_of(UIA_EditControlTypeId, Traits { password: true, ..t }), ("AXTextField", "AXSecureTextField"));
        assert_eq!(role_of(UIA_TextControlTypeId, t), ("AXStaticText", ""));
        assert_eq!(role_of(UIA_TextControlTypeId, Traits { heading: true, ..t }), ("AXHeading", ""));
        assert_eq!(role_of(UIA_DocumentControlTypeId, Traits { web: true, ..t }), ("AXWebArea", ""));
        assert_eq!(role_of(UIA_ComboBoxControlTypeId, t), ("AXPopUpButton", ""));
        assert_eq!(role_of(UIA_ComboBoxControlTypeId, Traits { editable: true, ..t }), ("AXComboBox", ""));
        assert_eq!(role_of(UIA_TabItemControlTypeId, t), ("AXRadioButton", "AXTabButton"));
    }

    #[test]
    fn wheel_follows_the_pixels() {
        assert_eq!(wheel(0), 0);
        assert_eq!(wheel(-300), -360);
        assert_eq!(wheel(1), 1);
    }
}
