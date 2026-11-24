//! The Windows backend: the same modules, functions and types as `macos`, so the app reaches both as `platform::os`.
//!
//! Phase 1 of the Windows port (the workspace builds and its tests run on Windows): every function here is a
//! stand-in that reports "nothing there / not available" (no displays, no front app, permissions not granted, …)
//! rather than pretending to work. Real Win32 / UI Automation / WinRT code replaces them module by module; keep each
//! signature as `macos` has it, so the app needs no `cfg` of its own.
pub mod apps;
mod appbar;
mod audio;
pub mod automation;
mod brightness;
mod image;
pub mod displays;
pub mod keychain;
pub mod location;
pub mod window;
pub mod system;
pub mod notifications;
pub mod banners;
mod bluetooth;
pub mod ax;
pub mod radios;
mod readings;
pub mod calendar;
pub mod files;
pub mod media;
pub mod browser;
pub mod player;
mod picker;
mod privacy;
pub mod shell;
pub mod voice;
mod wifi;

/// Stands for objc2's `MainThreadMarker` (AppKit wants proof of the main thread; the Win32 calls here don't), so the
/// app's `MainThreadMarker::new()` checks read the same on both.
#[derive(Debug, Clone, Copy)]
pub struct MainThreadMarker(());

impl MainThreadMarker {
    pub fn new() -> Option<Self> {
        Some(Self(()))
    }
}

/// COM on this thread, in the multithreaded apartment (WinRT and UI Automation calls that wait on their answers),
/// once per thread and undone when the thread ends. A thread already in another apartment stays in it.
pub(crate) fn mta() {
    struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                // SAFETY: this thread's CoInitializeEx succeeded (below)
                unsafe { ::windows::Win32::System::Com::CoUninitialize() };
            }
        }
    }
    thread_local! {
        // SAFETY: paired with CoUninitialize in Drop, on this same thread, only when it succeeded
        static COM: Com = Com(unsafe { ::windows::Win32::System::Com::CoInitializeEx(None, ::windows::Win32::System::Com::COINIT_MULTITHREADED) }.is_ok());
    }
    COM.with(|_| {});
}

/// An undocumented COM interface of Windows' own (no public header: what its Settings and quick actions call), as
/// object `clsid` asked for interface `iid`, its methods called through their place in the interface's table. Each
/// use says which method it calls, at which place, and why that place holds.
pub(crate) struct Undocumented(::windows::core::IUnknown);

impl Undocumented {
    pub(crate) fn new(clsid: u128, iid: u128) -> Option<Self> {
        use ::windows::core::{IUnknown, Interface, GUID};
        mta();
        // SAFETY: COM objects on this thread's apartment (mta); `query` hands back the interface asked for, owned here
        // and released when dropped
        unsafe {
            let unknown: IUnknown = ::windows::Win32::System::Com::CoCreateInstance(&GUID::from_u128(clsid), None, ::windows::Win32::System::Com::CLSCTX_ALL).ok()?;
            let mut raw = std::ptr::null_mut();
            unknown.query(&GUID::from_u128(iid), &mut raw).ok().ok()?;
            (!raw.is_null()).then(|| Self(IUnknown::from_raw(raw)))
        }
    }

    /// The object, and the function at place `index` of its interface's table (IUnknown's three come first).
    ///
    /// # Safety
    /// `F` must be that method's real signature, the object first.
    pub(crate) unsafe fn method<F: Copy>(&self, index: usize) -> (*mut std::ffi::c_void, F) {
        use ::windows::core::Interface;
        let this = self.0.as_raw();
        let table = *(this as *const *const usize);
        (this, std::mem::transmute_copy(&*table.add(index)))
    }
}
