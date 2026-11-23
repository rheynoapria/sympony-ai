mod adhan;
mod agents;
mod aiusage;
mod artwork;
mod brain;
mod calendar;
mod clipboard;
mod background;
mod backup;
mod commands;
mod everyday;
mod exec;
mod mcp_out;
mod bridge;
mod eyes;
mod askai;
mod hands;
mod files;
mod github;
mod hooks;
mod extras;
mod hover;
mod lang;
mod mcp;
mod native;
mod media;
mod notch;
mod notif;
mod onboarding;
mod perm;
mod phone;
mod pony;
mod radio;
mod settings_window;
mod shell;
mod shortcut;
mod speedtest;
mod tele;
mod todosync;
mod updater;
mod voice;
mod watchers;
mod youtube;

use commands::App;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Run before each page's own scripts: the frontend reads the system from it (on a Mac it leaves out what needs
/// Windows: the System and Screen Time tabs, Windows-only settings, …).
pub(crate) fn page_globals() -> String {
    // (the system, and this run's language: lang.rs)
    match lang::globals() {
        "" => {
            let mut g = format!(";window.SYMPONY_OS={:?};", std::env::consts::OS);
            if std::env::var("SYMPONY_SHELL_DEV").ok().as_deref() == Some("1") {
                g += "window.SYMPONY_SHELL_DEV=true;";
            }
            g
        }
        g => g.to_string(),
    }
}

/// `sympony --mcp` (main.rs).
pub fn mcp_bridge() {
    mcp::bridge();
}

/// `sympony --hook <agent> <event>` (main.rs).
pub fn hook_bridge(agent: &str, event: &str) {
    mcp::hook(agent, event);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| settings_window::open(app, None)))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(shell::plugin())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = services::paths::data_dir();
            let log = Arc::new(services::Log::open(&data_dir));
            // a backup confirmed in About → Import: put in place now, before anything reads the data (backup.rs)
            let just_imported = match services::backup::apply_pending(&data_dir, chrono::Utc::now().timestamp_millis(), &chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()) {
                Ok(Some(copy)) => {
                    log.line(&format!("backup: imported; the data from before is in {}", copy.display()));
                    true
                }
                Ok(None) => false,
                Err(e) => {
                    log.line(&format!("backup: the import didn't happen: {e}"));
                    false
                }
            };
            log.line(&format!("Sympony started {}", env!("CARGO_PKG_VERSION")));
            let l = log.clone();
            let ctx = services::Ctx {
                data_dir: data_dir.clone(),
                emit: Arc::new(move |ch, v| {
                    let _ = handle.emit(ch, v);
                }),
                log: Arc::new(move |m| l.line(m)),
                changed: {
                    let h = app.handle().clone();
                    Arc::new(move |patch| {
                        let s = h.state::<App>().settings.get();
                        let _ = h.emit("settings", s);
                        background::settings_changed(&h, patch);
                    })
                },
            };
            let secrets = services::secrets::FileSecrets::open(&data_dir, Some(&platform::os::keychain::Keychain), services::settings::SECRET_KEYS);
            for k in services::settings::RETIRED_KEYS {
                let _ = platform::Secrets::set(&secrets, k, ""); // (AI goes through the agents now: no API keys kept)
            }
            let deps = services::Deps::new(&data_dir, Arc::new(secrets), Arc::new(platform::os::location::CoreLocation));
            let mut reg = services::build(&deps);
            watchers::register_audio(&mut reg);
            watchers::register_system(&mut reg, app.handle());
            notif::register(&mut reg, app.handle());
            perm::register(&mut reg, app.handle());
            everyday::register(&mut reg, app.handle(), &data_dir);
            adhan::register(&mut reg, app.handle());
            github::register(&mut reg, app.handle());
            todosync::register(&mut reg, app.handle(), &data_dir);
            agents::register(&mut reg, app.handle());
            brain::register(&mut reg, app.handle());
            exec::register(&mut reg, app.handle());
            mcp_out::register(&mut reg, app.handle());
            bridge::register(&mut reg, app.handle());
            eyes::register(&mut reg, app.handle());
            askai::register(&mut reg, app.handle());
            hands::register(app.handle());
            pony::register(&mut reg, app.handle());
            mcp::register(&mut reg, app.handle());
            hooks::register(&mut reg, app.handle());
            aiusage::register(&mut reg, app.handle());
            files::register(&mut reg, app.handle());
            clipboard::register(&mut reg, app.handle());
            phone::register(&mut reg, app.handle());
            lang::register(&mut reg, app.handle());
            extras::register(&mut reg, app.handle());
            radio::register(&mut reg, app.handle());
            speedtest::register(&mut reg, app.handle());
            tele::register(&mut reg, app.handle());
            backup::register(&mut reg, app.handle());
            updater::register(&mut reg, app.handle());
            voice::register(&mut reg, app.handle());
            youtube::register(&mut reg, app.handle());
            app.manage(App { settings: deps.settings.clone(), deps, log, data_dir, reg, ctx, warned: Mutex::new(Default::default()) });
            app.manage(updater::UpdaterState::new());
            voice::start(app.handle());
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            lang::init(app.handle());
            let ob = onboarding::Onboarding::default();
            app.manage(ob);
            notch::create(app.handle())?;
            hover::start(app.handle());
            shell::setup(app.handle())?;
            let force_ob = std::env::var("SYMPONY_ONBOARDING").as_deref() == Ok("1");
            let first_run = app.state::<App>().settings.get().get("onboarded").is_none_or(|v| v.is_null());
            if force_ob || first_run {
                onboarding::open(app.handle());
            }
            // (back from an import: About again, with the line about it)
            if just_imported {
                settings_window::open(app.handle(), Some("about".into()));
            }
            background::start(app.handle());
            media::start(app.handle());
            watchers::start(app.handle());
            notif::start(app.handle());
            everyday::start(app.handle());
            calendar::start(app.handle());
            todosync::start(app.handle());
            mcp::start(app.handle());
            hooks::start(app.handle());
            hooks::paseo_start(app.handle());
            aiusage::start(app.handle());
            files::load(app.handle());
            clipboard::start(app.handle());
            lang::start(app.handle());
            extras::start(app.handle());
            radio::start(app.handle());
            updater::start(app.handle());
            Ok(())
        })
        .invoke_handler(all_commands!())
        .run(tauri::generate_context!())
        .expect("error while running Sympony");
}
