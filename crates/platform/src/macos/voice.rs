//! macOS Voice V1 platform hooks: CGEventTap modifier trigger, paste-and-restore insertion with
//! secure-input / Accessibility fallback, and AVFoundation microphone permission helpers.
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, Bool};
use objc2::msg_send;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString};
use objc2_foundation::{NSArray, NSData, NSString};

use crate::voice::{Insert, InsertResult, KeyInput, Trigger, TriggerEvent, TriggerLogic, VoiceKey};

// ---------------------------------------------------------------------------
// CoreGraphics / CoreFoundation / Carbon FFI
// ---------------------------------------------------------------------------

type CFMachPortRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type CGEventRef = *mut c_void;
type CGEventSourceRef = *mut c_void;

const K_CG_SESSION_EVENT_TAP: u32 = 1;
const K_CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const K_CG_EVENT_TAP_OPTION_LISTEN_ONLY: u32 = 1;
const K_CG_HID_EVENT_TAP: u32 = 0;

const K_CG_EVENT_KEY_DOWN: u32 = 10;
const K_CG_EVENT_FLAGS_CHANGED: u32 = 12;
const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;

const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;

// macOS virtual keycodes
const KVK_ESCAPE: u16 = 53;
const KVK_ANSI_V: u16 = 9;
const KVK_RIGHT_COMMAND: u16 = 54;
const KVK_LEFT_OPTION: u16 = 58;
const KVK_RIGHT_SHIFT: u16 = 60;
const KVK_RIGHT_OPTION: u16 = 61;
const KVK_RIGHT_CONTROL: u16 = 62;
const KVK_FUNCTION: u16 = 63;

// CGEventFlags masks
const FLAG_SHIFT: u64 = 0x0002_0000;
const FLAG_CONTROL: u64 = 0x0004_0000;
const FLAG_ALTERNATE: u64 = 0x0008_0000;
const FLAG_COMMAND: u64 = 0x0010_0000;
const FLAG_SECONDARY_FN: u64 = 0x0080_0000;
const FLAG_MOD_MASK: u64 = FLAG_SHIFT | FLAG_CONTROL | FLAG_ALTERNATE | FLAG_COMMAND | FLAG_SECONDARY_FN;

type CGEventTapCallBack = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    ev_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: CGEventTapCallBack,
        user_info: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventSetFlags(event: CGEventRef, flags: u64);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventCreateKeyboardEvent(
        source: CGEventSourceRef,
        virtual_key: u16,
        key_down: bool,
    ) -> CGEventRef;
    fn CGEventPost(tap: u32, event: CGEventRef);
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopCommonModes: *const c_void;
    fn CFMachPortCreateRunLoopSource(
        allocator: *const c_void,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: *const c_void);
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: CFRunLoopRef);
    fn CFRelease(cf: *const c_void);
    fn CFRetain(cf: *const c_void) -> *const c_void;
}

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn IsSecureEventInputEnabled() -> u8;
}

// ---------------------------------------------------------------------------
// Microphone permission (AVCaptureDevice, AVMediaTypeAudio = "soun")
// ---------------------------------------------------------------------------

pub fn mic_status() -> &'static str {
    objc2::rc::autoreleasepool(|_| {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return "denied";
        };
        let media = NSString::from_str("soun");
        let status: isize =
            unsafe { msg_send![cls, authorizationStatusForMediaType: &*media] };
        match status {
            0 => "notAsked",
            3 => "granted",
            _ => "denied",
        }
    })
}

pub fn mic_request() {
    objc2::rc::autoreleasepool(|_| {
        let Some(cls) = AnyClass::get(c"AVCaptureDevice") else {
            return;
        };
        let media = NSString::from_str("soun");
        let handler = RcBlock::new(|_granted: Bool| {});
        let _: () = unsafe {
            msg_send![cls, requestAccessForMediaType: &*media, completionHandler: &*handler]
        };
    });
}

// ---------------------------------------------------------------------------
// MacTrigger (listen-only CGEventTap -> TriggerLogic)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum TargetMatcher {
    SingleMod { keycode: u16, flag: u64 },
    ComboMods { flags: u64 },
}

