//! Volume (CoreAudio), built-in display brightness (DisplayServices), Caps Lock, the keyboard input source (TIS) and
//! the battery (IOKit power sources). Plain C APIs; CF objects are read through their toll-free NS twins.
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_foundation::{NSArray, NSDictionary, NSFileManager, NSNumber, NSProcessInfo, NSString};
use serde_json::{json, Value};
use std::ffi::c_void;

const fn cc(s: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*s)
}

#[repr(C)]
struct Address {
    selector: u32,
    scope: u32,
    element: u32,
}

#[link(name = "CoreAudio", kind = "framework")]
#[link(name = "AudioToolbox", kind = "framework")] // it serves the virtual main volume
unsafe extern "C" {
    fn AudioObjectGetPropertyData(obj: u32, a: *const Address, qs: u32, q: *const c_void, size: *mut u32, out: *mut c_void) -> i32;
    fn AudioObjectSetPropertyData(obj: u32, a: *const Address, qs: u32, q: *const c_void, size: u32, data: *const c_void) -> i32;
    fn AudioObjectGetPropertyDataSize(obj: u32, a: *const Address, qs: u32, q: *const c_void, size: *mut u32) -> i32;
}

/// The sound outputs (or inputs): (id, name, is the default).
pub fn audio_devices(input: bool) -> Vec<(u32, String, bool)> {
    let scope = if input { cc(b"inpt") } else { cc(b"outp") };
    let all = Address { selector: cc(b"dev#"), scope: cc(b"glob"), element: 0 };
    let mut size = 0u32;
    if unsafe { AudioObjectGetPropertyDataSize(1, &all, 0, std::ptr::null(), &mut size) } != 0 {
        return vec![];
    }
    let mut ids = vec![0u32; size as usize / 4];
    if unsafe { AudioObjectGetPropertyData(1, &all, 0, std::ptr::null(), &mut size, ids.as_mut_ptr() as *mut c_void) } != 0 {
        return vec![];
    }
    let def = default_device(input);
    objc2::rc::autoreleasepool(|_| {
        ids.into_iter()
            .filter(|&id| {
                let streams = Address { selector: cc(b"stm#"), scope, element: 0 };
                let mut n = 0u32;
                unsafe { AudioObjectGetPropertyDataSize(id, &streams, 0, std::ptr::null(), &mut n) == 0 && n > 0 }
            })
            .filter_map(|id| {
                let name = Address { selector: cc(b"lnam"), scope: cc(b"glob"), element: 0 };
                let mut cf: *mut c_void = std::ptr::null_mut();
                let mut size = std::mem::size_of::<*mut c_void>() as u32;
                if unsafe { AudioObjectGetPropertyData(id, &name, 0, std::ptr::null(), &mut size, &mut cf as *mut _ as *mut c_void) } != 0 {
                    return None;
                }
                let name: Retained<NSString> = unsafe { take(cf) }?; // (a copy: ours to release)
                Some((id, name.to_string(), Some(id) == def))
            })
            .collect()
    })
}

fn default_device(input: bool) -> Option<u32> {
    let a = Address { selector: if input { cc(b"dIn ") } else { cc(b"dOut") }, scope: cc(b"glob"), element: 0 };
    let (mut dev, mut size) = (0u32, 4u32);
    (unsafe { AudioObjectGetPropertyData(1, &a, 0, std::ptr::null(), &mut size, &mut dev as *mut _ as *mut c_void) } == 0 && dev != 0).then_some(dev)
}

/// Makes a device the default output (or input); false when it's gone or refused.
pub fn set_default_device(id: u32, input: bool) -> bool {
    if !audio_devices(input).iter().any(|d| d.0 == id) {
        return false;
    }
    let a = Address { selector: if input { cc(b"dIn ") } else { cc(b"dOut") }, scope: cc(b"glob"), element: 0 };
    unsafe { AudioObjectSetPropertyData(1, &a, 0, std::ptr::null(), 4, &id as *const u32 as *const c_void) == 0 }
}

fn output_device() -> Option<u32> {
    default_device(false)
}

