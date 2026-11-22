use serde_json::json;
use services::youtube::{is_browser, lookup_key, pick_tab, video_id};

fn t(u: &str, n: &str) -> (String, String) {
    (u.into(), n.into())
}

#[test]
fn ids_from_watch_mobile_and_short_links() {
    assert_eq!(video_id("https://www.youtube.com/watch?v=VgSWAOb7JTQ&t=40s").as_deref(), Some("VgSWAOb7JTQ"));
    assert_eq!(video_id("https://m.youtube.com/watch?feature=share&v=VgSWAOb7JTQ").as_deref(), Some("VgSWAOb7JTQ"));
    assert_eq!(video_id("https://youtu.be/VgSWAOb7JTQ?si=x").as_deref(), Some("VgSWAOb7JTQ"));
}

#[test]
fn no_id_for_music_shorts_and_others() {
    assert_eq!(video_id("https://music.youtube.com/watch?v=VgSWAOb7JTQ"), None);
    assert_eq!(video_id("https://www.youtube.com/shorts/VgSWAOb7JTQ"), None);
    assert_eq!(video_id("https://www.youtube.com/@dennycaknan"), None);
    assert_eq!(video_id("https://www.youtube.com/watch?v=short"), None);
    assert_eq!(video_id("https://example.com/watch?v=VgSWAOb7JTQ"), None);
}

#[test]
fn pick_matches_tab_title_with_suffix_and_count() {
    let tabs = [
        t("https://www.youtube.com/watch?v=AAAAAAAAAAA", "Other - YouTube"),
        t("https://www.youtube.com/watch?v=VgSWAOb7JTQ", "(3) Denny Caknan - PULUNG (Official Music Video) - YouTube"),
    ];
    assert_eq!(pick_tab(&tabs, "Denny Caknan - PULUNG (Official Music Video)").as_deref(), Some("VgSWAOb7JTQ"));
}

#[test]
fn pick_single_candidate_only_without_a_title() {
    let tabs = [t("https://www.youtube.com/watch?v=VgSWAOb7JTQ", "Something else - YouTube"), t("https://github.com", "GitHub")];
    assert_eq!(pick_tab(&tabs, "").as_deref(), Some("VgSWAOb7JTQ"));
}

#[test]
fn unrelated_video_tab_is_not_picked_while_youtube_music_plays() {
    // (final review I1: YouTube Music plays, one paused youtube.com tab is open elsewhere)
    let tabs = [t("https://music.youtube.com/watch?v=AAAAAAAAAAA", "Pulung - YouTube Music"),
                t("https://www.youtube.com/watch?v=VgSWAOb7JTQ", "Some talk - YouTube")];
    assert_eq!(pick_tab(&tabs, "Pulung"), None);
}

#[test]
fn pick_two_without_match_is_none() {
    let tabs = [t("https://www.youtube.com/watch?v=AAAAAAAAAAA", "A - YouTube"), t("https://www.youtube.com/watch?v=BBBBBBBBBBB", "B - YouTube")];
    assert_eq!(pick_tab(&tabs, "Pulung"), None);
}

#[test]
fn browsers_only() {
    assert!(is_browser("com.brave.Browser") && is_browser("com.apple.Safari"));
    assert!(!is_browser("com.spotify.client") && !is_browser("com.apple.Music"));
}

#[test]
fn key_has_app_title_artist_album() {
    let m = json!({"app": "com.brave.Browser", "title": "Pulung", "artist": "Denny Caknan", "album": ""});
    assert_eq!(lookup_key(&m), "com.brave.Browser|Pulung|Denny Caknan|");
}

#[test]
fn lookup_key_changes_with_title() {
    let a = json!({"app": "com.brave.Browser", "title": "Pulung", "artist": "Denny Caknan", "album": "", "position": 3});
    let b = json!({"app": "com.brave.Browser", "title": "Kartonyono", "artist": "Denny Caknan", "album": "", "position": 3});
    let c = json!({"app": "com.brave.Browser", "title": "Pulung", "artist": "Denny Caknan", "album": "", "position": 90});
    assert_ne!(lookup_key(&a), lookup_key(&b));
    assert_eq!(lookup_key(&a), lookup_key(&c));
}

use services::youtube::{due, parse_tabs};
use std::time::Duration;

#[test]
fn due_on_a_new_song_and_every_5s_while_unfound() {
    let s = Duration::from_secs;
    assert!(due("a", "b", true, false, false, false, s(0))); // another song: always
    assert!(!due("a", "b", true, false, true, true, s(0))); // …unless a lookup is running
    assert!(!due("a", "a", true, true, false, true, s(60))); // found: never again for this song
    assert!(!due("a", "a", false, true, false, true, s(4))); // not found: not before 5 s
    assert!(due("a", "a", false, true, false, true, s(5)));
    assert!(!due("a", "a", false, false, false, true, s(60))); // paused: wait
}

#[test]
fn no_retries_while_the_notch_is_closed() {
    // (final review I3: YouTube Music for hours with the notch closed must not run osascript every 5 s)
    assert!(!due("a", "a", false, true, false, false, Duration::from_secs(60)));
}

#[test]
fn tabs_from_the_script() {
    let tabs = parse_tabs(r#"[["https://www.youtube.com/watch?v=VgSWAOb7JTQ","Pulung - YouTube"],["https://github.com","GitHub"]]"#).unwrap();
    assert_eq!(tabs.len(), 2);
    assert_eq!(tabs[0].1, "Pulung - YouTube");
    assert!(parse_tabs(r#"{"error":"-1743 Not authorized"}"#).is_none());
    assert!(parse_tabs("garbage").is_none());
}

use services::youtube::{avatar_from_page, channel_url};

#[test]
fn channel_from_oembed() {
    let v = json!({"author_name": "Ferry Irwandi", "author_url": "https://www.youtube.com/@ferryirwandi"});
    assert_eq!(channel_url(&v).as_deref(), Some("https://www.youtube.com/@ferryirwandi"));
    assert_eq!(channel_url(&json!({"author_url": "https://evil.example/@x"})), None);
    assert_eq!(channel_url(&json!({})), None);
}

#[test]
fn avatar_is_the_channel_pages_og_image_made_small() {
    let html = r#"<meta property="og:title" content="Ferry Irwandi"><meta property="og:image" content="https://yt3.googleusercontent.com/8wEN-abc=s900-c-k-c0x00ffffff-no-rj">"#;
    assert_eq!(avatar_from_page(html).as_deref(), Some("https://yt3.googleusercontent.com/8wEN-abc=s240-c-k-c0x00ffffff-no-rj"));
    assert_eq!(avatar_from_page(r#"<meta property="og:image" content="https://evil.example/a.png">"#), None);
    assert_eq!(avatar_from_page("<html></html>"), None);
}

use services::youtube::wants_avatar;

#[test]
fn channel_picture_only_when_the_song_has_no_cover() {
    assert!(wants_avatar(&json!({"artwork": null, "arts": 0})));
    assert!(!wants_avatar(&json!({"artwork": "data:image/png;base64,xx", "arts": 1})));
    assert!(!wants_avatar(&json!({"artwork": null, "arts": 1}))); // (the helper is still fetching one)
}
