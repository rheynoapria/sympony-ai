use serde_json::{json, Value};
use services::media::{changed, command, from_poll};

fn fx(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap()
}
const NOW: i64 = 1_763_450_000_000;

#[test]
fn browser_song_maps() {
    let m = from_poll(&fx("helper-poll-browser.json"), NOW);
    assert_eq!(m["type"], "media");
    assert_eq!(m["active"], true);
    assert_eq!(m["playing"], true);
    assert_eq!(m["title"], "Hati-Hati di Jalan");
    assert_eq!(m["artist"], "Tulus");
    assert_eq!(m["album"], "Manusia");
    assert_eq!(m["app"], "com.google.Chrome");
    assert_eq!(m["duration"], 242.5);
    assert_eq!(m["position"], 61.25);
    assert_eq!(m["positionUpdated"], NOW);
    assert_eq!(m["canSeek"], true);
    assert_eq!(m["source"], "music");
}

#[test]
fn paused_is_active_not_playing() {
    let m = from_poll(&fx("helper-poll-paused.json"), NOW);
    assert_eq!((m["active"].clone(), m["playing"].clone()), (json!(true), json!(false)));
}

#[test]
fn stopped_is_inactive() {
    let m = from_poll(&fx("helper-poll-nothing.json"), NOW);
    assert_eq!(m["active"], false);
    assert_eq!(m["playing"], false);
    // a helper that answered nothing usable is nothing playing too
    assert_eq!(from_poll(&json!({"error": "boom"}), NOW)["active"], false);
}

#[test]
fn spotify_wins_when_playing() {
    let m = from_poll(&fx("helper-poll-spotify.json"), NOW);
    assert_eq!(m["title"], "Never Gonna Give You Up");
    assert_eq!(m["app"], "com.spotify.client");
    assert_eq!(m["source"], "spotify");
    assert_eq!(m["duration"], 213.573); // Spotify says milliseconds
    assert_eq!(m["artwork"], "https://i.scdn.co/image/ab67616d0000b273abc");
    assert_eq!(m["shuffle"], true);
    assert_eq!(m["canShuffle"], true);
}

#[test]
fn windows_says_which_controls_work() {
    // the system media controls' answer (platform::os::media::poll): a browser tab with no previous song or timeline
    let poll = json!({ "spotify": null, "music": {
        "state": "playing", "id": "Live|Channel|", "title": "Live", "artist": "Channel", "album": "", "app": "Chrome",
        "duration": 0.0, "position": 0.0, "rate": 1.0, "arts": 1, "shuffle": null, "repeat": "list",
        "canShuffle": false, "canRepeat": true, "canPrev": false, "canNext": true, "canSeek": false } });
    let m = from_poll(&poll, NOW);
    assert_eq!((m["app"].clone(), m["source"].clone()), (json!("Chrome"), json!("music")));
    assert_eq!((m["canPrev"].clone(), m["canNext"].clone(), m["canSeek"].clone()), (json!(false), json!(true), json!(false)));
    assert_eq!((m["repeat"].clone(), m["canRepeat"].clone()), (json!("list"), json!(true)));
    // a timeline but the app won't seek
    let mut seekless = poll.clone();
    seekless["music"]["duration"] = json!(200.0);
    assert_eq!(from_poll(&seekless, NOW)["canSeek"], false);
    // the macOS helper says nothing about them: all there
    let m = from_poll(&fx("helper-poll-browser.json"), NOW);
    assert_eq!((m["canPrev"].clone(), m["canNext"].clone(), m["canSeek"].clone()), (json!(true), json!(true), json!(true)));
}

#[test]
fn a_new_position_from_the_app_is_sent_at_once() {
    // Windows tells when the app last gave its position: a new one (a small seek, a stall) is sent although the
    // position moved less than the 2 s a seek needs otherwise
    let poll = |pos: f64, stamp: i64| json!({ "music": { "state": "playing", "title": "Song", "artist": "A", "app": "Chrome",
        "duration": 200.0, "position": pos, "stamp": stamp } });
    let a = from_poll(&poll(50.0, 1_763_449_990_000), NOW);
    assert_eq!(a["positionStamp"], 1_763_449_990_000_i64);
    let same = from_poll(&poll(51.0, 1_763_449_990_000), NOW + 1000);
    assert!(!changed(&a, &same));
    let told = from_poll(&poll(50.6, 1_763_449_999_000), NOW + 1000);
    assert!(changed(&a, &told));
    // the macOS helper gives none: as before
    assert_eq!(from_poll(&fx("helper-poll-browser.json"), NOW)["positionStamp"], Value::Null);
}