fn get_prop<T: Default>(dev: u32, sel: &[u8; 4]) -> Option<T> {
    let a = Address { selector: cc(sel), scope: cc(b"outp"), element: 0 };
    let mut v = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    (unsafe { AudioObjectGetPropertyData(dev, &a, 0, std::ptr::null(), &mut size, &mut v as *mut T as *mut c_void) } == 0).then_some(v)
}

fn set_prop<T>(dev: u32, sel: &[u8; 4], v: T) -> bool {
    let a = Address { selector: cc(sel), scope: cc(b"outp"), element: 0 };
    unsafe { AudioObjectSetPropertyData(dev, &a, 0, std::ptr::null(), std::mem::size_of::<T>() as u32, &v as *const T as *const c_void) == 0 }
}

/// The default output's volume (0-100) and mute; None when it has no volume of its own (some HDMI outputs).
pub fn volume() -> Option<(u8, bool)> {
    let dev = output_device()?;
    let level: f32 = get_prop(dev, b"vmvc")?;
    let muted: u32 = get_prop(dev, b"mute").unwrap_or(0);
    Some(((level * 100.0).round().clamp(0.0, 100.0) as u8, muted != 0))
}

pub fn set_volume(level: u8) {
    if let Some(dev) = output_device() {
        set_prop(dev, b"vmvc", level.min(100) as f32 / 100.0);
        if level > 0 {
            set_prop(dev, b"mute", 0u32);
        }
    }
}

pub fn toggle_mute() {
    if let Some(dev) = output_device() {
        let muted: u32 = get_prop(dev, b"mute").unwrap_or(0);
        set_prop(dev, b"mute", (muted == 0) as u32);
    }
}

// ---- brightness: DisplayServices is private, so it's loaded at run time
type GetB = unsafe extern "C" fn(u32, *mut f32) -> i32;
type SetB = unsafe extern "C" fn(u32, f32) -> i32;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGGetOnlineDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayIsBuiltin(display: u32) -> u32;
    fn CGEventSourceFlagsState(state: i32) -> u64;
}
unsafe extern "C" {
    fn dlopen(path: *const i8, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const i8) -> *mut c_void;
}

fn display_services() -> Option<(GetB, SetB)> {
    static FNS: std::sync::OnceLock<Option<(usize, usize)>> = std::sync::OnceLock::new();
    let (g, s) = (*FNS.get_or_init(|| unsafe {
        let h = dlopen(c"/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices".as_ptr(), 1);
        if h.is_null() {
            return None;
        }
        let (g, s) = (dlsym(h, c"DisplayServicesGetBrightness".as_ptr()), dlsym(h, c"DisplayServicesSetBrightness".as_ptr()));
        (!g.is_null() && !s.is_null()).then_some((g as usize, s as usize))
    }))?;
    Some(unsafe { (std::mem::transmute::<usize, GetB>(g), std::mem::transmute::<usize, SetB>(s)) })
}

/// The display whose brightness macOS controls: the built-in one first.
fn bright_display() -> Option<(u32, f32)> {
    let (get, _) = display_services()?;
    let mut ids = [0u32; 16];
    let mut n = 0u32;
    if unsafe { CGGetOnlineDisplayList(16, ids.as_mut_ptr(), &mut n) } != 0 {
        return None;
    }
    let mut ids = ids[..n as usize].to_vec();
    ids.sort_by_key(|d| unsafe { CGDisplayIsBuiltin(*d) } == 0);
    ids.into_iter().find_map(|d| {
        let mut v = 0f32;
        (unsafe { get(d, &mut v) } == 0).then_some((d, v))
    })
}

/// 0-100; None without a display macOS can dim (an external monitor only).
pub fn brightness() -> Option<u8> {
    bright_display().map(|(_, v)| (v * 100.0).round().clamp(0.0, 100.0) as u8)
}

pub fn set_brightness(level: u8) {
    if let (Some((_, set)), Some((d, _))) = (display_services(), bright_display()) {
        unsafe { set(d, level.min(100) as f32 / 100.0) };
    }
}

pub fn caps_lock() -> bool {
    const HID_SYSTEM: i32 = 1;
    const ALPHA_SHIFT: u64 = 0x10000;
    unsafe { CGEventSourceFlagsState(HID_SYSTEM) & ALPHA_SHIFT != 0 }
}

