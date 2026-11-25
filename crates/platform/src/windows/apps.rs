//! Running apps. On Windows an app's id is its program's file name in lower case (`chrome.exe`) where macOS has a
//! bundle id, and its name is the one Task Manager shows (the program's description: "Google Chrome"); Sympony itself
//! is `app.sympony`, as on macOS. A Store app runs inside ApplicationFrameHost's frame: the app is the process of the
//! window in that frame. Where an app is asked about by id, the id may also be a Start menu app id (as the media
//! controls name their app: `Chrome`, `MSEdge`, `Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic`).
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

/// Sympony's own id (its identifier, as macOS' bundle id).
const OWN_ID: &str = "app.sympony";

/// The programs seen in front or open: by id the path last seen with it (an app used today may have quit by the time
/// Screen Time asks for its icon), and by path its name (read once: not every second). Two programs can share an id
/// (Chromium browsers are all `chrome.exe`): each keeps its own name.
#[derive(Default)]
struct Seen {
    paths: HashMap<String, PathBuf>,
    names: HashMap<PathBuf, String>,
}
static SEEN: Mutex<Option<Seen>> = Mutex::new(None);

/// The full path of process `pid`'s program.
pub(crate) fn exe_path(pid: u32) -> Option<PathBuf> {
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
        ok.then(|| PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
    }
}

fn id_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// A string from a program's version information (`FileDescription`, …), in the first language it's written in.
fn version_string(path: &Path, key: &str) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
    let wide = |s: &str| super::shell::wide(s);
    let file = wide(&path.to_string_lossy());
    // SAFETY: NUL-terminated names; the block is sized as Windows says and outlives every pointer VerQueryValueW
    // hands back into it (each read within the length it gives)
    unsafe {
        let size = GetFileVersionInfoSizeW(file.as_ptr(), std::ptr::null_mut());
        if size == 0 {
            return None;
        }
        let mut block = vec![0u8; size as usize];
        if GetFileVersionInfoW(file.as_ptr(), 0, size, block.as_mut_ptr().cast()) == 0 {
            return None;
        }
        let (mut at, mut len) = (std::ptr::null_mut(), 0u32);
        let (lang, page) = if VerQueryValueW(block.as_ptr().cast(), wide(r"\VarFileInfo\Translation").as_ptr(), &mut at, &mut len) != 0 && len >= 4 {
            let p = at as *const u16;
            (*p, *p.add(1))
        } else {
            // (US English, Unicode)
            (0x0409, 0x04b0)
        };
        let query = wide(&format!(r"\StringFileInfo\{lang:04x}{page:04x}\{key}"));
        if VerQueryValueW(block.as_ptr().cast(), query.as_ptr(), &mut at, &mut len) == 0 || len == 0 {
            return None;
        }
        let text: Vec<u16> = std::slice::from_raw_parts(at as *const u16, len as usize).iter().copied().take_while(|c| *c != 0).collect();
        let text = String::from_utf16_lossy(&text).trim().to_string();
        (!text.is_empty()).then_some(text)
    }
}

/// (id, name) for a program, remembered for later.
pub(crate) fn named(path: &Path) -> (String, String) {
    let id = id_of(path);
    let mut seen = SEEN.lock().unwrap();
    let seen = seen.get_or_insert_with(Seen::default);
    seen.paths.insert(id.clone(), path.to_path_buf());
    if let Some(name) = seen.names.get(path) {
        return (id, name.clone());
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| id.clone());
    let name = version_string(path, "FileDescription").unwrap_or(stem);
    seen.names.insert(path.to_path_buf(), name.clone());
    (id, name)
}

pub(crate) fn class_of(w: HWND) -> String {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut buf = [0u16; 64];
    // SAFETY: the buffer and its length
    let n = unsafe { GetClassNameW(w, buf.as_mut_ptr(), buf.len() as i32) }.max(0) as usize;
    String::from_utf16_lossy(&buf[..n])
}

fn pid_of_window(w: HWND) -> u32 {
    let mut pid = 0;
    // SAFETY: any window handle; pid written once
    unsafe { GetWindowThreadProcessId(w, &mut pid) };
    pid
}

