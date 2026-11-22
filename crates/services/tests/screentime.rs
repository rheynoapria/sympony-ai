use serde_json::json;
use services::screentime::{category, ScreenTime};

const D1: &str = "2026-11-19";

#[test]
fn counts_seconds_per_app_and_hour() {
    let mut s = ScreenTime::default();
    for _ in 0..90 {
        s.tick("com.google.Chrome", "Google Chrome", D1, 9);
    }
    for _ in 0..30 {
        s.tick("com.microsoft.VSCode", "Code", D1, 10);
    }
    let v = s.summary("today", D1, Some("Code"), &|_| None);
    assert_eq!(v["total"], 120);
    assert_eq!(v["apps"][0], json!({"name": "Google Chrome", "icon": null, "secs": 90}));
    assert_eq!(v["apps"][1]["secs"], 30);
    assert_eq!((v["hours"][9].as_i64(), v["hours"][10].as_i64(), v["hours"].as_array().unwrap().len()), (Some(90), Some(30), 24));
    assert_eq!(v["current"], json!({"name": "Code"}));
}

#[test]
fn switches_counted() {
    let mut s = ScreenTime::default();
    for id in ["a", "a", "b", "b", "a", "c"] {
        s.tick(id, id, D1, 9);
    }
    // a → b → a → c
    assert_eq!(s.summary("today", D1, None, &|_| None)["switches"], 3);
}

#[test]
fn week_sums_days() {
    let mut s = ScreenTime::default();
    s.tick("x", "X", "2026-11-12", 9); // 7 days before: out of the week
    s.tick("x", "X", "2026-11-13", 9);
    s.tick("x", "X", D1, 9);
    s.tick("y", "Y", D1, 20);
    let w = s.summary("week", D1, None, &|_| None);
    assert_eq!((w["total"].as_i64(), w["hours"][9].as_i64()), (Some(3), Some(2)));
    assert_eq!(w["apps"][0], json!({"name": "X", "icon": null, "secs": 2}));
    assert_eq!(s.summary("today", D1, None, &|_| None)["total"], 2);
}

#[test]
fn old_days_dropped() {
    let mut s = ScreenTime::default();
    s.tick("x", "X", "2026-10-01", 9);
    s.tick("x", "X", D1, 9);
    let saved: ScreenTime = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
    assert_eq!(saved.days(), vec![D1.to_string()]);
}

#[test]
fn categories_and_colors() {
    assert_eq!(category("com.google.Chrome"), ("Browsing", "#64d2ff"));
    assert_eq!(category("com.jetbrains.intellij"), ("Development", "#0a84ff"));
    assert_eq!(category("com.tinyspeck.slackmacgap"), ("Communication", "#30d158"));
    assert_eq!(category("com.unknown.thing"), ("Other", "#636366"));
    let mut s = ScreenTime::default();
    s.tick("com.google.Chrome", "Chrome", D1, 9);
    s.tick("com.brave.Browser", "Brave", D1, 9);
    s.tick("com.apple.finder", "Finder", D1, 9);
    let v = s.summary("today", D1, None, &|_| None);
    assert_eq!(v["categories"][0], json!({"name": "Browsing", "color": "#64d2ff", "secs": 2}));
    assert_eq!(v["categories"][1]["name"], "System");
}

#[test]
fn only_the_top_apps_are_sent_with_icons() {
    let mut s = ScreenTime::default();
    for i in 0..12 {
        for _ in 0..=i {
            s.tick(&format!("app{i}"), &format!("App {i}"), D1, 9);
        }
    }
    let asked = std::cell::Cell::new(0);
    let v = s.summary("today", D1, None, &|_| {
        asked.set(asked.get() + 1);
        Some("data:".into())
    });
    // the tab lists 7: only those go, and only their icons are made; the total still counts every app
    assert_eq!((v["apps"].as_array().unwrap().len(), asked.get()), (7, 7));
    assert_eq!(v["apps"][0]["name"], "App 11");
    assert_eq!(v["total"], 78);
}
