//! Direct Google Calendar API v3 integration on the user's device, sharing Google OAuth sign-in with `todosync.rs`.
//! Uses:
//! - `calendar.calendarlist.readonly` to list the user's calendars so they choose which ones Sympony & Pony use
//! - `calendar.events` to read upcoming events and create, move/edit, or delete events on user request.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use services::calendar::local_tz;
use services::gcal::{default_write_calendar, event_body, parse_calendar_list, parse_event, parse_events, rfc3339_utc, CalendarItem};
use services::oauth::{SCOPE_CALENDAR_EVENTS, SCOPE_CALENDAR_LIST, SCOPE_TASKS};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const API: &str = "https://www.googleapis.com/calendar/v3";
const DAY_MS: i64 = 86_400_000;

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
struct Saved {
    calendars: Vec<CalendarItem>,
    selected_ids: Option<Vec<String>>,
    default_calendar_id: Option<String>,
    last: i64,
}

#[derive(Clone, Debug)]
struct EventRef {
    calendar_id: String,
    calendar_name: String,
    event_id: String,
    gcal_key: String,
    title: String,
    start: i64,
    end: i64,
    location: String,
    description: Option<String>,
    writable: bool,
}

#[derive(Default)]
pub struct GCal {
    saved: Mutex<Saved>,
    events: Mutex<Vec<Value>>,
    index: Mutex<HashMap<String, EventRef>>,
    syncing: AtomicBool,
    last_fetch: Mutex<Option<Instant>>,
    error: Mutex<String>,
}

fn file(app: &AppHandle) -> std::path::PathBuf {
    app.state::<App>().data_dir.join("gcal.json")
}

fn save(app: &AppHandle) {
    let s = app.state::<GCal>().saved.lock().unwrap().clone();
    let tmp = file(app).with_extension("json.tmp");
    if serde_json::to_vec(&s).is_ok_and(|b| std::fs::write(&tmp, b).is_ok()) {
        let _ = std::fs::rename(tmp, file(app));
    }
}

fn set_error(app: &AppHandle, msg: &str) {
    *app.state::<GCal>().error.lock().unwrap() = msg.to_string();
}

pub fn state(app: &AppHandle) -> Value {
    let auth = crate::todosync::google_auth_info(app);
    let g = app.state::<GCal>();
    let saved = g.saved.lock().unwrap().clone();
    let has_cal = crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS);
    let has_list = crate::todosync::has_scope(app, SCOPE_CALENDAR_LIST);
    let has_tasks = crate::todosync::has_scope(app, SCOPE_TASKS);
    let write_cal = default_write_calendar(&saved.calendars, saved.default_calendar_id.as_deref()).map(|c| c.id.clone());
    let gcal_err = g.error.lock().unwrap().clone();
    let err = if !gcal_err.is_empty() { gcal_err } else if !auth.signed_in { auth.error } else { String::new() };
    json!({
        "ready": auth.ready,
        "builtIn": auth.built_in,
        "signingIn": auth.signing_in,
        "signedIn": auth.signed_in,
        "account": auth.account,
        "hasCalendarScope": has_cal,
        "hasCalendarListScope": has_list,
        "hasTasksScope": has_tasks,
        "calendars": saved.calendars,
        "defaultCalendarId": write_cal,
        "syncing": g.syncing.load(Ordering::SeqCst),
        "last": if saved.last > 0 { json!(saved.last) } else { Value::Null },
        "error": err,
    })
}

pub fn tell(app: &AppHandle) -> Value {
    let v = state(app);
    let _ = app.emit("pony:gcal", &v);
    v
}

pub fn cached_events(app: &AppHandle) -> Vec<Value> {
    app.try_state::<GCal>().map(|g| g.events.lock().unwrap().clone()).unwrap_or_default()
}

fn call(app: &AppHandle, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let url = if path.starts_with("https://") { path.to_string() } else { format!("{API}{path}") };
    for attempt in 0..2 {
        let t = crate::todosync::google_token(app)?;
        match services::http::bearer(method, &url, &t, body) {
            Ok((s, v)) if (200..300).contains(&s) => return Ok(v),
            Ok((401, _)) if attempt == 0 => {
                crate::todosync::invalidate_access_token(app);
                continue;
            }
            Ok((401, _)) => return Err("Google didn’t accept the sign-in. Sign in again in Settings.".into()),
            Ok((403, v)) => {
                let msg = v["error"]["message"].as_str().unwrap_or("Calendar permission denied");
                return Err(format!("Google Calendar denied access: {msg}"));
            }
            Ok((404, _)) => return Err("not found".into()),
            Ok((s, v)) => return Err(format!("Google Calendar answered {s}: {}", v["error"]["message"].as_str().unwrap_or(""))),
            Err(_) => return Err("Couldn’t reach Google Calendar".into()),
        }
    }
    Err("Google didn’t accept the sign-in".into())
}

