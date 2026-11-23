//! Floating Pony Chat window (`pony-chat`): resizable, draggable, optional always-on-top companion
//! window sharing the exact same chat history, Pony tools, streaming, approvals, and Glass/OLED look.
use crate::commands::App;
use platform::geometry::target;
use platform::os::displays::displays_here;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "pony-chat";

const DEFAULT_W: f64 = 436.0;
const DEFAULT_H: f64 = 580.0;
const MIN_W: f64 = 340.0;
const MIN_H: f64 = 380.0;

/// When Floating Chat was last opened (ms since epoch): the notch closing right after doesn't steal focus back.
pub static OPENED_AT: AtomicU64 = AtomicU64::new(0);

pub fn opened_just_now() -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    now.saturating_sub(OPENED_AT.load(Ordering::Relaxed)) < 1500
}

pub struct FloatingChat {
    pub pinned: AtomicBool,
    pub last_bounds: Mutex<Option<(f64, f64, f64, f64)>>,
}

impl Default for FloatingChat {
    fn default() -> Self {
        Self {
            pinned: AtomicBool::new(true),
            last_bounds: Mutex::new(None),
        }
    }
}

/// True while the floating Pony chat window exists and is visible.
pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false))
}

/// Single recipient for background Pony events (`pony:agentDone`, `pony:aiPeek`) so only one window
/// appends the message and broadcasts via `store:chats`.
pub fn chat_target(app: &AppHandle) -> &'static str {
    if is_open(app) { LABEL } else { crate::notch::LABEL }
}

pub fn is_pinned(app: &AppHandle) -> bool {
    app.try_state::<FloatingChat>()
        .map(|s| s.pinned.load(Ordering::Relaxed))
        .unwrap_or(true)
}

pub fn state_json(app: &AppHandle) -> Value {
    json!({
        "open": is_open(app),
        "pinned": is_pinned(app),
    })
}

fn emit_state(app: &AppHandle) {
    let _ = app.emit("floating-chat:state", state_json(app));
}

/// Computes initial (x, y, w, h) in logical screen coordinates on the active Sympony display. Main thread.
fn initial_bounds(app: &AppHandle) -> (f64, f64, f64, f64) {
    if let Some(st) = app.try_state::<FloatingChat>() {
        if let Some(b) = *st.last_bounds.lock().unwrap() {
            if b.2 >= MIN_W && b.3 >= MIN_H {
                return b;
            }
        }
    }
    let setting = app
        .state::<App>()
        .settings
        .get()["display"]
        .as_str()
        .unwrap_or("primary")
        .to_string();
    let all = displays_here();
    if let Some(d) = target(&all, &setting) {
        let w = DEFAULT_W.min((d.frame.w - 48.0).max(MIN_W));
        let h = DEFAULT_H.min((d.frame.h - 120.0).max(MIN_H));
        let x = (d.frame.x + d.frame.w - w - 24.0).max(d.frame.x + 20.0);
        let y = d.frame.y + 68.0;
        return (x, y, w, h);
    }
    (960.0, 76.0, DEFAULT_W, DEFAULT_H)
}

fn bring_front(w: &tauri::WebviewWindow) {
    if let Some(handle) = crate::native::window(w) {
        // SAFETY: live OS window handle (NSWindow on macOS, HWND on Windows) on the main thread
        unsafe { platform::os::window::bring_front(handle) };
    }
}

fn reveal(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(w) = a.get_webview_window(LABEL) else { return };
        if !w.is_visible().unwrap_or(false) {
            let _ = w.show();
        }
        let _ = w.set_focus();
        bring_front(&w);
        let _ = w.emit_to(LABEL, "floating-chat:focus", ());
        emit_state(&a);
    });
}

