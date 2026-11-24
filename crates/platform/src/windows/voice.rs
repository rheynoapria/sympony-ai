//! Dictation on Windows: the key (a low-level keyboard hook that only listens, fed to the shared `TriggerLogic`), and
//! putting the text where the user types (the clipboard, Ctrl+V, then what was on the clipboard back, as macOS does
//! with ⌘V). Recording itself is `crate::voice::CpalCapture`. The settings name keys as a Mac does: Option is Alt,
//! Command the Windows key; Fn never reaches Windows (the keyboard keeps it).
use crate::voice::{Insert, InsertResult, KeyInput, Trigger, TriggerEvent, TriggerLogic, VoiceKey};
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    VK_ESCAPE, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN,
};

/// `"granted" | "denied" | "notAsked"`, as on macOS: Settings → Privacy & security → Microphone.
pub fn mic_status() -> &'static str {
    super::privacy::consent("microphone").perm()
}

/// Windows' prompt for the microphone, where it asks desktop apps and hasn't had an answer.
pub fn mic_request() {
    super::privacy::ask("microphone");
}

/// macOS's Secure Input (a password field keeps typing to itself) has no Windows counterpart.
pub fn is_secure_input_enabled() -> bool {
    false
}

// ---------------------------------------------------------------------------
// WinTrigger (WH_KEYBOARD_LL, listen-only -> TriggerLogic)
// ---------------------------------------------------------------------------

/// The modifier keys, one bit each (left and right apart).
const MODS: [(u16, u8); 8] = [(VK_LSHIFT, 1), (VK_RSHIFT, 2), (VK_LCONTROL, 4), (VK_RCONTROL, 8), (VK_LMENU, 16), (VK_RMENU, 32), (VK_LWIN, 64), (VK_RWIN, 128)];
const SHIFT: u8 = 1 | 2;
const CTRL: u8 = 4 | 8;
const ALT: u8 = 16 | 32;
const WIN: u8 = 64 | 128;