#[test]
fn seek_command_shape() {
    assert_eq!(
        command("spotify", 42, "seek", &json!(12.5)),
        json!({"op": "cmd", "app": "spotify", "pid": 42, "action": "seek", "value": 12.5})
    );
}

#[test]
fn same_song_moving_on_time_is_quiet() {
    let a = from_poll(&fx("helper-poll-browser.json"), NOW);
    let mut b = from_poll(&fx("helper-poll-browser.json"), NOW + 1000);
    b["position"] = json!(62.25);
    assert!(!changed(&a, &b));
    b["position"] = json!(120.0); // a seek
    assert!(changed(&a, &b));
    let p = from_poll(&fx("helper-poll-paused.json"), NOW + 1000);
    assert!(changed(&a, &p));
    let n1 = from_poll(&fx("helper-poll-nothing.json"), NOW);
    let n2 = from_poll(&fx("helper-poll-nothing.json"), NOW + 1000);
    assert!(!changed(&n1, &n2));
}

use services::media::{data_url, deezer_cover, deezer_url, itunes_cover, itunes_url};

#[test]
fn itunes_picks_matching_cover() {
    let r = json!({"results": [
        {"trackName": "Hati-Hati di Jalan", "artistName": "Tulus", "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg"}
    ]});
    assert_eq!(
        itunes_cover(&r, "Hati-Hati di Jalan (Official Video)", "TULUS").as_deref(),
        Some("https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg")
    );
    assert_eq!(itunes_cover(&r, "Hati-Hati di Jalan", "Raisa"), None);
    assert!(itunes_url("Tulus", "Hati-Hati di Jalan").starts_with("https://itunes.apple.com/search?media=music&entity=song&limit=8&term=Tulus%20"));
}

#[test]
fn deezer_picks_matching_cover() {
    let r = fx("deezer-search.json");
    assert_eq!(
        deezer_cover(&r, "Hati-Hati di Jalan (Official Video)", "TULUS").as_deref(),
        Some("https://cdn-images.dzcdn.net/images/cover/ec4b98e50b1c776c71774097eb1aee95/1000x1000-000000-80-0-0.jpg")
    );
    assert!(deezer_url("Tulus", "Hati-Hati di Jalan").starts_with("https://api.deezer.com/search?q=Tulus%20Hati-Hati%20di%20Jalan"));
}

#[test]
fn deezer_rejects_other_artist() {
    let r = fx("deezer-search.json");
    assert_eq!(deezer_cover(&r, "Hati-Hati di Jalan", "Raisa"), None);
    assert_eq!(deezer_cover(&json!({"data": []}), "x", "y"), None);
}

#[test]
fn artwork_bytes_become_a_data_url() {
    assert!(data_url(b"\x89PNG\r\n\x1a\nabc").unwrap().starts_with("data:image/png;base64,iVBORw0KGg"));
    assert!(data_url(b"\xff\xd8\xff\xe0abc").unwrap().starts_with("data:image/jpeg;base64,/9j/"));
    assert_eq!(data_url(b""), None);
}

use services::media::{art_key, backoff};

#[test]
fn playing_browser_beats_paused_spotify() {
    let mut p = fx("helper-poll-spotify.json");
    p["spotify"]["state"] = json!("paused");
    let m = from_poll(&p, NOW);
    assert_eq!(m["source"], "music");
    assert_eq!(m["playing"], true);
    // both paused: Spotify still first
    p["music"]["state"] = json!("paused");
    assert_eq!(from_poll(&p, NOW)["source"], "spotify");
}

#[test]
fn art_key_changes_when_the_artist_or_art_arrives() {
    let mut m = from_poll(&fx("helper-poll-browser.json"), NOW);
    m["artist"] = json!(""); // the artist often comes a poll later, with the same id
    let early = art_key(&m);
    m["artist"] = json!("Tulus");
    assert_ne!(art_key(&m), early);
    let with_artist = art_key(&m);
    m["arts"] = json!(0);
    assert_ne!(art_key(&m), with_artist);
}

#[test]
fn helper_backoff_doubles_to_a_minute() {
    let s: Vec<u64> = (1..=7).map(|n| backoff(n).as_secs()).collect();
    assert_eq!(s, vec![2, 4, 8, 16, 32, 60, 60]);
}

#[test]
fn playback_rate_comes_through() {
    // (final review I7: a tab at 2× must not be extrapolated at 1×)
    let mut poll = fx("helper-poll-browser.json");
    poll["music"]["rate"] = json!(2.0);
    assert_eq!(from_poll(&poll, NOW)["rate"], 2.0);
    assert_eq!(from_poll(&fx("helper-poll-browser.json"), NOW)["rate"], 1.0);
}
