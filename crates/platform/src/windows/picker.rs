//! The screen colour picker: a still of every screen, with a magnifier by the pointer showing the pixels around it and
//! the colour under it. A click, Enter or Space picks it; Esc or a right-click lets go; the arrow keys move the
//! pointer one pixel (ten with Shift). Its own window and message loop, on the calling thread, until then.
use std::cell::RefCell;
use windows_sys::core::{w, PCWSTR};
use windows_sys::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, SetFocus, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_UP};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

/// Pixels across the magnifier.
const CELLS: i32 = 13;

struct Picker {
    /// the still, in a memory DC (and what was selected into it before)
    shot: HDC,
    bitmap: HBITMAP,
    was: HGDIOBJ,
    size: (i32, i32),
    /// the pointer, in the still's pixels
    at: POINT,
    /// where the magnifier is drawn
    lens: RECT,
    /// the magnifier's measures for the screen's scale: one pixel's size, the label's height
    zoom: i32,
    label: i32,
    font: HFONT,
    picked: Option<Option<[u8; 3]>>,
}

thread_local! {
    static PICKER: RefCell<Option<Picker>> = const { RefCell::new(None) };
}

/// The colour picked on screen; None when let go (or no screen to pick from).
pub fn pick_color() -> Option<[u8; 3]> {
    // SAFETY: this thread's DPI awareness is set for the picker's window and put back after it
    unsafe {
        // (pixels, not points, on every screen whatever its scale)
        let before = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let picked = run();
        if !before.is_null() {
            SetThreadDpiAwarenessContext(before);
        }
        picked
    }
}

unsafe fn run() -> Option<[u8; 3]> {
    let (x, y) = (GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN));
    let (w, h) = (GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
    if w <= 0 || h <= 0 {
        return None;
    }
    let screen = GetDC(std::ptr::null_mut());
    let shot = CreateCompatibleDC(screen);
    let bitmap = CreateCompatibleBitmap(screen, w, h);
    let was = SelectObject(shot, bitmap);
    BitBlt(shot, 0, 0, w, h, screen, x, y, SRCCOPY | CAPTUREBLT);
    ReleaseDC(std::ptr::null_mut(), screen);
    let mut at = POINT { x: 0, y: 0 };
    GetCursorPos(&mut at);
    let (mut dpi, mut unused) = (96u32, 0u32);
    GetDpiForMonitor(MonitorFromPoint(at, MONITOR_DEFAULTTONEAREST), MDT_EFFECTIVE_DPI, &mut dpi, &mut unused);
    let scale = |n: i32| (n as f32 * dpi.max(96) as f32 / 96.0).round() as i32;
    let font = CreateFontW(-scale(14), 0, 0, 0, FW_SEMIBOLD as i32, 0, 0, 0, DEFAULT_CHARSET.into(), OUT_DEFAULT_PRECIS.into(), CLIP_DEFAULT_PRECIS.into(), CLEARTYPE_QUALITY.into(), 0, w!("Segoe UI"));
    let mut p = Picker { shot, bitmap, was, size: (w, h), at: POINT { x: at.x - x, y: at.y - y }, lens: RECT { left: 0, top: 0, right: 0, bottom: 0 }, zoom: scale(9), label: scale(28), font, picked: None };
    p.lens = lens(&p);
    PICKER.with(|s| *s.borrow_mut() = Some(p));
    let hwnd = CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, class(), w!(""), WS_POPUP, x, y, w, h, std::ptr::null_mut(), std::ptr::null_mut(), GetModuleHandleW(std::ptr::null()), std::ptr::null());
    if !hwnd.is_null() {
        ShowWindow(hwnd, SW_SHOW);
        SetForegroundWindow(hwnd);
        SetFocus(hwnd);
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    let p = PICKER.with(|s| s.borrow_mut().take())?;
    SelectObject(p.shot, p.was);
    DeleteObject(p.bitmap);
    DeleteDC(p.shot);
    DeleteObject(p.font);
    p.picked.flatten()
}