fn mod_bit(vk: u16) -> Option<u8> {
    MODS.iter().find(|(k, _)| *k == vk).map(|(_, b)| *b)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Matcher {
    /// one key alone
    Single(u16),
    /// these modifiers together (each group: either side), nothing else
    Combo(u8),
}

impl Matcher {
    fn from_key(key: &VoiceKey) -> Result<Self, String> {
        Ok(match key {
            VoiceKey::RightOption => Self::Single(VK_RMENU),
            VoiceKey::LeftOption => Self::Single(VK_LMENU),
            VoiceKey::RightCommand => Self::Single(VK_RWIN),
            VoiceKey::RightControl => Self::Single(VK_RCONTROL),
            VoiceKey::RightShift => Self::Single(VK_RSHIFT),
            VoiceKey::Fn => return Err("Windows doesn’t see the Fn key: pick another dictation key in Settings → Voice".into()),
            VoiceKey::Combo(s) => {
                let mut want = 0u8;
                for part in s.split('+') {
                    want |= match part.trim().to_ascii_lowercase().as_str() {
                        "right_option" | "left_option" | "option" | "alt" => ALT,
                        "right_shift" | "left_shift" | "shift" => SHIFT,
                        "right_command" | "left_command" | "command" | "cmd" | "win" => WIN,
                        "right_control" | "left_control" | "control" | "ctrl" => CTRL,
                        _ => 0,
                    };
                }
                Self::Combo(if want == 0 { ALT | SHIFT } else { want })
            }
        })
    }

    /// Alt or the Windows key alone opens a menu or Start when let go: those get a mask key (below).
    fn needs_mask(self) -> bool {
        match self {
            Self::Single(vk) => matches!(vk, VK_LMENU | VK_RMENU | VK_LWIN | VK_RWIN),
            Self::Combo(want) => want & (ALT | WIN) != 0,
        }
    }
}

struct HookContext {
    matcher: Matcher,
    /// whether to send the mask key (`mask`): the matcher's need, off in tests (nothing is sent from them)
    masking: bool,
    logic: Mutex<TriggerLogic>,
    target_down: AtomicBool,
    /// the modifier keys down now (`MODS` bits)
    held: Mutex<u8>,
    tx: Sender<TriggerEvent>,
    epoch: Instant,
}

impl HookContext {
    fn feed(&self, input: KeyInput) {
        let now = self.epoch.elapsed().as_millis() as u64;
        let events = self.logic.lock().map(|mut l| l.on_event(input, now)).unwrap_or_default();
        for e in events {
            let _ = self.tx.send(e);
        }
    }

    /// One key going down or up (not one Sympony sent itself).
    fn key(&self, vk: u16, down: bool) {
        let bit = mod_bit(vk);
        let was_down = self.target_down.load(Ordering::Relaxed);
        let held = {
            let mut h = self.held.lock().unwrap();
            if let Some(b) = bit {
                if down {
                    *h |= b;
                } else {
                    *h &= !b;
                }
            }
            *h
        };
        // a key that isn't a modifier: Esc cancels, any other one is typing
        if bit.is_none() {
            if down {
                self.feed(if vk == VK_ESCAPE { KeyInput::Esc } else { KeyInput::OtherKey });
            }
            return;
        }
        match self.matcher {
            Matcher::Single(target) => {
                let target_bit = mod_bit(target).unwrap_or(0);
                if vk == target {
                    if down && !was_down {
                        if held & !target_bit != 0 {
                            self.feed(KeyInput::OtherKey);
                        } else {
                            self.target_down.store(true, Ordering::Relaxed);
                            self.feed(KeyInput::TargetDown);
                            if self.masking {
                                mask();
                            }
                        }
                    } else if !down && was_down {
                        self.target_down.store(false, Ordering::Relaxed);
                        self.feed(KeyInput::TargetUp);
                    }
                } else if was_down && down {
                    // (another modifier while holding it, e.g. Alt+Shift)
                    self.feed(KeyInput::OtherKey);
                }
            }
            Matcher::Combo(want) => {
                // (each group counts once, whichever side)
                let groups = [SHIFT, CTRL, ALT, WIN].iter().filter(|g| held & **g != 0).fold(0u8, |a, g| a | g);
                let exact = groups == want;
                let extra = groups & !want != 0;
                if exact && !was_down {
                    self.target_down.store(true, Ordering::Relaxed);
                    self.feed(KeyInput::TargetDown);
                    if self.masking {
                        mask();
                    }
                } else if was_down && extra {
                    self.feed(KeyInput::OtherKey);
                } else if was_down && !exact {
                    self.target_down.store(false, Ordering::Relaxed);
                    self.feed(KeyInput::TargetUp);
                }
            }
        }
    }
}

/// An unassigned key (0xE8) pressed and let go: Windows then takes the Alt or Windows key being held as part of a
/// shortcut, so letting it go opens no menu and no Start (AutoHotkey's menu mask key).
fn mask() {
    send_keys(&[(0xE8, true), (0xE8, false)]);
}

/// Keys sent as if typed: (virtual key, down).
fn send_keys(keys: &[(u16, bool)]) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP};
    let inputs: Vec<INPUT> = keys
        .iter()
        .map(|&(vk, down)| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if down { 0 } else { KEYEVENTF_KEYUP }, time: 0, dwExtraInfo: 0 } },
        })
        .collect();
    // SAFETY: an array of initialised keyboard inputs with its length and the size of one
    let sent = unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    sent as usize == inputs.len()
}

thread_local! {
    // the hook's context, on the thread that installed it (Windows calls the hook there)
    static CONTEXT: RefCell<Option<Arc<HookContext>>> = const { RefCell::new(None) };
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CallNextHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, WM_KEYDOWN, WM_SYSKEYDOWN};
    if code == HC_ACTION as i32 {
        // SAFETY: for HC_ACTION, lparam is the event's KBDLLHOOKSTRUCT
        let k = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        // (not what was sent, Sympony's own paste and mask among it; not AltGr's made-up left Ctrl)
        let altgr_ctrl = k.vkCode == VK_LCONTROL as u32 && k.scanCode & 0x200 != 0;
        if k.flags & LLKHF_INJECTED == 0 && !altgr_ctrl {
            let down = wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN;
            CONTEXT.with(|c| {
                if let Some(ctx) = c.borrow().as_ref() {
                    ctx.key(k.vkCode as u16, down);
                }
            });
        }
    }
    // SAFETY: passes the event on unchanged (the hook only listens)
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}