impl TargetMatcher {
    fn from_key(key: &VoiceKey) -> Self {
        match key {
            VoiceKey::RightOption => Self::SingleMod {
                keycode: KVK_RIGHT_OPTION,
                flag: FLAG_ALTERNATE,
            },
            VoiceKey::LeftOption => Self::SingleMod {
                keycode: KVK_LEFT_OPTION,
                flag: FLAG_ALTERNATE,
            },
            VoiceKey::RightCommand => Self::SingleMod {
                keycode: KVK_RIGHT_COMMAND,
                flag: FLAG_COMMAND,
            },
            VoiceKey::RightControl => Self::SingleMod {
                keycode: KVK_RIGHT_CONTROL,
                flag: FLAG_CONTROL,
            },
            VoiceKey::RightShift => Self::SingleMod {
                keycode: KVK_RIGHT_SHIFT,
                flag: FLAG_SHIFT,
            },
            VoiceKey::Fn => Self::SingleMod {
                keycode: KVK_FUNCTION,
                flag: FLAG_SECONDARY_FN,
            },
            VoiceKey::Combo(s) => {
                let mut flags = 0u64;
                for part in s.split('+') {
                    match part.trim().to_ascii_lowercase().as_str() {
                        "right_option" | "left_option" | "option" | "alt" => flags |= FLAG_ALTERNATE,
                        "right_shift" | "left_shift" | "shift" => flags |= FLAG_SHIFT,
                        "right_command" | "left_command" | "command" | "cmd" => flags |= FLAG_COMMAND,
                        "right_control" | "left_control" | "control" | "ctrl" => flags |= FLAG_CONTROL,
                        "fn" => flags |= FLAG_SECONDARY_FN,
                        _ => {}
                    }
                }
                if flags == 0 {
                    flags = FLAG_ALTERNATE | FLAG_SHIFT;
                }
                Self::ComboMods { flags }
            }
        }
    }
}

struct TapContext {
    matcher: TargetMatcher,
    logic: Mutex<TriggerLogic>,
    target_down: AtomicBool,
    tx: Sender<TriggerEvent>,
    epoch: Instant,
    tap_port: Mutex<usize>,
}

impl TapContext {
    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn feed(&self, input: KeyInput) {
        let now = self.now_ms();
        let events = {
            let Ok(mut lg) = self.logic.lock() else {
                return;
            };
            lg.on_event(input, now)
        };
        for ev in events {
            let _ = self.tx.send(ev);
        }
    }
}

unsafe extern "C" fn event_tap_cb(
    _proxy: CGEventTapProxy,
    ev_type: u32,
    event: CGEventRef,
    user_info: *mut c_void,
) -> CGEventRef {
    if user_info.is_null() {
        return event;
    }
    let ctx = unsafe { &*(user_info as *const TapContext) };

    if ev_type == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT {
        if let Ok(port) = ctx.tap_port.lock() {
            if *port != 0 {
                unsafe { CGEventTapEnable(*port as CFMachPortRef, true) };
            }
        }
        return event;
    }

    let keycode = unsafe { CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) } as u16;
    let flags = unsafe { CGEventGetFlags(event) } & FLAG_MOD_MASK;

    if ev_type == K_CG_EVENT_KEY_DOWN {
        if keycode == KVK_ESCAPE {
            ctx.feed(KeyInput::Esc);
        } else {
            ctx.feed(KeyInput::OtherKey);
        }
        return event;
    }

    if ev_type == K_CG_EVENT_FLAGS_CHANGED {
        match ctx.matcher {
            TargetMatcher::SingleMod {
                keycode: target_kc,
                flag: target_flag,
            } => {
                let was_down = ctx.target_down.load(Ordering::Relaxed);
                if keycode == target_kc {
                    let is_down = (flags & target_flag) != 0;
                    let other_mods = (flags & !target_flag) != 0;
                    if is_down && !was_down {
                        if other_mods {
                            ctx.feed(KeyInput::OtherKey);
                        } else {
                            ctx.target_down.store(true, Ordering::Relaxed);
                            ctx.feed(KeyInput::TargetDown);
                        }
                    } else if !is_down && was_down {
                        ctx.target_down.store(false, Ordering::Relaxed);
                        ctx.feed(KeyInput::TargetUp);
                    }
                } else if was_down && (flags & !target_flag) != 0 {
                    // Another modifier was pressed while holding target key (e.g., ⌥+⇧).
                    ctx.feed(KeyInput::OtherKey);
                }
            }
            TargetMatcher::ComboMods { flags: want } => {
                let was_down = ctx.target_down.load(Ordering::Relaxed);
                let exact = flags == want;
                let extra = (flags & !want) != 0;
                if exact && !was_down {
                    ctx.target_down.store(true, Ordering::Relaxed);
                    ctx.feed(KeyInput::TargetDown);
                } else if was_down && extra {
                    ctx.feed(KeyInput::OtherKey);
                } else if was_down && !exact {
                    ctx.target_down.store(false, Ordering::Relaxed);
                    ctx.feed(KeyInput::TargetUp);
                }
            }
        }
    }

    event
}

