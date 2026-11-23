//! Files and the clipboard. Choosing files works (the Explorer file dialog); the rest is a stand-in for now (nothing
//! read or written). `view` is the window's HWND where macOS takes its NSView.
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

pub fn icon_png(_path: &str, _px: f64) -> Option<Vec<u8>> {
    None
}

/// Changes each time the clipboard does.
pub fn change_count() -> isize {
    0
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

pub fn read_clip() -> Clip {
    Clip::None
}

pub fn write_text(_text: &str) -> bool {
    false
}

pub fn write_png(_png: &[u8]) -> bool {
    false
}

/// To the Recycle Bin.
pub fn trash(_path: &str) -> Result<(), String> {
    Err("moving to the Recycle Bin isn't available on Windows yet".into())
}

pub unsafe fn share(_view: *mut c_void, _paths: &[String]) {}

pub unsafe fn drag_out(_view: *mut c_void, _paths: &[String], _done: Box<dyn Fn(bool)>) -> bool {
    false
}
