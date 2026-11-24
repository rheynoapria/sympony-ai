//! A Chromium browser's address bar and tab strip (Chrome, Edge, Brave, Vivaldi), read through UI Automation: what
//! YouTube video mode needs on Windows, where macOS asks the browser for its tabs over AppleScript. Only the browser's
//! own controls are read, never the pages.
use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use ::windows::Win32::System::Variant::VARIANT;
use ::windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern, TreeScope_Children, TreeScope_Descendants,
    UIA_ClassNamePropertyId, UIA_ControlTypePropertyId, UIA_TabControlTypeId, UIA_TabItemControlTypeId, UIA_ValuePatternId,
};

/// The address in the address bar, with the window's title, of each window of the browser `exe` (its program's file
/// name, e.g. `chrome.exe`) whose title `want` accepts. No other window's address is read. A window shows its
/// current tab only: a video playing in a tab behind another isn't there (`has_tab` tells it's there).
pub fn addresses(exe: &str, want: &dyn Fn(&str) -> bool) -> Vec<(String, String)> {
    super::mta();
    // SAFETY: UI Automation's COM calls, on this thread's apartment (mta); each object is released when dropped
    unsafe { read(exe, want) }.unwrap_or_default()
}

/// Whether a tab of the browser `exe`'s windows, in front or not, has a name (its page's title, then the browser's
/// notes: "– Audio playing") that `want` accepts. Only yes or no comes back: no tab's name leaves here.
pub fn has_tab(exe: &str, want: &dyn Fn(&str) -> bool) -> bool {
    super::mta();
    // SAFETY: as in `addresses`
    unsafe { tab(exe, want) }.unwrap_or(false)
}

unsafe fn read(exe: &str, want: &dyn Fn(&str) -> bool) -> ::windows::core::Result<Vec<(String, String)>> {
    let uia = automation()?;
    // (its address bar: found before the page, which isn't searched)
    let omnibox = uia.CreatePropertyCondition(UIA_ClassNamePropertyId, &VARIANT::from("OmniboxViewViews"))?;
    let mut out = vec![];
    for (w, title) in windows(&uia, exe)? {
        if !want(&title) {
            continue;
        }
        if let Some(address) = w.FindFirst(TreeScope_Descendants, &omnibox).ok().and_then(|e| value(&e)) {
            out.push((address, title));
        }
    }
    Ok(out)
}

unsafe fn tab(exe: &str, want: &dyn Fn(&str) -> bool) -> ::windows::core::Result<bool> {
    let uia = automation()?;
    let control = |id: i32| uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(id));
    // (the tab strip, found before the page, which isn't searched; then its tabs)
    let (strip, tab) = (control(UIA_TabControlTypeId.0)?, control(UIA_TabItemControlTypeId.0)?);
    for (w, _) in windows(&uia, exe)? {
        let Ok(s) = w.FindFirst(TreeScope_Descendants, &strip) else { continue };
        let tabs = s.FindAll(TreeScope_Descendants, &tab)?;
        for i in 0..tabs.Length()? {
            if tabs.GetElement(i)?.CurrentName().is_ok_and(|n| want(&n.to_string())) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

unsafe fn automation() -> ::windows::core::Result<IUIAutomation> {
    CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
}

/// The browser `exe`'s top-level windows (Chromium's), with their titles.
unsafe fn windows(uia: &IUIAutomation, exe: &str) -> ::windows::core::Result<Vec<(IUIAutomationElement, String)>> {
    let chromium = uia.CreatePropertyCondition(UIA_ClassNamePropertyId, &VARIANT::from("Chrome_WidgetWin_1"))?;
    let all = uia.GetRootElement()?.FindAll(TreeScope_Children, &chromium)?;
    let mut out = vec![];
    for i in 0..all.Length()? {
        let w = all.GetElement(i)?;
        let title = w.CurrentName().map(|t| t.to_string()).unwrap_or_default();
        if !title.is_empty() && w.CurrentProcessId().is_ok_and(|pid| program(pid as u32).is_some_and(|p| p.eq_ignore_ascii_case(exe))) {
            out.push((w, title));
        }
    }
    Ok(out)
}

/// An address bar's text, as an address (Chromium may leave out the `https://`).
unsafe fn value(e: &IUIAutomationElement) -> Option<String> {
    let v: IUIAutomationValuePattern = e.GetCurrentPatternAs(UIA_ValuePatternId).ok()?;
    let text = v.CurrentValue().ok()?.to_string();
    let text = text.trim();
    (!text.is_empty()).then(|| if text.contains("://") { text.to_string() } else { format!("https://{text}") })
}

/// The file name of process `pid`'s program (`chrome.exe`).
fn program(pid: u32) -> Option<String> {
    super::apps::exe_path(pid).and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
}
