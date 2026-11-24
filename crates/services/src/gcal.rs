//! Pure Google Calendar v3 parsing, event mapping, key generation, and request-body construction.
//! Runs identically on macOS, Windows, and Linux; network calls live in `src-tauri/src/gcal.rs`.
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CalendarItem {
    pub id: String,
    pub summary: String,
    pub color: String,
    pub primary: bool,
    pub access_role: String,
    pub selected: bool,
    pub writable: bool,
}

/// Whether a Google Calendar `accessRole` allows creating, moving, editing, and deleting events.
pub fn can_write(access_role: &str) -> bool {
    matches!(access_role, "owner" | "writer")
}

/// Stable, compact, URL- and LLM-safe key for a Google Calendar event (`gc_<10 hex>`).
/// Matches `[A-Za-z0-9_-]{4,40}` so Pony's action syntax (`|`) and `dropIds` handle it cleanly.
pub fn event_key(calendar_id: &str, event_id: &str) -> String {
    let mut h = Sha256::new();
    h.update(calendar_id.as_bytes());
    h.update(b"\0");
    h.update(event_id.as_bytes());
    let digest = h.finalize();
    let hex: String = digest.iter().take(5).map(|b| format!("{b:02x}")).collect();
    format!("gc_{hex}")
}

/// Formats epoch ms as UTC RFC3339 (`2026-11-24T12:00:00Z`) for Google Calendar query params.
pub fn rfc3339_utc(ms: i64) -> String {
    DateTime::from_timestamp_millis(ms)
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

/// Parses Google Calendar `GET /users/me/calendarList` response into sorted `CalendarItem`s.
/// When `prev_selected` is `None` (first fetch after sign-in), selects calendars marked `primary`
/// or `selected` in Google Calendar (falling back to primary / first calendar if none are marked).
pub fn parse_calendar_list(v: &Value, prev_selected: Option<&[String]>) -> Vec<CalendarItem> {
    let mut out: Vec<CalendarItem> = v["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["deleted"] != true && c["hidden"] != true)
        .filter_map(|c| {
            let id = c["id"].as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let summary = c["summaryOverride"]
                .as_str()
                .or_else(|| c["summary"].as_str())
                .unwrap_or(&id)
                .trim()
                .to_string();
            let color = c["backgroundColor"].as_str().unwrap_or("#4285f4").to_string();
            let primary = c["primary"] == true;
            let access_role = c["accessRole"].as_str().unwrap_or("reader").to_string();
            let writable = can_write(&access_role);
            let selected = match prev_selected {
                Some(ids) => ids.iter().any(|x| x == &id),
                None => primary || c["selected"] == true,
            };
            let summary = if summary.is_empty() { id.clone() } else { summary };
            Some(CalendarItem {
                id,
                summary,
                color,
                primary,
                access_role,
                selected,
                writable,
            })
        })
        .collect();
    out.sort_by(|a, b| b.primary.cmp(&a.primary).then_with(|| a.summary.to_lowercase().cmp(&b.summary.to_lowercase())));
    if prev_selected.is_none() && !out.is_empty() && !out.iter().any(|c| c.selected) {
        out[0].selected = true;
    }
    out
}

/// Picks the best writable calendar for creating new events:
/// 1) `preferred_id` if present, selected, and writable
/// 2) `primary` if selected and writable
/// 3) first selected writable calendar
/// 4) `primary` if writable (even if unchecked)
/// 5) first writable calendar
pub fn default_write_calendar<'a>(calendars: &'a [CalendarItem], preferred_id: Option<&str>) -> Option<&'a CalendarItem> {
    if let Some(pref) = preferred_id.filter(|s| !s.is_empty()) {
        if let Some(c) = calendars.iter().find(|c| c.id == pref && c.selected && c.writable) {
            return Some(c);
        }
    }
    calendars
        .iter()
        .find(|c| c.primary && c.selected && c.writable)
        .or_else(|| calendars.iter().find(|c| c.selected && c.writable))
        .or_else(|| calendars.iter().find(|c| c.primary && c.writable))
        .or_else(|| calendars.iter().find(|c| c.writable))
}

fn parse_day_ms(date: &str, tz: Tz) -> Option<i64> {
    let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    let dt = d.and_time(NaiveTime::from_hms_opt(0, 0, 0)?);
    tz.from_local_datetime(&dt).earliest().map(|t| t.timestamp_millis())
}

fn parse_event_time(v: &Value, tz: Tz) -> Option<(i64, bool)> {
    if let Some(dt) = v["dateTime"].as_str() {
        let parsed = DateTime::parse_from_rfc3339(dt).ok()?;
        return Some((parsed.timestamp_millis(), false));
    }
    if let Some(d) = v["date"].as_str() {
        return Some((parse_day_ms(d, tz)?, true));
    }
    None
}