/// The process of the app a top-level window shows: a Store app's own, inside ApplicationFrameHost's frame.
pub(crate) fn app_pid(w: HWND) -> u32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::EnumChildWindows;
    let frame = pid_of_window(w);
    if class_of(w) != "ApplicationFrameWindow" {
        return frame;
    }
    unsafe extern "system" fn each(child: HWND, found: LPARAM) -> BOOL {
        // SAFETY: `found` is the (frame's pid, answer) pair below, alive while EnumChildWindows runs
        let found = unsafe { &mut *(found as *mut (u32, u32)) };
        let pid = pid_of_window(child);
        if pid != found.0 {
            found.1 = pid;
            return 0;
        }
        1
    }
    let mut found = (frame, 0u32);
    // SAFETY: each child window is handed to `each` before EnumChildWindows returns
    unsafe { EnumChildWindows(w, Some(each), &mut found as *mut (u32, u32) as LPARAM) };
    if found.1 != 0 {
        found.1
    } else {
        frame
    }
}

/// The windows the taskbar shows, frontmost first: visible, on this desktop (not cloaked), not owned by another
/// window, not a tool window, with a title.
pub(crate) fn app_windows() -> Vec<HWND> {
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindow, GetWindowLongW, GetWindowTextLengthW, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW};
    unsafe extern "system" fn each(h: HWND, out: LPARAM) -> BOOL {
        // SAFETY: `out` is the Vec below, alive while EnumWindows runs
        unsafe { (*(out as *mut Vec<HWND>)).push(h) };
        1
    }
    let mut all: Vec<HWND> = Vec::new();
    // SAFETY: each top-level window is handed to `each` before EnumWindows returns; the checks only read
    unsafe {
        EnumWindows(Some(each), &mut all as *mut Vec<HWND> as LPARAM);
        all.retain(|&h| {
            let mut cloaked = 0u32;
            IsWindowVisible(h) != 0
                && GetWindow(h, GW_OWNER).is_null()
                && (GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW) == 0
                && GetWindowTextLengthW(h) > 0
                && !(DwmGetWindowAttribute(h, DWMWA_CLOAKED as u32, (&raw mut cloaked).cast(), 4) == 0 && cloaked != 0)
        });
    }
    all
}

/// The app in front now (its pid), to give the keyboard back to it later.
pub fn frontmost_pid() -> Option<i32> {
    // SAFETY: no arguments
    let w = unsafe { GetForegroundWindow() };
    (!w.is_null()).then(|| app_pid(w) as i32)
}

/// Brings the app's frontmost window forward (restored when minimised).
pub fn activate_pid(pid: i32) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{IsIconic, SetForegroundWindow, ShowWindow, SW_RESTORE};
    let Some(w) = app_windows().into_iter().find(|w| app_pid(*w) == pid as u32) else { return };
    // SAFETY: a top-level window just listed
    unsafe {
        if IsIconic(w) != 0 {
            ShowWindow(w, SW_RESTORE);
        }
        if SetForegroundWindow(w) == 0 {
            // Windows turns it down at times though Sympony has the front, e.g. when that's the notch (a window
            // that never activates) after the Share window closed. As tao does to bring a window forward, a tap of
            // Alt lets the next try through. (Injected, so the dictation key's hook passes it by.)
            tap_alt();
            SetForegroundWindow(w);
        }
    }
}

/// An Alt press and release, sent to the app in front (Sympony's own window when it's used).
fn tap_alt() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VK_MENU};
    // SAFETY: a plain lookup
    let scan = unsafe { MapVirtualKeyW(u32::from(VK_MENU), MAPVK_VK_TO_VSC) } as u16;
    let key = |flags| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
    let inputs = [key(0), key(KEYEVENTF_KEYUP)];
    // SAFETY: two well-formed keyboard inputs, read during the call
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
}

/// The pid of a running program with this id (`spotify.exe`).
pub fn pid_of(id: &str) -> Option<i32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    if !id.to_ascii_lowercase().ends_with(".exe") {
        return None;
    }
    // SAFETY: the snapshot is checked, walked with a correctly sized entry and closed
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut more = Process32FirstW(snap, &mut e) != 0;
        while more {
            let n = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..n]).eq_ignore_ascii_case(id) {
                found = Some(e.th32ProcessID as i32);
                break;
            }
            more = Process32NextW(snap, &mut e) != 0;
        }
        CloseHandle(snap);
        found
    }
}

/// Whether a program with this id is running.
pub fn running(id: &str) -> bool {
    pid_of(id).is_some()
}

