use chrono::TimeZone;
use chrono_tz::Asia::Jakarta;
use serde_json::{json, Value};
use services::calendar::{expand_local, parse_ics, Feed};

fn ms(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> i64 {
    Jakarta.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap().timestamp_millis()
}

fn feed() -> Vec<Value> {
    let text = std::fs::read_to_string("tests/fixtures/feed.ics").unwrap();
    let f = Feed { url: "https://x/work.ics".into(), name: "Work".into(), color: "#ff9f0a".into() };
    parse_ics(&text, &f, ms(2026, 11, 1, 0, 0), ms(2027, 1, 1, 0, 0), Jakarta)
}

fn titled<'a>(ev: &'a [Value], t: &str) -> Vec<&'a Value> {
    ev.iter().filter(|e| e["title"] == t).collect()
}

#[test]
fn weekly_with_exdate_until_and_override() {
    let ev = feed();
    let starts: Vec<i64> = titled(&ev, "Stand, up").iter().map(|e| e["start"].as_i64().unwrap()).collect();
    // Mo 16, (We 18 excluded), Fr 20 moved, Mo 23, We 25, Fr 27, Mo 30, We 2, Fr 4 (until 09:00 local)
    assert_eq!(starts, vec![ms(2026, 11, 16, 9, 0), ms(2026, 11, 23, 9, 0), ms(2026, 11, 25, 9, 0), ms(2026, 11, 27, 9, 0), ms(2026, 11, 30, 9, 0), ms(2026, 12, 2, 9, 0), ms(2026, 12, 4, 9, 0)]);
    let moved = titled(&ev, "Stand up (moved)");
    assert_eq!(moved.len(), 1);
    assert_eq!(moved[0]["start"], ms(2026, 11, 20, 10, 0));
    let first = titled(&ev, "Stand, up")[0];
    assert_eq!(first["end"].as_i64().unwrap() - first["start"].as_i64().unwrap(), 15 * 60_000);
    assert_eq!(first["description"], "Line one\nline two that is folded here");
    assert_eq!(first["organizer"], "Ani");
    assert_eq!((first["source"].as_str(), first["color"].as_str(), first["provider"].as_str(), first["uid"].as_str()), (Some("Work"), Some("#ff9f0a"), Some("ics"), Some("standup@x")));
    assert_eq!(first["repeat"], "weekly");
    assert_eq!(first["allDay"], false);
}

#[test]
fn utc_duration_all_day_cancelled_floating() {
    let ev = feed();
    let l = titled(&ev, "Launch");
    // a reminder (VALARM) inside the event doesn't overwrite it
    assert_eq!(l[0]["description"], "Real notes");
    assert_eq!((l[0]["start"].as_i64(), l[0]["end"].as_i64()), (Some(ms(2026, 11, 25, 10, 0)), Some(ms(2026, 11, 25, 12, 0))));
    let h = titled(&ev, "Holiday");
    assert_eq!((h[0]["allDay"].as_bool(), h[0]["start"].as_i64(), h[0]["end"].as_i64()), (Some(true), Some(ms(2026, 12, 1, 0, 0)), Some(ms(2026, 12, 2, 0, 0))));
    assert!(titled(&ev, "Cancelled").is_empty());
    // floating times are local; every 2 days, 3 times
    let g: Vec<i64> = titled(&ev, "Gym").iter().map(|e| e["start"].as_i64().unwrap()).collect();
    assert_eq!(g, vec![ms(2026, 11, 17, 18, 0), ms(2026, 11, 19, 18, 0), ms(2026, 11, 21, 18, 0)]);
    // ids are unique per occurrence
    let mut ids: Vec<&str> = ev.iter().map(|e| e["id"].as_str().unwrap()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), ev.len());
}

#[test]
fn not_ics_is_empty() {
    let f = Feed { url: "u".into(), name: "n".into(), color: "".into() };
    assert!(parse_ics("<html>sign in</html>", &f, 0, i64::MAX / 2, Jakarta).is_empty());
}

#[test]
fn local_events_repeat() {
    let list = json!([
        {"id": "l1", "title": "Pay rent", "start": ms(2026, 10, 31, 9, 0), "end": ms(2026, 10, 31, 9, 30), "location": "", "repeat": "monthly"},
        {"id": "l2", "title": "Once", "start": ms(2026, 11, 20, 13, 0), "end": ms(2026, 11, 20, 14, 0), "location": "Office", "repeat": "none"},
        {"id": "l3", "title": "Old", "start": ms(2026, 1, 1, 9, 0), "end": ms(2026, 1, 1, 10, 0), "repeat": "none"}
    ]);
    let ev = expand_local(&list, ms(2026, 11, 1, 0, 0), ms(2027, 3, 1, 0, 0), Jakarta);
    let rent: Vec<i64> = titled(&ev, "Pay rent").iter().map(|e| e["start"].as_i64().unwrap()).collect();
    // the 31st: months without one are skipped
    assert_eq!(rent, vec![ms(2026, 12, 31, 9, 0), ms(2027, 1, 31, 9, 0)]);
    let once = titled(&ev, "Once");
    assert_eq!((once[0]["provider"].as_str(), once[0]["uid"].as_str(), once[0]["source"].as_str()), (Some("sympony"), Some("l2"), Some("Sympony")));
    assert!(once[0]["repeat"].is_null());
    assert_eq!(titled(&ev, "Pay rent")[0]["repeat"], "monthly");
    assert!(titled(&ev, "Old").is_empty());
}

#[test]
fn old_daily_series_still_shows() {
    let text = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:old@x\r\nSUMMARY:Pills\r\nDTSTART:19600101T080000\r\nDTEND:19600101T081000\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let f = Feed { url: "u".into(), name: "n".into(), color: "".into() };
    let ev = parse_ics(text, &f, ms(2026, 11, 1, 0, 0), ms(2026, 11, 8, 0, 0), Jakarta);
    assert_eq!(ev.len(), 7);
    assert_eq!(ev[0]["start"], ms(2026, 11, 1, 8, 0));
    // the same with a weekly rule
    let text = text.replace("FREQ=DAILY", "FREQ=WEEKLY");
    assert_eq!(parse_ics(&text, &f, ms(2026, 11, 1, 0, 0), ms(2026, 11, 29, 0, 0), Jakarta).len(), 4);
}