fn class() -> PCWSTR {
    static ONCE: std::sync::Once = std::sync::Once::new();
    let name = w!("SymponyColorPicker");
    ONCE.call_once(|| {
        // SAFETY: a class with this module's handle, the system's cross cursor and `proc`, registered once
        unsafe {
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(proc),
                hInstance: GetModuleHandleW(std::ptr::null()),
                hCursor: LoadCursorW(std::ptr::null_mut(), IDC_CROSS),
                lpszClassName: name,
                ..std::mem::zeroed()
            };
            RegisterClassExW(&wc);
        }
    });
    name
}

/// Where the magnifier goes: below right of the pointer, or on the other side near an edge.
fn lens(p: &Picker) -> RECT {
    let (side, tall, gap) = (CELLS * p.zoom, CELLS * p.zoom + p.label, p.zoom * 2);
    let left = if p.at.x + gap + side > p.size.0 { p.at.x - gap - side } else { p.at.x + gap };
    let top = if p.at.y + gap + tall > p.size.1 { p.at.y - gap - tall } else { p.at.y + gap };
    let (left, top) = (left.max(0), top.max(0));
    RECT { left, top, right: left + side, bottom: top + tall }
}

/// The still's pixel under the pointer.
unsafe fn color(p: &Picker) -> Option<[u8; 3]> {
    let c: COLORREF = GetPixel(p.shot, p.at.x, p.at.y);
    (c != CLR_INVALID).then(|| [(c & 0xff) as u8, ((c >> 8) & 0xff) as u8, ((c >> 16) & 0xff) as u8])
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        // (the still is drawn whole in WM_PAINT: nothing to erase first)
        WM_ERASEBKGND => 1,
        WM_PAINT => {
            paint(hwnd);
            0
        }
        WM_MOUSEMOVE => {
            moved(hwnd, POINT { x: (lp & 0xffff) as i16 as i32, y: ((lp >> 16) & 0xffff) as i16 as i32 });
            0
        }
        WM_LBUTTONDOWN => {
            finish(hwnd, true);
            0
        }
        WM_RBUTTONDOWN => {
            finish(hwnd, false);
            0
        }
        WM_KEYDOWN => {
            let step = if GetKeyState(VK_SHIFT as i32) < 0 { 10 } else { 1 };
            match wp as u16 {
                VK_ESCAPE => finish(hwnd, false),
                VK_RETURN | VK_SPACE => finish(hwnd, true),
                VK_LEFT => nudge(-step, 0),
                VK_RIGHT => nudge(step, 0),
                VK_UP => nudge(0, -step),
                VK_DOWN => nudge(0, step),
                _ => {}
            }
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// The pointer moved: the magnifier is drawn again where it was and where it goes.
unsafe fn moved(hwnd: HWND, at: POINT) {
    let rects = PICKER.with(|s| {
        let mut s = s.try_borrow_mut().ok()?;
        let p = s.as_mut()?;
        let old = p.lens;
        p.at = at;
        p.lens = lens(p);
        Some((old, p.lens))
    });
    if let Some((old, new)) = rects {
        InvalidateRect(hwnd, &old, 0);
        InvalidateRect(hwnd, &new, 0);
    }
}

unsafe fn nudge(dx: i32, dy: i32) {
    let mut at = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut at) != 0 {
        // (WM_MOUSEMOVE follows)
        SetCursorPos(at.x + dx, at.y + dy);
    }
}

/// Picked (`pick`) or let go: the window closes and the loop in `run` ends.
unsafe fn finish(hwnd: HWND, pick: bool) {
    PICKER.with(|s| {
        if let Some(p) = s.borrow_mut().as_mut() {
            p.picked = Some(if pick { color(p) } else { None });
        }
    });
    DestroyWindow(hwnd);
}

/// The still where it needs drawing, then the magnifier over it: in a buffer first, so nothing flickers.
unsafe fn paint(hwnd: HWND) {
    let mut ps: PAINTSTRUCT = std::mem::zeroed();
    let dc = BeginPaint(hwnd, &mut ps);
    PICKER.with(|s| {
        let Ok(s) = s.try_borrow() else { return };
        let Some(p) = s.as_ref() else { return };
        let r = ps.rcPaint;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return;
        }
        let back = CreateCompatibleDC(dc);
        let bitmap = CreateCompatibleBitmap(dc, w, h);
        let was = SelectObject(back, bitmap);
        BitBlt(back, 0, 0, w, h, p.shot, r.left, r.top, SRCCOPY);
        // (the magnifier is drawn in the window's coordinates)
        SetViewportOrgEx(back, -r.left, -r.top, std::ptr::null_mut());
        draw_lens(back, p);
        SetViewportOrgEx(back, 0, 0, std::ptr::null_mut());
        BitBlt(dc, r.left, r.top, w, h, back, 0, 0, SRCCOPY);
        SelectObject(back, was);
        DeleteObject(bitmap);
        DeleteDC(back);
    });
    EndPaint(hwnd, &ps);
}

