//! Files and the clipboard (stand-in: nothing read or written yet). `view` is the window's HWND where macOS takes its
//! NSView.
#![allow(clippy::missing_safety_doc)]
use std::ffi::c_void;

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
