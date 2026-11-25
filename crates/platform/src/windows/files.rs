//! Files and the clipboard: choosing files (the Explorer file dialog), a file's icon, the clipboard (text and
//! pictures, read and written), the Recycle Bin, Windows' Share window and dragging files out to Explorer and apps.
//! `view` is the window's HWND where macOS takes its NSView.
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
pub(crate) const CF_UNICODETEXT: u32 = 13;
const CF_HDROP: u32 = 15;

/// A clipboard format apps register by name ("PNG", the privacy marks).
pub(crate) fn format(name: &str) -> u32 {
    let name = super::shell::wide(name);
    // SAFETY: a NUL-terminated name
    unsafe { windows_sys::Win32::System::DataExchange::RegisterClipboardFormatW(name.as_ptr()) }
}

/// The clipboard opened for `f` (another app may hold it for a moment: a few tries), then closed again. None when it
/// stays held.
pub(crate) fn with_clipboard<T>(f: impl FnOnce() -> T) -> Option<T> {
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
pub(crate) fn clip_bytes(fmt: u32) -> Option<Vec<u8>> {
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
pub(crate) fn put(fmt: u32, bytes: &[u8]) -> bool {
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

thread_local! {
    // The Share window's request handler on the window it was last opened over: one at a time, the next share takes
    // its place (else that window would hand out every earlier share's files too).
    static SHARING: std::cell::RefCell<Option<(::windows::ApplicationModel::DataTransfer::DataTransferManager, i64)>> =
        const { std::cell::RefCell::new(None) };
    // why the last `share` on this thread didn't open the Share window (None: it opened)
    static SHARE_FAILED: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// Why the last `share` on this thread didn't open the Share window, taken (None: it opened, or none was asked).
pub fn share_failed() -> Option<String> {
    SHARE_FAILED.with(|f| f.borrow_mut().take())
}

/// Windows' Share window (Nearby Sharing, Mail, other apps…) for these files and folders, over `view`'s window.
/// Closing it shares nothing. Main thread; `view` is the window's HWND.
///
/// # Safety
/// `view` must be a live window of this thread.
pub unsafe fn share(view: *mut c_void, paths: &[String]) {
    let why = if view.is_null() || paths.is_empty() {
        Some("nothing to share from".to_string())
    } else {
        share_in(::windows::Win32::Foundation::HWND(view), paths).err().map(|e| format!("{} ({:#010x})", e.message(), e.code().0))
    };
    SHARE_FAILED.with(|f| *f.borrow_mut() = why);
}

fn share_in(hwnd: ::windows::Win32::Foundation::HWND, paths: &[String]) -> ::windows::core::Result<()> {
    use ::windows::core::HSTRING;
    use ::windows::ApplicationModel::DataTransfer::{DataRequestedEventArgs, DataTransferManager};
    use ::windows::Foundation::TypedEventHandler;
    use ::windows::Storage::IStorageItem;
    use ::windows::Win32::UI::Shell::IDataTransferManagerInterop;
    use windows_collections::IIterable;
    let paths: Vec<String> = paths.iter().filter(|p| std::path::Path::new(p).exists()).cloned().collect();
    if paths.is_empty() {
        return Err(::windows::core::Error::new(::windows::Win32::Foundation::E_INVALIDARG, "the files are gone"));
    }
    let title = HSTRING::from(share_title(&paths));
    let interop = ::windows::core::factory::<DataTransferManager, IDataTransferManagerInterop>()?;
    // SAFETY: `hwnd` is the caller's live window, on its own thread
    let manager: DataTransferManager = unsafe { interop.GetForWindow(hwnd)? };
    SHARING.with(|s| {
        if let Some((m, token)) = s.borrow_mut().take() {
            let _ = m.RemoveDataRequested(token);
        }
    });
    // (asked for when the window opens, on this thread; a title is required, or Windows shows nothing to share.
    // The storage items are made there: they can't be handed between threads, and the handler could be)
    let token = manager.DataRequested(&TypedEventHandler::<DataTransferManager, DataRequestedEventArgs>::new(move |_, args| {
        let Some(args) = args.as_ref() else { return Ok(()) };
        let data = args.Request()?.Data()?;
        data.Properties()?.SetTitle(&title)?;
        // (WinRT lists of an interface hold Option<it>)
        let list: IIterable<IStorageItem> = storage_items(&paths).into_iter().map(Some).collect::<Vec<_>>().into();
        data.SetStorageItemsReadOnly(&list)
    }))?;
    SHARING.with(|s| *s.borrow_mut() = Some((manager, token)));
    // SAFETY: as above
    unsafe { interop.ShowShareUIForWindow(hwnd) }
}

/// The files and folders as WinRT storage items, the ones that are gone left out.
fn storage_items(paths: &[String]) -> Vec<::windows::Storage::IStorageItem> {
    use ::windows::core::{Interface, HSTRING};
    use ::windows::Storage::{IStorageItem, StorageFile, StorageFolder};
    paths.iter().filter_map(|p| {
        let h = HSTRING::from(p.as_str());
        if std::path::Path::new(p).is_dir() {
            StorageFolder::GetFolderFromPathAsync(&h).and_then(|op| op.join()).and_then(|f| f.cast::<IStorageItem>()).ok()
        } else {
            StorageFile::GetFileFromPathAsync(&h).and_then(|op| op.join()).and_then(|f| f.cast::<IStorageItem>()).ok()
        }
    }).collect()
}

/// What the Share window names: the one file's name, else how many there are.
fn share_title(paths: &[String]) -> String {
    match paths {
        [one] => std::path::Path::new(one).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| one.clone()),
        _ => format!("{} items", paths.len()),
    }
}

/// The files as the shell's own data object (CF_HDROP and the shell's formats, its drag picture), as Explorer makes
/// for a drag. Files from different folders are fine. COM must be set up on this thread.
fn data_object(paths: &[String]) -> ::windows::core::Result<::windows::Win32::System::Com::IDataObject> {
    use ::windows::core::HSTRING;
    use ::windows::Win32::Foundation::E_INVALIDARG;
    use ::windows::Win32::System::Com::IDataObject;
    use ::windows::Win32::UI::Shell::Common::ITEMIDLIST;
    use ::windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHCreateShellItemArrayFromIDLists, BHID_DataObject};
    // SAFETY: each ID list made here is freed below, after the item array has copied them
    let ids: Vec<*mut ITEMIDLIST> = paths.iter().filter(|p| std::path::Path::new(p).exists())
        .map(|p| unsafe { ILCreateFromPathW(&HSTRING::from(p.as_str())) }).filter(|id| !id.is_null()).collect();
    if ids.is_empty() {
        return Err(E_INVALIDARG.into());
    }
    let whole: Vec<*const ITEMIDLIST> = ids.iter().map(|id| *id as *const ITEMIDLIST).collect();
    // (the items' own data object, as Explorer asks for one)
    // SAFETY: the ID lists are live for the call
    let data = unsafe { SHCreateShellItemArrayFromIDLists(&whole).and_then(|items| items.BindToHandler::<_, IDataObject>(None::<&::windows::Win32::System::Com::IBindCtx>, &BHID_DataObject)) };
    for id in ids {
        // SAFETY: made by ILCreateFromPathW above, freed once
        unsafe { ILFree(Some(id)) };
    }
    data
}

/// Whether the mouse is over one of Sympony's own windows (the WebView's are another process's, under ours).
fn over_own_window() -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT};
    let mut at = POINT { x: 0, y: 0 };
    // SAFETY: reads of the cursor and the window under it
    unsafe {
        if GetCursorPos(&mut at) == 0 {
            return false;
        }
        let w = WindowFromPoint(at);
        if w.is_null() {
            return false;
        }
        let root = GetAncestor(w, GA_ROOT);
        let mut pid = 0u32;
        GetWindowThreadProcessId(if root.is_null() { w } else { root }, &mut pid);
        pid == std::process::id()
    }
}

