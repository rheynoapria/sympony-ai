//! A Chromium browser's address bar (Chrome, Edge, Brave, Vivaldi), read through UI Automation: what YouTube video
//! mode needs on Windows, where macOS asks the browser for its tabs over AppleScript.
use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use ::windows::Win32::System::Variant::VARIANT;
use ::windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern, TreeScope_Children, TreeScope_Descendants,
    UIA_ClassNamePropertyId, UIA_ValuePatternId,
};

/// The address in the address bar, with the window's title, of each window of the browser `exe` (its program's file
/// name, e.g. `chrome.exe`) whose title `want` accepts. No other window's address is read. A window shows its
/// current tab only: a video playing in a tab behind another isn't there.
pub fn addresses(exe: &str, want: &dyn Fn(&str) -> bool) -> Vec<(String, String)> {
    super::mta();
    // SAFETY: UI Automation's COM calls, on this thread's apartment (mta); each object is released when dropped
    unsafe { read(exe, want) }.unwrap_or_default()
}

unsafe fn read(exe: &str, want: &dyn Fn(&str) -> bool) -> ::windows::core::Result<Vec<(String, String)>> {
    let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
    let class = |name: &str| uia.CreatePropertyCondition(UIA_ClassNamePropertyId, &VARIANT::from(name));
    // (Chromium's top-level windows, then its address bar inside one: found before the page, which isn't searched)
    let windows = uia.GetRootElement()?.FindAll(TreeScope_Children, &class("Chrome_WidgetWin_1")?)?;
    let omnibox = class("OmniboxViewViews")?;
    let mut out = vec![];
    for i in 0..windows.Length()? {
        let w = windows.GetElement(i)?;
        let title = w.CurrentName().map(|t| t.to_string()).unwrap_or_default();
        if title.is_empty() || !want(&title) || !w.CurrentProcessId().is_ok_and(|pid| program(pid as u32).is_some_and(|p| p.eq_ignore_ascii_case(exe))) {
            continue;
        }
        if let Some(address) = w.FindFirst(TreeScope_Descendants, &omnibox).ok().and_then(|e| value(&e)) {
            out.push((address, title));
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
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
    // SAFETY: the handle is checked, used for this one query and closed; the buffer outlives the call
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(h);
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        ok.then(|| path.rsplit('\\').next().unwrap_or("").to_string())
    }
}
