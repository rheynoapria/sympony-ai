//! Displays and the pointer, in the same space as macOS: the whole desktop's, top-left origin, in points (a
//! monitor's physical pixels over its scale: 1.0 at 96 DPI, 1.25 at 120…), which is what Tauri's logical positions
//! are. With every monitor at one scale that space is exact; with mixed scales each monitor is scaled by its own
//! factor, so the primary one is exact and the others' origins are approximate.
use super::MainThreadMarker;
use crate::geometry::{Display, Rect};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW, MONITOR_DEFAULTTONEAREST};
use windows_sys::Win32::UI::HiDpi::{GetAwarenessFromDpiAwarenessContext, GetDpiForMonitor, GetThreadDpiAwarenessContext, DPI_AWARENESS_UNAWARE, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetCursorPos, MONITORINFOF_PRIMARY};

/// (left, top, right, bottom) in physical pixels.
type Px = (i32, i32, i32, i32);

struct Monitor {
    device: String,
    full: Px,
    work: Px,
    primary: bool,
    scale: f64,
}

fn px(r: RECT) -> Px {
    (r.left, r.top, r.right, r.bottom)
}

/// A monitor's scale (its DPI over 96). 1.0 when this thread isn't DPI-aware: Windows then hands out rectangles
/// already scaled to 96 DPI, and dividing again would shrink them. (Sympony's windows are per-monitor aware: Tauri.)
fn scale(h: HMONITOR) -> f64 {
    // SAFETY: plain queries; GetDpiForMonitor writes two u32s.
    unsafe {
        if GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()) == DPI_AWARENESS_UNAWARE {
            return 1.0;
        }
        let (mut x, mut y) = (0u32, 0u32);
        if GetDpiForMonitor(h, MDT_EFFECTIVE_DPI, &mut x, &mut y) == 0 && x > 0 {
            x as f64 / 96.0
        } else {
            1.0
        }
    }
}

fn monitor(h: HMONITOR) -> Option<Monitor> {
    let mut mi = MONITORINFOEXW::default();
    mi.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    // SAFETY: `mi` is a MONITORINFOEXW whose cbSize says so, as GetMonitorInfoW wants for the device name.
    if unsafe { GetMonitorInfoW(h, &mut mi as *mut MONITORINFOEXW as *mut MONITORINFO) } == 0 {
        return None;
    }
    let n = mi.szDevice.iter().position(|&c| c == 0).unwrap_or(mi.szDevice.len());
    Some(Monitor {
        device: String::from_utf16_lossy(&mi.szDevice[..n]),
        full: px(mi.monitorInfo.rcMonitor),
        work: px(mi.monitorInfo.rcWork),
        primary: mi.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
        scale: scale(h),
    })
}

fn monitors() -> Vec<Monitor> {
    unsafe extern "system" fn each(h: HMONITOR, _: HDC, _: *mut RECT, out: LPARAM) -> BOOL {
        // SAFETY: `out` is the Vec passed below, alive for the whole (synchronous) enumeration.
        unsafe { (*(out as *mut Vec<HMONITOR>)).push(h) };
        1
    }
    let mut handles: Vec<HMONITOR> = vec![];
    // SAFETY: no DC and no clip: every monitor, each reported to `each` before EnumDisplayMonitors returns.
    unsafe { EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(each), &mut handles as *mut Vec<HMONITOR> as LPARAM) };
    handles.into_iter().filter_map(monitor).collect()
}

/// A physical rectangle in points, by `scale`.
fn to_points(r: Px, scale: f64) -> Rect {
    let s = if scale > 0.0 { scale } else { 1.0 };
    Rect { x: r.0 as f64 / s, y: r.1 as f64 / s, w: (r.2 - r.0) as f64 / s, h: (r.3 - r.1) as f64 / s }
}

/// `\\.\DISPLAY2` → 2: the id the `display` setting keeps (stable while the monitor stays on its port).
fn display_number(device: &str) -> Option<u32> {
    let digits: String = device.chars().rev().take_while(char::is_ascii_digit).collect::<Vec<_>>().into_iter().rev().collect();
    digits.parse().ok()
}

/// The taskbar on a monitor, in display-local points, from the monitor's full and work rectangles: the side the work
/// area gives up. None when it's hidden (auto-hide) or on another monitor.
fn taskbar(full: Px, work: Px, scale: f64) -> Option<Rect> {
    let (w, h) = ((full.2 - full.0) as f64, (full.3 - full.1) as f64);
    let (top, bottom, left, right) = ((work.1 - full.1) as f64, (full.3 - work.3) as f64, (work.0 - full.0) as f64, (full.2 - work.2) as f64);
    let r = if bottom > 0.0 {
        Rect { x: 0.0, y: h - bottom, w, h: bottom }
    } else if top > 0.0 {
        Rect { x: 0.0, y: 0.0, w, h: top }
    } else if left > 0.0 {
        Rect { x: 0.0, y: 0.0, w: left, h }
    } else if right > 0.0 {
        Rect { x: w - right, y: 0.0, w: right, h }
    } else {
        return None;
    };
    let s = if scale > 0.0 { scale } else { 1.0 };
    Some(Rect { x: r.x / s, y: r.y / s, w: r.w / s, h: r.h / s })
}

