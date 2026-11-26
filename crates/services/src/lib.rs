//! Sympony's services: what `svc(name, method, ...args)` and the commands do, written against `platform`.
pub mod adhan;
pub mod archive;
pub mod agents;
pub mod askai;
pub mod brain;
pub mod backup;
pub mod aiusage;
pub mod bluetooth;
pub mod bookmarks;
pub mod clipboard;
pub mod colorpick;
pub mod codemode;
pub mod custom_modules;
pub mod devdrive;
pub mod exec;
pub mod eyes;
pub mod feed;
pub mod calendar;
pub mod gcal;
pub mod github;
pub mod health;
pub mod hands;
pub mod hit;
pub mod hooks;
pub mod http;
pub mod location;
pub mod mcp_client;
pub mod lyrics;
pub mod media;
pub mod notif;
pub mod onboarding;
pub mod pomodoro;
pub mod i18n;
pub mod launcher;
pub mod learn;
mod log;
pub mod oauth;
pub mod paths;
pub mod phone;
pub mod pony;
pub mod prayer;
pub mod radio;
pub mod routines;
pub mod schedule;
pub mod screentime;
pub mod secrets;
pub mod settings;
pub mod shelf;
pub mod speedtest;
pub mod stats;
pub mod store;
pub mod todosync;
pub mod tools;
pub mod warmth;
pub mod watch;
pub mod weather;
pub mod wifi;
pub mod youtube;
mod registry;

pub use log::Log;

pub use registry::{not_implemented, stub, Ctx, Handler, Registry};

/// What the service methods need besides their arguments.
pub struct Deps {
    pub settings: std::sync::Arc<settings::Settings>,
    pub weather: std::sync::Arc<weather::Weather>,
    pub prayer: std::sync::Arc<prayer::Prayer>,
    pub locator: std::sync::Arc<dyn platform::location::Locator>,
}

impl Deps {
    pub fn new(data_dir: &std::path::Path, secrets: std::sync::Arc<dyn platform::Secrets>, locator: std::sync::Arc<dyn platform::location::Locator>) -> Self {
        Deps {
            settings: std::sync::Arc::new(settings::Settings::load(data_dir, secrets)),
            weather: std::sync::Arc::new(weather::Weather::new(data_dir)),
            prayer: std::sync::Arc::new(prayer::Prayer::new(data_dir)),
            locator,
        }
    }
}

/// Every built service method, registered. The app and the parity report both start from this.
pub fn build(deps: &Deps) -> Registry {
    let mut reg = Registry::default();
    weather::register(&mut reg, deps);
    prayer::register(&mut reg);
    location::register(&mut reg, deps);
    store::register(&mut reg);
    lyrics::register(&mut reg);
    // Page size/scale hook (used for desktop text scaling; AppKit handles it on macOS)
    reg.add("notch.page", Box::new(|_, _| Ok(serde_json::Value::Bool(true))));
    reg
}

/// Contract commands that are real (the rest answer their stub); edited as tasks land.
pub const COMMANDS_DONE: &[&str] = &["notch_arrows", "notch_hud", "share_files", "shelf_start_drag", "svc", "log", "app_info", "app_quit", "open_external", "settings_get", "settings_set", "settings_reset", "settings_secret", "displays_list", "notch_hitrect", "notch_opened", "notch_focus", "notch_drag", "settings_open", "helper_state", "helper_cmd", "calendar_get", "calendar_refresh", "open_calendar_app"];
/// Contract events Sympony sends.
pub const EVENTS_DONE: &[&str] = &["settings", "agent:tool", "claude", "chat:brief", "aiusage", "aiusage:alert", "shelf:changed", "clipboard:changed", "phone:state", "phone:received", "phone:text", "notch:soundHere", "notch:focusHere", "notch:near", "notch:standby", "notch:reset", "notch:visible", "prayer:due", "look:warm", "lang", "lang:ready", "speedtest", "onboard:hint", "tele:key", "calendar", "todosync", "github", "pomodoro", "pomodoro:done", "timer", "timer:done", "health", "health:goal", "health:remind", "clock:changed", "prayer:adhanStop", "stats", "notif", "notif:history", "weather", "helper", "notch:camera", "notch:hover", "notch:toggle", "notch:blur", "notch:anchor", "settings:section", "store:todo", "store:notes", "store:stopwatch", "store:bookmarks", "store:chats", "store:teleprompter"];