// ---- keyboard input source
#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn TISCopyCurrentKeyboardInputSource() -> *mut c_void;
    fn TISCreateInputSourceList(props: *const c_void, include_all: u8) -> *mut c_void;
    fn TISGetInputSourceProperty(src: *const c_void, key: *const c_void) -> *const c_void;
    static kTISPropertyInputSourceLanguages: *const c_void;
    static kTISPropertyLocalizedName: *const c_void;
    static kTISPropertyInputSourceCategory: *const c_void;
    static kTISCategoryKeyboardInputSource: *const c_void;
    static kTISPropertyInputSourceIsSelectCapable: *const c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// A CF object owned by us, read as its NS twin.
unsafe fn take<T: objc2::Message>(cf: *mut c_void) -> Option<Retained<T>> {
    unsafe { Retained::from_raw(cf as *mut T) }
}
unsafe fn peek<'a, T: 'a>(cf: *const c_void) -> Option<&'a T> {
    unsafe { (cf as *const T).as_ref() }
}

/// (short code, name, how many keyboard sources can be picked). TIS wants the main thread.
pub fn input_source() -> Option<(String, String, usize)> {
    super::location::on_main(|| unsafe {
        let src: Retained<AnyObject> = take(TISCopyCurrentKeyboardInputSource())?;
        let s = Retained::as_ptr(&src) as *const c_void;
        let langs: Option<&NSArray<NSString>> = peek(TISGetInputSourceProperty(s, kTISPropertyInputSourceLanguages));
        let name: Option<&NSString> = peek(TISGetInputSourceProperty(s, kTISPropertyLocalizedName));
        let code = langs.and_then(|l| l.firstObject()).map(|c| c.to_string()).unwrap_or_default();
        let code = code.split(['-', '_']).next().unwrap_or("").to_uppercase();
        let list: Retained<NSArray<AnyObject>> = take(TISCreateInputSourceList(std::ptr::null(), 0))?;
        let count = list
            .iter()
            .filter(|i| {
                let p = Retained::as_ptr(i) as *const c_void;
                let cat: Option<&NSString> = peek(TISGetInputSourceProperty(p, kTISPropertyInputSourceCategory));
                let kb: Option<&NSString> = peek(kTISCategoryKeyboardInputSource);
                let sel: Option<&NSNumber> = peek(TISGetInputSourceProperty(p, kTISPropertyInputSourceIsSelectCapable));
                cat.is_some() && cat.map(|c| c.to_string()) == kb.map(|k| k.to_string()) && sel.is_some_and(|b| b.as_bool())
            })
            .count();
        Some((code, name.map(|n| n.to_string()).unwrap_or_default(), count))
    })
}

// ---- battery
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> *mut c_void;
    fn IOPSCopyPowerSourcesList(blob: *const c_void) -> *mut c_void;
    fn IOPSGetPowerSourceDescription(blob: *const c_void, ps: *const c_void) -> *const c_void;
}

fn num(d: &NSDictionary<NSString, AnyObject>, k: &str) -> Option<i64> {
    d.objectForKey(&NSString::from_str(k))?.downcast::<NSNumber>().ok().map(|n| n.as_i64())
}
fn text(d: &NSDictionary<NSString, AnyObject>, k: &str) -> String {
    d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSString>().ok()).map(|s| s.to_string()).unwrap_or_default()
}

/// `{hasBattery, level, pluggedIn, charging, saver, secondsLeft}` (the frontend's `power` message without its type).
pub fn power() -> Value {
    objc2::rc::autoreleasepool(|_| power_now()) // a background thread: its own pool
}

