use serde_json::json;

#[test]
fn a_station_from_radio_browser() {
    use services::radio::station;
    let s = station(&json!({"stationuuid": "u1", "name": " Koplo ", "url": "http://a", "url_resolved": "https://b", "favicon": "https://f.png",
        "tags": "pop,dangdut,indonesia,hits", "codec": "AAC", "bitrate": 64, "countrycode": "ID", "hls": 0})).unwrap();
    assert_eq!(s, json!({"id": "u1", "name": "Koplo", "url": "https://b", "favicon": "https://f.png", "tags": "pop, dangdut, indonesia",
        "codec": "AAC", "bitrate": 64, "country": "ID", "hls": false}));
    // no address, no id, or not http(s): left out
    assert!(station(&json!({"stationuuid": "u", "name": "x", "url_resolved": ""})).is_none());
    assert!(station(&json!({"name": "x", "url_resolved": "http://a"})).is_none());
    assert!(station(&json!({"stationuuid": "u", "name": "x", "url_resolved": "file:///etc/passwd"})).is_none());
    // a favicon that isn't http(s) isn't kept
    assert_eq!(station(&json!({"stationuuid": "u", "name": "x", "url_resolved": "http://a", "favicon": "javascript:x"})).unwrap()["favicon"], "");
}

#[test]
fn the_song_from_the_streams_title() {
    use services::radio::icy_title;
    assert_eq!(icy_title(b"StreamTitle='Raisa - Kali Kedua';StreamUrl='';"), Some("Raisa - Kali Kedua".into()));
    assert_eq!(icy_title(b"StreamTitle='';"), None);
    assert_eq!(icy_title(b"StreamTitle='It's me';\0\0\0"), Some("It's me".into()));
    assert_eq!(icy_title(b"nothing"), None);
}

#[test]
fn the_macs_region() {
    use services::radio::region;
    assert_eq!(region("en_ID"), "ID");
    assert_eq!(region("en_ID@calendar=gregorian"), "ID");
    assert_eq!(region("id"), "");
    assert_eq!(region("zh-Hans_CN"), "CN");
}

#[test]
fn favourites_and_recent() {
    use services::radio::{fav, played};
    let a = json!({"id": "a", "name": "A"});
    let b = json!({"id": "b", "name": "B"});
    let mut favs = vec![];
    fav(&mut favs, &a);
    fav(&mut favs, &b);
    fav(&mut favs, &a);
    assert_eq!(favs, vec![b.clone()]);
    let mut recent = vec![];
    for i in 0..25 {
        played(&mut recent, &json!({"id": format!("s{i}")}));
    }
    played(&mut recent, &json!({"id": "s10"}));
    assert_eq!(recent.len(), 20);
    assert_eq!(recent[0]["id"], "s10");
    assert_eq!(recent.iter().filter(|s| s["id"] == "s10").count(), 1);
}

#[test]
fn speed_test_maths() {
    use services::speedtest::*;
    let (ping, jitter) = ping_stats(&[20.0, 22.0, 18.0, 30.0, 21.0]);
    assert_eq!(ping, 21.0); // the median
    assert!((jitter - 6.75).abs() < 1e-9); // mean change between pings: (2+4+12+9)/4
    assert_eq!(mbps(1_000_000, 1.0), 8.0);
    assert_eq!(colo("8f1a2b3c4d5e6f70-SIN"), Some("SIN".into()));
    assert_eq!(colo("nope"), None);
    assert_eq!(server_ms("cfRequestDuration;dur=12.5"), Some(12.5));
    // the next size: bigger while each took under ~3 s, and never over the cap
    assert_eq!(next_size(&[100_000, 1_000_000, 10_000_000, 25_000_000], 0, 0.2, 0), Some(1_000_000));
    assert_eq!(next_size(&[100_000, 1_000_000, 10_000_000, 25_000_000], 1, 3.5, 0), None);
    assert_eq!(next_size(&[100_000, 1_000_000, 10_000_000, 25_000_000], 3, 0.5, 0), None);
    assert_eq!(next_size(&[100_000, 1_000_000, 10_000_000, 25_000_000], 2, 0.5, 70_000_000), None);
}

#[test]
fn a_logo_address_cant_break_out() {
    use services::radio::station;
    let s = |f: &str| station(&json!({"stationuuid": "u", "name": "x", "url_resolved": "http://a", "favicon": f})).unwrap()["favicon"].clone();
    assert_eq!(s("https://x/a.png\" onerror=\"alert(1)"), "");
    assert_eq!(s("https://x/a b.png"), "");
    assert_eq!(s("https://x/<a>.png"), "");
    assert_eq!(s("https://x/a'.png"), "");
    assert_eq!(s("https://x/a.png?v=1&s=2"), "https://x/a.png?v=1&s=2");
    // and a stream address with a quote or space isn't played
    assert!(station(&json!({"stationuuid": "u", "name": "x", "url_resolved": "http://a/\"x"})).is_none());
}

#[test]
fn icy_titles_in_latin_1() {
    use services::radio::icy_title;
    assert_eq!(icy_title(b"StreamTitle='Caf\xe9 del Mar';"), Some("Café del Mar".into()));
}

#[test]
fn the_next_size_only_when_it_would_finish_soon() {
    use services::speedtest::{next_size, server_ms};
    let sizes = [100_000, 1_000_000, 10_000_000, 25_000_000];
    // 1 MB in 2.9 s (~2.8 Mbps): 10 MB would take ~29 s, so it stops here
    assert_eq!(next_size(&sizes, 1, 2.9, 1_100_000), None);
    // 1 MB in 0.5 s: 10 MB ~5 s, fine
    assert_eq!(next_size(&sizes, 1, 0.5, 1_100_000), Some(10_000_000));
    // the whole ladder fits the cap
    assert_eq!(next_size(&sizes, 2, 0.5, 11_100_000), Some(25_000_000));
    assert_eq!(server_ms("cfRequestDuration;dur=12.5, cfL4;desc=\"?proto=TCP\""), Some(12.5));
}