fn conference_url(ev: &Value) -> Option<String> {
    if let Some(h) = ev["hangoutLink"].as_str().filter(|s| !s.trim().is_empty()) {
        return Some(h.trim().to_string());
    }
    ev["conferenceData"]["entryPoints"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|e| e["entryPointType"] == "video")
        .and_then(|e| e["uri"].as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Parses one Google Calendar event JSON object into Sympony's frontend event shape.
pub fn parse_event(cal: &CalendarItem, ev: &Value, tz: Tz) -> Option<Value> {
    if ev["status"] == "cancelled" {
        return None;
    }
    let event_id = ev["id"].as_str()?.trim();
    if event_id.is_empty() {
        return None;
    }
    let (start, all_day) = parse_event_time(&ev["start"], tz)?;
    let (mut end, _) = parse_event_time(&ev["end"], tz).unwrap_or((start + if all_day { 86_400_000 } else { 3_600_000 }, all_day));
    if end <= start {
        end = start + if all_day { 86_400_000 } else { 1_800_000 };
    }
    let title = ev["summary"].as_str().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("(No title)");
    let gcal_key = event_key(&cal.id, event_id);
    let organizer = ev["organizer"]["displayName"]
        .as_str()
        .or_else(|| ev["organizer"]["email"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let attendees: Vec<String> = ev["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["resource"] != true)
        .filter_map(|a| a["displayName"].as_str().or_else(|| a["email"].as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
    let attendee_count = attendees.len();
    let ical_uid = ev["iCalUID"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let mut obj = json!({
        "id": format!("gcal|{}|{event_id}", cal.id),
        "gcalKey": gcal_key,
        "uid": event_id,
        "calendarId": cal.id,
        "calendarName": cal.summary,
        "writable": cal.writable,
        "title": title,
        "start": start,
        "end": end,
        "allDay": all_day,
        "location": ev["location"].as_str().unwrap_or("").trim(),
        "description": ev["description"].as_str().map(str::trim).filter(|s| !s.is_empty()),
        "url": conference_url(ev),
        "openUrl": ev["htmlLink"].as_str().map(str::trim).filter(|s| !s.is_empty()),
        "organizer": organizer,
        "attendees": attendees.into_iter().take(6).collect::<Vec<_>>(),
        "attendeeCount": attendee_count,
        "color": cal.color,
        "source": cal.summary,
        "provider": "gcal",
        "repeat": if ev["recurringEventId"].is_string() { Some("repeats") } else { None },
    });
    if let Some(iuid) = ical_uid {
        obj["icalUid"] = json!(iuid);
    }
    Some(obj)
}

/// Parses a Google Calendar `events.list` response payload into Sympony events.
pub fn parse_events(cal: &CalendarItem, v: &Value, tz: Tz) -> Vec<Value> {
    v["items"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|ev| parse_event(cal, ev, tz))
        .collect()
}

/// Builds a Google Calendar v3 event body for `POST` (create) or `PATCH` (update/move).
/// Only includes fields that are `Some(...)` so `PATCH` leaves untouched fields intact.
pub fn event_body(
    title: Option<&str>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    location: Option<&str>,
    description: Option<&str>,
    tz: Tz,
) -> Value {
    let mut m = serde_json::Map::new();
    if let Some(t) = title {
        m.insert("summary".into(), json!(t.trim()));
    }
    if let Some(ms) = start_ms {
        if let Some(dt) = DateTime::from_timestamp_millis(ms) {
            m.insert("start".into(), json!({"dateTime": dt.with_timezone(&tz).to_rfc3339(), "timeZone": tz.name()}));
        }
    }
    if let Some(ms) = end_ms {
        if let Some(dt) = DateTime::from_timestamp_millis(ms) {
            m.insert("end".into(), json!({"dateTime": dt.with_timezone(&tz).to_rfc3339(), "timeZone": tz.name()}));
        }
    }
    if let Some(loc) = location {
        m.insert("location".into(), json!(loc.trim()));
    }
    if let Some(desc) = description {
        m.insert("description".into(), json!(desc.trim()));
    }
    Value::Object(m)
}

/// Filters out duplicate read-only events (e.g., from macOS EventKit or ICS feeds) that represent the
/// same calendar item already loaded via Google Calendar OAuth (`provider == "gcal"`).
pub fn filter_duplicates_against_gcal(other_events: Vec<Value>, gcal_events: &[Value]) -> Vec<Value> {
    if gcal_events.is_empty() {
        return other_events;
    }
    let mut seen_uid_start: HashSet<(String, i64)> = HashSet::new();
    let mut seen_title_start: HashSet<(String, i64)> = HashSet::new();
    for g in gcal_events {
        let Some(start) = g["start"].as_i64() else { continue };
        if let Some(u) = g["icalUid"].as_str().filter(|s| !s.is_empty()) {
            seen_uid_start.insert((u.to_string(), start));
        }
        if let Some(u) = g["uid"].as_str().filter(|s| !s.is_empty()) {
            seen_uid_start.insert((u.to_string(), start));
        }
        if let Some(t) = g["title"].as_str().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty()) {
            seen_title_start.insert((t, start));
        }
    }
    other_events
        .into_iter()
        .filter(|e| {
            // Never drop Sympony's own local events
            if e["provider"] == "sympony" {
                return true;
            }
            let Some(start) = e["start"].as_i64() else { return true };
            if let Some(u) = e["uid"].as_str() {
                if seen_uid_start.contains(&(u.to_string(), start)) {
                    return false;
                }
            }
            if let Some(t) = e["title"].as_str().map(|s| s.trim().to_lowercase()) {
                if seen_title_start.contains(&(t, start)) {
                    return false;
                }
            }
            true
        })
        .collect()
}
