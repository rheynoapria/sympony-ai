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

/// Windows: the Chromium browsers whose address bar is read (UI Automation), by the app id they give the system
/// media controls (`Chrome`, or `Chrome.…` for a channel or profile) → their program.
const WINDOWS_BROWSERS: &[(&str, &str)] = &[("Chrome", "chrome.exe"), ("MSEdge", "msedge.exe"), ("Brave", "brave.exe"), ("Vivaldi", "vivaldi.exe")];

pub fn windows_browser(app_id: &str) -> Option<&'static str> {
    WINDOWS_BROWSERS.iter().find(|(id, _)| app_id == *id || app_id.strip_prefix(id).is_some_and(|r| r.starts_with('.'))).map(|(_, exe)| *exe)
}

pub fn is_browser(bundle: &str) -> bool {
    BROWSERS.contains(&bundle) || windows_browser(bundle).is_some()
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

/// A tab's (or a browser window's: "… - YouTube - Google Chrome") title names what's playing.
pub fn names(tab_title: &str, now_title: &str) -> bool {
    let (t, want) = (norm(tab_title), norm(now_title));
    !t.is_empty() && !want.is_empty() && (t.contains(&want) || want.contains(t.as_str()))
}

/// A tab in the browser's tab strip is YouTube playing what's playing: its name names it and is a youtube.com
/// page's ("… - YouTube", then the browser's own notes such as "– Audio playing"), not YouTube Music's.
pub fn youtube_tab(tab_name: &str, now_title: &str) -> bool {
    tab_name.rfind(" - YouTube").is_some_and(|i| {
        let rest = &tab_name[i + " - YouTube".len()..];
        (rest.is_empty() || rest.starts_with(" \u{2013}") || rest.starts_with(" -")) && names(&tab_name[..i], now_title)
    })
}

/// YouTube's search page for a video's title.
pub fn search_url(title: &str) -> String {
    format!("https://www.youtube.com/results?search_query={}", crate::http::q(title))
}

/// YouTube's answer is a page of search results at all (not a consent page, a redirect's end, a "try later"): only
/// then does finding nothing in it mean the video isn't there.
pub fn has_results(html: &str) -> bool {
    html.contains("\"videoRenderer\":")
}

/// Whether to search again for the song after `tries` searches that brought no page of results, the last
/// `since_last` ago: up to 3 a song, 5 s apart.
pub fn search_due(tries: u32, since_last: Option<std::time::Duration>) -> bool {
    tries < 3 && since_last.is_none_or(|d| d >= std::time::Duration::from_secs(5))
}

/// From YouTube's search page: the video with exactly that title (letters and digits compared) from that channel
/// (when it's known); none when no result is it. For a video playing in a tab behind another, whose address can't be
/// read.
pub fn id_from_search(html: &str, title: &str, channel: &str) -> Option<String> {
    let (want, ch) = (norm(title), norm(channel));
    if want.is_empty() {
        return None;
    }
    const KEY: &str = "\"videoRenderer\":";
    let mut at = 0;
    while let Some(i) = html[at..].find(KEY) {
        let start = at + i + KEY.len();
        at = start;
        // (just this result's object, not the whole page)
        let Some(Ok(v)) = serde_json::Deserializer::from_str(&html[start..]).into_iter::<Value>().next() else { continue };
        let (Some(id), Some(t)) = (v["videoId"].as_str().and_then(valid_id), v["title"]["runs"][0]["text"].as_str()) else { continue };
        let owner = norm(v["ownerText"]["runs"][0]["text"].as_str().or(v["longBylineText"]["runs"][0]["text"].as_str()).unwrap_or(""));
        if norm(t) == want && (ch.is_empty() || (!owner.is_empty() && (owner == ch || owner.contains(&ch) || ch.contains(&owner)))) {
            return Some(id);
        }
    }
    None
}

/// From the browser's tabs `(address, title)`: the video of the tab whose title matches what's playing; the only
/// video tab there is only when nothing names what's playing (an unrelated paused tab must not stand in for YouTube
/// Music, Spotify Web… playing in another tab); none when that can't be told.
pub fn pick_tab(tabs: &[(String, String)], now_title: &str) -> Option<String> {
    let videos: Vec<(String, &str)> = tabs.iter().filter_map(|(u, t)| video_id(u).map(|id| (id, t.as_str()))).collect();
    let want = norm(now_title);
    if let Some((id, _)) = videos.iter().find(|(_, t)| names(t, now_title)) {
        return Some(id.clone());
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
    due_every(slot_key, key, has_id, playing, busy, want, since_last, std::time::Duration::from_secs(5))
}

/// `due`, looking again every `every` while the video isn't found (Windows: 2 s, its lookup reads one address bar;
/// a browser names the new video in its window title a moment after Now Playing does).
#[allow(clippy::too_many_arguments)]
pub fn due_every(slot_key: &str, key: &str, has_id: bool, playing: bool, busy: bool, want: bool, since_last: std::time::Duration, every: std::time::Duration) -> bool {
    if busy {
        return false;
    }
    slot_key != key || (!has_id && playing && want && since_last >= every)
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