struct TriggerHandle {
    ctx: Arc<HookContext>,
    stop_flag: Arc<AtomicBool>,
    hook_thread_id: u32,
    hook_thread: Option<JoinHandle<()>>,
    tick_thread: Option<JoinHandle<()>>,
}

/// The dictation key's watcher (macOS: `MacTrigger`).
#[derive(Default)]
pub struct WinTrigger {
    inner: Mutex<Option<TriggerHandle>>,
}

impl WinTrigger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reset trigger state (e.g. when hands-free auto-stops due to silence or the 60 s cap).
    pub fn reset_state(&self) {
        if let Some(h) = self.inner.lock().ok().as_ref().and_then(|g| g.as_ref()) {
            if let Ok(mut l) = h.ctx.logic.lock() {
                l.reset();
            }
        }
    }
}

impl Trigger for WinTrigger {
    fn start(&self, key: VoiceKey, tx: Sender<TriggerEvent>) -> Result<(), String> {
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows_sys::Win32::System::Threading::GetCurrentThreadId;
        use windows_sys::Win32::UI::WindowsAndMessaging::{DispatchMessageW, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSG, WH_KEYBOARD_LL};
        self.stop();
        let matcher = Matcher::from_key(&key)?;
        let ctx = Arc::new(HookContext {
            matcher,
            masking: matcher.needs_mask(),
            logic: Mutex::new(TriggerLogic::new()),
            target_down: AtomicBool::new(false),
            held: Mutex::new(0),
            tx,
            epoch: Instant::now(),
        });
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<u32, String>>();
        let ctx_hook = Arc::clone(&ctx);
        let hook_thread = thread::spawn(move || {
            CONTEXT.with(|c| *c.borrow_mut() = Some(ctx_hook));
            // SAFETY: the hook is installed, its messages pumped on this thread until WM_QUIT, then removed here
            unsafe {
                let h = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), GetModuleHandleW(std::ptr::null()), 0);
                if h.is_null() {
                    let _ = ready_tx.send(Err("Windows refused the keyboard hook for the dictation key".into()));
                    return;
                }
                let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    DispatchMessageW(&msg);
                }
                UnhookWindowsHookEx(h);
            }
        });
        let hook_thread_id = match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(id)) => id,
            Ok(Err(e)) => {
                let _ = hook_thread.join();
                return Err(e);
            }
            Err(_) => return Err("timed out starting the keyboard hook".into()),
        };
        let stop_flag = Arc::new(AtomicBool::new(false));
        let (ctx_tick, stop_tick) = (Arc::clone(&ctx), Arc::clone(&stop_flag));
        let tick_thread = thread::spawn(move || {
            while !stop_tick.load(Ordering::Relaxed) {
                if ctx_tick.logic.lock().map(|l| l.is_pending()).unwrap_or(false) {
                    ctx_tick.feed(KeyInput::Tick);
                }
                thread::sleep(Duration::from_millis(20));
            }
        });
        if let Ok(mut g) = self.inner.lock() {
            *g = Some(TriggerHandle { ctx, stop_flag, hook_thread_id, hook_thread: Some(hook_thread), tick_thread: Some(tick_thread) });
        }
        Ok(())
    }

    fn stop(&self) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{PostThreadMessageW, WM_QUIT};
        let handle = self.inner.lock().ok().and_then(|mut g| g.take());
        if let Some(mut h) = handle {
            h.stop_flag.store(true, Ordering::Relaxed);
            // SAFETY: a message to the hook's own thread, which ends its loop
            unsafe { PostThreadMessageW(h.hook_thread_id, WM_QUIT, 0, 0) };
            if let Some(t) = h.tick_thread.take() {
                let _ = t.join();
            }
            if let Some(t) = h.hook_thread.take() {
                let _ = t.join();
            }
        }
    }
}