/// Opens (or brings forward & focuses) the floating Pony chat window.
pub fn open(app: &AppHandle) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    OPENED_AT.store(now, Ordering::Relaxed);

    let a = app.clone();
    // Queue onto the main event loop off-thread so Windows WebView2 never deadlocks when creating a window from a command.
    crate::native::later_on_main_thread(app, move || {
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            bring_front(&w);
            let _ = w.emit_to(LABEL, "floating-chat:focus", ());
            emit_state(&a);
            return;
        }
        let (x, y, w_px, h_px) = initial_bounds(&a);
        let pinned = is_pinned(&a);
        let built = WebviewWindowBuilder::new(&a, LABEL, WebviewUrl::App("floating-chat.html".into()))
            .initialization_script(crate::page_globals())
            .title("Pony")
            .transparent(true)
            .decorations(false)
            .shadow(cfg!(target_os = "macos"))
            .resizable(true)
            .focusable(true)
            .skip_taskbar(true)
            .inner_size(w_px, h_px)
            .min_inner_size(MIN_W, MIN_H)
            .position(x, y)
            .visible(false)
            .on_page_load(|w, p| {
                if p.event() == tauri::webview::PageLoadEvent::Finished {
                    reveal(w.app_handle());
                }
            })
            .build();

        match built {
            Ok(win) => {
                if let Some(handle) = crate::native::window(&win) {
                    // SAFETY: live OS window created on the main thread
                    unsafe { platform::os::window::style_floating_chat_window(handle, pinned) };
                }
                // Fallback reveal in case PageLoadEvent::Finished was missed
                let h_reveal = a.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1200));
                    reveal(&h_reveal);
                });

                let h_ev = a.clone();
                let w_ev = win.clone();
                win.on_window_event(move |e| match e {
                    WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                        let scale = w_ev.scale_factor().unwrap_or(1.0);
                        if let (Ok(pos), Ok(size)) = (w_ev.outer_position(), w_ev.inner_size()) {
                            let lp: LogicalPosition<f64> = pos.to_logical(scale);
                            let ls: LogicalSize<f64> = size.to_logical(scale);
                            if ls.width >= MIN_W && ls.height >= MIN_H {
                                if let Some(st) = h_ev.try_state::<FloatingChat>() {
                                    *st.last_bounds.lock().unwrap() = Some((lp.x, lp.y, ls.width, ls.height));
                                }
                            }
                        }
                    }
                    WindowEvent::Destroyed => {
                        emit_state(&h_ev);
                    }
                    _ => {}
                });
            }
            Err(e) => {
                a.state::<App>().log.line(&format!("floating_chat: failed to open: {e}"));
            }
        }
    });
}

/// Closes the floating Pony chat window cleanly (keeping its last position/size).
pub fn close(app: &AppHandle) {
    let a = app.clone();
    crate::native::later_on_main_thread(app, move || {
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.close();
        }
        emit_state(&a);
    });
}

/// Toggles the floating Pony chat window open/closed.
pub fn toggle(app: &AppHandle) {
    if is_open(app) {
        close(app);
    } else {
        open(app);
    }
}

/// Pins or unpins the floating Pony chat window always-on-top.
pub fn set_pin(app: &AppHandle, pinned: bool) -> Value {
    if let Some(st) = app.try_state::<FloatingChat>() {
        st.pinned.store(pinned, Ordering::Relaxed);
    }
    let a = app.clone();
    crate::native::later_on_main_thread(app, move || {
        if let Some(w) = a.get_webview_window(LABEL) {
            if let Some(handle) = crate::native::window(&w) {
                // SAFETY: live OS window on the main thread
                unsafe { platform::os::window::set_floating_chat_pin(handle, pinned) };
            }
        }
        emit_state(&a);
    });
    json!({ "open": is_open(app), "pinned": pinned })
}

/// Docks back to the notch: closes floating chat and opens the Notch on the Pony chat tab.
pub fn dock_to_notch(app: &AppHandle) {
    close(app);
    open_notch_module(app, "chat");
}

/// Opens a specific module inside the Notch (used by Dock-to-Notch and action chips in floating chat).
pub fn open_notch_module(app: &AppHandle, module: &str) {
    let _ = app.emit_to(crate::notch::LABEL, "notch:openMod", module);
}
