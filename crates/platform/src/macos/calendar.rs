//! The Mac's own calendars (iCloud, Google, Exchange… whatever Calendar.app shows) through EventKit, with the owner's
//! permission (asked once).
use block2::RcBlock;
use objc2::runtime::Bool;
use objc2_app_kit::NSColorSpace;
use objc2_event_kit::{EKAuthorizationStatus, EKEntityType, EKEventStatus, EKEventStore};
use objc2_foundation::{NSDate, NSError};
use serde_json::{json, Value};

fn status() -> EKAuthorizationStatus {
    unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) }
}

/// The permission now, for the log.
pub fn status_name() -> &'static str {
    match status() {
        EKAuthorizationStatus::FullAccess => "full",
        EKAuthorizationStatus::NotDetermined => "not asked",
        EKAuthorizationStatus::Denied => "denied",
        EKAuthorizationStatus::Restricted => "restricted",
        _ => "write only",
    }
}

/// Permission state in the `perm` service shape: `"granted" | "denied" | "notAsked"`.
pub fn perm_status() -> &'static str {
    match status() {
        EKAuthorizationStatus::FullAccess => "granted",
        EKAuthorizationStatus::NotDetermined => "notAsked",
        _ => "denied",
    }
}

/// Non-blocking calendar permission request: asks via the native macOS dialog if not determined.
pub fn request() {
    if status() != EKAuthorizationStatus::NotDetermined {
        return;
    }
    let store = unsafe { EKEventStore::new() };
    let keep = store.clone();
    let block = RcBlock::new(move |_ok: Bool, _err: *mut NSError| {
        let _ = &keep;
    });
    unsafe { store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _) };
}

/// Whether Sympony may read the calendars; asks (and waits for the answer) the first time.
pub fn access() -> bool {
    let s = status();
    if s == EKAuthorizationStatus::FullAccess {
        return true;
    }
    if s != EKAuthorizationStatus::NotDetermined {
        return false;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let store = unsafe { EKEventStore::new() };
    let block = RcBlock::new(move |ok: Bool, _err: *mut NSError| {
        let _ = tx.send(ok.as_bool());
    });
    unsafe { store.requestFullAccessToEventsWithCompletion(&*block as *const _ as *mut _) };
    rx.recv_timeout(std::time::Duration::from_secs(300)).unwrap_or(false)
}

fn ms(d: &NSDate) -> i64 {
    (d.timeIntervalSince1970() * 1000.0).round() as i64
}

/// Events overlapping `[from, to)` (ms) in the calendar's shape; none without access.
pub fn events(from: i64, to: i64) -> Vec<Value> {
    if status() != EKAuthorizationStatus::FullAccess {
        return vec![];
    }
    objc2::rc::autoreleasepool(|_| unsafe {
        let store = EKEventStore::new();
        let (a, b) = (NSDate::dateWithTimeIntervalSince1970(from as f64 / 1000.0), NSDate::dateWithTimeIntervalSince1970(to as f64 / 1000.0));
        let pred = store.predicateForEventsWithStartDate_endDate_calendars(&a, &b, None);
        let srgb = NSColorSpace::sRGBColorSpace();
        store
            .eventsMatchingPredicate(&pred)
            .iter()
            .filter(|e| e.status() != EKEventStatus::Canceled)
            .map(|e| {
                let (s, end) = (ms(&e.startDate()), ms(&e.endDate()));
                let all_day = e.isAllDay();
                let cal = e.calendar();
                let color = cal.as_ref().and_then(|c| c.color().colorUsingColorSpace(&srgb)).map(|c| {
                    let h = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                    format!("#{:02x}{:02x}{:02x}", h(c.redComponent()), h(c.greenComponent()), h(c.blueComponent()))
                });
                let id = e.eventIdentifier().map(|i| i.to_string()).unwrap_or_default();
                json!({
                    "id": format!("mac|{id}|{s}"), "uid": e.calendarItemExternalIdentifier().map(|i| i.to_string()).unwrap_or(id),
                    "title": e.title().to_string(), "start": s,
                    // EventKit ends an all-day event at 23:59:59; the calendar wants the next midnight
                    "end": if all_day { end + 1000 } else { end }, "allDay": all_day,
                    "location": e.location().map(|l| l.to_string()).unwrap_or_default(),
                    "description": e.notes().map(|n| n.to_string()), "url": e.URL().and_then(|u| u.absoluteString()).map(|u| u.to_string()),
                    "organizer": e.organizer().and_then(|o| o.name()).map(|n| n.to_string()),
                    "color": color, "source": cal.map(|c| c.title().to_string()).unwrap_or_default(), "provider": "mac",
                    "repeat": if e.hasRecurrenceRules() { Some("repeats") } else { None },
                })
            })
            .collect()
    })
}
