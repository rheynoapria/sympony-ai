//! Internet radio (pure): a Radio Browser station as the Radio tab shows it, the song from a stream's ICY title, the
//! Mac's region, favourites and recent.
use serde_json::{json, Value};

/// An http(s) address with nothing that could leave an HTML attribute (pages put a logo in `<img src="…">`).
fn http(u: &str) -> bool {
    (u.starts_with("http://") || u.starts_with("https://")) && !u.chars().any(|c| c.is_whitespace() || c.is_control() || "\"'<>`\\".contains(c))
}

/// A station from Radio Browser's JSON (None: no id or no http(s) address to play).
pub fn station(v: &Value) -> Option<Value> {
    let id = v["stationuuid"].as_str().filter(|s| !s.is_empty())?;
    let url = v["url_resolved"].as_str().filter(|u| http(u)).or(v["url"].as_str().filter(|u| http(u)))?;
    let tags: Vec<&str> = v["tags"].as_str().unwrap_or("").split(',').map(str::trim).filter(|t| !t.is_empty()).take(3).collect();
    Some(json!({
        "id": id, "name": v["name"].as_str().unwrap_or("").trim(), "url": url,
        "favicon": v["favicon"].as_str().filter(|f| http(f)).unwrap_or(""),
        "tags": tags.join(", "), "codec": v["codec"].as_str().unwrap_or(""), "bitrate": v["bitrate"].as_u64().unwrap_or(0),
        "country": v["countrycode"].as_str().unwrap_or(""), "hls": v["hls"].as_u64().unwrap_or(0) == 1,
    }))
}

/// `StreamTitle='…';` from an ICY metadata block (None when empty).
pub fn icy_title(block: &[u8]) -> Option<String> {
    // (UTF-8, else Latin-1: older stations send that)
    let s: String = match std::str::from_utf8(block) {
        Ok(s) => s.to_string(),
        Err(_) => block.iter().map(|&b| b as char).collect(),
    };
    let start = s.find("StreamTitle='")? + "StreamTitle='".len();
    let rest = &s[start..];
    let end = rest.find("';").unwrap_or(rest.trim_end_matches('\0').len());
    Some(rest[..end].trim().to_string()).filter(|t| !t.is_empty())
}

/// The region of `defaults read -g AppleLocale` ("en_ID" → "ID"; none: "").
pub fn region(locale: &str) -> String {
    let base = locale.split('@').next().unwrap_or("");
    base.rsplit_once('_').map(|(_, r)| r.to_string()).filter(|r| r.len() == 2 && r.chars().all(|c| c.is_ascii_uppercase())).unwrap_or_default()
}

/// Starred, or not any more.
pub fn fav(favs: &mut Vec<Value>, s: &Value) {
    if let Some(i) = favs.iter().position(|x| x["id"] == s["id"]) {
        favs.remove(i);
    } else {
        favs.push(s.clone());
    }
}

/// Played: first in Recent (once), 20 kept.
pub fn played(recent: &mut Vec<Value>, s: &Value) {
    recent.retain(|x| x["id"] != s["id"]);
    recent.insert(0, s.clone());
    recent.truncate(20);
}
