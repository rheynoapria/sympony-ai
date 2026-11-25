//! The notch's open state, keyboard focus, dragging, the toggle shortcut and the tray.
use crate::commands::App;
use crate::notch::{Notch, LABEL};
use platform::os::MainThreadMarker;
use platform::os::{apps, displays::mouse_location};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Pony is using the keyboard and mouse in another app (ask_ai typing, Hands): the notch doesn't take the keyboard
/// meanwhile, so neither Pony's keys land in it nor that app becomes the one the notch gives the front back to.
static DRIVING: AtomicBool = AtomicBool::new(false);

pub struct Driving;
impl Driving {
    pub fn start() -> Driving {
        DRIVING.store(true, Ordering::SeqCst);
        Driving
    }
}
impl Drop for Driving {
    fn drop(&mut self) {
        DRIVING.store(false, Ordering::SeqCst);
    }
}

/// Folds the expanded notch out of the way when Hands needs to click/drag near the top of the screen.
/// Returns `true` if the notch was open (caller may pause briefly for the close animation).
pub fn yield_notch(app: &AppHandle) -> bool {
    let was_open = app.try_state::<Shell>().is_some_and(|s| s.open.lock().unwrap().0);
    if was_open {
        let _ = app.emit_to(LABEL, "notch:yield", ());
    }
    was_open
}

#[derive(Default)]
pub struct Shell {
    pub open: Mutex<(bool, u64)>,
    /// the app that had the keyboard before the notch took it
    pub gave_back_to: Mutex<Option<i32>>,
    pub dragging: AtomicBool,
    pub anchor: Mutex<Option<f64>>,
    pub shortcut: Mutex<Option<Shortcut>>,
    pub last_bad: Mutex<String>,
}

pub fn opened(app: &AppHandle, open: bool, seq: u64) {
    let shell = app.state::<Shell>();
    let mut st = shell.open.lock().unwrap();
    if seq >= st.1 {
        *st = (open, seq);
    }
    if open && app.get_webview_window(crate::onboarding::LABEL).is_some() {
        let _ = app.emit_to(crate::onboarding::LABEL, "onboard:tried", true);
    }
}

/// Whether the page has the keyboard now (its last `focus` ask), for a share that brought the notch forward.
#[cfg(windows)]
static KEYS: AtomicBool = AtomicBool::new(false);

/// `true`: the notch window takes the keyboard (a field was clicked); `false`: it gives it back.
pub fn focus(app: &AppHandle, want: bool) {
    #[cfg(windows)]
    KEYS.store(want, Ordering::SeqCst);
    if want && DRIVING.load(Ordering::SeqCst) {
        return;
    }
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(w) = a.get_webview_window(LABEL) else { return };
        let shell = a.state::<Shell>();
        if want {
            let mine = std::process::id() as i32;
            *shell.gave_back_to.lock().unwrap() = apps::frontmost_pid().filter(|p| *p != mine);
            let _ = w.set_focusable(true);
            let _ = w.set_focus();
        } else {
            let _ = w.set_focusable(false);
            let back = shell.gave_back_to.lock().unwrap().take();
            // (the notch closing right after it opened Settings: Settings keeps the front, the app before doesn't
            // come back over it)
            let other = a.webview_windows().into_iter().any(|(label, ww)| label != LABEL && ww.is_visible().unwrap_or(false) && ww.is_focused().unwrap_or(false));
            if let Some(pid) = back.filter(|_| {
                !other
                    && !crate::settings_window::opened_just_now()
                    && !crate::floating_chat::opened_just_now()
            }) {
                apps::activate_pid(pid);
            }
        }
    });
}