/// Every display, the primary one first (as macOS lists its main screen). No camera notch on Windows.
pub use super::picker::pick_color;

pub fn displays(_mtm: MainThreadMarker) -> Vec<Display> {
    let mut all: Vec<Display> = monitors()
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let id = display_number(&m.device).unwrap_or(i as u32 + 1);
            Display { id, name: format!("Display {id}"), frame: to_points(m.full, m.scale), camera: None, main: m.primary }
        })
        .collect();
    all.sort_by_key(|d| !d.main);
    all
}

/// `displays` from any thread (Windows doesn't tie these calls to the main one).
pub fn displays_here() -> Vec<Display> {
    MainThreadMarker::new().map(displays).unwrap_or_default()
}

/// Whether any mouse button is down now.
pub fn mouse_down() -> bool {
    // SAFETY: a plain key-state query; the high bit means down.
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|&k| unsafe { GetAsyncKeyState(k as i32) } as u16 & 0x8000 != 0)
}

/// The taskbar's rectangle on `display_id` (the Dock's on macOS), in display-local points.
pub fn dock_rect(_mtm: MainThreadMarker, display_id: u32) -> Option<Rect> {
    monitors()
        .into_iter()
        .enumerate()
        .find(|(i, m)| display_number(&m.device).unwrap_or(*i as u32 + 1) == display_id)
        .and_then(|(_, m)| taskbar(m.full, m.work, m.scale))
}

/// The mouse in desktop points (top-left origin): the cursor's pixels over the scale of the monitor it's on.
pub fn mouse_location(_mtm: MainThreadMarker) -> (f64, f64) {
    let mut p = POINT { x: 0, y: 0 };
    // SAFETY: GetCursorPos writes one POINT; MonitorFromPoint takes it by value.
    unsafe {
        if GetCursorPos(&mut p) == 0 {
            return (0.0, 0.0);
        }
        let s = scale(MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST));
        (p.x as f64 / s, p.y as f64 / s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_are_pixels_over_the_scale() {
        assert_eq!(to_points((0, 0, 1920, 1080), 1.25), Rect { x: 0.0, y: 0.0, w: 1536.0, h: 864.0 });
        assert_eq!(to_points((-3200, 0, 0, 1350), 1.0), Rect { x: -3200.0, y: 0.0, w: 3200.0, h: 1350.0 });
        // (a scale Windows didn't give: as at 96 DPI)
        assert_eq!(to_points((0, 0, 800, 600), 0.0), Rect { x: 0.0, y: 0.0, w: 800.0, h: 600.0 });
    }

    #[test]
    fn display_ids_come_from_the_device_name() {
        assert_eq!(display_number(r"\\.\DISPLAY1"), Some(1));
        assert_eq!(display_number(r"\\.\DISPLAY12"), Some(12));
        assert_eq!(display_number("odd"), None);
    }

    #[test]
    fn the_taskbar_is_what_the_work_area_gives_up() {
        let full = (0, 0, 1920, 1080);
        // bottom, 48 px at 125 %
        assert_eq!(taskbar(full, (0, 0, 1920, 1032), 1.25), Some(Rect { x: 0.0, y: 825.6, w: 1536.0, h: 38.4 }));
        assert_eq!(taskbar(full, (0, 40, 1920, 1080), 1.0), Some(Rect { x: 0.0, y: 0.0, w: 1920.0, h: 40.0 }));
        assert_eq!(taskbar(full, (60, 0, 1920, 1080), 1.0), Some(Rect { x: 0.0, y: 0.0, w: 60.0, h: 1080.0 }));
        assert_eq!(taskbar(full, (0, 0, 1860, 1080), 1.0), Some(Rect { x: 1860.0, y: 0.0, w: 60.0, h: 1080.0 }));
        // auto-hide: the work area is the whole monitor
        assert_eq!(taskbar(full, full, 1.0), None);
        // a monitor not at the origin: still display-local
        assert_eq!(taskbar((-3200, 0, 0, 1350), (-3200, 0, 0, 1302), 1.0), Some(Rect { x: 0.0, y: 1302.0, w: 3200.0, h: 48.0 }));
    }
}
