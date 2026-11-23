//! Opening things the way Explorer does: ShellExecute (a link in the browser, a file in its app, a folder in Explorer),
//! and selecting a file in an Explorer window. Same functions as `macos::shell`; call them off the main thread.
use windows_sys::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
use windows_sys::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems, ShellExecuteW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

pub(crate) fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// COM for this thread while it lives (ShellExecute can hand a target to a shell extension, which wants COM). A thread
/// that already has COM in the other mode keeps it, and this doesn't undo it.
struct Com(bool);

impl Com {
    fn new() -> Self {
        // SAFETY: plain call; balanced by CoUninitialize in Drop only when it succeeded.
        Com(unsafe { CoInitializeEx(std::ptr::null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32) } >= 0)
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            // SAFETY: pairs the successful CoInitializeEx above, on the same thread.
            unsafe { CoUninitialize() };
        }
    }
}

/// ShellExecute's "open" on `file` with `params`: true when Windows took it (it returns more than 32).
fn shell_open(file: &str, params: Option<&str>) -> bool {
    let _com = Com::new();
    let (f, verb) = (wide(file), wide("open"));
    let p = params.map(wide);
    // SAFETY: NUL-terminated UTF-16 strings that outlive the call; no owner window.
    let r = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), f.as_ptr(), p.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()), std::ptr::null(), SW_SHOWNORMAL) };
    r as isize > 32
}

/// A link, file or folder in the app that handles it. False when Windows refused it (no app for it, not found…).
pub fn open(target: &str) -> bool {
    !target.is_empty() && shell_open(target, None)
}

/// `path` selected in an Explorer window.
pub fn reveal(path: &str) -> bool {
    if path.is_empty() {
        return false;
    }
    let _com = Com::new();
    let w = wide(path);
    // SAFETY: the item list is made from a NUL-terminated path, used for one call, and freed after it.
    unsafe {
        let pidl = ILCreateFromPathW(w.as_ptr());
        if pidl.is_null() {
            return false;
        }
        let ok = SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0) >= 0;
        ILFree(pidl);
        ok
    }
}

/// `files` opened with the program at `app` (an .exe or a shortcut from `files::choose("app", …)`).
pub fn open_with(app: &str, files: &[String]) -> Result<(), String> {
    // (a Windows path can't hold a double quote, so quoting each one is enough; one that does isn't a real path and
    // would end its quotes early, so it's refused rather than passed on)
    if files.iter().any(|f| f.contains('"')) {
        return Err("a file name with a double quote isn't a Windows path".into());
    }
    let params = files.iter().map(|f| format!("\"{f}\"")).collect::<Vec<_>>().join(" ");
    if shell_open(app, Some(&params)) {
        Ok(())
    } else {
        Err(format!("Windows couldn’t start {}", std::path::Path::new(app).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| app.to_string())))
    }
}