/// Windows shows its Share window only over the window in front, and the notch doesn't come to the front by itself:
/// it's unfocusable, so a click in it leaves the keyboard with your app (only a text field or the arrow keys take
/// it, and not on the drop page, where files land on the Share tile). For a share from it, the notch comes to the
/// front as for typing, and is unfocusable again once the Share window has the front. When the Share window closes
/// (Esc, or an app was picked), Windows hands the front back to the notch: the app you were in gets it back then, as
/// when typing ends, unless the page has taken the keyboard meanwhile. A click on the app before ends the watch;
/// after a click on some other app it just runs out (two minutes): the notch only comes to the front again for
/// typing or the arrow keys (the page has the keyboard then) or another share (whose watch takes over). Main thread.
#[cfg(windows)]
pub fn front_for_share(app: &AppHandle, w: &tauri::WebviewWindow) {
    use std::sync::atomic::AtomicU64;
    static SHARES: AtomicU64 = AtomicU64::new(0);
    let mine = std::process::id() as i32;
    if w.label() != LABEL || apps::frontmost_pid() == Some(mine) {
        return;
    }
    let before = apps::frontmost_pid();
    let _ = w.set_focusable(true);
    let _ = w.set_focus();
    let log = app.state::<App>().log.clone();
    log.line(if apps::frontmost_pid() == Some(mine) { "share: the notch came to the front for it" } else { "share: the notch didn't come to the front" });
    // (this share's watch; a later share's takes over)
    let me = SHARES.fetch_add(1, Ordering::SeqCst) + 1;
    let a = app.clone();
    std::thread::spawn(move || {
        let current = || SHARES.load(Ordering::SeqCst) == me;
        let tick = || std::thread::sleep(std::time::Duration::from_millis(250));
        // the Share window takes the front (10 s at most: it may not come). It takes a second or two to show, and
        // meanwhile the front may still be the notch or the app before: neither is the Share window
        let mut host = None;
        for _ in 0..40 {
            tick();
            let p = apps::frontmost_pid();
            if p.is_some() && p != Some(mine) && p != before {
                host = p;
                break;
            }
        }
        if !current() {
            return;
        }
        let b = a.clone();
        let _ = a.run_on_main_thread(move || {
            if let Some(w) = b.get_webview_window(LABEL).filter(|_| !KEYS.load(Ordering::SeqCst)) {
                let _ = w.set_focusable(false);
            }
        });
        // until it closes (two minutes at most): the front back on the notch, or on the app before (a click there).
        // (the Share window is several windows of more than one process, the front moving among them: anything
        // else in front is waited through)
        if host.is_some() {
            log.line("share: the Share window has the front");
            let mut back = false;
            for _ in 0..480 {
                tick();
                let p = apps::frontmost_pid();
                if p == Some(mine) {
                    back = true;
                    break;
                }
                if p.is_some() && p == before {
                    log.line("share: the Share window closed, the app before has the front");
                    return;
                }
            }
            if !back {
                return;
            }
        } else {
            log.line("share: no Share window came to the front");
        }
        if !current() || KEYS.load(Ordering::SeqCst) || apps::frontmost_pid() != Some(mine) {
            return;
        }
        let Some(pid) = before else { return };
        log.line("share: the Share window closed, the app before gets the front back");
        // (the Share window's last pieces may hand the front to the notch once more as they go: a second try)
        for _ in 0..2 {
            let _ = a.run_on_main_thread(move || apps::activate_pid(pid));
            std::thread::sleep(std::time::Duration::from_millis(600));
            if apps::frontmost_pid() == Some(pid) {
                log.line("share: the app before has the front again");
                return;
            }
        }
        log.line("share: the app before didn't take the front, Windows kept it on the notch");
    });
}

/// Between "start" and "end", the notch follows the mouse along the top edge (`notch:anchor`, window points).
pub fn drag(app: &AppHandle, action: &str) {
    let shell = app.state::<Shell>();
    match action {
        "start" => {
            if shell.dragging.swap(true, Ordering::SeqCst) {
                return;
            }
            let app = app.clone();
            std::thread::spawn(move || {
                while app.state::<Shell>().dragging.load(Ordering::SeqCst) {
                    let a = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let (Some(mtm), Some(win)) = (MainThreadMarker::new(), *a.state::<Notch>().win.lock().unwrap()) else { return };
                        // the mouseup may never reach the page (it went click-through, or reloaded): no button down ends it
                        if !platform::os::displays::mouse_down() {
                            drag(&a, "end");
                            return;
                        }
                        let x = (mouse_location(mtm).0 - win.x).clamp(0.0, win.w);
                        *a.state::<Shell>().anchor.lock().unwrap() = Some(x);
                        let _ = a.emit_to(LABEL, "notch:anchor", x);
                    });
                    std::thread::sleep(std::time::Duration::from_millis(16));
                }
            });
        }
        "end" => {
            shell.dragging.store(false, Ordering::SeqCst);
            if let Some(x) = *shell.anchor.lock().unwrap() {
                let win_w = app
                    .try_state::<Notch>()
                    .and_then(|n| n.win.lock().unwrap().map(|r| r.w))
                    .unwrap_or(platform::geometry::WIN_W);
                let frac = (x / win_w.max(1.0) * 1000.0).round() / 1000.0;
                let out = app.state::<App>().settings.set(serde_json::json!({ "notchPosition": frac }));
                let _ = app.emit("settings", out);
            }
        }
        _ => {}
    }
}