struct TriggerHandle {
    stop_flag: Arc<AtomicBool>,
    run_loop: Arc<Mutex<usize>>,
    ctx: Arc<TapContext>,
    tap_thread: Option<JoinHandle<()>>,
    tick_thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct MacTrigger {
    inner: Mutex<Option<TriggerHandle>>,
}

impl MacTrigger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset trigger state (e.g. when hands-free auto-stops due to silence or 60 s cap).
    pub fn reset_state(&self) {
        if let Ok(guard) = self.inner.lock() {
            if let Some(ref h) = *guard {
                if let Ok(mut lg) = h.ctx.logic.lock() {
                    lg.reset();
                }
            }
        }
    }
}

impl Trigger for MacTrigger {
    fn start(&self, key: VoiceKey, tx: Sender<TriggerEvent>) -> Result<(), String> {
        self.stop();

        if !super::banners::trusted(false) {
            return Err("Accessibility permission required for dictation trigger".into());
        }

        let ctx = Arc::new(TapContext {
            matcher: TargetMatcher::from_key(&key),
            logic: Mutex::new(TriggerLogic::new()),
            target_down: AtomicBool::new(false),
            tx,
            epoch: Instant::now(),
            tap_port: Mutex::new(0),
        });
        let stop_flag = Arc::new(AtomicBool::new(false));
        let run_loop = Arc::new(Mutex::new(0usize));

        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let ctx_tap = Arc::clone(&ctx);
        let rl_tap = Arc::clone(&run_loop);

        let tap_thread = thread::spawn(move || {
            let mask: u64 = (1 << K_CG_EVENT_KEY_DOWN) | (1 << K_CG_EVENT_FLAGS_CHANGED);
            let ctx_ptr = Arc::as_ptr(&ctx_tap) as *mut c_void;
            let tap = unsafe {
                CGEventTapCreate(
                    K_CG_SESSION_EVENT_TAP,
                    K_CG_HEAD_INSERT_EVENT_TAP,
                    K_CG_EVENT_TAP_OPTION_LISTEN_ONLY,
                    mask,
                    event_tap_cb,
                    ctx_ptr,
                )
            };
            if tap.is_null() {
                let _ = ready_tx.send(Err("CGEventTapCreate failed (check Accessibility)".into()));
                return;
            }
            if let Ok(mut p) = ctx_tap.tap_port.lock() {
                *p = tap as usize;
            }
            let src = unsafe { CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0) };
            let rl = unsafe { CFRunLoopGetCurrent() };
            unsafe {
                CFRetain(rl as *const c_void);
                CFRunLoopAddSource(rl, src, kCFRunLoopCommonModes);
                CGEventTapEnable(tap, true);
            }
            if let Ok(mut r) = rl_tap.lock() {
                *r = rl as usize;
            }
            let _ = ready_tx.send(Ok(()));

            unsafe {
                CFRunLoopRun();
                CGEventTapEnable(tap, false);
                CFRelease(src as *const c_void);
                CFRelease(tap as *const c_void);
                CFRelease(rl as *const c_void);
            }
        });

        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = tap_thread.join();
                return Err(e);
            }
            Err(_) => {
                return Err("timed out starting CGEventTap".into());
            }
        }

        let ctx_tick = Arc::clone(&ctx);
        let stop_tick = Arc::clone(&stop_flag);
        let tick_thread = thread::spawn(move || {
            while !stop_tick.load(Ordering::Relaxed) {
                let pending = ctx_tick
                    .logic
                    .lock()
                    .map(|l| l.is_pending())
                    .unwrap_or(false);
                if pending {
                    ctx_tick.feed(KeyInput::Tick);
                }
                thread::sleep(Duration::from_millis(20));
            }
        });

        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(TriggerHandle {
                stop_flag,
                run_loop,
                ctx,
                tap_thread: Some(tap_thread),
                tick_thread: Some(tick_thread),
            });
        }
        Ok(())
    }

    fn stop(&self) {
        let handle = self.inner.lock().ok().and_then(|mut g| g.take());
        if let Some(mut h) = handle {
            h.stop_flag.store(true, Ordering::Relaxed);
            if let Ok(rl) = h.run_loop.lock() {
                if *rl != 0 {
                    unsafe { CFRunLoopStop(*rl as CFRunLoopRef) };
                }
            }
            if let Some(t) = h.tick_thread.take() {
                let _ = t.join();
            }
            if let Some(t) = h.tap_thread.take() {
                let _ = t.join();
            }
        }
    }
}