fn power_now() -> Value {
    let saver = NSProcessInfo::processInfo().isLowPowerModeEnabled();
    let none = json!({ "hasBattery": false, "level": 100, "pluggedIn": true, "charging": false, "saver": saver });
    unsafe {
        let blob = IOPSCopyPowerSourcesInfo();
        if blob.is_null() {
            return none;
        }
        let list = IOPSCopyPowerSourcesList(blob);
        let mut out = none.clone();
        if let Some(items) = peek::<NSArray<AnyObject>>(list) {
            for ps in items.iter() {
                let Some(d) = peek::<NSDictionary<NSString, AnyObject>>(IOPSGetPowerSourceDescription(blob, Retained::as_ptr(&ps) as *const c_void)) else {
                    continue;
                };
                if text(d, "Type") != "InternalBattery" {
                    continue;
                }
                let (cur, max) = (num(d, "Current Capacity").unwrap_or(0), num(d, "Max Capacity").unwrap_or(100).max(1));
                let empty = num(d, "Time to Empty").unwrap_or(-1);
                out = json!({
                    "hasBattery": true, "level": (cur * 100 / max).clamp(0, 100),
                    "pluggedIn": text(d, "Power Source State") == "AC Power",
                    "charging": num(d, "Is Charging").unwrap_or(0) != 0, "saver": saver,
                    "secondsLeft": if empty > 0 { empty * 60 } else { -1 },
                });
                break;
            }
        }
        if !list.is_null() {
            CFRelease(list);
        }
        CFRelease(blob);
        out
    }
}

// ---- the System tab: CPU, memory, disk, network
unsafe extern "C" {
    fn mach_host_self() -> u32;
    fn host_statistics(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn host_statistics64(host: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
}

/// The CPU's tick counters (user, system, idle, nice) since boot, all cores together.
pub fn cpu_ticks() -> Option<[u32; 4]> {
    const HOST_CPU_LOAD_INFO: i32 = 3;
    let mut ticks = [0u32; 4];
    let mut count = 4u32;
    (unsafe { host_statistics(mach_host_self(), HOST_CPU_LOAD_INFO, ticks.as_mut_ptr() as *mut i32, &mut count) } == 0).then_some(ticks)
}

fn sysctl_u64(name: &std::ffi::CStr) -> Option<u64> {
    let mut v = 0u64;
    let mut size = std::mem::size_of::<u64>();
    (unsafe { libc::sysctlbyname(name.as_ptr(), &mut v as *mut u64 as *mut c_void, &mut size, std::ptr::null_mut(), 0) } == 0).then_some(v)
}

/// The chip's name, e.g. "Apple M3 Pro".
pub fn cpu_model() -> String {
    let mut buf = [0u8; 128];
    let mut size = buf.len();
    let ok = unsafe { libc::sysctlbyname(c"machdep.cpu.brand_string".as_ptr(), buf.as_mut_ptr() as *mut c_void, &mut size, std::ptr::null_mut(), 0) } == 0;
    if !ok {
        return String::new();
    }
    String::from_utf8_lossy(&buf[..size.saturating_sub(1)]).trim_end_matches('\0').to_string()
}

/// Total memory in bytes and the page counts Activity Monitor's "Memory Used" is made of:
/// (total, [page size, internal, purgeable, wired, compressed]) (services::stats::mem_used adds them up).
pub fn memory() -> Option<(u64, [u64; 5])> {
    const HOST_VM_INFO64: i32 = 4;
    let total = sysctl_u64(c"hw.memsize")?;
    let page = sysctl_u64(c"hw.pagesize").unwrap_or(16384);
    let mut vm: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
    let mut count = (std::mem::size_of::<libc::vm_statistics64>() / std::mem::size_of::<i32>()) as u32;
    if unsafe { host_statistics64(mach_host_self(), HOST_VM_INFO64, &mut vm as *mut _ as *mut i32, &mut count) } != 0 {
        return None;
    }
    Some((total, [page, vm.internal_page_count as u64, vm.purgeable_count as u64, vm.wire_count as u64, vm.compressor_page_count as u64]))
}

/// (total, free) bytes of the startup disk's data volume.
pub fn disk() -> Option<(u64, u64)> {
    let mut s: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(c"/System/Volumes/Data".as_ptr(), &mut s) } != 0 && unsafe { libc::statfs(c"/".as_ptr(), &mut s) } != 0 {
        return None;
    }
    let b = s.f_bsize as u64;
    Some((s.f_blocks * b, s.f_bavail * b))
}

/// Startup disk volume display name (e.g. "Macintosh HD") via NSFileManager.
pub fn disk_name() -> Option<String> {
    objc2::rc::autoreleasepool(|_| {
        let name = NSFileManager::defaultManager().displayNameAtPath(&NSString::from_str("/"));
        let s = name.to_string();
        let trimmed = s.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

/// macOS memory pressure level (`kern.memorystatus_vm_pressure_level`: 1 normal, 2 warn, 4 critical).
pub fn memory_pressure() -> Option<u32> {
    let mut v = 0u32;
    let mut size = std::mem::size_of::<u32>();
    (unsafe {
        libc::sysctlbyname(
            c"kern.memorystatus_vm_pressure_level".as_ptr(),
            &mut v as *mut u32 as *mut c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } == 0)
        .then_some(v)
}

/// Bytes received and sent since boot over the network interfaces (Wi-Fi and Ethernet, `en*`), and whether one of
/// them is wired and up. The counters are 32-bit and wrap: the frontend's rate skips a negative step.
pub fn network() -> (u64, u64, bool) {
    let (mut rx, mut tx) = (0u64, 0u64);
    unsafe {
        let mut list: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut list) != 0 {
            return (0, 0, false);
        }
        let mut p = list;
        while !p.is_null() {
            let a = &*p;
            let name = std::ffi::CStr::from_ptr(a.ifa_name).to_string_lossy();
            if !a.ifa_addr.is_null() && (*a.ifa_addr).sa_family as i32 == libc::AF_LINK && name.starts_with("en") && !a.ifa_data.is_null() {
                let d = &*(a.ifa_data as *const libc::if_data);
                rx += d.ifi_ibytes as u64;
                tx += d.ifi_obytes as u64;
            }
            p = a.ifa_next;
        }
        libc::freeifaddrs(list);
    }
    (rx, tx, false) // ponytail: wired detection skipped (the card then shows no "Ethernet"); add with SystemConfiguration
}

// ---- the clock's chime and the health reminders: idle time, a fullscreen app in front, Focus

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state: i32, kind: u32) -> f64;
    fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *mut c_void;
    fn CGDisplayBounds(display: u32) -> CGRect;
}

/// Seconds since the last keyboard, mouse or trackpad input (any app).
pub fn idle_secs() -> f64 {
    const COMBINED: i32 = 0;
    const ANY_INPUT: u32 = !0;
    unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED, ANY_INPUT) }
}