/// A program registered under App Paths (what Win+R finds by name): `chrome.exe` → its path.
fn app_path(id: &str) -> Option<PathBuf> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let key = super::shell::wide(&format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{id}"));
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE].into_iter().find_map(|root| {
        let (mut buf, mut size) = ([0u16; 1024], 2048u32);
        // SAFETY: a NUL-terminated key, its default value into a buffer with its size in bytes
        let read = unsafe { RegGetValueW(root, key.as_ptr(), std::ptr::null(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
        if read != 0 {
            return None;
        }
        let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
        let p = PathBuf::from(String::from_utf16_lossy(&buf[..n]).trim_matches('"'));
        p.exists().then_some(p)
    })
}

/// Where a program id's file is: the one last seen in front or open, else the one registered under App Paths (the
/// installed app of that name), else one running now.
pub(crate) fn exe_for(id: &str) -> Option<PathBuf> {
    let id = id.to_lowercase();
    if id == OWN_ID {
        return std::env::current_exe().ok();
    }
    if !id.ends_with(".exe") {
        return None;
    }
    let seen = SEEN.lock().unwrap().as_ref().and_then(|s| s.paths.get(&id).cloned());
    seen.or_else(|| app_path(&id)).or_else(|| pid_of(&id).and_then(|pid| exe_path(pid as u32)))
}

/// Explorer's name for an id: the program's path, or a Start menu app.
fn shell_name(id: &str) -> Option<String> {
    if id.is_empty() {
        return None;
    }
    if Path::new(id).is_absolute() {
        return Some(id.to_string());
    }
    if let Some(p) = exe_for(id) {
        return Some(p.to_string_lossy().to_string());
    }
    (!id.contains(['\\', '/'])).then(|| format!(r"shell:AppsFolder\{id}"))
}

/// An app's icon as a PNG about `px` pixels wide: a program by id, or a Start menu app (None when neither is found).
pub fn icon_png(id: &str, px: f64) -> Option<Vec<u8>> {
    super::image::shell_icon(&shell_name(id)?, px)
}

/// An app's name: a program's description ("Google Chrome"), or a Start menu app's.
pub fn app_name(id: &str) -> Option<String> {
    if id.eq_ignore_ascii_case(OWN_ID) {
        return Some("Sympony".to_string());
    }
    if let Some(p) = exe_for(id) {
        return Some(named(&p).1);
    }
    use ::windows::core::HSTRING;
    use ::windows::Win32::System::Com::CoTaskMemFree;
    use ::windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName, SIGDN_NORMALDISPLAY};
    let name = shell_name(id)?;
    super::mta();
    // SAFETY: COM calls on this thread's apartment; the name Windows hands over is copied, then freed as its docs ask
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(name), None).ok()?;
        let shown = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
        let text = shown.to_string().ok();
        CoTaskMemFree(Some(shown.0 as *const std::ffi::c_void));
        text.filter(|t| !t.is_empty())
    }
}

/// The id of an open app by its shown name (a notification names its app only so).
pub fn bundle_for_name(name: &str) -> Option<String> {
    open_apps().into_iter().find(|(_, n)| n.eq_ignore_ascii_case(name)).map(|(id, _)| id)
}

/// The app in front: (id, name).
pub fn frontmost() -> Option<(String, String)> {
    // SAFETY: no arguments
    let w = unsafe { GetForegroundWindow() };
    if w.is_null() {
        return None;
    }
    let pid = app_pid(w);
    if pid == std::process::id() {
        return Some((OWN_ID.to_string(), "Sympony".to_string()));
    }
    exe_path(pid).map(|p| named(&p))
}

/// Whether a process is an app with a window on the taskbar (a terminal, an editor): the one to bring forward for it.
pub fn is_app(pid: i32) -> bool {
    app_windows().into_iter().any(|w| app_pid(w) == pid as u32)
}

/// The apps open now (with a window on the taskbar), frontmost first: (id, name). Not Sympony itself.
pub fn open_apps() -> Vec<(String, String)> {
    let mine = std::process::id();
    let mut out: Vec<(String, String)> = Vec::new();
    for w in app_windows() {
        let pid = app_pid(w);
        if pid == mine {
            continue;
        }
        if let Some((id, name)) = exe_path(pid).map(|p| named(&p)) {
            if !out.iter().any(|(i, _)| *i == id) {
                out.push((id, name));
            }
        }
    }
    out
}

/// The apps with a window on the taskbar, frontmost first: (pid, id, name), each once (its frontmost window's). Not
/// Sympony itself.
pub(crate) fn app_list() -> Vec<(i32, String, String)> {
    let mine = std::process::id();
    let mut out: Vec<(i32, String, String)> = Vec::new();
    for w in app_windows() {
        let pid = app_pid(w);
        if pid == mine || out.iter().any(|(p, _, _)| *p == pid as i32) {
            continue;
        }
        if let Some((id, name)) = exe_path(pid).map(|p| named(&p)) {
            out.push((pid as i32, id, name));
        }
    }
    out
}

/// A program's version (its ProductVersion), by id.
pub(crate) fn version(id: &str) -> Option<String> {
    version_string(&exe_for(id)?, "ProductVersion")
}