fn synthetic_primary() -> CalendarItem {
    CalendarItem {
        id: "primary".into(),
        summary: "Primary".into(),
        color: "#4285f4".into(),
        primary: true,
        access_role: "owner".into(),
        selected: true,
        writable: true,
    }
}

/// Fetches the user's Google Calendars via `calendar.calendarlist.readonly`.
pub fn fetch_calendars(app: &AppHandle) -> Result<Vec<CalendarItem>, String> {
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_LIST) {
        let cals = vec![synthetic_primary()];
        app.state::<GCal>().saved.lock().unwrap().calendars = cals.clone();
        save(app);
        return Ok(cals);
    }
    let mut items = Vec::new();
    let mut page = String::new();
    loop {
        let path = format!("/users/me/calendarList?minAccessRole=freeBusyReader&showHidden=false&maxResults=250{page}");
        let v = call(app, "GET", &path, None)?;
        if let Some(arr) = v["items"].as_array() {
            items.extend(arr.iter().cloned());
        }
        match v["nextPageToken"].as_str() {
            Some(tok) if !tok.is_empty() => page = format!("&pageToken={}", services::http::q(tok)),
            _ => break,
        }
    }
    let g = app.state::<GCal>();
    let prev_selected = g.saved.lock().unwrap().selected_ids.clone();
    let parsed = parse_calendar_list(&json!({"items": items}), prev_selected.as_deref());
    {
        let mut saved = g.saved.lock().unwrap();
        if saved.selected_ids.is_none() {
            saved.selected_ids = Some(parsed.iter().filter(|c| c.selected).map(|c| c.id.clone()).collect());
        }
        saved.calendars = parsed.clone();
    }
    save(app);
    Ok(parsed)
}

fn rebuild_index(events: &[Value]) -> HashMap<String, EventRef> {
    let mut idx = HashMap::new();
    for ev in events {
        let (Some(cal_id), Some(ev_id), Some(key)) = (
            ev["calendarId"].as_str(),
            ev["uid"].as_str(),
            ev["gcalKey"].as_str(),
        ) else {
            continue;
        };
        let r = EventRef {
            calendar_id: cal_id.to_string(),
            calendar_name: ev["calendarName"].as_str().unwrap_or("Google Calendar").to_string(),
            event_id: ev_id.to_string(),
            gcal_key: key.to_string(),
            title: ev["title"].as_str().unwrap_or("").to_string(),
            start: ev["start"].as_i64().unwrap_or(0),
            end: ev["end"].as_i64().unwrap_or(0),
            location: ev["location"].as_str().unwrap_or("").to_string(),
            description: ev["description"].as_str().map(String::from),
            writable: ev["writable"] == true,
        };
        idx.insert(key.to_string(), r.clone());
        if let Some(full) = ev["id"].as_str() {
            idx.insert(full.to_string(), r.clone());
        }
        idx.entry(ev_id.to_string()).or_insert(r);
    }
    idx
}

/// Fetches upcoming events for all selected Google Calendars in `[from_ms, to_ms]`.
pub fn sync_events(app: &AppHandle, from_ms: i64, to_ms: i64, refresh_list: bool) -> Result<Vec<Value>, String> {
    let auth = crate::todosync::google_auth_info(app);
    if !auth.signed_in {
        return Ok(vec![]);
    }
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS) {
        let g = app.state::<GCal>();
        g.events.lock().unwrap().clear();
        g.index.lock().unwrap().clear();
        return Ok(vec![]);
    }
    let g = app.state::<GCal>();
    if g.syncing.swap(true, Ordering::SeqCst) {
        return Ok(cached_events(app));
    }
    tell(app);
    let result = (|| -> Result<Vec<Value>, String> {
        let need_list = refresh_list || g.saved.lock().unwrap().calendars.is_empty();
        let calendars = if need_list {
            fetch_calendars(app)?
        } else {
            g.saved.lock().unwrap().calendars.clone()
        };
        let tz = local_tz();
        let t_min = services::http::q(&rfc3339_utc(from_ms));
        let t_max = services::http::q(&rfc3339_utc(to_ms));
        let mut all = Vec::new();
        for cal in calendars.iter().filter(|c| c.selected) {
            let mut page = String::new();
            loop {
                let path = format!(
                    "/calendars/{}/events?singleEvents=true&orderBy=startTime&timeMin={t_min}&timeMax={t_max}&maxResults=250{page}",
                    services::http::q(&cal.id)
                );
                match call(app, "GET", &path, None) {
                    Ok(v) => {
                        all.extend(parse_events(cal, &v, tz));
                        match v["nextPageToken"].as_str() {
                            Some(tok) if !tok.is_empty() => page = format!("&pageToken={}", services::http::q(tok)),
                            _ => break,
                        }
                    }
                    Err(e) if e == "not found" => break,
                    Err(e) => return Err(e),
                }
            }
        }
        all.sort_by_key(|e| e["start"].as_i64());
        let idx = rebuild_index(&all);
        *g.events.lock().unwrap() = all.clone();
        *g.index.lock().unwrap() = idx;
        *g.last_fetch.lock().unwrap() = Some(Instant::now());
        g.saved.lock().unwrap().last = chrono::Utc::now().timestamp_millis();
        save(app);
        Ok(all)
    })();
    g.syncing.store(false, Ordering::SeqCst);
    match &result {
        Ok(_) => set_error(app, ""),
        Err(e) => {
            app.state::<App>().log.line(&format!("gcal: {e}"));
            set_error(app, e);
        }
    }
    tell(app);
    result
}

