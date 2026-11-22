use serde_json::{json, Value};
use services::lyrics::{best, clean_title, key, parse_lrc, to_get, to_rows, Store};

fn fx(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}

#[test]
fn lrc_lines_sorted_in_ms() {
    let l = parse_lrc("[00:13.24] Perjalanan\n[01:02.5]Dua\n\n[ar:Tulus]\n[00:00.00] ");
    assert_eq!(l, vec![(0, String::new()), (13240, "Perjalanan".into()), (62500, "Dua".into())]);
}

#[test]
fn lrc_multi_stamps() {
    let l = parse_lrc("[00:10.00][00:30.00] Chorus\n[00:20.000] Verse");
    assert_eq!(l, vec![(10000, "Chorus".into()), (20000, "Verse".into()), (30000, "Chorus".into())]);
}

#[test]
fn suggest_splits_artist_dash_title() {
    assert_eq!(clean_title("TULUS - Hati-Hati di Jalan (Official Music Video)", "TULUS Official"), ("Hati-Hati di Jalan".into(), "TULUS".into()));
    assert_eq!(clean_title("Hati-Hati di Jalan [Lirik]", "Tulus"), ("Hati-Hati di Jalan".into(), "Tulus".into()));
    assert_eq!(clean_title("Monokrom", "Tulus - Topic"), ("Monokrom".into(), "Tulus".into()));
}

#[test]
fn get_shape() {
    let g = to_get(&fx("lrclib-get.json"));
    assert_eq!(g["found"], true);
    assert_eq!(g["id"], 2998875);
    assert_eq!(g["synced"][0], json!([13240, "Perjalanan membawamu"]));
    assert!(g["plain"].as_str().unwrap().starts_with("Perjalanan membawamu"));
    assert_eq!(g["instrumental"], false);
}

#[test]
fn best_prefers_timed_near_duration() {
    let s = fx("lrclib-search.json");
    assert_eq!(best(&s, 261.5).unwrap()["id"], 9030179);
    assert_eq!(best(&s, 242.0).unwrap()["id"], 2998875);
    assert!(best(&s, 600.0).is_none()); // nothing near: none rather than another version's timing
    assert!(best(&s, 0.0).is_some()); // length unknown: the first timed one
}

#[test]
fn rows_shape() {
    let r = to_rows(&fx("lrclib-search.json"));
    assert_eq!(r[0], json!({"id": 2998875, "track": "Hati-Hati di Jalan", "artist": "Tulus", "album": "Manusia", "duration": 242.0, "kind": "timed", "first": "Perjalanan membawamu"}));
}

#[test]
fn picks_and_shifts_persist() {
    let dir = tempfile::tempdir().unwrap();
    let k = key("Hati-Hati di Jalan", "TULUS");
    assert_eq!(k, key("hati-hati di jalan", "Tulus"));
    {
        let s = Store::open(dir.path());
        s.set_pick(&k, Some(9030179));
        s.set_shift(&k, -500);
    }
    let s = Store::open(dir.path());
    assert_eq!(s.pick(&k), Some(9030179));
    assert_eq!(s.shift(&k), -500);
    s.set_pick(&k, None);
    assert_eq!(Store::open(dir.path()).pick(&k), None);
}

use services::lyrics::cache_key;

#[test]
fn player_titles_with_a_dash_keep_their_artist() {
    assert_eq!(clean_title("Yesterday - Remastered 2009", "The Beatles"), ("Yesterday".into(), "The Beatles".into()));
    assert_eq!(clean_title("Tulus – Monokrom", ""), ("Monokrom".into(), "Tulus".into())); // en dash, no artist
    assert_eq!(clean_title("tulus - Monokrom (Live)", "TULUS"), ("Monokrom".into(), "TULUS".into())); // left is the artist
}

#[test]
fn cache_key_follows_the_length_and_skips_unknown() {
    // an ad's length first, then the video's: two lookups, not the ad's "none" for the video
    assert_ne!(cache_key("A", "B", 15.0), cache_key("A", "B", 240.0));
    assert_eq!(cache_key("A", "B", 240.2), cache_key("a", "b", 239.8));
    assert_eq!(cache_key("A", "B", 0.0), None); // a loose match for an unknown length isn't kept
}