/// Service methods the app registers itself (OS-specific, on top of `build`'s).
pub const APP_METHODS_DONE: &[&str] = &["audio.devices", "audio.setDefault", "notif.access", "notif.grant", "notif.open", "notif.history", "notif.read", "notif.remove", "notif.seen", "notif.clear", "notif.telegram", "notif.test", "notif.grantBanners", "pomodoro.get", "pomodoro.start", "pomodoro.pause", "pomodoro.toggle", "pomodoro.reset", "pomodoro.skip", "pomodoro.setPhase", "timer.get", "timer.start", "timer.toggle", "timer.stop", "timer.add", "health.get", "health.breakDone", "health.mindful", "health.water", "health.eyeBreakNow", "health.eyeBreakDone", "clock.quiet", "stats.wifi", "system.toggle", "github.get", "github.refresh", "screentime.summary", "wifi.list", "wifi.connect", "wifi.disconnect", "bluetooth.connect", "bluetooth.disconnect", "stats.now", "temp.zones", "todosync.state", "todosync.lists", "todosync.signIn", "todosync.cancel", "todosync.signOut", "todosync.syncNow", "todosync.setList", "todosync.newList", "ai.agents", "chat.send", "translate.translate", "lyrics.romanize", "lyrics.translate", "adhan.pick", "adhan.clear", "adhan.data", "adhan.start", "adhan.stop", "agent.result", "claude.list", "claude.answer", "claude.status", "claude.install", "claude.remove", "brief.now", "paseo.status", "paseo.open", "aiusage.get", "aiusage.status", "aiusage.watch", "shelf.list", "shelf.add", "shelf.remove", "shelf.clear", "shelf.pick", "shelf.open", "shelf.reveal", "shelf.copy", "shelf.share", "actions.catalog", "actions.run", "actions.reveal", "launcher.list", "launcher.add", "launcher.remove", "launcher.open", "apps.open", "clipboard.list", "clipboard.copy", "clipboard.pin", "clipboard.remove", "clipboard.clear", "clipboard.open", "bookmarks.clipboard", "bookmarks.meta", "phone.start", "phone.stop", "phone.state", "phone.folder", "phone.pickFolder", "warmth.get", "lang.state", "lang.prepare", "lang.restart", "radio.state", "radio.play", "radio.stop", "radio.volume", "radio.fav", "radio.forget", "radio.country", "radio.list", "radio.countries", "speedtest.get", "speedtest.start", "speedtest.cancel", "teleprompter.read", "teleprompter.keys", "backup.export", "backup.open", "backup.import"];

/// Everything built: the registry's "svc.method" names + COMMANDS_DONE + EVENTS_DONE + APP_METHODS_DONE.
pub fn implemented(reg: &Registry) -> Vec<String> {
    let mut v = reg.names();
    v.extend(COMMANDS_DONE.iter().chain(EVENTS_DONE).chain(APP_METHODS_DONE).map(|s| s.to_string()));
    v
}

/// `open_external` opens web, mail and settings links only (System Settings on a Mac; a page of Windows' Settings,
/// and its Wi-Fi list, which the Windows frontend links to); anything else (files, scripts, other schemes) is refused.
pub fn external_url_ok(url: &str) -> bool {
    ["https://", "http://", "mailto:", "x-apple.systempreferences:", "ms-settings:"].iter().any(|p| url.starts_with(p) && url.len() > p.len())
        || url == "ms-availablenetworks:"
}
