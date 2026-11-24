use serde_json::json;
use services::youtube::{id_from_search, is_browser, lookup_key, names, pick_tab, search_url, video_id, windows_browser, youtube_tab};

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
fn windows_browsers_by_their_media_app_id() {
    assert_eq!(windows_browser("Chrome"), Some("chrome.exe"));
    assert_eq!(windows_browser("Chrome.BETA"), Some("chrome.exe"));
    assert_eq!(windows_browser("MSEdge"), Some("msedge.exe"));
    assert!(is_browser("Chrome") && is_browser("MSEdge"));
    // not a browser here: Spotify, Media Player, and macOS bundle ids that merely contain a browser's name
    for id in ["Spotify.exe", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "ChromeCast", "com.google.Chrome", "com.operasoftware.Opera"] {
        assert_eq!(windows_browser(id), None, "{id}");
    }
    assert!(!is_browser("Spotify.exe"));
}

#[test]
fn a_browser_window_title_names_the_video() {
    // Windows reads the address bar of the window whose title (its tab's, then the browser's name) names the video
    let now = "Denny Caknan - PULUNG (Official Music Video)";
    assert!(names("(3) Denny Caknan - PULUNG (Official Music Video) - YouTube - Google Chrome", now));
    assert!(names("Denny Caknan - PULUNG (Official Music Video) - YouTube and 2 more pages - Personal - Microsoft Edge", now));
    assert!(!names("Inbox - Gmail - Google Chrome", now));
    assert!(!names("Anything - Google Chrome", ""));
    let tabs = [t("https://www.youtube.com/watch?v=VgSWAOb7JTQ", "(3) Denny Caknan - PULUNG (Official Music Video) - YouTube - Google Chrome")];
    assert_eq!(pick_tab(&tabs, now).as_deref(), Some("VgSWAOb7JTQ"));
}

#[test]
fn a_tab_behind_is_known_by_its_name_in_the_tab_strip() {
    let now = "Shane Filan - Beautiful In White (Official Video)";
    // Chrome's tab names: the page's title, then its own notes
    assert!(youtube_tab("(74) Shane Filan - Beautiful In White (Official Video) - YouTube \u{2013} Audio playing - Memory usage - 784 MB", now));
    assert!(youtube_tab("Shane Filan - Beautiful In White (Official Video) - YouTube", now));
    // YouTube Music, another site, another video: no
    assert!(!youtube_tab("Beautiful In White - YouTube Music \u{2013} Audio playing", "Beautiful In White"));
    assert!(!youtube_tab("Shane Filan - Beautiful In White (Official Video) - Spotify", now));
    assert!(!youtube_tab("Westlife - Swear It Again - YouTube", now));
}

// YouTube's search page in short: results as `"videoRenderer":{…}` inside the page's data
const SEARCH: &str = r#"<script>var ytInitialData = {"contents":[{"videoRenderer":{"videoId":"4U13TPI5G2o","title":{"runs":[{"text":"Shane Filan - Beautiful In White - Lirik dan Terjemahan"}]},"ownerText":{"runs":[{"text":"beNing"}]}}},{"videoRenderer":{"videoId":"Trjrj_fQnIM","title":{"runs":[{"text":"Shane Filan - Beautiful In White (Official Video)"}]},"ownerText":{"runs":[{"text":"Re-uploads"}]}}},{"videoRenderer":{"videoId":"06-XXOTP3Gc","title":{"runs":[{"text":"Shane Filan - Beautiful In White (Official Video)"}]},"ownerText":{"runs":[{"text":"Shane Filan"}]}}}]};</script>"#;

#[test]
fn search_finds_the_video_with_that_title_from_that_channel() {
    let title = "Shane Filan - Beautiful In White (Official Video)";
    // the same title from another channel isn't it
    assert_eq!(id_from_search(SEARCH, title, "Shane Filan").as_deref(), Some("06-XXOTP3Gc"));
    // no channel known: the first with that exact title
    assert_eq!(id_from_search(SEARCH, title, "").as_deref(), Some("Trjrj_fQnIM"));
    // only a lyrics video, or nothing: none
    assert_eq!(id_from_search(SEARCH, "Shane Filan - Beautiful In White (Live)", "Shane Filan"), None);
    assert_eq!(id_from_search("<html>no results</html>", title, "Shane Filan"), None);
    assert_eq!(id_from_search(SEARCH, title, "Someone Else"), None);
    assert!(search_url("A & B").starts_with("https://www.youtube.com/results?search_query=A"));
}

#[test]
fn a_page_without_results_is_tried_again_not_taken_for_no_video() {
    use services::youtube::{has_results, search_due};
    use std::time::Duration;
    assert!(has_results(SEARCH));
    // a consent page, the end of a redirect loop, an error page: not "the video isn't there"
    assert!(!has_results("<html><form action=\"https://consent.youtube.com/save\"></form></html>"));
    // first try at once; then 5 s apart; 3 tries a song
    assert!(search_due(0, None));
    assert!(!search_due(1, Some(Duration::from_secs(2))));
    assert!(search_due(1, Some(Duration::from_secs(5))));
    assert!(!search_due(3, Some(Duration::from_secs(60))));
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
    // (Windows looks again sooner)
    assert!(!services::youtube::due_every("a", "a", false, true, false, true, s(1), s(2)));
    assert!(services::youtube::due_every("a", "a", false, true, false, true, s(2), s(2)));
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
