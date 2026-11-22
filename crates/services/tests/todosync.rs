use chrono::TimeZone;
use chrono_tz::Asia::Jakarta;
use serde_json::{json, Value};
use services::todosync::{guard, plan, Link, Remote, Snap};

const NOW: i64 = 1_795_000_000_000;

fn at(d: u32, h: u32) -> i64 {
    Jakarta.with_ymd_and_hms(2026, 11, d, h, 0, 0).unwrap().timestamp_millis()
}
fn r(id: &str, title: &str, done: bool, day: Option<&str>) -> Remote {
    Remote { id: id.into(), title: title.into(), done, day: day.map(String::from), deleted: false }
}
fn snap(text: &str, done: bool, day: Option<&str>) -> Snap {
    Snap { text: text.into(), done, day: day.map(String::from) }
}
fn link(l: &str, rid: &str, s: Snap) -> Link {
    Link { local: l.into(), remote: rid.into(), snap: s }
}
fn by_id<'a>(items: &'a [Value], id: &str) -> &'a Value {
    items.iter().find(|i| i["id"] == id).unwrap()
}

#[test]
fn first_sync_links_same_names() {
    let local = vec![json!({"id": "a", "text": "Buy milk", "done": false, "created": 1})];
    let p = plan(&local, &[r("g1", "Buy milk", false, None)], &[], Jakarta, NOW);
    assert!(p.create.is_empty() && p.update.is_empty() && p.delete.is_empty());
    assert_eq!(p.items.len(), 1);
    assert_eq!((p.links[0].local.as_str(), p.links[0].remote.as_str()), ("a", "g1"));
}

#[test]
fn new_each_side() {
    let local = vec![json!({"id": "a", "text": "Here", "done": false, "created": 1, "due": at(20, 14)})];
    let p = plan(&local, &[r("g1", "There", false, Some("2026-11-21"))], &[], Jakarta, NOW);
    assert_eq!(p.create, vec![("a".to_string(), snap("Here", false, Some("2026-11-20")))]);
    let added = p.items.iter().find(|i| i["text"] == "There").unwrap();
    // a day from Google lands at 09:00 here; linked to its task
    assert_eq!((added["due"].as_i64(), added["done"].as_bool()), (Some(at(21, 9)), Some(false)));
    assert!(p.links.iter().any(|l| l.remote == "g1" && l.local == added["id"].as_str().unwrap()));
}

#[test]
fn field_changes_both_ways() {
    let s = snap("Old", false, None);
    let local = vec![json!({"id": "a", "text": "New name", "done": false, "created": 1})];
    // the name changed here, done there: both kept
    let p = plan(&local, &[r("g1", "Old", true, None)], &[link("a", "g1", s)], Jakarta, NOW);
    assert_eq!(p.update, vec![("g1".to_string(), snap("New name", true, None))]);
    let a = by_id(&p.items, "a");
    assert_eq!((a["text"].as_str(), a["done"].as_bool(), a["doneAt"].as_i64()), (Some("New name"), Some(true), Some(NOW)));
    assert_eq!(p.links[0].snap, snap("New name", true, None));
    // both changed the name: this Mac wins
    let p = plan(&local, &[r("g1", "Theirs", false, None)], &[link("a", "g1", snap("Old", false, None))], Jakarta, NOW);
    assert_eq!(p.update[0].1.text, "New name");
}

#[test]
fn deletes_both_ways() {
    let s = snap("X", false, None);
    // trashed here → deleted there
    let local = vec![json!({"id": "a", "text": "X", "done": false, "created": 1, "deletedAt": 5})];
    let p = plan(&local, &[r("g1", "X", false, None)], &[link("a", "g1", s.clone())], Jakarta, NOW);
    assert_eq!(p.delete, vec!["g1".to_string()]);
    assert!(p.links.is_empty());
    // missing from the store without having been trashed (an old page saved over the sync): not a delete there —
    // unlinked and brought back here
    let p = plan(&[], &[r("g1", "X", false, None)], &[link("a", "g1", s.clone())], Jakarta, NOW);
    assert!(p.delete.is_empty());
    assert_eq!((p.items.len(), p.links.len()), (1, 1));
    // gone there → to the trash here, not created again
    let local = vec![json!({"id": "a", "text": "X", "done": false, "created": 1})];
    let p = plan(&local, &[], &[link("a", "g1", s)], Jakarta, NOW);
    assert_eq!(by_id(&p.items, "a")["deletedAt"], NOW);
    assert!(p.create.is_empty() && p.links.is_empty());
}

#[test]
fn due_day_keeps_local_time() {
    let local = vec![json!({"id": "a", "text": "X", "done": false, "created": 1, "due": at(20, 14)})];
    let s = snap("X", false, Some("2026-11-20"));
    // the same day there: the 14:00 here stays
    let p = plan(&local, &[r("g1", "X", false, Some("2026-11-20"))], &[link("a", "g1", s.clone())], Jakarta, NOW);
    assert!(p.update.is_empty());
    assert_eq!(by_id(&p.items, "a")["due"], at(20, 14));
    // moved to the 22nd there: the day moves, the time stays
    let p = plan(&local, &[r("g1", "X", false, Some("2026-11-22"))], &[link("a", "g1", s.clone())], Jakarta, NOW);
    assert_eq!(by_id(&p.items, "a")["due"], at(22, 14));
    // the day cleared there: no due time here
    let p = plan(&local, &[r("g1", "X", false, None)], &[link("a", "g1", s)], Jakarta, NOW);
    assert!(by_id(&p.items, "a").get("due").is_none());
}