/// Called from `calendar.rs`: syncs Google Calendar every 5 minutes (1 min on error) or when forced.
pub fn sync_if_due(app: &AppHandle, from_ms: i64, to_ms: i64, force: bool) {
    if !crate::todosync::google_auth_info(app).signed_in {
        return;
    }
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS) {
        return;
    }
    let g = app.state::<GCal>();
    let has_err = !g.error.lock().unwrap().is_empty();
    let due = match *g.last_fetch.lock().unwrap() {
        None => true,
        Some(t) => t.elapsed() >= Duration::from_secs(if has_err { 60 } else { 5 * 60 }),
    };
    if force || due {
        let _ = sync_events(app, from_ms, to_ms, force);
    }
}

/// Called when Google sign-in completes: fetches calendar list + upcoming events and refreshes the notch Calendar tab.
pub fn on_signed_in(app: &AppHandle) {
    set_error(app, "");
    tell(app);
    let h = app.clone();
    std::thread::spawn(move || {
        let now = chrono::Utc::now().timestamp_millis();
        let _ = sync_events(&h, now - 35 * DAY_MS, now + 120 * DAY_MS, true);
        crate::calendar::kick(&h, false);
    });
}

/// Called when the user disconnects their Google account: immediately clears cached calendars/events and refreshes UI.
pub fn on_signed_out(app: &AppHandle) {
    if let Some(g) = app.try_state::<GCal>() {
        *g.saved.lock().unwrap() = Saved::default();
        g.events.lock().unwrap().clear();
        g.index.lock().unwrap().clear();
        *g.last_fetch.lock().unwrap() = None;
        set_error(app, "");
    }
    let _ = std::fs::remove_file(file(app));
    tell(app);
    crate::calendar::kick(app, false);
}

fn find_target_calendar(app: &AppHandle, requested_id: Option<&str>) -> Result<CalendarItem, String> {
    let g = app.state::<GCal>();
    if g.saved.lock().unwrap().calendars.is_empty() {
        let _ = fetch_calendars(app);
    }
    let saved = g.saved.lock().unwrap().clone();
    if let Some(req_id) = requested_id.filter(|s| !s.is_empty()) {
        if let Some(c) = saved.calendars.iter().find(|c| c.id == req_id && c.writable) {
            return Ok(c.clone());
        }
    }
    default_write_calendar(&saved.calendars, saved.default_calendar_id.as_deref())
        .cloned()
        .ok_or_else(|| "No writable Google Calendar is available. Select a calendar you can edit in Settings → Calendar.".into())
}