/// Whether the app in front shows a window over a whole display (macOS fullscreen: it covers the menu bar too).
pub fn fullscreen_front() -> bool {
    objc2::rc::autoreleasepool(|_| {
        let Some(pid) = super::apps::frontmost_pid() else { return false };
        let mut ids = [0u32; 16];
        let mut n = 0u32;
        let screens: Vec<CGRect> = unsafe {
            CGGetOnlineDisplayList(16, ids.as_mut_ptr(), &mut n);
            ids[..n as usize].iter().map(|d| CGDisplayBounds(*d)).collect()
        };
        const ON_SCREEN: u32 = 1 << 0;
        const NO_DESKTOP: u32 = 1 << 4;
        unsafe {
            let Some(list) = take::<NSArray<NSDictionary<NSString, AnyObject>>>(CGWindowListCopyWindowInfo(ON_SCREEN | NO_DESKTOP, 0)) else { return false };
            list.iter().any(|w| {
                if num(&w, "kCGWindowOwnerPID") != Some(pid as i64) || num(&w, "kCGWindowLayer") != Some(0) {
                    return false;
                }
                let Some(b) = w.objectForKey(&NSString::from_str("kCGWindowBounds")).and_then(|b| b.downcast::<NSDictionary>().ok()) else { return false };
                let b: &NSDictionary<NSString, AnyObject> = &*(Retained::as_ptr(&b) as *const NSDictionary<NSString, AnyObject>);
                let f = |k| b.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.as_f64()).unwrap_or(-1.0);
                screens.iter().any(|s| f("X") == s.x && f("Y") == s.y && f("Width") == s.w && f("Height") == s.h)
            })
        }
    })
}

