//! Now playing: the media helper's poll answer → the frontend's `media` message, and its commands.
use serde_json::{json, Value};

const SPOTIFY: &str = "com.spotify.client";

fn playing_part(p: &Value) -> Option<&Value> {
    let s = p["state"].as_str()?;
    (s != "stopped" && p["title"].as_str().is_some_and(|t| !t.is_empty())).then_some(p)
}

/// What plays wins over what's paused; then Spotify over whatever macOS says is playing.
pub fn from_poll(poll: &Value, now_ms: i64) -> Value {
    let parts = [("spotify", playing_part(&poll["spotify"])), ("music", playing_part(&poll["music"]))];
    let pick = |state: Option<&str>| parts.iter().find_map(|(s, p)| p.filter(|p| state.is_none_or(|st| p["state"] == st)).map(|p| (*s, p)));
    let Some((src, p)) = pick(Some("playing")).or_else(|| pick(None)) else {
        return json!({ "type": "media", "active": false, "playing": false });
    };
    let spotify = src == "spotify";
    // Spotify's AppleScript gives the track length in milliseconds
    let duration = p["duration"].as_f64().unwrap_or(0.0) / if spotify { 1000.0 } else { 1.0 };
    let str_of = |k: &str| p[k].as_str().unwrap_or("").to_string();
    json!({
        "type": "media", "active": true, "playing": p["state"] == "playing", "source": src,
        "id": str_of("id"), "title": str_of("title"), "artist": str_of("artist"), "album": str_of("album"),
        "app": if spotify { SPOTIFY.to_string() } else { str_of("app") },
        "artwork": if spotify && !str_of("art").is_empty() { json!(str_of("art")) } else { Value::Null },
        "arts": p["arts"].as_i64().unwrap_or(0),
        "duration": duration, "position": p["position"].as_f64().unwrap_or(0.0), "positionUpdated": now_ms,
        "rate": p["rate"].as_f64().filter(|r| *r > 0.0).unwrap_or(1.0),
        "shuffle": p["shuffle"], "repeat": p["repeat"],
        "canShuffle": p["canShuffle"].as_bool().unwrap_or(false), "canRepeat": p["canRepeat"].as_bool().unwrap_or(false),
        "canSeek": duration > 0.0,
    })
}

/// Worth sending: anything but the position moved, or the position jumped (a seek) rather than ran on.
pub fn changed(prev: &Value, now: &Value) -> bool {
    let strip = |v: &Value| {
        let mut v = v.clone();
        if let Some(o) = v.as_object_mut() {
            for k in ["position", "positionUpdated"] {
                o.remove(k);
            }
        }
        v
    };
    if strip(prev) != strip(now) {
        return true;
    }
    if now["active"] != true {
        return false;
    }
    let since = (now["positionUpdated"].as_i64().unwrap_or(0) - prev["positionUpdated"].as_i64().unwrap_or(0)) as f64 / 1000.0;
    let expected = prev["position"].as_f64().unwrap_or(0.0) + if now["playing"] == true { since } else { 0.0 };
    (now["position"].as_f64().unwrap_or(0.0) - expected).abs() > 2.0
}

/// What a cover lookup is for: the song, its artist and whether the helper has art. Browsers often send the artist
/// (or the cover) a poll after the title, with the same id: that is a new lookup, not the first one's miss.
pub fn art_key(m: &Value) -> String {
    let (title, artist) = (m["title"].as_str().unwrap_or(""), m["artist"].as_str().unwrap_or(""));
    format!("{}|{title}|{artist}|{}", m["id"].as_str().unwrap_or(""), m["arts"])
}

/// The rest before restarting a helper that failed `streak` times in a row: 2 s, doubling, at most a minute.
pub fn backoff(streak: u32) -> std::time::Duration {
    std::time::Duration::from_secs((2u64 << streak.clamp(1, 6).saturating_sub(1)).min(60))
}

/// The helper's request for a control (play, pause, toggle, next, prev, seek, shuffle, repeat).
pub fn command(source: &str, pid: i64, action: &str, value: &Value) -> Value {
    json!({ "op": "cmd", "app": source, "pid": pid, "action": action, "value": value })
}

/// Lowercase letters and digits only, without "(Official Video)", "[Lyrics]" and the like.
fn norm(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in s.to_lowercase().chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth as i32 - 1).max(0) as usize,
            c if depth == 0 && c.is_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    for w in ["official", "video", "audio", "lyrics", "lyric"] {
        out = out.replace(w, "");
    }
    out
}

fn first_artist(a: &str) -> String {
    let lower = a.to_lowercase();
    let cut = [" feat", " ft.", " ft ", " & ", " and ", " dan ", " x ", " with ", ",", "/"]
        .iter()
        .filter_map(|s| lower.find(s))
        .min()
        .unwrap_or(lower.len());
    norm(&lower[..cut])
}

pub fn itunes_url(artist: &str, title: &str) -> String {
    format!("https://itunes.apple.com/search?media=music&entity=song&limit=8&term={}", crate::http::q(&format!("{artist} {title}")))
}

/// First matching iTunes track cover upgraded to 600×600 (previously ran synchronously inside `media_mac.js`).
pub fn itunes_cover(resp: &Value, title: &str, artist: &str) -> Option<String> {
    let (t, a) = (norm(title), first_artist(artist));
    if t.is_empty() || a.is_empty() {
        return None;
    }
    resp["results"].as_array()?.iter().find_map(|r| {
        let (rt, ra) = (norm(r["trackName"].as_str()?), norm(r["artistName"].as_str()?));
        let ok = (rt.starts_with(&t) || t.starts_with(&rt)) && !rt.is_empty() && (ra.contains(&a) || a.contains(&ra));
        ok.then(|| r["artworkUrl100"].as_str().map(|u| u.replace("100x100bb", "600x600bb"))).flatten()
    })
}

pub fn deezer_url(artist: &str, title: &str) -> String {
    format!("https://api.deezer.com/search?q={}&limit=8", crate::http::q(&format!("{artist} {title}")))
}

/// The first result whose title and (first) artist match loosely: its largest cover.
pub fn deezer_cover(resp: &Value, title: &str, artist: &str) -> Option<String> {
    let (t, a) = (norm(title), first_artist(artist));
    if t.is_empty() || a.is_empty() {
        return None;
    }
    resp["data"].as_array()?.iter().find_map(|r| {
        let (rt, ra) = (norm(r["title"].as_str()?), norm(r["artist"]["name"].as_str()?));
        let ok = (rt.starts_with(&t) || t.starts_with(&rt)) && !rt.is_empty() && (ra.contains(&a) || a.contains(&ra));
        ok.then(|| r["album"]["cover_xl"].as_str().map(String::from)).flatten()
    })
}

/// A cover file's bytes as an `<img>` source.
pub fn data_url(bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let mime = if bytes.starts_with(b"\x89PNG") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8") {
        "jpeg"
    } else if bytes.is_empty() {
        return None;
    } else {
        "jpeg"
    };
    Some(format!("data:image/{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
