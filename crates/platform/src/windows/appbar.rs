//! Keep windows below Sympony (Settings → General): a strip across the top of Sympony's display, registered with the
//! shell as an app bar (as the taskbar is), so maximised windows start below it and Sympony never covers their tabs
//! or title bars. The strip lies under the notch (which stays above it) and under every window, so what's behind it
//! is the desktop: it's frosted over it (`reserveBlur`, 0 clear), or the colour of the app just below it when that's
//! one colour (`reserveMatch`), through DWM's accent (as the Start menu's and the taskbar's own look). It lives on a
//! thread of its own, which also hears the shell's app-bar notices.
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
/// LOOK changed.
const RESTYLE: u32 = WM_APP + 3;
/// The look-under timer, while the strip takes the app's colour.
const MATCH_TIMER: usize = 1;
const MATCH_EVERY_MS: u32 = 400;

/// The strip wanted: the display's rectangle (left, top, right) and the strip's height, in pixels; None: no strip.
static WANT: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);
/// How it looks: frosted (0 clear … 100) and whether it takes the colour of the app below.
static LOOK: Mutex<(u8, bool)> = Mutex::new((60, false));
/// The app below's colour (0xRRGGBB) while it's one colour and LOOK asks for it.
static UNDER: Mutex<Option<u32>> = Mutex::new(None);
/// While the album art shows behind the lyrics inside the notch: its colours at the notch's two ends (0xRRGGBB) and
/// where the notch's middle is (a screen pixel). The strip's left part is painted like the left end and its right
/// part like the right end, whatever LOOK says, so the top bar reads as one piece.
static ART: Mutex<Option<(u32, u32, i32)>> = Mutex::new(None);
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

/// How the strip looks: `frost` 0 (clear: the desktop as it is) to 100 (most frosted), and `match_app`: the colour
/// of the app just below it instead, while that's one colour. Kept for when a strip is made.
pub fn set_look(frost: u8, match_app: bool) {
    let look = (frost.min(100), match_app);
    {
        let mut l = LOOK.lock().unwrap();
        if *l == look {
            return;
        }
        *l = look;
    }
    restyle_soon();
}

/// The album art's colours for the strip (`ART`), or none.
pub fn set_art(art: Option<(u32, u32, i32)>) {
    {
        let mut a = ART.lock().unwrap();
        if *a == art {
            return;
        }
        *a = art;
    }
    restyle_soon();
}

fn restyle_soon() {
    if let Some(&strip) = STRIP.get().filter(|s| **s != 0) {
        // SAFETY: the strip's own window; the message only asks it to read LOOK and ART again
        unsafe { PostMessageW(strip as HWND, RESTYLE, 0, 0) };
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
                // (black: what DWM's frame drawn into the window shows through, so the accent is all there is)
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
            restyle(h);
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
        restyle(h);
    }
}

/// The look ART, else LOOK and UNDER, ask for. The album art's two colours are painted (DWM's frame and accent off);
/// otherwise DWM's frame is drawn into the whole window, whose black lets the accent be all there is. The look-under
/// timer runs only while the strip is there and takes the app's colour.
unsafe fn restyle(h: HWND) {
    use windows_sys::Win32::Graphics::Dwm::DwmExtendFrameIntoClientArea;
    use windows_sys::Win32::Graphics::Gdi::InvalidateRect;
    use windows_sys::Win32::UI::Controls::MARGINS;
    let (frost, match_app) = *LOOK.lock().unwrap();
    let art = ART.lock().unwrap().is_some();
    let matching = match_app && !art && WANT.lock().unwrap().is_some();
    unsafe {
        if matching {
            SetTimer(h, MATCH_TIMER, MATCH_EVERY_MS, None);
        } else {
            KillTimer(h, MATCH_TIMER);
            *UNDER.lock().unwrap() = None;
        }
        let m = if art { 0 } else { -1 };
        DwmExtendFrameIntoClientArea(h, &MARGINS { cxLeftWidth: m, cxRightWidth: m, cyTopHeight: m, cyBottomHeight: m });
        if art {
            set_accent(h, ACCENT_DISABLED, 0);
        } else {
            let under = if matching { *UNDER.lock().unwrap() } else { None };
            let (state, colour) = accent_for(frost, under);
            set_accent(h, state, colour);
        }
        InvalidateRect(h, std::ptr::null(), 1);
    }
}