impl Drop for MacTrigger {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// MacInsert (pasteboard save -> set -> ⌘V -> 300ms restore; secure/AX fallback)
// ---------------------------------------------------------------------------

type SavedItem = Vec<(String, Vec<u8>)>;

fn snapshot_pasteboard() -> Vec<SavedItem> {
    objc2::rc::autoreleasepool(|_| {
        let pb = NSPasteboard::generalPasteboard();
        let Some(items) = pb.pasteboardItems() else {
            return Vec::new();
        };
        let mut saved = Vec::new();
        for item in items.iter() {
            let mut entries = Vec::new();
            let types = item.types();
            for ty in types.iter() {
                if let Some(data) = item.dataForType(&ty) {
                    let bytes = unsafe { data.as_bytes_unchecked().to_vec() };
                    entries.push((ty.to_string(), bytes));
                }
            }
            if !entries.is_empty() {
                saved.push(entries);
            }
        }
        saved
    })
}

fn set_pasteboard_string(text: &str) -> isize {
    objc2::rc::autoreleasepool(|_| {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let s = NSString::from_str(text);
        let _ = pb.setString_forType(&s, unsafe { NSPasteboardTypeString });
        pb.changeCount()
    })
}

/// Writes `text` to the pasteboard with Transient + AutoGenerated markers so clipboard managers
/// (1Password, Raycast, Paste, Sympony clipboard history) ignore temporary dictation paste transfers.
fn set_pasteboard_transient(text: &str) -> isize {
    objc2::rc::autoreleasepool(|_| {
        let pb = NSPasteboard::generalPasteboard();
        pb.clearContents();
        let item = NSPasteboardItem::new();
        let s = NSString::from_str(text);
        let _ = item.setString_forType(&s, unsafe { NSPasteboardTypeString });
        let empty = NSData::new();
        for marker in ["org.nspasteboard.TransientType", "org.nspasteboard.AutoGeneratedType"] {
            let ty = NSString::from_str(marker);
            let _ = item.setData_forType(&empty, &ty);
        }
        let refs: [&NSPasteboardItem; 1] = [&*item];
        let arr = NSArray::from_slice(&refs);
        let objects: &NSArray<objc2::runtime::ProtocolObject<dyn objc2_app_kit::NSPasteboardWriting>> =
            unsafe { &*(Retained::as_ptr(&arr) as *const _) };
        let _ = pb.writeObjects(objects);
        pb.changeCount()
    })
}

fn restore_pasteboard(saved: &[SavedItem], expected_change_count: isize) {
    objc2::rc::autoreleasepool(|_| {
        let pb = NSPasteboard::generalPasteboard();
        if pb.changeCount() != expected_change_count {
            // User copied something else during the 300 ms window; do not overwrite it.
            return;
        }
        pb.clearContents();
        if saved.is_empty() {
            return;
        }
        let mut ns_items: Vec<Retained<NSPasteboardItem>> = Vec::with_capacity(saved.len());
        for entries in saved {
            let item = NSPasteboardItem::new();
            for (ty, bytes) in entries {
                let ns_ty = NSString::from_str(ty);
                let data = NSData::with_bytes(bytes);
                let _ = item.setData_forType(&data, &ns_ty);
            }
            ns_items.push(item);
        }
        let refs: Vec<&NSPasteboardItem> = ns_items.iter().map(|i| &**i).collect();
        let arr = NSArray::from_slice(&refs);
        let objects: &NSArray<objc2::runtime::ProtocolObject<dyn objc2_app_kit::NSPasteboardWriting>> =
            unsafe { &*(Retained::as_ptr(&arr) as *const _) };
        let _ = pb.writeObjects(objects);
    });
}

fn post_cmd_v() {
    unsafe {
        let down = CGEventCreateKeyboardEvent(std::ptr::null_mut(), KVK_ANSI_V, true);
        let up = CGEventCreateKeyboardEvent(std::ptr::null_mut(), KVK_ANSI_V, false);
        if !down.is_null() {
            CGEventSetFlags(down, FLAG_COMMAND);
            CGEventPost(K_CG_HID_EVENT_TAP, down);
            CFRelease(down as *const c_void);
        }
        if !up.is_null() {
            CGEventSetFlags(up, FLAG_COMMAND);
            CGEventPost(K_CG_HID_EVENT_TAP, up);
            CFRelease(up as *const c_void);
        }
    }
}

pub fn is_secure_input_enabled() -> bool {
    unsafe { IsSecureEventInputEnabled() != 0 }
}

#[derive(Default)]
pub struct MacInsert;

impl MacInsert {
    pub fn new() -> Self {
        Self
    }

    /// Always copy mode (skips synthetic paste, keeps text on clipboard).
    pub fn copy_only(&self, text: &str) -> InsertResult {
        let _ = set_pasteboard_string(text);
        InsertResult::Copied
    }
}

impl Insert for MacInsert {
    fn insert(&self, text: &str) -> InsertResult {
        if text.is_empty() {
            return InsertResult::Typed;
        }
        if is_secure_input_enabled() || !super::banners::trusted(false) {
            let _ = set_pasteboard_string(text);
            return InsertResult::Copied;
        }

        let saved = snapshot_pasteboard();
        let change_count = set_pasteboard_transient(text);
        post_cmd_v();

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            restore_pasteboard(&saved, change_count);
        });

        InsertResult::Typed
    }
}
