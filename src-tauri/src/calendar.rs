//! The calendar: the subscribed ICS feeds (fetched every 15 minutes, a failed one keeps its last good copy), Sympony's
//! own events and the Mac's calendars (read every minute), merged and sent as `calendar` when they change.
use serde_json::{json, Value};
use services::calendar::{expand_local, local_tz, parse_ics, Feed};
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const DAY: i64 = 86_400_000;

pub struct Calendar {
    last: Mutex<Value>,
    kick: Mutex<Sender<bool>>, // true: fetch the feeds now
}

/// Sends the calendar again (`calendar_get`), and fetches the feeds first when `fetch`.
pub fn kick(app: &AppHandle, fetch: bool) {
    if let Some(c) = app.try_state::<Calendar>() {
        let _ = c.kick.lock().unwrap().send(fetch);
    }
}

/// The last calendar, sent again now (a page that just loaded).
pub fn send_last(app: &AppHandle) {
    if let Some(c) = app.try_state::<Calendar>() {
        let v = c.last.lock().unwrap().clone();
        let _ = app.emit("calendar", v);
    }
}

fn fetch(url: &str) -> Result<String, String> {
    let url = url.trim();
    let url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    let text = services::http::get_text(&url).map_err(|e| format!("{e:#}"))?;
    if !text.contains("BEGIN:VCALENDAR") {
        return Err("That link doesn’t give a calendar (ICS)".into());
    }
    Ok(text)
}

pub fn start(app: &AppHandle) {
    let (tx, rx) = channel();
    app.manage(Calendar { last: Mutex::new(json!({"events": [], "errors": {}})), kick: Mutex::new(tx) });
    let a = app.clone();
    std::thread::spawn(move || run(a, rx));
    // the Mac's calendars: asked once (macOS keeps the answer), on a thread of its own so the prompt holds up nothing
    let a = app.clone();
    std::thread::spawn(move || {
        if a.state::<App>().settings.get()["calendarEnabled"] != false && platform::os::calendar::access() {
            kick(&a, false);
        }
    });
}

fn run(app: AppHandle, rx: Receiver<bool>) {
    let mut texts: HashMap<String, String> = HashMap::new(); // url → last good feed
    let mut errors = serde_json::Map::new();
    let mut fetched: Option<(Instant, Value)> = None; // when, and for which feeds
    let (mut fetch_now, mut resend, mut first) = (false, true, true);
    loop {
        let s = app.state::<App>().settings.get();
        let on = s["calendarEnabled"] != false;
        let feeds = s["icsFeeds"].clone();
        // (the first pass sends what's here at once; the feeds follow. A feed that failed is tried again a minute on)
        let due = |(t, f): &(Instant, Value)| t.elapsed() >= Duration::from_secs(if errors.is_empty() { 15 * 60 } else { 60 }) || *f != feeds;
        if on && !first && (fetch_now || fetched.as_ref().is_none_or(due)) {
            errors.clear();
            let urls: Vec<String> = feeds.as_array().into_iter().flatten().filter_map(|f| f["url"].as_str().map(String::from)).collect();
            texts.retain(|u, _| urls.contains(u));
            for u in &urls {
                match fetch(u) {
                    Ok(t) => {
                        texts.insert(u.clone(), t);
                    }
                    Err(e) => {
                        errors.insert(u.clone(), json!(e));
                    }
                }
            }
            fetched = Some((Instant::now(), feeds.clone()));
        }
        let now = chrono::Utc::now().timestamp_millis();
        let (from, to, tz) = (now - 35 * DAY, now + 120 * DAY, local_tz());
        if on && !first {
            crate::gcal::sync_if_due(&app, from, to, fetch_now);
        }
        let mut events: Vec<Value> = vec![];
        let mut mac_n = 0;
        let mut gcal_n = 0;
        if on {
            let gcal = crate::gcal::cached_events(&app);
            gcal_n = gcal.len();
            for f in feeds.as_array().into_iter().flatten() {
                let Some(t) = f["url"].as_str().and_then(|u| texts.get(u)) else { continue };
                let feed = Feed { url: f["url"].as_str().unwrap_or("").into(), name: f["name"].as_str().unwrap_or("Calendar").into(), color: f["color"].as_str().unwrap_or("").into() };
                events.extend(parse_ics(t, &feed, from, to, tz));
            }
            events.extend(expand_local(&s["localEvents"], from, to, tz));
            let mac = platform::os::calendar::events(from, to);
            mac_n = mac.len();
            events.extend(mac);
            events = services::gcal::filter_duplicates_against_gcal(events, &gcal);
            events.extend(gcal);
            events.sort_by_key(|e| e["start"].as_i64());
        }
        let v = json!({"events": events, "errors": errors});
        let changed = *app.state::<Calendar>().last.lock().unwrap() != v;
        if changed {
            app.state::<App>().log.line(&format!("calendar: {} events ({gcal_n} from Google Calendar, {mac_n} from the OS calendars, access {:?})", events_n(&v), platform::os::calendar::status_name()));
        }
        if changed || resend {
            *app.state::<Calendar>().last.lock().unwrap() = v.clone();
            let _ = app.emit("calendar", v);
        }
        let wait = if first { Duration::ZERO } else { Duration::from_secs(60) };
        (fetch_now, resend, first) = (false, false, false);
        match rx.recv_timeout(wait) {
            Ok(f) => (fetch_now, resend) = (f, true),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn events_n(v: &Value) -> usize {
    v["events"].as_array().map_or(0, |a| a.len())
}
