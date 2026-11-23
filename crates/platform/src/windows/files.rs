//! Files and the clipboard: choosing files (the Explorer file dialog), a file's icon, the clipboard (text and
//! pictures, read and written), the Recycle Bin. Sharing and dragging files out are stand-ins for now. `view` is the
//! window's HWND where macOS takes its NSView.
#![allow(clippy::missing_safety_doc)]
use std::ffi::c_void;

/// The Explorer file dialog choosing files / a folder / a program / an audio file: their paths (none: cancelled).
/// `what` as for `macos::files::choose`: "files" (several), "folder", "app" (.exe or shortcut, from the Start menu),
/// "backup" (.sympony, from Downloads), "audio", anything else one file (from the Start menu).
pub fn choose(what: &str, prompt: &str) -> Vec<String> {
    let (what, prompt) = (what.to_string(), prompt.to_string());
    // (its own thread: the dialog wants a single-threaded COM apartment, which the caller's thread may not be)
    std::thread::spawn(move || dialog(&what, &prompt).unwrap_or_default()).join().unwrap_or_default()
}

/// Where the dialog starts for `what`.
fn start_folder(what: &str) -> Option<String> {
    match what {
        "backup" => std::env::var("USERPROFILE").ok().map(|h| format!("{h}\\Downloads")),
        "files" | "folder" | "audio" => None,
        _ => std::env::var("ProgramData").ok().map(|d| format!("{d}\\Microsoft\\Windows\\Start Menu\\Programs")),
    }
}

fn dialog(what: &str, prompt: &str) -> ::windows::core::Result<Vec<String>> {
    use ::windows::core::{w, HSTRING};
    use ::windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
    use ::windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use ::windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_ALLOWMULTISELECT, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
    // SAFETY: COM calls on this thread's own apartment, set up here and torn down at the end; each path the dialog
    // hands back is copied, then freed with CoTaskMemFree as its docs ask.
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let out = (|| {
            let d: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let mut opts = d.GetOptions()? | FOS_FORCEFILESYSTEM;
            match what {
                "files" => opts |= FOS_ALLOWMULTISELECT,
                "folder" => opts |= FOS_PICKFOLDERS,
                _ => {}
            }
            d.SetOptions(opts)?;
            d.SetTitle(&HSTRING::from(prompt))?;
            let filters: &[COMDLG_FILTERSPEC] = match what {
                "app" => &[COMDLG_FILTERSPEC { pszName: w!("Programs"), pszSpec: w!("*.exe;*.lnk") }],
                "audio" => &[COMDLG_FILTERSPEC { pszName: w!("Audio"), pszSpec: w!("*.mp3;*.m4a;*.aac;*.wav;*.ogg;*.opus;*.flac") }],
                "backup" => &[COMDLG_FILTERSPEC { pszName: w!("Sympony backup"), pszSpec: w!("*.sympony") }, COMDLG_FILTERSPEC { pszName: w!("All files"), pszSpec: w!("*.*") }],
                _ => &[],
            };
            if !filters.is_empty() {
                d.SetFileTypes(filters)?;
            }
            if let Some(dir) = start_folder(what) {
                if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(dir), None) {
                    let _ = d.SetFolder(&item);
                }
            }
            // (Show errs when the user cancels: nothing chosen)
            if d.Show(None).is_err() {
                return Ok(vec![]);
            }
            let items = d.GetResults()?;
            let mut out = vec![];
            for i in 0..items.GetCount()? {
                let p = items.GetItemAt(i)?.GetDisplayName(SIGDN_FILESYSPATH)?;
                out.push(p.to_string().unwrap_or_default());
                CoTaskMemFree(Some(p.0 as *const c_void));
            }
            Ok(out.into_iter().filter(|p| !p.is_empty()).collect())
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        out
    }
}

/// A file's or folder's icon as Explorer shows it, a PNG about `px` wide.
pub fn icon_png(path: &str, px: f64) -> Option<Vec<u8>> {
    super::image::shell_icon(path, px)
}

/// Changes each time the clipboard does (Windows' clipboard sequence number).
pub fn change_count() -> isize {
    // SAFETY: no arguments
    unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() as isize }
}

/// What's on the clipboard now.
pub enum Clip {
    /// a copy marked private (password managers), or files
    Skip,
    Text(String),
    /// PNG bytes
    Image(Vec<u8>),
    None,
}

const CF_BITMAP: u32 = 2;
const CF_DIB: u32 = 8;
const CF_UNICODETEXT: u32 = 13;
const CF_HDROP: u32 = 15;

/// A clipboard format apps register by name ("PNG", the privacy marks).
fn format(name: &str) -> u32 {
    let name = super::shell::wide(name);
    // SAFETY: a NUL-terminated name
    unsafe { windows_sys::Win32::System::DataExchange::RegisterClipboardFormatW(name.as_ptr()) }
}

/// The clipboard opened for `f` (another app may hold it for a moment: a few tries), then closed again. None when it
/// stays held.
fn with_clipboard<T>(f: impl FnOnce() -> T) -> Option<T> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, OpenClipboard};
    // SAFETY: opened here, closed below, on this thread
    let open = (0..10).any(|i| {
        if i > 0 {
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        unsafe { OpenClipboard(std::ptr::null_mut()) != 0 }
    });
    if !open {
        return None;
    }
    let out = f();
    // SAFETY: opened above
    unsafe { CloseClipboard() };
    Some(out)
}