impl Drop for WinTrigger {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------------------------------------------------------------------------
// WinInsert (clipboard save -> set -> Ctrl+V -> 300 ms restore; an elevated app: copy only)
// ---------------------------------------------------------------------------

/// What was on the clipboard, each format's bytes (the ones held in memory: not bitmaps' or metafiles' handles,
/// whose picture also comes as a DIB).
fn snapshot() -> Vec<(u32, Vec<u8>)> {
    use windows_sys::Win32::System::DataExchange::EnumClipboardFormats;
    super::files::with_clipboard(|| {
        let mut out = vec![];
        let mut fmt = 0;
        loop {
            // SAFETY: the clipboard is open (with_clipboard)
            fmt = unsafe { EnumClipboardFormats(fmt) };
            if fmt == 0 {
                break;
            }
            // (bitmap, metafile, palette, enhanced metafile, owner display and the display formats, private and
            // GDI ranges: handles, not memory)
            let handle = matches!(fmt, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E) || (0x200..=0x3FF).contains(&fmt);
            if handle {
                continue;
            }
            if let Some(b) = super::files::clip_bytes(fmt).filter(|b| b.len() <= 64 << 20) {
                out.push((fmt, b));
            }
        }
        out
    })
    .unwrap_or_default()
}

fn restore(saved: &[(u32, Vec<u8>)]) {
    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    super::files::with_clipboard(|| {
        // SAFETY: the clipboard is open (with_clipboard)
        unsafe { EmptyClipboard() };
        for (fmt, bytes) in saved {
            super::files::put(*fmt, bytes);
        }
    });
}

/// The text on the clipboard for a moment, marked so clipboard histories (Windows', Sympony's, others') skip it.
/// The clipboard's sequence number after it, or None when it wasn't taken.
fn set_passing(text: &str) -> Option<isize> {
    use windows_sys::Win32::System::DataExchange::EmptyClipboard;
    let bytes: Vec<u8> = super::shell::wide(text).iter().flat_map(|c| c.to_le_bytes()).collect();
    let named = &super::files::format;
    let taken = super::files::with_clipboard(|| {
        // SAFETY: the clipboard is open (with_clipboard)
        if unsafe { EmptyClipboard() } == 0 || !super::files::put(super::files::CF_UNICODETEXT, &bytes) {
            return false;
        }
        super::files::put(named("ExcludeClipboardContentFromMonitorProcessing"), &[0]);
        super::files::put(named("CanIncludeInClipboardHistory"), &0u32.to_le_bytes());
        super::files::put(named("CanUploadToCloudClipboard"), &0u32.to_le_bytes());
        true
    })?;
    taken.then(super::files::change_count)
}

/// Whether the app in front runs elevated (as administrator): Windows keeps a normal app's keystrokes from it, so the
/// text can only be copied there.
fn front_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION};
    let Some(pid) = super::apps::frontmost_pid() else { return false };
    // SAFETY: handles checked, used for one query each and closed
    unsafe {
        let p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as u32);
        if p.is_null() {
            return false;
        }
        let mut token: HANDLE = std::ptr::null_mut();
        let opened = OpenProcessToken(p, TOKEN_QUERY, &mut token) != 0;
        CloseHandle(p);
        // (an elevated app's token is closed to a normal one)
        if !opened {
            return true;
        }
        let mut e: TOKEN_ELEVATION = std::mem::zeroed();
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, (&raw mut e).cast(), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len) != 0;
        CloseHandle(token);
        ok && e.TokenIsElevated != 0 && !own_elevated()
    }
}

/// Whether Sympony itself runs elevated (then it may type anywhere).
fn own_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    // SAFETY: this process' own token, queried once and closed
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut e: TOKEN_ELEVATION = std::mem::zeroed();
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, (&raw mut e).cast(), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len) != 0;
        CloseHandle(token);
        ok && e.TokenIsElevated != 0
    }
}

/// Puts dictated text where the user types (macOS: `MacInsert`).
#[derive(Default)]
pub struct WinInsert;

impl WinInsert {
    pub fn new() -> Self {
        Self
    }

