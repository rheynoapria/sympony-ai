//! The Settings window: made or brought forward; while it exists Sympony is a regular app (Dock, ⌘-Tab).
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "settings";

/// When Settings was last opened (ms since the epoch): the notch closing right after doesn't hand the front back.
pub static OPENED_AT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn opened_just_now() -> bool {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    now.saturating_sub(OPENED_AT.load(std::sync::atomic::Ordering::Relaxed)) < 1500
}

pub fn open(app: &AppHandle, section: Option<String>) {
    OPENED_AT.store(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0), std::sync::atomic::Ordering::Relaxed);
    if crate::onboarding::is_opening(app) {
        crate::onboarding::defer_settings(app, section);
        return;
    }
    // (Launch at login shows what Task Manager → Startup apps says now)
    crate::login::sync(app, false);
    let a = app.clone();
    // (the window is made from the event loop: `native::later_on_main_thread` says why)
    crate::native::later_on_main_thread(app, move || {
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            bring_front(&w);
            if let Some(s) = section {
                let _ = w.emit_to(LABEL, "settings:section", s);
            }
            return;
        }
        #[cfg(target_os = "macos")]
        let _ = a.set_activation_policy(tauri::ActivationPolicy::Regular);
        // the new Settings (settings-ui) is the default; SYMPONY_SETTINGS_UI=classic opens the old page
        let want_next = std::env::var("SYMPONY_SETTINGS_UI").as_deref() != Ok("classic");
        let has_next = a.asset_resolver().get("settings-dist/index.html".into()).is_some();
        if want_next && !has_next {
            eprintln!("settings: settings-dist not built, using the classic page");
        }
        let next = want_next && has_next;
        let url = if next {
            match section.as_deref() {
                Some(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'/') => {
                    WebviewUrl::App(format!("settings-dist/index.html?section={s}").into())
                }
                _ => WebviewUrl::App("settings-dist/index.html".into()),
            }
        } else {
            WebviewUrl::App("settings.html".into())
        };
        let mut builder = WebviewWindowBuilder::new(&a, LABEL, url)
            .initialization_script(crate::page_globals())
            .title("Sympony Settings")
            .center()
            // (hidden until its page has drawn: no white flash before the dark theme)
            .visible(false)
            .on_page_load(move |w, p| {
                if p.event() == tauri::webview::PageLoadEvent::Finished {
                    if let Some(s) = section.clone() {
                        let _ = w.emit_to(LABEL, "settings:section", s);
                    }
                    reveal(w.app_handle());
                }
            });
        builder = if next {
            let b = builder.inner_size(1040.0, 720.0).min_inner_size(820.0, 560.0);
            #[cfg(target_os = "macos")]
            // the traffic lights sit inside the sidebar card (8 px window padding + 16 px inset), not on its corner
            let b = b
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .traffic_light_position(tauri::LogicalPosition::new(24.0, 26.0));
            b
        } else {
            builder.inner_size(980.0, 700.0).min_inner_size(760.0, 520.0)
        };
        let built = builder.build();
        match built {
            Ok(w) => {
                // (if the page never says it finished, it shows anyway)
                let h2 = a.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1500));
                    reveal(&h2);
                });
                #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
                let h = a.clone();
                w.on_window_event(move |e| {
                    if matches!(e, WindowEvent::Destroyed) {
                        #[cfg(target_os = "macos")]
                        if h.get_webview_window(crate::onboarding::LABEL).is_none() {
                            let _ = h.set_activation_policy(tauri::ActivationPolicy::Accessory);
                        }
                    }
                });
            }
            Err(e) => {
                #[cfg(target_os = "macos")]
                let _ = a.set_activation_policy(tauri::ActivationPolicy::Accessory);
                eprintln!("settings window: {e}");
            }
        }
    });
}

/// In front of the app the user is in, right away (see `platform::os::window::bring_front`).
fn bring_front(w: &tauri::WebviewWindow) {
    if let Some(ns) = crate::native::window(w) {
        // SAFETY: a live NSWindow, on the main thread (`open` runs there)
        unsafe { platform::os::window::bring_front(ns) };
    }
}

/// Shows the new Settings window once (its page is ready), in front.
fn reveal(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(w) = a.get_webview_window(LABEL) else { return };
        if w.is_visible().unwrap_or(false) {
            return;
        }
        let _ = w.show();
        let _ = w.set_focus();
        bring_front(&w);
    });
}
