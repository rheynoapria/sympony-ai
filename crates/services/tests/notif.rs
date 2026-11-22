use serde_json::json;
use services::notif::{parse_record, History};

const DAY: i64 = 86_400_000;

fn record(title: Option<&str>, body: Option<&str>, date: f64) -> Vec<u8> {
    let mut req = plist::Dictionary::new();
    if let Some(t) = title { req.insert("titl".into(), t.into()); }
    if let Some(b) = body { req.insert("body".into(), b.into()); }
    req.insert("subt".into(), "".into());
    let mut d = plist::Dictionary::new();
    d.insert("app".into(), "com.apple.Mail".into());
    d.insert("date".into(), plist::Value::Real(date));
    d.insert("req".into(), plist::Value::Dictionary(req));
    let mut out = vec![];
    plist::to_writer_binary(&mut out, &plist::Value::Dictionary(d)).unwrap();
    out
}

#[test]
fn record_fields() {
    // Cocoa date 800000000 s = 2026-05-09T…; at in Unix ms
    let n = parse_record(&record(Some("Meeting"), Some("At 10"), 800_000_000.0), "com.apple.Mail").unwrap();
    assert_eq!(n.title, "Meeting");
    assert_eq!(n.body, "At 10");
    assert_eq!(n.app_id, "com.apple.Mail");
    assert_eq!(n.at, (800_000_000 + 978_307_200) * 1000);
}

#[test]
fn record_without_text() {
    let n = parse_record(&record(None, None, 1.0), "").unwrap();
    assert_eq!((n.title.as_str(), n.body.as_str(), n.app_id.as_str()), ("", "", "com.apple.Mail")); // the plist's app
    assert!(parse_record(b"not a plist", "x").is_none());
}

fn note(i: i64, at: i64) -> serde_json::Value {
    json!({ "id": i.to_string(), "aumid": "a", "app": "A", "title": format!("t{i}"), "body": "", "at": at })
}

#[test]
fn history_add_prunes_by_max_and_days() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = History::open(dir.path(), [7u8; 32]);
    let now = 100 * DAY;
    h.add(note(1, now - 5 * DAY), now, 3, 200);
    for i in 2..=6 { h.add(note(i, now - 10 + i), now, 3, 4); } // arriving in time order
    let v = h.view();
    let ids: Vec<&str> = v["items"].as_array().unwrap().iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["6", "5", "4", "3"]); // newest first; the 5-day-old one and the oldest past 4 gone
    assert_eq!(v["unseen"], 4);
    assert_eq!(v["items"][0]["read"], false);
}

#[test]
fn read_seen_remove_clear() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = History::open(dir.path(), [7u8; 32]);
    for i in 1..=3 { h.add(note(i, DAY + i), DAY + 10, 3, 200); }
    let rev = h.view()["rev"].as_u64().unwrap();
    h.read("2");
    assert_eq!(h.view()["items"][1]["read"], true);
    assert!(h.view()["rev"].as_u64().unwrap() > rev);
    h.seen();
    assert_eq!(h.view()["unseen"], 0);
    h.remove("1");
    h.read("all");
    assert!(h.view()["items"].as_array().unwrap().iter().all(|i| i["read"] == true));
    assert_eq!(h.view()["items"].as_array().unwrap().len(), 2);
    h.clear();
    assert_eq!(h.view()["items"], json!([]));
}

#[test]
fn history_file_is_encrypted_and_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut h = History::open(dir.path(), [9u8; 32]);
        h.add(note(1, DAY), DAY, 3, 200);
    }
    let raw = std::fs::read_to_string(dir.path().join("notif-history.json")).unwrap();
    // (base64 can hold "t1" by chance; a quote or a field name it can't)
    assert!(raw.starts_with("sy1:") && !raw.contains('"') && !raw.contains("title"));
    let h = History::open(dir.path(), [9u8; 32]);
    assert_eq!(h.view()["items"][0]["title"], "t1");
}

#[test]
fn bad_history_file_starts_fresh() {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut h = History::open(dir.path(), [9u8; 32]);
        h.add(note(1, DAY), DAY, 3, 200);
    }
    let h = History::open(dir.path(), [1u8; 32]); // another key: can't read it
    assert_eq!(h.view()["items"], json!([]));
    // kept aside under a name of its own each time, not lost
    let aside: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.contains("unreadable")).collect();
    assert_eq!(aside.len(), 1);
}

#[test]
fn record_without_a_date_is_now() {
    let mut d = plist::Dictionary::new();
    d.insert("app".into(), "com.x".into());
    let mut req = plist::Dictionary::new();
    req.insert("titl".into(), "Hi".into());
    d.insert("req".into(), plist::Value::Dictionary(req));
    let mut out = vec![];
    plist::to_writer_binary(&mut out, &plist::Value::Dictionary(d)).unwrap();
    let n = parse_record(&out, "").unwrap();
    assert!((n.at - chrono::Utc::now().timestamp_millis()).abs() < 5000);
}

#[test]
fn view_prunes_and_says_its_limits() {
    let dir = tempfile::tempdir().unwrap();
    let mut h = History::open(dir.path(), [7u8; 32]);
    let now = 100 * DAY;
    h.add(note(1, now - 2 * DAY), now - 2 * DAY, 3, 200);
    h.add(note(2, now), now, 3, 200);
    let v = h.view_at(now, 1, 200); // the limit lowered to a day: the old one goes now, not at the next arrival
    assert_eq!(v["items"].as_array().unwrap().len(), 1);
    assert_eq!((v["days"].clone(), v["max"].clone()), (json!(1), json!(200)));
}

#[test]
fn memory_history_never_touches_disk() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("notif-history.json"), "sy1:whatever").unwrap();
    let mut h = History::memory(dir.path());
    h.add(note(1, DAY), DAY, 3, 200);
    assert_eq!(h.view()["items"].as_array().unwrap().len(), 1);
    assert_eq!(std::fs::read_to_string(dir.path().join("notif-history.json")).unwrap(), "sy1:whatever"); // untouched
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

use services::notif::{banner_app, Recent};

#[test]
fn banner_app_is_the_description_before_the_title() {
    assert_eq!(banner_app("Script Editor, AX probe 3, Body three", "AX probe 3"), "Script Editor");
    assert_eq!(banner_app("WhatsApp, Ana, hi, there", "Ana"), "WhatsApp");
    assert_eq!(banner_app("Mail", ""), "Mail");
    assert_eq!(banner_app("", "x"), "");
}

#[test]
fn recent_banners_match_their_database_row_once() {
    let mut r = Recent::default();
    r.add("b:1", "Hi", "there", 1_000);
    assert_eq!(r.take("Hi", "there", 6_000).as_deref(), Some("b:1")); // the db row 5 s later: the banner's
    assert_eq!(r.take("Hi", "there", 7_000), None); // once
    r.add("b:2", "Old", "", 1_000);
    assert_eq!(r.take("Old", "", 120_000), None); // too long ago: a new one
}