    /// The text on the clipboard, nothing typed.
    pub fn copy_only(&self, text: &str) -> InsertResult {
        if super::files::write_text(text) {
            InsertResult::Copied
        } else {
            InsertResult::Failed("another app is holding the clipboard".into())
        }
    }
}

impl Insert for WinInsert {
    fn insert(&self, text: &str) -> InsertResult {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_CONTROL;
        if text.is_empty() {
            return InsertResult::Typed;
        }
        if front_elevated() {
            return self.copy_only(text);
        }
        let saved = snapshot();
        let Some(ours) = set_passing(text) else { return InsertResult::Failed("another app is holding the clipboard".into()) };
        // ('V' is 0x56)
        if !send_keys(&[(VK_CONTROL, true), (0x56, true), (0x56, false), (VK_CONTROL, false)]) {
            return InsertResult::Copied;
        }
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(300));
            // (unless something else was copied meanwhile)
            if super::files::change_count() == ours {
                restore(&saved);
            }
        });
        InsertResult::Typed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_as_the_settings_name_them() {
        assert_eq!(Matcher::from_key(&VoiceKey::RightOption), Ok(Matcher::Single(VK_RMENU)));
        assert_eq!(Matcher::from_key(&VoiceKey::RightControl), Ok(Matcher::Single(VK_RCONTROL)));
        assert_eq!(Matcher::from_key(&VoiceKey::Combo("right_option+right_shift".into())), Ok(Matcher::Combo(ALT | SHIFT)));
        assert!(Matcher::from_key(&VoiceKey::Fn).is_err());
        assert!(Matcher::Single(VK_RMENU).needs_mask() && !Matcher::Single(VK_RCONTROL).needs_mask());
    }

    fn context(key: VoiceKey) -> (HookContext, std::sync::mpsc::Receiver<TriggerEvent>) {
        let (tx, rx) = std::sync::mpsc::channel();
        let ctx = HookContext { matcher: Matcher::from_key(&key).unwrap(), masking: false, logic: Mutex::new(TriggerLogic::new()), target_down: AtomicBool::new(false), held: Mutex::new(0), tx, epoch: Instant::now() };
        (ctx, rx)
    }

    #[test]
    fn the_key_alone_goes_down_and_up_and_repeats_are_one() {
        let (ctx, rx) = context(VoiceKey::RightControl);
        ctx.key(VK_RCONTROL, true);
        ctx.key(VK_RCONTROL, true);
        ctx.key(VK_RCONTROL, false);
        let got: Vec<_> = rx.try_iter().collect();
        assert_eq!(got.first(), Some(&TriggerEvent::Down));
        assert_eq!(got.iter().filter(|e| **e == TriggerEvent::Down).count(), 1);
    }

    #[test]
    fn typing_while_it_is_down_cancels() {
        let (ctx, rx) = context(VoiceKey::RightControl);
        ctx.key(VK_RCONTROL, true);
        ctx.key(0x43, true); // C: Ctrl+C, a shortcut, not dictation
        assert_eq!(rx.try_iter().collect::<Vec<_>>(), vec![TriggerEvent::Down, TriggerEvent::Cancel]);
    }

    #[test]
    fn with_another_modifier_already_down_it_is_a_shortcut() {
        let (ctx, rx) = context(VoiceKey::RightControl);
        ctx.key(VK_LSHIFT, true);
        ctx.key(VK_RCONTROL, true);
        assert!(rx.try_iter().all(|e| e != TriggerEvent::Down));
    }

    #[test]
    fn a_combo_goes_down_when_exactly_its_keys_are_held() {
        let (ctx, rx) = context(VoiceKey::Combo("right_option+right_shift".into()));
        ctx.key(VK_RSHIFT, true);
        assert!(rx.try_iter().next().is_none());
        ctx.key(VK_LMENU, true); // (either Alt)
        assert_eq!(rx.try_iter().collect::<Vec<_>>(), vec![TriggerEvent::Down]);
        ctx.key(VK_RSHIFT, false);
        // (one of them let go: up again)
        assert!(!ctx.target_down.load(Ordering::Relaxed));
    }
}
