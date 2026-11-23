//! macOS permissions service (`perm.status`, `perm.request`) for first-run onboarding (spec §5.4).
use platform::os::{automation, banners, calendar, location, notifications, voice};
use serde_json::{json, Value};
use services::onboarding::{action, Action, Perm};
use tauri::AppHandle;

const MUSIC_BUNDLE: &str = "com.apple.Music";
const SPOTIFY_BUNDLE: &str = "com.spotify.client";

fn open_pane(pane: &str) {
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
    let _ = std::process::Command::new("/usr/bin/open").arg(url).status();
}

fn full_disk_status() -> &'static str {
    match notifications::max_rowid() {
        Ok(_) => "granted",
        Err(_) => "denied",
    }
}

fn accessibility_status() -> &'static str {
    if banners::trusted(false) {
        "granted"
    } else {
        "denied"
    }
}

fn screen_recording_status() -> &'static str {
    if platform::ax::screen_access(false) {
        "granted"
    } else {
        "denied"
    }
}

/// Summary status for Automation across Apple Music and Spotify.
fn automation_summary(music: &str, spotify: &str) -> &'static str {
    if music == "notAsked" || spotify == "notAsked" {
        "notAsked"
    } else if music == "denied" || spotify == "denied" {
        "denied"
    } else if music == "granted" || spotify == "granted" {
        "granted"
    } else {
        "notRunning"
    }
}

pub fn status_value() -> Value {
    let music = automation::status(MUSIC_BUNDLE, false);
    let spotify = automation::status(SPOTIFY_BUNDLE, false);
    json!({
        "calendars": calendar::perm_status(),
        "location": location::status(),
        "automation": {
            "music": music,
            "spotify": spotify,
        },
        "fullDisk": full_disk_status(),
        "accessibility": accessibility_status(),
        "screenRecording": screen_recording_status(),
        "microphone": voice::mic_status(),
    })
}

fn parse_perm(kind: &str) -> Option<Perm> {
    match kind.to_ascii_lowercase().as_str() {
        "calendars" => Some(Perm::Calendars),
        "location" => Some(Perm::Location),
        "automation" => Some(Perm::Automation),
        "fulldisk" => Some(Perm::FullDisk),
        "accessibility" => Some(Perm::Accessibility),
        "screenrecording" | "screen_recording" => Some(Perm::ScreenRecording),
        "microphone" => Some(Perm::Microphone),
        _ => None,
    }
}

fn pane_for(perm: Perm) -> &'static str {
    match perm {
        Perm::Calendars => "Privacy_Calendars",
        Perm::Location => "Privacy_LocationServices",
        Perm::Automation => "Privacy_Automation",
        Perm::FullDisk => "Privacy_AllFiles",
        Perm::Accessibility => "Privacy_Accessibility",
        Perm::ScreenRecording => "Privacy_ScreenCapture",
        Perm::Microphone => "Privacy_Microphone",
    }
}

pub fn register(reg: &mut services::Registry, _app: &AppHandle) {
    reg.add("perm.status", Box::new(|_, _| Ok(status_value())));
    reg.add("perm.request", Box::new(|_, args| {
        let kind = args.first().and_then(Value::as_str).unwrap_or("");
        let force_pane = args.get(1).and_then(Value::as_bool).unwrap_or(false);
        let Some(perm) = parse_perm(kind) else {
            return Err(anyhow::anyhow!("unknown permission: {kind}"));
        };
        if force_pane {
            if perm == Perm::Accessibility {
                let _ = banners::trusted(true);
            } else if perm == Perm::ScreenRecording {
                let _ = platform::ax::screen_access(true);
            }
            open_pane(pane_for(perm));
            return Ok(json!({ "action": "pane" }));
        }
        let (st, ask_bundles): (&str, Vec<&'static str>) = match perm {
            Perm::Calendars => (calendar::perm_status(), vec![]),
            Perm::Location => (location::status(), vec![]),
            Perm::Automation => {
                let m = automation::status(MUSIC_BUNDLE, false);
                let s = automation::status(SPOTIFY_BUNDLE, false);
                let mut ask = Vec::new();
                if m == "notAsked" {
                    ask.push(MUSIC_BUNDLE);
                }
                if s == "notAsked" {
                    ask.push(SPOTIFY_BUNDLE);
                }
                (automation_summary(m, s), ask)
            }
            Perm::FullDisk => (full_disk_status(), vec![]),
            Perm::Accessibility => (accessibility_status(), vec![]),
            Perm::ScreenRecording => (screen_recording_status(), vec![]),
            Perm::Microphone => (voice::mic_status(), vec![]),
        };

        let act = action(perm, st);
        let tag = match act {
            Action::Done => "done",
            Action::LaterOnPlay => "later",
            Action::Dialog => {
                match perm {
                    Perm::Calendars => calendar::request(),
                    Perm::Location => location::request(),
                    Perm::Automation => {
                        std::thread::spawn(move || {
                            for bid in ask_bundles {
                                let _ = automation::status(bid, true);
                            }
                        });
                    }
                    Perm::Microphone => voice::mic_request(),
                    Perm::FullDisk | Perm::Accessibility | Perm::ScreenRecording => {}
                }
                "dialog"
            }
            Action::OpenPane(pane) => {
                if perm == Perm::Accessibility {
                    let _ = banners::trusted(true);
                } else if perm == Perm::ScreenRecording {
                    let _ = platform::ax::screen_access(true);
                }
                open_pane(pane);
                "pane"
            }
        };
        Ok(json!({ "action": tag }))
    }));
}
