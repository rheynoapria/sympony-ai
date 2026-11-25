//! The computer's own calendars: Windows' appointment store (Windows' Calendar app, and the accounts added to Windows
//! that sync there), read-only. Windows asks nothing of a desktop app here: Settings → Privacy & security → Calendar
//! decides. Sympony's own events and calendar links don't need any of this. Events go out as macOS's do (`provider`
//! "mac": the frontend's name for the computer's calendars).
use ::windows::ApplicationModel::Appointments::{AppointmentManager, AppointmentProperties, AppointmentStore, AppointmentStoreAccessType, FindAppointmentsOptions};
use ::windows::Foundation::{DateTime, TimeSpan};
use serde_json::{json, Value};
use std::collections::HashMap;

/// FILETIME's 1601 to Unix' 1970, in ms.
const FROM_1601_MS: i64 = 11_644_473_600_000;

fn store() -> Option<AppointmentStore> {
    super::mta();
    AppointmentManager::RequestStoreAsync(AppointmentStoreAccessType::AllCalendarsReadOnly).and_then(|op| op.join()).ok()
}

/// The permission now, for the log.
pub fn status_name() -> &'static str {
    if store().is_some() {
        "full"
    } else {
        "denied"
    }
}

/// `"granted" | "denied" | "notAsked"`, as on macOS (Windows never asks: granted or denied).
pub fn perm_status() -> &'static str {
    if store().is_some() {
        "granted"
    } else {
        "denied"
    }
}

/// Nothing to ask on Windows.
pub fn request() {}

pub fn access() -> bool {
    store().is_some()
}

/// Opens the calendar app at today: the one Windows shows appointments in (Calendar, Outlook), else `outlookcal:`
/// when an app takes it. Nothing when there's neither. It waits on WinRT: not on a UI thread.
pub fn open_app() {
    super::mta();
    let unix_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64);
    let now = DateTime { UniversalTime: (unix_ms + FROM_1601_MS) * 10_000 };
    let day = TimeSpan { Duration: 24 * 60 * 60 * 10_000_000 };
    if AppointmentManager::ShowTimeFrameAsync(now, day).and_then(|op| op.join()).is_ok() {
        return;
    }
    if scheme_taken("outlookcal") {
        super::shell::open("outlookcal:");
    }
}

/// Whether an app is registered for the link scheme `scheme:`.
fn scheme_taken(scheme: &str) -> bool {
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_CLASSES_ROOT, KEY_READ};
    let name = super::shell::wide(scheme);
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: a NUL-terminated name; the key, when opened, is closed at once
    unsafe {
        let ok = RegOpenKeyExW(HKEY_CLASSES_ROOT, name.as_ptr(), 0, KEY_READ, &mut key) == 0;
        if ok {
            RegCloseKey(key);
        }
        ok
    }
}

fn ms(d: DateTime) -> i64 {
    d.UniversalTime / 10_000 - FROM_1601_MS
}

/// Events overlapping `[from, to)` (ms) in the calendar's shape; none without access. A repeating event comes as each
/// of its times.
pub fn events(from: i64, to: i64) -> Vec<Value> {
    let Some(store) = store() else { return vec![] };
    let found = (|| -> ::windows::core::Result<_> {
        let opts = FindAppointmentsOptions::new()?;
        let want = opts.FetchProperties()?;
        for p in [
            AppointmentProperties::Subject()?,
            AppointmentProperties::StartTime()?,
            AppointmentProperties::Duration()?,
            AppointmentProperties::AllDay()?,
            AppointmentProperties::Location()?,
            AppointmentProperties::Details()?,
            AppointmentProperties::Uri()?,
            AppointmentProperties::Organizer()?,
            AppointmentProperties::Recurrence()?,
            AppointmentProperties::IsCanceledMeeting()?,
        ] {
            want.Append(&p)?;
        }
        let start = DateTime { UniversalTime: (from + FROM_1601_MS) * 10_000 };
        let span = TimeSpan { Duration: (to - from).max(0) * 10_000 };
        store.FindAppointmentsAsyncWithOptions(start, span, &opts)?.join()
    })();
    let Ok(found) = found else { return vec![] };
    // each calendar's name and colour, looked up once
    let mut calendars: HashMap<String, (String, Option<String>)> = HashMap::new();
    let mut out = vec![];
    for a in found {
        if a.IsCanceledMeeting().unwrap_or(false) {
            continue;
        }
        let (Ok(start), Ok(length)) = (a.StartTime(), a.Duration()) else { continue };
        let s = ms(start);
        let end = s + length.Duration / 10_000;
        let cal_id = a.CalendarId().map(|h| h.to_string()).unwrap_or_default();
        let (source, color) = calendars
            .entry(cal_id.clone())
            .or_insert_with(|| {
                let cal = store.GetAppointmentCalendarAsync(&cal_id.clone().into()).and_then(|op| op.join()).ok();
                let name = cal.as_ref().and_then(|c| c.DisplayName().ok()).map(|n| n.to_string()).unwrap_or_default();
                let color = cal.and_then(|c| c.DisplayColor().ok()).map(|c| format!("#{:02x}{:02x}{:02x}", c.R, c.G, c.B));
                (name, color)
            })
            .clone();
        let id = a.LocalId().map(|h| h.to_string()).unwrap_or_default();
        let text = |r: ::windows::core::Result<::windows::core::HSTRING>| r.map(|h| h.to_string()).unwrap_or_default();
        let details = text(a.Details());
        out.push(json!({
            "id": format!("mac|{id}|{s}"),
            "uid": a.RoamingId().ok().map(|h| h.to_string()).filter(|r| !r.is_empty()).unwrap_or(id),
            "title": text(a.Subject()), "start": s, "end": end, "allDay": a.AllDay().unwrap_or(false),
            "location": text(a.Location()),
            "description": (!details.is_empty()).then_some(details),
            "url": a.Uri().ok().and_then(|u| u.AbsoluteUri().ok()).map(|u| u.to_string()),
            "organizer": a.Organizer().ok().and_then(|o| o.DisplayName().ok()).map(|n| n.to_string()).filter(|n| !n.is_empty()),
            "color": color, "source": source, "provider": "mac",
            "repeat": a.Recurrence().is_ok().then_some("repeats"),
        }));
    }
    out
}
