//! YouTube video mode: which browsers are asked, the video id in a tab's address, and which tab
//! is the one playing.
use serde_json::Value;

/// The browsers whose tabs are read (AppleScript): Chromium ones and Safari.
pub const BROWSERS: &[&str] = &[
    "com.brave.Browser",
    "com.google.Chrome",
    "com.microsoft.edgemac",
    "company.thebrowser.Browser",
    "com.vivaldi.Vivaldi",
    "com.operasoftware.Opera",
    "com.apple.Safari",
];

pub fn is_browser(bundle: &str) -> bool {
    BROWSERS.contains(&bundle)
}

/// Safari names a tab's title `name`, the Chromium browsers `title`.
pub fn is_safari(bundle: &str) -> bool {
    bundle == "com.apple.Safari"
}

fn valid_id(s: &str) -> Option<String> {
    (s.len() == 11 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')).then(|| s.to_string())
}

/// The video id in a youtube.com watch address (www, m) or a youtu.be link; none for YouTube Music, Shorts and
/// anything else (YouTube Music stays the music view).
pub fn video_id(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let (host, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (path, query) = path.split_once('?').unwrap_or((path, ""));
    match host {
        "youtu.be" => valid_id(path.split('/').next().unwrap_or("")),
        "youtube.com" | "www.youtube.com" | "m.youtube.com" if path == "watch" => {
            query.split(['&', '#']).find_map(|kv| kv.strip_prefix("v=")).and_then(valid_id)
        }
        _ => None,
    }
}

/// A tab title or Now Playing title reduced for comparing: no "(3) " unread count, no " - YouTube", letters and
/// digits only, lowercase.
fn norm(s: &str) -> String {
    let s = s.trim();
    let s = match s.strip_prefix('(').and_then(|r| r.split_once(") ")) {
        Some((n, r)) if !n.is_empty() && n.chars().all(|c| c.is_ascii_digit() || c == '+') => r,
        _ => s,
    };
    let s = s.strip_suffix(" - YouTube").unwrap_or(s);
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// From the browser's tabs `(address, title)`: the video of the tab whose title matches what's playing; the only
/// video tab there is only when nothing names what's playing (an unrelated paused tab must not stand in for YouTube
/// Music, Spotify Web… playing in another tab); none when that can't be told.
pub fn pick_tab(tabs: &[(String, String)], now_title: &str) -> Option<String> {
    let videos: Vec<(String, String)> = tabs.iter().filter_map(|(u, t)| video_id(u).map(|id| (id, norm(t)))).collect();
    let want = norm(now_title);
    if !want.is_empty() {
        if let Some((id, _)) = videos.iter().find(|(_, t)| !t.is_empty() && (t.contains(&want) || want.contains(t.as_str()))) {
            return Some(id.clone());
        }
    }
    match videos.as_slice() {
        [(id, _)] if want.is_empty() => Some(id.clone()),
        _ => None,
    }
}

/// The song as far as the lookup cares: a new one means a new lookup (browsers change their Now Playing id every
/// few seconds, so it isn't used).
pub fn lookup_key(m: &Value) -> String {
    let s = |k: &str| m[k].as_str().unwrap_or("").to_string();
    format!("{}|{}|{}|{}", s("app"), s("title"), s("artist"), s("album"))
}

/// Whether to look the playing browser's tabs up now: for a new song at once, and while its video isn't found
/// (the player page may be opened later) every 5 s while it plays and the open notch shows Music (`want`); one
/// lookup at a time.
pub fn due(slot_key: &str, key: &str, has_id: bool, playing: bool, busy: bool, want: bool, since_last: std::time::Duration) -> bool {
    if busy {
        return false;
    }
    slot_key != key || (!has_id && playing && want && since_last >= std::time::Duration::from_secs(5))
}

/// The channel's picture is worth fetching: the song has no cover and none is on its way from the helper.
pub fn wants_avatar(m: &Value) -> bool {
    m["artwork"].is_null() && m["arts"] != 1
}

/// helper/yt_tabs.js's answer → `(address, title)` per tab; None for its `{"error": …}` or anything else.
pub fn parse_tabs(out: &str) -> Option<Vec<(String, String)>> {
    serde_json::from_str::<Vec<(String, String)>>(out.trim()).ok()
}

/// The channel's address from YouTube's oEmbed answer (`author_url`), only a youtube.com one.
pub fn channel_url(oembed: &Value) -> Option<String> {
    oembed["author_url"].as_str().filter(|u| u.starts_with("https://www.youtube.com/")).map(String::from)
}

/// The channel's profile picture from its page (`og:image`, on YouTube's picture hosts), asked for at 240 px: the
/// cover for a video with no album art.
pub fn avatar_from_page(html: &str) -> Option<String> {
    let tag = r#"<meta property="og:image" content=""#;
    let start = html.find(tag)? + tag.len();
    let url = &html[start..start + html[start..].find('"')?];
    if !(url.starts_with("https://yt3.googleusercontent.com/") || url.starts_with("https://yt3.ggpht.com/")) {
        return None;
    }
    Some(match url.rfind("=s") {
        Some(i) if url[i + 2..].starts_with(|c: char| c.is_ascii_digit()) => {
            let digits = url[i + 2..].chars().take_while(char::is_ascii_digit).count();
            format!("{}=s240{}", &url[..i], &url[i + 2 + digits..])
        }
        _ => url.to_string(),
    })
}
