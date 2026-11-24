//! Keep windows below Sympony (Settings → General): a strip across the top of Sympony's display, registered with the
//! shell as an app bar (as the taskbar is), so maximised windows start below it and Sympony never covers their tabs
//! or title bars. The strip is a black window under the notch (which stays above it), so the two read as one bar.
//! It lives on a thread of its own, which also hears the shell's app-bar notices.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::Shell::{SHAppBarMessage, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABN_POSCHANGED, APPBARDATA};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// WANT changed.
const APPLY: u32 = WM_APP + 1;
/// The shell's app-bar notices.
const NOTICE: u32 = WM_APP + 2;

/// The strip wanted: the display's rectangle (left, top, right) and the strip's height, in pixels; None: no strip.
static WANT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
/// The strip's window (as a number: a raw handle isn't Send), made the first time a strip is wanted.
static STRIP: OnceLock<usize> = OnceLock::new();
/// Registered with the shell.
static REGISTERED: AtomicBool = AtomicBool::new(false);

/// A strip `height` pixels tall across the top of the display whose rectangle is (left, top, right), or none. Waits
/// (up to 2 s) for the strip to be in place, or given back: Sympony quitting gives the space back before it's gone.
pub fn set(want: Option<(i32, i32, i32, i32)>) {
    {
        let mut w = WANT.lock().unwrap();
        if *w == want {
            return;
        }
        *w = want;
    }
    if want.is_none() && STRIP.get().is_none() {
        return;
    }
    let strip = *STRIP.get_or_init(spawn);
    if strip != 0 {
        // SAFETY: the strip's own window; the message only asks it to read WANT again
        unsafe { SendMessageTimeoutW(strip as HWND, APPLY, 0, 0, SMTO_ABORTIFHUNG, 2000, std::ptr::null_mut()) };
    }
}

/// The strip's thread: its window and the loop that serves it, for as long as Sympony runs.
fn spawn() -> usize {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        // SAFETY: a window class and window of this module, served by this thread's own message loop
        unsafe {
            // (pixels on every display, whatever its scale)
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let class = windows_sys::core::w!("SymponyStrip");
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(proc),
                hInstance: instance,
                hbrBackground: GetStockObject(BLACK_BRUSH),
                lpszClassName: class,
                ..std::mem::zeroed()
            };
            RegisterClassExW(&wc);
            let h = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, class, windows_sys::core::w!(""), WS_POPUP, 0, 0, 0, 0, std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null());
            let _ = tx.send(h as usize);
            if h.is_null() {
                return;
            }
            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    });
    rx.recv().unwrap_or(0)
}

fn data(h: HWND) -> APPBARDATA {
    // SAFETY: a plain struct, all zeroes being valid
    let mut d: APPBARDATA = unsafe { std::mem::zeroed() };
    d.cbSize = std::mem::size_of::<APPBARDATA>() as u32;
    d.hWnd = h;
    d.uCallbackMessage = NOTICE;
    d
}

/// Registers, places or gives back the strip as WANT says.
unsafe fn apply(h: HWND) {
    let want = *WANT.lock().unwrap();
    unsafe {
        match want {
            Some((left, top, right, height)) => {
                if !REGISTERED.swap(true, Ordering::Relaxed) {
                    SHAppBarMessage(ABM_NEW, &mut data(h));
                }
                // (the shell moves it below a taskbar that's at the top too)
                let mut d = data(h);
                d.uEdge = ABE_TOP;
                d.rc = RECT { left, top, right, bottom: top + height };
                SHAppBarMessage(ABM_QUERYPOS, &mut d);
                d.rc.bottom = d.rc.top + height;
                SHAppBarMessage(ABM_SETPOS, &mut d);
                SetWindowPos(h, HWND_BOTTOM, d.rc.left, d.rc.top, d.rc.right - d.rc.left, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            }
            None => {
                if REGISTERED.swap(false, Ordering::Relaxed) {
                    SHAppBarMessage(ABM_REMOVE, &mut data(h));
                }
                ShowWindow(h, SW_HIDE);
            }
        }
    }
}

unsafe extern "system" fn proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            APPLY => {
                apply(h);
                0
            }
            // (another bar or the taskbar moved: the strip takes its place again)
            NOTICE if wp as u32 == ABN_POSCHANGED => {
                apply(h);
                0
            }
            // (a click on the strip doesn't take the keyboard from the app in front)
            WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
            _ => DefWindowProcW(h, msg, wp, lp),
        }
    }
}
