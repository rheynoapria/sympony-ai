//! Sympony's own windows (stand-in: left as Tauri made them). `handle` is the window's HWND where macOS takes its
//! NSWindow.
#![allow(clippy::missing_safety_doc)]
use std::ffi::c_void;

pub unsafe fn style_notch_window(_handle: *mut c_void) {}

pub unsafe fn style_onboarding_window(_handle: *mut c_void, _level: isize) {}

pub unsafe fn set_window_level(_handle: *mut c_void, _level: isize, _lower: Option<bool>) {}

pub unsafe fn set_window_shadow(_handle: *mut c_void, _shadow: bool) {}

pub unsafe fn set_window_alpha(_handle: *mut c_void, _alpha: f64) {}

pub unsafe fn set_click_through(_handle: *mut c_void, _through: bool) {}

pub unsafe fn bring_front(_handle: *mut c_void) {}