unsafe fn draw_lens(dc: HDC, p: &Picker) {
    let l = p.lens;
    let side = CELLS * p.zoom;
    // the pixels around the pointer, each a square
    SetStretchBltMode(dc, COLORONCOLOR);
    StretchBlt(dc, l.left, l.top, side, side, p.shot, p.at.x - CELLS / 2, p.at.y - CELLS / 2, CELLS, CELLS, SRCCOPY);
    let (white, black, dark) = (rgb(255, 255, 255), rgb(0, 0, 0), rgb(24, 24, 27));
    frame(dc, RECT { left: l.left - 1, top: l.top - 1, right: l.right + 1, bottom: l.bottom + 1 }, black);
    frame(dc, RECT { left: l.left, top: l.top, right: l.right, bottom: l.top + side }, white);
    // the one under the pointer
    let c = l.left + (CELLS / 2) * p.zoom;
    let m = l.top + (CELLS / 2) * p.zoom;
    frame(dc, RECT { left: c - 1, top: m - 1, right: c + p.zoom + 1, bottom: m + p.zoom + 1 }, black);
    frame(dc, RECT { left: c, top: m, right: c + p.zoom, bottom: m + p.zoom }, white);
    // its colour and code
    let label = RECT { left: l.left, top: l.top + side, right: l.right, bottom: l.bottom };
    fill(dc, label, dark);
    let Some([r, g, b]) = color(p) else { return };
    let pad = (p.label - p.zoom * 2) / 2;
    let swatch = RECT { left: label.left + pad, top: label.top + pad, right: label.left + pad + p.zoom * 2, bottom: label.bottom - pad };
    fill(dc, swatch, rgb(r, g, b));
    frame(dc, swatch, rgb(120, 120, 128));
    let code: Vec<u16> = format!("#{r:02X}{g:02X}{b:02X}").encode_utf16().collect();
    let was = SelectObject(dc, p.font);
    SetBkMode(dc, TRANSPARENT as i32);
    SetTextColor(dc, white);
    let mut text = RECT { left: swatch.right + pad, ..label };
    DrawTextW(dc, code.as_ptr(), code.len() as i32, &mut text, DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX);
    SelectObject(dc, was);
}

fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    r as u32 | (g as u32) << 8 | (b as u32) << 16
}

unsafe fn fill(dc: HDC, r: RECT, c: COLORREF) {
    let brush = CreateSolidBrush(c);
    FillRect(dc, &r, brush);
    DeleteObject(brush);
}

unsafe fn frame(dc: HDC, r: RECT, c: COLORREF) {
    let brush = CreateSolidBrush(c);
    FrameRect(dc, &r, brush);
    DeleteObject(brush);
}