/// Creates a new event in Google Calendar and immediately updates the local cache & notch UI.
pub fn create_event(app: &AppHandle, req: &Value) -> Result<Value, String> {
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS) {
        return Err("Connect Google Calendar in Settings → Calendar first.".into());
    }
    let title = req["title"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or("Event title is required")?;
    let start = req["start"].as_i64().ok_or("Event start time is required")?;
    let end = req["end"].as_i64().filter(|&e| e > start).unwrap_or(start + 3_600_000);
    let location = req["location"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let description = req["description"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let cal = find_target_calendar(app, req["calendarId"].as_str())?;
    let tz = local_tz();
    let body = event_body(Some(title), Some(start), Some(end), location, description, tz);
    let created = call(app, "POST", &format!("/calendars/{}/events", services::http::q(&cal.id)), Some(&body))?;
    app.state::<App>().log.line(&format!("gcal: created “{title}” in {}", cal.summary));
    let parsed = parse_event(&cal, &created, tz).ok_or("Google Calendar returned an unreadable event")?;
    let g = app.state::<GCal>();
    {
        let mut evs = g.events.lock().unwrap();
        evs.push(parsed.clone());
        evs.sort_by_key(|e| e["start"].as_i64());
        let idx = rebuild_index(&evs);
        *g.index.lock().unwrap() = idx;
    }
    crate::calendar::kick(app, false);
    Ok(json!({
        "ok": true,
        "id": parsed["gcalKey"],
        "eventId": parsed["uid"],
        "calendarId": cal.id,
        "calendarName": cal.summary,
        "title": parsed["title"],
        "start": parsed["start"],
        "end": parsed["end"],
        "htmlLink": parsed["openUrl"],
    }))
}

/// Moves or edits an existing Google Calendar event and immediately updates the local cache & notch UI.
pub fn update_event(app: &AppHandle, req: &Value) -> Result<Value, String> {
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS) {
        return Err("Connect Google Calendar in Settings → Calendar first.".into());
    }
    let key = req["id"].as_str().map(str::trim).filter(|s| !s.is_empty()).ok_or("Event id is required")?;
    let g = app.state::<GCal>();
    let prev = g
        .index
        .lock()
        .unwrap()
        .get(key)
        .cloned()
        .ok_or_else(|| "Couldn’t find that Google Calendar event".to_string())?;
    if !prev.writable {
        return Err(format!("“{}” is in a read-only calendar ({}).", prev.title, prev.calendar_name));
    }
    let new_title = req["title"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let new_start = req["start"].as_i64();
    let orig_dur = (prev.end - prev.start).max(1_800_000);
    let new_end = match (new_start, req["end"].as_i64()) {
        (_, Some(e)) => Some(e),
        (Some(s), None) => Some(s + orig_dur),
        (None, None) => None,
    };
    let new_loc = req["location"].as_str();
    let new_desc = req["description"].as_str();
    let tz = local_tz();
    let body = event_body(new_title, new_start, new_end, new_loc, new_desc, tz);
    let path = format!("/calendars/{}/events/{}", services::http::q(&prev.calendar_id), services::http::q(&prev.event_id));
    let updated = call(app, "PATCH", &path, Some(&body))?;
    app.state::<App>().log.line(&format!("gcal: updated “{}” ({}) in {}", new_title.unwrap_or(&prev.title), prev.gcal_key, prev.calendar_name));
    let cal = g
        .saved
        .lock()
        .unwrap()
        .calendars
        .iter()
        .find(|c| c.id == prev.calendar_id)
        .cloned()
        .unwrap_or_else(|| CalendarItem {
            id: prev.calendar_id.clone(),
            summary: prev.calendar_name.clone(),
            color: "#4285f4".into(),
            primary: prev.calendar_id == "primary",
            access_role: "owner".into(),
            selected: true,
            writable: true,
        });
    let parsed = parse_event(&cal, &updated, tz).ok_or("Google Calendar returned an unreadable event")?;
    {
        let mut evs = g.events.lock().unwrap();
        if let Some(slot) = evs.iter_mut().find(|e| e["gcalKey"].as_str() == Some(prev.gcal_key.as_str())) {
            *slot = parsed.clone();
        } else {
            evs.push(parsed.clone());
        }
        evs.sort_by_key(|e| e["start"].as_i64());
        let idx = rebuild_index(&evs);
        *g.index.lock().unwrap() = idx;
    }
    crate::calendar::kick(app, false);
    Ok(json!({
        "ok": true,
        "id": parsed["gcalKey"],
        "eventId": parsed["uid"],
        "calendarId": cal.id,
        "calendarName": cal.summary,
        "title": parsed["title"],
        "start": parsed["start"],
        "end": parsed["end"],
        "prev": {
            "title": prev.title,
            "start": prev.start,
            "end": prev.end,
            "location": prev.location,
            "description": prev.description,
            "calendarId": prev.calendar_id,
        }
    }))
}

/// Deletes an existing Google Calendar event and immediately updates the local cache & notch UI.
pub fn delete_event(app: &AppHandle, key: &str) -> Result<Value, String> {
    if !crate::todosync::has_scope(app, SCOPE_CALENDAR_EVENTS) {
        return Err("Connect Google Calendar in Settings → Calendar first.".into());
    }
    let key = key.trim();
    let g = app.state::<GCal>();
    let prev = g
        .index
        .lock()
        .unwrap()
        .get(key)
        .cloned()
        .ok_or_else(|| "Couldn’t find that Google Calendar event".to_string())?;
    if !prev.writable {
        return Err(format!("“{}” is in a read-only calendar ({}).", prev.title, prev.calendar_name));
    }
    let path = format!("/calendars/{}/events/{}", services::http::q(&prev.calendar_id), services::http::q(&prev.event_id));
    match call(app, "DELETE", &path, None) {
        Ok(_) => {}
        Err(e) if e == "not found" => {}
        Err(e) => return Err(e),
    }
    app.state::<App>().log.line(&format!("gcal: deleted “{}” ({}) from {}", prev.title, prev.gcal_key, prev.calendar_name));
    {
        let mut evs = g.events.lock().unwrap();
        evs.retain(|e| e["gcalKey"].as_str() != Some(prev.gcal_key.as_str()));
        let idx = rebuild_index(&evs);
        *g.index.lock().unwrap() = idx;
    }
    crate::calendar::kick(app, false);
    Ok(json!({
        "ok": true,
        "id": prev.gcal_key,
        "calendarId": prev.calendar_id,
        "calendarName": prev.calendar_name,
        "title": prev.title,
        "prev": {
            "title": prev.title,
            "start": prev.start,
            "end": prev.end,
            "location": prev.location,
            "description": prev.description,
            "calendarId": prev.calendar_id,
        }
    }))
}

pub fn register(reg: &mut services::Registry, app: &AppHandle, dir: &std::path::Path) {
    let saved: Saved = std::fs::read(dir.join("gcal.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    app.manage(GCal { saved: Mutex::new(saved), ..Default::default() });

    let h = app.clone();
    reg.add("pony.gcalState", Box::new(move |_, _| Ok(state(&h))));

    let h = app.clone();
    reg.add("pony.gcalSignIn", Box::new(move |_, _| {
        crate::todosync::google_sign_in(&h);
        Ok(state(&h))
    }));

    let h = app.clone();
    reg.add("pony.gcalCancel", Box::new(move |_, _| {
        crate::todosync::google_cancel_sign_in(&h);
        Ok(state(&h))
    }));

    let h = app.clone();
    reg.add("pony.gcalSignOut", Box::new(move |_, _| {
        crate::todosync::google_sign_out(&h);
        Ok(state(&h))
    }));

    let h = app.clone();
    reg.add("pony.gcalRefresh", Box::new(move |_, _| {
        let h2 = h.clone();
        std::thread::spawn(move || {
            let now = chrono::Utc::now().timestamp_millis();
            let _ = sync_events(&h2, now - 35 * DAY_MS, now + 120 * DAY_MS, true);
            crate::calendar::kick(&h2, false);
        });
        Ok(state(&h))
    }));

    let h = app.clone();
    reg.add("pony.gcalSetCalendars", Box::new(move |_, args| {
        let selected: Vec<String> = args
            .first()
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let default_id = args.get(1).and_then(Value::as_str).map(String::from);
        {
            let g = h.state::<GCal>();
            let mut saved = g.saved.lock().unwrap();
            saved.selected_ids = Some(selected.clone());
            for cal in saved.calendars.iter_mut() {
                cal.selected = selected.iter().any(|x| x == &cal.id);
            }
            if let Some(def) = default_id {
                saved.default_calendar_id = if def.is_empty() { None } else { Some(def) };
            }
        }
        save(&h);
        let snap = tell(&h);
        let h2 = h.clone();
        std::thread::spawn(move || {
            let now = chrono::Utc::now().timestamp_millis();
            let _ = sync_events(&h2, now - 35 * DAY_MS, now + 120 * DAY_MS, false);
            crate::calendar::kick(&h2, false);
        });
        Ok(snap)
    }));

    let h = app.clone();
    reg.add("pony.gcalCreate", Box::new(move |_, args| {
        let req = args.first().cloned().unwrap_or(Value::Null);
        create_event(&h, &req).map_err(anyhow::Error::msg)
    }));

    let h = app.clone();
    reg.add("pony.gcalUpdate", Box::new(move |_, args| {
        let req = args.first().cloned().unwrap_or(Value::Null);
        update_event(&h, &req).map_err(anyhow::Error::msg)
    }));

    let h = app.clone();
    reg.add("pony.gcalDelete", Box::new(move |_, args| {
        let id = args.first().and_then(Value::as_str).unwrap_or("");
        delete_event(&h, id).map_err(anyhow::Error::msg)
    }));
}