/// The saved position as the frontend's anchor (window points).
pub fn anchor_from_settings(app: &AppHandle) -> Option<f64> {
    let win_w = app
        .try_state::<Notch>()
        .and_then(|n| n.win.lock().unwrap().map(|r| r.w))
        .unwrap_or(platform::geometry::WIN_W);
    app.state::<App>().settings.get()["notchPosition"]
        .as_f64()
        .map(|p| platform::geometry::anchor_px_for(p, win_w))
}

/// Tells the notch where `notchPosition` puts it (after Settings changed it, or a reset).
pub fn send_anchor(app: &AppHandle) {
    if let Some(x) = anchor_from_settings(app) {
        let _ = app.emit_to(LABEL, "notch:anchor", x);
    }
}

/// (Re)registers `toggleShortcut`; a setting that doesn't parse is logged once and left unregistered.
pub fn sync_shortcut(app: &AppHandle) {
    use crate::shortcut::{decide, Decision};
    let wanted = app.state::<App>().settings.get()["toggleShortcut"].as_str().unwrap_or("").to_string();
    let shell = app.state::<Shell>();
    let mut cur = shell.shortcut.lock().unwrap();
    let mut last_bad = shell.last_bad.lock().unwrap();
    let gs = app.global_shortcut();
    let drop_current = |cur: &mut Option<Shortcut>| {
        if let Some(old) = cur.take() {
            let _ = gs.unregister(old);
        }
    };
    match decide(&wanted, *cur, &last_bad) {
        Decision::Keep => {}
        Decision::Unregister => drop_current(&mut cur),
        Decision::Bad => {
            drop_current(&mut cur);
            app.state::<App>().log.line(&format!("shortcut: can't use {wanted:?}"));
            *last_bad = wanted;
        }
        Decision::Register(sc) => {
            drop_current(&mut cur);
            match gs.register(sc) {
                Ok(()) => *cur = Some(sc),
                Err(e) => {
                    app.state::<App>().log.line(&format!("shortcut: can't use {wanted:?}: {e}"));
                    *last_bad = wanted;
                }
            }
        }
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, sc, ev| {
            // (the Teleprompter's reading keys go to it, the colour picker's starts it)
            if ev.state() == ShortcutState::Pressed && !crate::tele::pressed(app, sc) && !crate::colorpick::pressed(app, sc) {
                let _ = app.emit_to(LABEL, "notch:toggle", ());
            }
        })
        .build()
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    app.manage(Shell::default());
    sync_shortcut(app);
    // the keyboard leaves the notch (a click elsewhere): the frontend ends its typing
    if let Some(w) = app.get_webview_window(LABEL) {
        let h = app.clone();
        w.on_window_event(move |e| {
            if let WindowEvent::Focused(false) = e {
                let _ = h.emit_to(LABEL, "notch:blur", ());
            }
            // (what's dropped here: the Teleprompter may read a .txt from it)
            if let WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = e {
                crate::tele::dropped(&h, paths);
            }
        });
    }
    let open = MenuItem::with_id(app, "open", "Open Sympony", true, None::<&str>)?;
    let float_chat = MenuItem::with_id(app, "floating_chat", "Floating Pony Chat", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Sympony", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &float_chat, &settings, &quit])?;
    // macOS: Pony's silhouette in black, a template the menu bar tints light or dark; Windows/Linux trays don't
    // tint, so they get the colour app icon
    #[cfg(target_os = "macos")]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../brand/icon-ui.png"))?;
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../frontend/icon.png"))?;
    TrayIconBuilder::with_id("sympony")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Sympony")
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "open" => {
                let _ = app.emit_to(LABEL, "notch:toggle", ());
            }
            "floating_chat" => crate::floating_chat::toggle(app),
            "settings" => crate::settings_window::open(app, None),
            "quit" => {
                app.state::<App>().log.line("tray: Quit");
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
