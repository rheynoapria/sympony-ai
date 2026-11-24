use chrono_tz::Asia::Jakarta;
use serde_json::json;
use services::gcal::*;

#[test]
fn parses_and_sorts_calendar_list_with_defaults_and_saved_selection() {
    let raw = json!({
        "items": [
            {"id": "work@group.calendar.google.com", "summary": "Work", "backgroundColor": "#0b8043", "accessRole": "writer", "selected": true},
            {"id": "hidden@group.calendar.google.com", "summary": "Hidden", "hidden": true, "accessRole": "reader"},
            {"id": "holidays@group.calendar.google.com", "summary": "Holidays", "backgroundColor": "#3f51b5", "accessRole": "reader", "selected": false},
            {"id": "me@gmail.com", "summary": "Personal", "primary": true, "backgroundColor": "#4285f4", "accessRole": "owner", "selected": true}
        ]
    });
    let first = parse_calendar_list(&raw, None);
    assert_eq!(first.len(), 3);
    assert_eq!(first[0].id, "me@gmail.com");
    assert!(first[0].primary && first[0].selected && first[0].writable);
    assert_eq!(first[1].id, "holidays@group.calendar.google.com");
    assert!(!first[1].selected && !first[1].writable);
    assert_eq!(first[2].id, "work@group.calendar.google.com");
    assert!(first[2].selected && first[2].writable);

    // Explicit user selection overrides Google's default flags
    let saved = vec!["work@group.calendar.google.com".to_string()];
    let picked = parse_calendar_list(&raw, Some(&saved));
    assert!(!picked[0].selected);
    assert!(picked[2].selected);
    assert_eq!(default_write_calendar(&picked, None).unwrap().id, "work@group.calendar.google.com");
}

#[test]
fn parses_timed_and_all_day_events_with_stable_keys_and_meet_link() {
    let cal = CalendarItem {
        id: "me@gmail.com".into(),
        summary: "Personal".into(),
        color: "#4285f4".into(),
        primary: true,
        access_role: "owner".into(),
        selected: true,
        writable: true,
    };
    let raw = json!({
        "items": [
            {
                "id": "ev123",
                "iCalUID": "ev123@google.com",
                "status": "confirmed",
                "summary": "Product Sync",
                "start": {"dateTime": "2026-11-25T10:00:00+07:00"},
                "end": {"dateTime": "2026-11-25T11:00:00+07:00"},
                "hangoutLink": "https://meet.google.com/abc-defg-hij",
                "htmlLink": "https://calendar.google.com/event?eid=123",
                "location": "Room A",
                "organizer": {"displayName": "Rheyno"},
                "attendees": [{"displayName": "Alya"}, {"email": "dev@example.com"}]
            },
            {
                "id": "allday1",
                "status": "confirmed",
                "summary": "Company Offsite",
                "start": {"date": "2026-11-26"},
                "end": {"date": "2026-11-27"}
            },
            {
                "id": "gone",
                "status": "cancelled",
                "summary": "Cancelled"
            }
        ]
    });
    let evs = parse_events(&cal, &raw, Jakarta);
    assert_eq!(evs.len(), 2);
    assert_eq!(evs[0]["provider"], "gcal");
    assert_eq!(evs[0]["title"], "Product Sync");
    assert_eq!(evs[0]["url"], "https://meet.google.com/abc-defg-hij");
    assert_eq!(evs[0]["openUrl"], "https://calendar.google.com/event?eid=123");
    assert_eq!(evs[0]["writable"], true);
    assert_eq!(evs[0]["attendeeCount"], 2);
    let key = evs[0]["gcalKey"].as_str().unwrap();
    assert!(key.starts_with("gc_") && key.len() == 13);
    assert_eq!(key, event_key("me@gmail.com", "ev123"));

    assert_eq!(evs[1]["allDay"], true);
    assert_eq!(evs[1]["end"].as_i64().unwrap() - evs[1]["start"].as_i64().unwrap(), 86_400_000);
}

#[test]
fn builds_rfc3339_event_body_and_deduplicates_os_events() {
    let body = event_body(Some("Dentist"), Some(1_795_568_400_000), Some(1_795_572_000_000), Some("Clinic"), None, Jakarta);
    assert_eq!(body["summary"], "Dentist");
    assert_eq!(body["location"], "Clinic");
    assert!(body.get("description").is_none());
    assert_eq!(body["start"]["timeZone"], "Asia/Jakarta");
    assert!(body["start"]["dateTime"].as_str().unwrap().ends_with("+07:00"));

    let gcal = vec![json!({
        "provider": "gcal",
        "uid": "ev123",
        "icalUid": "ev123@google.com",
        "title": "Product Sync",
        "start": 1000
    })];
    let others = vec![
        json!({"provider": "mac", "uid": "ev123@google.com", "title": "Product Sync", "start": 1000}),
        json!({"provider": "google", "uid": "other", "title": "Product Sync", "start": 1000}),
        json!({"provider": "sympony", "uid": "l1", "title": "Product Sync", "start": 1000}),
        json!({"provider": "mac", "uid": "u2", "title": "Lunch", "start": 2000}),
    ];
    let kept = filter_duplicates_against_gcal(others, &gcal);
    assert_eq!(kept.len(), 2);
    assert_eq!(kept[0]["provider"], "sympony");
    assert_eq!(kept[1]["title"], "Lunch");
}