/// On-screen normal windows on `display` (layer 0, excluding `skip_pid`), in display-local top-left coordinates.
/// Reads only `kCGWindowBounds`, `kCGWindowLayer`, `kCGWindowOwnerPID`, `kCGWindowAlpha` — never window titles,
/// so macOS never prompts for Screen Recording permission.
pub fn onscreen_windows(display: crate::geometry::Rect, skip_pid: u32) -> Vec<crate::geometry::Rect> {
    objc2::rc::autoreleasepool(|_| {
        const ON_SCREEN: u32 = 1 << 0;
        const NO_DESKTOP: u32 = 1 << 4;
        let mut out = Vec::new();
        unsafe {
            let Some(list) = take::<NSArray<NSDictionary<NSString, AnyObject>>>(
                CGWindowListCopyWindowInfo(ON_SCREEN | NO_DESKTOP, 0),
            ) else {
                return out;
            };
            for w in list.iter() {
                if num(&w, "kCGWindowLayer") != Some(0) {
                    continue;
                }
                if num(&w, "kCGWindowOwnerPID") == Some(skip_pid as i64) {
                    continue;
                }
                if let Some(a) = w
                    .objectForKey(&NSString::from_str("kCGWindowAlpha"))
                    .and_then(|v| v.downcast::<NSNumber>().ok())
                    .map(|n| n.as_f64())
                {
                    if a <= 0.05 {
                        continue;
                    }
                }
                let Some(b) = w
                    .objectForKey(&NSString::from_str("kCGWindowBounds"))
                    .and_then(|b| b.downcast::<NSDictionary>().ok())
                else {
                    continue;
                };
                let b: &NSDictionary<NSString, AnyObject> =
                    &*(Retained::as_ptr(&b) as *const NSDictionary<NSString, AnyObject>);
                let f = |k| {
                    b.objectForKey(&NSString::from_str(k))
                        .and_then(|v| v.downcast::<NSNumber>().ok())
                        .map(|n| n.as_f64())
                        .unwrap_or(-1.0)
                };
                let (wx, wy, ww, wh) = (f("X"), f("Y"), f("Width"), f("Height"));
                if ww < 120.0 || wh < 80.0 {
                    continue;
                }
                // Include windows whose center falls inside this display.
                let cx = wx + ww * 0.5;
                let cy = wy + wh * 0.5;
                if cx < display.x
                    || cx > display.x + display.w
                    || cy < display.y
                    || cy > display.y + display.h
                {
                    continue;
                }
                // Clamp to display-local bounds.
                let lx = (wx - display.x).max(0.0);
                let ly = (wy - display.y).max(0.0);
                let rx = (wx + ww - display.x).min(display.w);
                let by = (wy + wh - display.y).min(display.h);
                if rx - lx >= 100.0 && by - ly >= 60.0 {
                    out.push(crate::geometry::Rect {
                        x: lx.round(),
                        y: ly.round(),
                        w: (rx - lx).round(),
                        h: (by - ly).round(),
                    });
                    if out.len() >= 12 {
                        break;
                    }
                }
            }
        }
        out
    })
}

/// Whether a Focus (Do Not Disturb, Sleep…) is on: macOS keeps its active ones in this file, readable with Full Disk
/// Access (which Sympony has for notifications); without it, off.
pub fn focus_on() -> bool {
    let path = dirs_home().join("Library/DoNotDisturb/DB/Assertions.json");
    let Ok(text) = std::fs::read_to_string(path) else { return false };
    let v: Value = serde_json::from_str(&text).unwrap_or_default();
    v["data"].as_array().is_some_and(|d| d.iter().any(|x| x["storeAssertionRecords"].as_array().is_some_and(|r| !r.is_empty())))
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var_os("HOME").map(Into::into).unwrap_or_default()
}

// ---- the microphone: the default input's mute, or its volume where it has no mute (a MacBook's own mic)

unsafe extern "C" {
    fn AudioObjectIsPropertySettable(obj: u32, a: *const Address, settable: *mut u8) -> i32;
}

static MIC_LEVEL: std::sync::Mutex<f32> = std::sync::Mutex::new(0.75); // the volume before it was muted that way

fn input_prop(sel: &[u8; 4]) -> Option<(u32, Address)> {
    let dev = default_device(true)?;
    let a = Address { selector: cc(sel), scope: cc(b"inpt"), element: 0 };
    let mut ok = 0u8;
    (unsafe { AudioObjectIsPropertySettable(dev, &a, &mut ok) } == 0 && ok != 0).then_some((dev, a))
}