/// The bytes of a clipboard item in `fmt` (the clipboard open).
fn clip_bytes(fmt: u32) -> Option<Vec<u8>> {
    use windows_sys::Win32::System::DataExchange::GetClipboardData;
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    // SAFETY: the clipboard is open (the caller); its memory is only read, between lock and unlock
    unsafe {
        let mem = GetClipboardData(fmt);
        if mem.is_null() {
            return None;
        }
        let at = GlobalLock(mem) as *const u8;
        if at.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(at, GlobalSize(mem)).to_vec();
        GlobalUnlock(mem);
        Some(bytes)
    }
}

pub fn read_clip() -> Clip {
    use windows_sys::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};
    let has = |fmt: u32| fmt != 0 && unsafe { IsClipboardFormatAvailable(fmt) } != 0;
    with_clipboard(|| {
        // marked private by the app that copied it (what Windows' own clipboard history skips too), or files copied
        // in Explorer
        let kept_out = has(format("ExcludeClipboardContentFromMonitorProcessing"))
            || has(format("Clipboard Viewer Ignore"))
            || clip_bytes(format("CanIncludeInClipboardHistory")).is_some_and(|b| b.iter().all(|x| *x == 0))
            || has(CF_HDROP);
        if kept_out {
            return Clip::Skip;
        }
        if has(CF_UNICODETEXT) {
            if let Some(b) = clip_bytes(CF_UNICODETEXT) {
                let wide: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|c| *c != 0).collect();
                return Clip::Text(String::from_utf16_lossy(&wide));
            }
        }
        if let Some(png) = clip_bytes(format("PNG")).filter(|b| b.starts_with(b"\x89PNG")) {
            return Clip::Image(png);
        }
        // (any other picture: Windows hands it over as a bitmap)
        if has(CF_BITMAP) {
            // SAFETY: the clipboard's own bitmap, read while it's open, not freed (the clipboard owns it)
            let read = unsafe { super::image::bgra(GetClipboardData(CF_BITMAP)) };
            if let Some(png) = read.and_then(|(w, h, px)| super::image::png(w, h, px, false)) {
                return Clip::Image(png);
            }
        }
        Clip::None
    })
    .unwrap_or(Clip::None)
}

/// Hands `bytes` to the clipboard as `fmt` (it's open and emptied); false when it wasn't taken.
fn put(fmt: u32, bytes: &[u8]) -> bool {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::SetClipboardData;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    // SAFETY: the memory is filled between lock and unlock, then Windows' once SetClipboardData takes it, freed here
    // when it doesn't
    unsafe {
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if mem.is_null() {
            return false;
        }
        let to = GlobalLock(mem) as *mut u8;
        if to.is_null() {
            GlobalFree(mem);
            return false;
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), to, bytes.len());
        GlobalUnlock(mem);
        let taken = !SetClipboardData(fmt, mem).is_null();
        if !taken {
            GlobalFree(mem);
        }
        taken
    }
}

/// Puts `text` on the clipboard, as Copy does. False when another app keeps holding it.
pub fn write_text(text: &str) -> bool {
    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    let bytes: Vec<u8> = super::shell::wide(text).iter().flat_map(|c| c.to_le_bytes()).collect();
    // SAFETY: emptied while open
    with_clipboard(|| unsafe { EmptyClipboard() } != 0 && put(CF_UNICODETEXT, &bytes)).unwrap_or(false)
}

/// Puts a picture on the clipboard: as PNG (browsers, Office, chat apps keep its transparency) and as a bitmap (for
/// the rest, Paint among them).
pub fn write_png(png: &[u8]) -> bool {
    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    let Some((w, h, px)) = super::image::bgra_of_png(png) else { return false };
    // (a bitmap with its header: 32 bits, rows from the bottom)
    let mut dib = Vec::with_capacity(40 + px.len());
    for v in [40u32, w] {
        dib.extend_from_slice(&v.to_le_bytes());
    }
    dib.extend_from_slice(&(h as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&32u16.to_le_bytes());
    // (BI_RGB, its size, the resolution and the colour table: none)
    dib.extend_from_slice(&[0u8; 24]);
    dib.extend_from_slice(&px);
    // SAFETY: emptied while open
    with_clipboard(|| unsafe { EmptyClipboard() } != 0 && put(format("PNG"), png) | put(CF_DIB, &dib)).unwrap_or(false)
}

/// To the Recycle Bin (its Restore works). Where there's no Recycle Bin (a network drive), Windows asks before
/// deleting for good.
pub fn trash(path: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    // (a list of paths, each NUL-terminated, ending in an empty one)
    let mut from = super::shell::wide(path);
    from.push(0);
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_WANTNUKEWARNING) as u16,
        // SAFETY: the rest is "none" (a zeroed struct is valid: null window, null names)
        ..unsafe { std::mem::zeroed() }
    };
    // SAFETY: the double-NUL-terminated list outlives the call
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 {
        return Err(format!("Windows couldn't move it to the Recycle Bin (error {code:#x})"));
    }
    if op.fAnyOperationsAborted != 0 {
        return Err("cancelled".into());
    }
    Ok(())
}

pub unsafe fn share(_view: *mut c_void, _paths: &[String]) {}

pub unsafe fn drag_out(_view: *mut c_void, _paths: &[String], _done: Box<dyn Fn(bool)>) -> bool {
    false
}