/// Drags these files out of `view`'s window from the mouse's place now (the drag the page just started): Explorer and
/// the desktop copy them (or make shortcuts), apps take them as attachments. `done(dropped)` when it ends; a drop back
/// on Sympony's own windows isn't one, as on macOS. Main thread, during a mouse drag: with the button already up
/// (a click that's over) nothing starts, false.
///
/// # Safety
/// `view` must be a live window of this thread.
pub unsafe fn drag_out(view: *mut c_void, paths: &[String], done: Box<dyn Fn(bool)>) -> bool {
    use ::windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY, DROPEFFECT_LINK, DROPEFFECT_NONE};
    use ::windows::Win32::UI::Shell::SHDoDragDrop;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
    if view.is_null() {
        return false;
    }
    // (the primary button as the user set it, still held; GetAsyncKeyState reads the physical ones)
    // SAFETY: plain reads of the mouse
    let primary = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 { VK_RBUTTON } else { VK_LBUTTON };
    if unsafe { GetAsyncKeyState(primary as i32) } >= 0 {
        return false;
    }
    let Ok(data) = data_object(paths) else { return false };
    // the shell's own drop source and drag picture; a copy or a link, never a move: the Shelf only points at files,
    // and a drag never takes the user's file away from where it is
    // SAFETY: `view` is the caller's live window; the drag runs its own loop here until the drop
    let effect = unsafe { SHDoDragDrop(Some(::windows::Win32::Foundation::HWND(view)), &data, None::<&IDropSource>, DROPEFFECT_COPY | DROPEFFECT_LINK) };
    done(matches!(effect, Ok(e) if e != DROPEFFECT_NONE) && !over_own_window());
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder under the temp folder, removed when dropped.
    struct Scratch(std::path::PathBuf);

    impl Scratch {
        fn new(tag: &str) -> Scratch {
            let d = std::env::temp_dir().join(format!("sy-files-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&d);
            std::fs::create_dir_all(&d).unwrap();
            Scratch(d)
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The paths a data object hands a drop target as CF_HDROP, as Explorer reads them.
    fn dropped_paths(data: &::windows::Win32::System::Com::IDataObject) -> Vec<String> {
        use ::windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
        use ::windows::Win32::System::Ole::{ReleaseStgMedium, CF_HDROP};
        use ::windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
        let fmt = FORMATETC { cfFormat: CF_HDROP.0, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 };
        // SAFETY: the medium is read while held and released once
        unsafe {
            let mut medium = data.GetData(&fmt).unwrap();
            let drop = HDROP(medium.u.hGlobal.0);
            let n = DragQueryFileW(drop, u32::MAX, None);
            let out = (0..n).map(|i| {
                let mut buf = vec![0u16; DragQueryFileW(drop, i, None) as usize + 1];
                let len = DragQueryFileW(drop, i, Some(&mut buf)) as usize;
                String::from_utf16_lossy(&buf[..len])
            }).collect();
            ReleaseStgMedium(&mut medium);
            out
        }
    }

    #[test]
    fn a_drag_hands_out_the_shelfs_files_from_any_folder_as_explorer_reads_them() {
        use ::windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
        let s = Scratch::new("drag");
        let (a, b) = (s.0.join("one"), s.0.join("two words"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let files = [a.join("note.txt"), b.join("picture ü.png")];
        for f in &files {
            std::fs::write(f, b"x").unwrap();
        }
        let paths: Vec<String> = files.iter().map(|f| f.to_string_lossy().into_owned()).collect();
        // SAFETY: this test thread's own apartment, torn down at the end
        let init = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        {
            // (the shell hands out long names; the temp folder may be named short, DKEASS~1)
            let same = |a: &[String]| a.iter().map(|p| std::fs::canonicalize(p).unwrap()).collect::<Vec<_>>();
            let data = data_object(&paths).unwrap();
            assert_eq!(same(&dropped_paths(&data)), same(&paths));
            // a file that's gone is left out; none left: no drag
            let gone = s.0.join("gone.txt").to_string_lossy().into_owned();
            assert_eq!(same(&dropped_paths(&data_object(&[gone.clone(), paths[0].clone()]).unwrap())), same(&paths[..1]));
            assert!(data_object(&[gone]).is_err());
        }
        if init.is_ok() {
            // SAFETY: paired with the CoInitializeEx above
            unsafe { CoUninitialize() };
        }
    }

    #[test]
    fn a_share_that_cant_open_says_why_once() {
        // SAFETY: a null window is turned away before any use
        unsafe { share(std::ptr::null_mut(), &[r"C:\a.txt".into()]) };
        assert_eq!(share_failed().as_deref(), Some("nothing to share from"));
        assert_eq!(share_failed(), None);
    }

    #[test]
    fn the_share_window_names_one_file_or_how_many() {
        assert_eq!(share_title(&[r"C:\Users\me\Desktop\report.pdf".into()]), "report.pdf");
        assert_eq!(share_title(&[r"C:\a.txt".into(), r"C:\b.txt".into()]), "2 items");
    }

    #[test]
    fn the_share_window_gets_files_and_folders_as_storage_items() {
        let s = Scratch::new("share");
        let f = s.0.join("a.txt");
        std::fs::write(&f, b"x").unwrap();
        let paths = [f.to_string_lossy().into_owned(), s.0.to_string_lossy().into_owned(), s.0.join("gone.txt").to_string_lossy().into_owned()];
        let names: Vec<String> = storage_items(&paths).iter().map(|i| i.Name().unwrap().to_string()).collect();
        assert_eq!(names, vec!["a.txt".to_string(), s.0.file_name().unwrap().to_string_lossy().into_owned()]);
    }
}