fn read_input<T: Default>(dev: u32, a: &Address) -> Option<T> {
    let mut v = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    (unsafe { AudioObjectGetPropertyData(dev, a, 0, std::ptr::null(), &mut size, &mut v as *mut T as *mut c_void) } == 0).then_some(v)
}

fn write_input<T>(dev: u32, a: &Address, v: T) {
    unsafe { AudioObjectSetPropertyData(dev, a, 0, std::ptr::null(), std::mem::size_of::<T>() as u32, &v as *const T as *const c_void) };
}

/// `(available, muted)`: available when the input can be muted (or turned down).
pub fn mic() -> (bool, bool) {
    if let Some((d, a)) = input_prop(b"mute") {
        return (true, read_input::<u32>(d, &a).unwrap_or(0) != 0);
    }
    if let Some((d, a)) = input_prop(b"volm") {
        return (true, read_input::<f32>(d, &a).unwrap_or(1.0) <= 0.0);
    }
    (false, false)
}

pub fn toggle_mic() {
    if let Some((d, a)) = input_prop(b"mute") {
        let m = read_input::<u32>(d, &a).unwrap_or(0);
        return write_input(d, &a, (m == 0) as u32);
    }
    if let Some((d, a)) = input_prop(b"volm") {
        let v = read_input::<f32>(d, &a).unwrap_or(1.0);
        let mut keep = MIC_LEVEL.lock().unwrap();
        if v > 0.0 {
            *keep = v;
            write_input(d, &a, 0.0f32);
        } else {
            write_input(d, &a, keep.max(0.1));
        }
    }
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGSessionCopyCurrentDictionary() -> *mut c_void;
}

/// The Mac's name, as Sharing settings show it (`scutil --get ComputerName`), else "Mac".
pub fn computer_name() -> String {
    std::process::Command::new("/usr/sbin/scutil").args(["--get", "ComputerName"]).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Mac".into())
}

/// The languages in Language & Region, first first ("en-ID", "id-ID"): `defaults read -g AppleLanguages`.
pub fn languages() -> Vec<String> {
    std::process::Command::new("/usr/bin/defaults").args(["read", "-g", "AppleLanguages"]).output().ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).split(['(', ')', ',', '\n']).map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// The region in Language & Region as two letters ("en_ID" → "ID"; none: ""): `defaults read -g AppleLocale`.
pub fn region() -> String {
    let Ok(o) = std::process::Command::new("/usr/bin/defaults").args(["read", "-g", "AppleLocale"]).output() else { return String::new() };
    let locale = String::from_utf8_lossy(&o.stdout).trim().to_string();
    let base = locale.split('@').next().unwrap_or("");
    base.rsplit_once('_').map(|(_, r)| r.to_string()).filter(|r| r.len() == 2 && r.chars().all(|c| c.is_ascii_uppercase())).unwrap_or_default()
}

/// Whether the screen is locked (the login window is up), from the session's own record.
pub fn screen_locked() -> bool {
    objc2::rc::autoreleasepool(|_| unsafe {
        let Some(d) = take::<NSDictionary<NSString, AnyObject>>(CGSessionCopyCurrentDictionary()) else { return false };
        num(&d, "CGSSessionScreenIsLocked").unwrap_or(0) != 0
    })
}

/// Keep awake (Control tab): macOS's own `caffeinate` keeps the display on while it runs, tied to Sympony's life.
pub fn keep_awake(on: bool) {
    static CHILD: std::sync::Mutex<Option<std::process::Child>> = std::sync::Mutex::new(None);
    let mut c = CHILD.lock().unwrap();
    match (on, c.is_some()) {
        (true, false) => {
            *c = std::process::Command::new("/usr/bin/caffeinate").args(["-di", "-w", &std::process::id().to_string()]).spawn().ok();
        }
        (false, true) => {
            if let Some(mut ch) = c.take() {
                let _ = ch.kill();
                let _ = ch.wait();
            }
        }
        _ => {}
    }
}

/// macOS lets no app switch Focus (the Control tab opens its settings instead): false.
pub fn set_focus(_on: bool) -> bool {
    false
}

/// Opens macOS's Screenshot (its toolbar, as ⇧⌘5 does).
pub fn screenshot() {
    let _ = std::process::Command::new("/usr/bin/open").args(["-b", "com.apple.screenshot.launcher"]).status();
}