/// Paints the album art's two colours (ART), split where the notch's middle is; otherwise only the class's black.
unsafe fn paint(h: HWND) {
    use windows_sys::Win32::Graphics::Gdi::*;
    unsafe {
        let mut ps: PAINTSTRUCT = std::mem::zeroed();
        let dc = BeginPaint(h, &mut ps);
        if let Some((left, right, middle)) = *ART.lock().unwrap() {
            let (mut client, mut at) = (RECT { left: 0, top: 0, right: 0, bottom: 0 }, RECT { left: 0, top: 0, right: 0, bottom: 0 });
            GetClientRect(h, &mut client);
            GetWindowRect(h, &mut at);
            let split = (middle - at.left).clamp(0, client.right);
            for (rgb, part) in [(left, RECT { right: split, ..client }), (right, RECT { left: split, ..client })] {
                let brush = CreateSolidBrush(colorref(rgb));
                FillRect(dc, &part, brush);
                DeleteObject(brush);
            }
        }
        EndPaint(h, &ps);
    }
}

/// 0xRRGGBB → GDI's 0x00BBGGRR.
fn colorref(rgb: u32) -> u32 {
    ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}

/// What's just below the strip, along its left and right thirds (the notch's panel may hang below its middle):
/// one colour, or None.
unsafe fn look_under(h: HWND) -> Option<u32> {
    use windows_sys::Win32::Graphics::Gdi::*;
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    unsafe {
        if GetWindowRect(h, &mut r) == 0 || r.right <= r.left {
            return None;
        }
        let w = r.right - r.left;
        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return None;
        }
        let mem = CreateCompatibleDC(screen);
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = w;
        bi.bmiHeader.biHeight = -1; // (one row, top-down)
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        bi.bmiHeader.biCompression = BI_RGB;
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(mem, &bi, DIB_RGB_COLORS, &mut bits, std::ptr::null_mut(), 0);
        let mut found = None;
        if !dib.is_null() && !bits.is_null() {
            let old = SelectObject(mem, dib);
            // (the row just below the strip: the app's tab strip or title bar)
            if BitBlt(mem, 0, 0, w, 1, screen, r.left, r.bottom, SRCCOPY) != 0 {
                // SAFETY: the section holds one row of `w` 32-bit pixels, written by BitBlt above
                let row = std::slice::from_raw_parts(bits as *const u32, w as usize);
                found = one_colour(row);
            }
            SelectObject(mem, old);
            DeleteObject(dib);
        }
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        found
    }
}

/// DWM's accent for the strip: `state` (an ACCENT_* below) and its colour (0xAABBGGRR). False where Windows has no
/// accent to set (the strip stays black).
unsafe fn set_accent(h: HWND, state: u32, colour: u32) -> bool {
    #[repr(C)]
    struct AccentPolicy {
        state: u32,
        flags: u32,
        colour: u32,
        animation: u32,
    }
    #[repr(C)]
    struct Data {
        attribute: u32,
        data: *mut std::ffi::c_void,
        size: usize,
    }
    type SetWindowCompositionAttribute = unsafe extern "system" fn(HWND, *mut Data) -> i32;
    const WCA_ACCENT_POLICY: u32 = 19;
    static SET: OnceLock<Option<SetWindowCompositionAttribute>> = OnceLock::new();
    let set = SET.get_or_init(|| {
        use windows_sys::Win32::System::LibraryLoader::GetProcAddress;
        // SAFETY: user32 is loaded in every GUI process; the name is a NUL-terminated ASCII string
        unsafe {
            let user32 = GetModuleHandleW(windows_sys::core::w!("user32.dll"));
            // SAFETY: the export of that name has this signature since Windows 10 (undocumented, as the shell uses it)
            GetProcAddress(user32, c"SetWindowCompositionAttribute".as_ptr().cast())
                .map(|f| std::mem::transmute::<unsafe extern "system" fn() -> isize, SetWindowCompositionAttribute>(f))
        }
    });
    let Some(set) = set else { return false };
    let mut policy = AccentPolicy { state, flags: 2, colour, animation: 0 };
    let mut d = Data { attribute: WCA_ACCENT_POLICY, data: (&raw mut policy).cast(), size: std::mem::size_of::<AccentPolicy>() };
    // SAFETY: the strip's own window and a policy that lives through the call
    unsafe { set(h, &mut d) != 0 }
}

const ACCENT_DISABLED: u32 = 0;
const ACCENT_ENABLE_GRADIENT: u32 = 1;
const ACCENT_ENABLE_TRANSPARENTGRADIENT: u32 = 2;
const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
/// The frost's tint (0xBBGGRR): a near black, so it reads with the black notch above it.
const FROST_TINT: u32 = 0x1c1c1c;