#[test]
fn completed_remote_not_imported() {
    let p = plan(&[], &[r("g1", "Old done thing", true, None), Remote { deleted: true, ..r("g2", "Gone", false, None) }], &[], Jakarta, NOW);
    assert!(p.items.is_empty() && p.links.is_empty());
}

#[test]
fn rebase_keeps_edits_made_during_the_sync() {
    use services::todosync::rebase;
    let before = vec![json!({"id": "a", "text": "A", "done": false}), json!({"id": "b", "text": "B", "done": false})];
    // the sync: a renamed from Google, c imported
    let planned = vec![json!({"id": "a", "text": "A2", "done": false}), json!({"id": "b", "text": "B", "done": false}), json!({"id": "c", "text": "C", "done": false})];
    // meanwhile here: b ticked, d added
    let now = vec![json!({"id": "a", "text": "A", "done": false}), json!({"id": "b", "text": "B", "done": true, "doneAt": 9}), json!({"id": "d", "text": "D", "done": false})];
    let out = rebase(&before, &planned, &now);
    let ids: Vec<&str> = out.iter().map(|i| i["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["a", "b", "d", "c"]);
    assert_eq!(out[0]["text"], "A2");
    assert_eq!((out[1]["done"].as_bool(), out[1]["doneAt"].as_i64()), (Some(true), Some(9)));
}

#[test]
fn first_sync_matches_done_with_done() {
    // a repeating task leaves Done copies of the same name: the active one in Google links to the active one here
    let local = vec![json!({"id": "old", "text": "Take pill", "done": true, "created": 1}), json!({"id": "now", "text": "Take pill", "done": false, "created": 2})];
    let p = plan(&local, &[r("g1", "Take pill", false, None)], &[], Jakarta, NOW);
    let l = p.links.iter().find(|l| l.remote == "g1").unwrap();
    assert_eq!(l.local, "now");
    assert!(p.update.iter().all(|(id, s)| id != "g1" || !s.done));
}

#[test]
fn done_in_google_repeats_here() {
    // every day at 08:00; ticked off in Google: done here, and the next one comes as todoDone makes it
    let rep = json!({"days": [0, 1, 2, 3, 4, 5, 6], "time": "08:00"});
    let local = vec![json!({"id": "a", "text": "Pill", "done": false, "created": 1, "due": at(20, 8), "repeat": rep})];
    let s = snap("Pill", false, Some("2026-11-20"));
    let p = plan(&local, &[r("g1", "Pill", true, Some("2026-11-20"))], &[link("a", "g1", s.clone())], Jakarta, at(20, 9));
    let a = by_id(&p.items, "a");
    assert_eq!((a["done"].as_bool(), a.get("repeat").is_none(), a["repeated"].as_bool()), (Some(true), true, Some(true)));
    let next = p.items.iter().find(|i| i["id"] != "a").unwrap();
    assert_eq!((next["done"].as_bool(), next["due"].as_i64(), next["repeat"].clone()), (Some(false), Some(at(21, 8)), rep));
    // the new one goes to Google too
    assert_eq!(p.create.len(), 1);
    // the day cleared in Google doesn't take a repeating task's time away
    let p = plan(&local, &[r("g1", "Pill", false, None)], &[link("a", "g1", s)], Jakarta, NOW);
    assert_eq!(by_id(&p.items, "a")["due"], at(20, 8));
}

#[test]
fn guard_stops_mass_changes() {
    let links: Vec<Link> = (0..10).map(|i| link(&format!("l{i}"), &format!("g{i}"), snap("x", false, None))).collect();
    let mut p = plan(&[], &[], &[], Jakarta, NOW);
    p.delete = (0..6).map(|i| format!("g{i}")).collect();
    assert!(guard(&p, &links, &[]).is_err());
    p.delete = vec!["g1".into()];
    assert!(guard(&p, &links, &[]).is_ok());
    // more than half the linked tasks to the trash here: stopped too
    let before: Vec<Value> = (0..10).map(|i| json!({"id": format!("l{i}"), "text": "x", "done": false})).collect();
    let mut p = plan(&[], &[], &[], Jakarta, NOW);
    p.items = before.iter().map(|i| { let mut i = i.clone(); i["deletedAt"] = json!(NOW); i }).collect();
    assert!(guard(&p, &links, &before).is_err());
    // a small list may change wholly (3 or fewer)
    let few = &links[..2];
    let mut p = plan(&[], &[], &[], Jakarta, NOW);
    p.delete = vec!["g0".into(), "g1".into()];
    assert!(guard(&p, few, &[]).is_ok());
}