/// The accent for a look: the app's colour (`under`, 0xRRGGBB) solid; else clear at 0; else acrylic, its tint more
/// opaque the more frosted (from 0x14 at 1 to 0xc0 at 100). Returns (state, 0xAABBGGRR).
fn accent_for(frost: u8, under: Option<u32>) -> (u32, u32) {
    if let Some(rgb) = under {
        return (ACCENT_ENABLE_GRADIENT, 0xff00_0000 | colorref(rgb));
    }
    match u32::from(frost.min(100)) {
        0 => (ACCENT_ENABLE_TRANSPARENTGRADIENT, 0),
        f => (ACCENT_ENABLE_ACRYLICBLURBEHIND, ((0x14 + (f - 1) * (0xc0 - 0x14) / 99) << 24) | FROST_TINT),
    }
}

/// A row of screen pixels (0x__RRGGBB) along its left and right thirds: their colour when they're all within a few
/// steps of each other (their average), else None.
fn one_colour(row: &[u32]) -> Option<u32> {
    let n = row.len();
    if n < 12 {
        return None;
    }
    let picks: Vec<u32> = (0..n / 3).step_by((n / 48).max(1)).chain((n - n / 3..n).step_by((n / 48).max(1))).map(|i| row[i] & 0xff_ffff).collect();
    let ch = |c: u32, s: u32| (c >> s) & 0xff;
    let mut out = 0;
    for s in [16, 8, 0] {
        let (lo, hi) = picks.iter().fold((255, 0), |(lo, hi), &c| (ch(c, s).min(lo), ch(c, s).max(hi)));
        if hi - lo > 6 {
            return None;
        }
        out |= (picks.iter().map(|&c| ch(c, s)).sum::<u32>() / picks.len() as u32) << s;
    }
    Some(out)
}

unsafe extern "system" fn proc(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            APPLY => {
                apply(h);
                0
            }
            RESTYLE => {
                restyle(h);
                0
            }
            WM_PAINT => {
                paint(h);
                0
            }
            // (the app below: its colour when it changed)
            WM_TIMER if wp == MATCH_TIMER => {
                let now = look_under(h);
                let changed = {
                    let mut under = UNDER.lock().unwrap();
                    std::mem::replace(&mut *under, now) != now
                };
                if changed {
                    restyle(h);
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_look_is_the_app_s_colour_else_clear_at_0_else_frosted_more_and_more() {
        // (0xRRGGBB in, 0xAABBGGRR out, opaque)
        assert_eq!(accent_for(60, Some(0x3478f6)), (ACCENT_ENABLE_GRADIENT, 0xfff6_7834));
        assert_eq!(accent_for(0, None), (ACCENT_ENABLE_TRANSPARENTGRADIENT, 0));
        assert_eq!(accent_for(1, None), (ACCENT_ENABLE_ACRYLICBLURBEHIND, 0x1400_0000 | FROST_TINT));
        assert_eq!(accent_for(100, None), (ACCENT_ENABLE_ACRYLICBLURBEHIND, 0xc000_0000 | FROST_TINT));
        assert_eq!(accent_for(250, None), accent_for(100, None));
        let alpha = |f| accent_for(f, None).1 >> 24;
        assert!((1..100).all(|f| alpha(f) < alpha(f + 1)), "more frosted, more tint");
    }

    #[test]
    fn one_colour_only_when_both_sides_are_that_colour() {
        let row = vec![0xff20_2124u32; 1920];
        assert_eq!(one_colour(&row), Some(0x20_2124));
        // (a few steps apart: their average; 40 is one of the pixels looked at)
        let mut near = row.clone();
        near[40] = 0x26_2427;
        assert_eq!(one_colour(&near), Some(0x20_2124));
        near[40] = 0x29_2427;
        assert_eq!(one_colour(&near), None, "more than a few steps");
        // (the middle, under the notch's panel, doesn't count)
        let mut middle = row.clone();
        middle[960] = 0xffff_ffff;
        assert_eq!(one_colour(&middle), Some(0x20_2124));
        // (a tab of another colour on one side, or a wallpaper: none)
        let mut tab = row.clone();
        for p in &mut tab[100..300] {
            *p = 0xffe8_eaed;
        }
        assert_eq!(one_colour(&tab), None);
        let gradient: Vec<u32> = (0..1920u32).map(|i| (i / 8) << 8).collect();
        assert_eq!(one_colour(&gradient), None);
        assert_eq!(one_colour(&[0; 4]), None);
    }
}
