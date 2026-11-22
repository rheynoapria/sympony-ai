//! Lyrics from LRCLIB in the shapes notch.js reads; a hand pick and a timing nudge kept per song in
//! lyrics.json. Romanize and translate use AI.
use crate::http::{get_json, q};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const API: &str = "https://lrclib.net/api";

/// `[mm:ss.xx] text` lines → (ms, text), sorted; a line with several stamps counts at each; tags like `[ar:…]` dropped.
pub fn parse_lrc(lrc: &str) -> Vec<(i64, String)> {
    let mut out = vec![];
    for line in lrc.lines() {
        let mut rest = line.trim();
        let mut stamps = vec![];
        while let Some(end) = rest.strip_prefix('[').and_then(|r| r.find(']')) {
            let tag = &rest[1..end + 1];
            let Some((m, s)) = tag.split_once(':') else { break };
            let (Ok(m), Ok(s)) = (m.parse::<i64>(), s.parse::<f64>()) else { break };
            stamps.push(m * 60_000 + (s * 1000.0).round() as i64);
            rest = &rest[end + 2..];
        }
        let text = rest.trim().to_string();
        out.extend(stamps.into_iter().map(|t| (t, text.clone())));
    }
    out.sort_by_key(|(t, _)| *t);
    out
}

fn strip_brackets(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in s.chars() {
        match c {
            '(' | '[' | '【' => depth += 1,
            ')' | ']' | '】' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A browser's title and artist as a song's: "Artist - Title (Official Video)" by "Artist Official" → (Title, Artist).
/// The dash splits off an artist only when there's none, it is the artist, or the artist is a channel (VEVO, " - Topic",
/// "Official"); else what follows it is a version ("Yesterday - Remastered 2009") and goes.
pub fn clean_title(title: &str, artist: &str) -> (String, String) {
    let t = strip_brackets(title).replace(['–', '—'], "-");
    let t = t.split(" | ").next().unwrap_or("").trim().to_string();
    let mut a = artist.trim().to_string();
    let mut channel = false;
    for w in [" - Topic", " Official", " official", " VEVO", "VEVO"] {
        if let Some(x) = a.strip_suffix(w) {
            a = x.trim().to_string();
            channel = true;
        }
    }
    match t.split_once(" - ") {
        Some((l, r)) if !r.trim().is_empty() => {
            let (l, r) = (l.trim(), r.trim());
            if a.is_empty() || channel || l.eq_ignore_ascii_case(&a) {
                (r.to_string(), if a.is_empty() || channel { l.to_string() } else { a })
            } else {
                (l.to_string(), a)
            }
        }
        _ => (t, a),
    }
}

/// An LRCLIB record → `lyrics.get`'s answer.
pub fn to_get(r: &Value) -> Value {
    let synced = r["syncedLyrics"].as_str().map(parse_lrc).filter(|l| !l.is_empty());
    json!({
        "found": true, "id": r["id"],
        "synced": synced.map(|l| l.into_iter().map(|(t, s)| json!([t, s])).collect::<Vec<_>>()),
        "plain": r["plainLyrics"].as_str().unwrap_or(""), "instrumental": r["instrumental"] == true,
    })
}

fn timed(r: &Value) -> bool {
    r["syncedLyrics"].as_str().is_some_and(|s| !s.trim().is_empty())
}

/// From search results: the timed one nearest the song's length (within 3 s), else an untimed one that near;
/// with the length unknown, the first timed one.
pub fn best(results: &Value, duration: f64) -> Option<&Value> {
    let rs = results.as_array()?;
    let near = |r: &&Value| duration <= 0.0 || (r["duration"].as_f64().unwrap_or(0.0) - duration).abs() <= 3.0;
    let dist = |r: &&Value| ((r["duration"].as_f64().unwrap_or(0.0) - duration).abs() * 1000.0) as i64;
    let pick = |want_timed: bool| rs.iter().filter(near).filter(|r| timed(r) == want_timed).min_by_key(|r| if duration > 0.0 { dist(r) } else { 0 });
    if duration <= 0.0 {
        return rs.iter().find(|r| timed(r)).or(rs.first());
    }
    pick(true).or_else(|| pick(false))
}

/// Search results → the rows Search lyrics lists.
pub fn to_rows(results: &Value) -> Vec<Value> {
    results.as_array().map(|rs| rs.iter().map(|r| {
        let kind = if r["instrumental"] == true { "instrumental" } else if timed(r) { "timed" } else { "plain" };
        let first = r["plainLyrics"].as_str().and_then(|p| p.lines().map(str::trim).find(|l| !l.is_empty())).unwrap_or("");
        json!({ "id": r["id"], "track": r["trackName"], "artist": r["artistName"], "album": r["albumName"],
            "duration": r["duration"], "kind": kind, "first": first })
    }).collect()).unwrap_or_default()
}

/// The session cache's key: the song with its length (an ad's length, then the video's, are two lookups); None
/// with the length unknown (a loose match then isn't kept).
pub fn cache_key(title: &str, artist: &str, duration: f64) -> Option<String> {
    (duration > 0.0).then(|| format!("{}|{}", key(title, artist), duration.round()))
}

/// A song's key for picks and nudges.
pub fn key(title: &str, artist: &str) -> String {
    format!("{}|{}", title.trim().to_lowercase(), artist.trim().to_lowercase())
}

/// lyrics.json: `{picks: {key: id}, shifts: {key: ms}}`.
pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn open(dir: &Path) -> Store {
        Store { path: dir.join("lyrics.json") }
    }
    fn read(&self) -> Value {
        std::fs::read_to_string(&self.path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
    }
    fn write(&self, v: &Value) {
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, v.to_string()).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
    pub fn pick(&self, k: &str) -> Option<i64> {
        self.read()["picks"][k].as_i64()
    }
    pub fn shift(&self, k: &str) -> i64 {
        self.read()["shifts"][k].as_i64().unwrap_or(0)
    }
    pub fn set_pick(&self, k: &str, id: Option<i64>) {
        let mut v = self.read();
        match id {
            Some(id) => v["picks"][k] = json!(id),
            None => {
                if let Some(p) = v["picks"].as_object_mut() {
                    p.remove(k);
                }
            }
        }
        self.write(&v);
    }
    pub fn set_shift(&self, k: &str, ms: i64) {
        let mut v = self.read();
        v["shifts"][k] = json!(ms);
        self.write(&v);
    }
}

// ---- the service
static FOUND: Mutex<Option<HashMap<String, Value>>> = Mutex::new(None); // lookups done this session (none too)

fn arg(args: &[Value], k: &str) -> String {
    args.first().and_then(|a| a[k].as_str()).unwrap_or("").to_string()
}

/// None for "LRCLIB has none" (404, or 400 for a request it won't take, e.g. an hour-long mix), Err for a network problem.
fn fetch(url: &str) -> anyhow::Result<Option<Value>> {
    match get_json(url) {
        Ok(v) => Ok(Some(v)),
        Err(e) if ["HTTP 404", "HTTP 400"].iter().any(|c| e.to_string().contains(c)) => Ok(None),
        Err(e) => Err(e),
    }
}

fn lookup(title: &str, artist: &str, album: &str, duration: f64) -> anyhow::Result<Value> {
    let mut url = format!("{API}/get?track_name={}&artist_name={}", q(title), q(artist));
    if !album.is_empty() {
        url += &format!("&album_name={}", q(album));
    }
    if duration > 0.0 {
        url += &format!("&duration={}", duration.round());
    }
    let got = fetch(&url)?;
    if let Some(r) = got.as_ref().filter(|r| timed(r)) {
        return Ok(to_get(r));
    }
    // /get stops at its first match, which may be untimed while another upload of the song (other album, a
    // second or two off) is timed: search, and keep the untimed one only when no timed one is near the length
    let mut fallback = got;
    let (t, a) = clean_title(title, artist);
    let mut tries = vec![format!("{API}/search?track_name={}&artist_name={}", q(&t), q(&a))];
    if !a.is_empty() {
        tries.push(format!("{API}/search?q={}", q(&format!("{a} {t}"))));
    }
    for u in tries {
        let rs = match fetch(&u) {
            Ok(Some(rs)) => rs,
            Ok(None) => continue,
            Err(e) if fallback.is_none() => return Err(e), // (a network error isn't remembered as "no lyrics")
            Err(_) => break,
        };
        match best(&rs, duration) {
            Some(r) if timed(r) => return Ok(to_get(r)),
            Some(r) if fallback.is_none() => fallback = Some(r.clone()),
            _ => {}
        }
    }
    Ok(fallback.map_or_else(|| json!({ "found": false }), |r| to_get(&r)))
}

fn get(dir: &Path, title: &str, artist: &str, album: &str, duration: f64) -> anyhow::Result<Value> {
    let store = Store::open(dir);
    let k = key(title, artist);
    let mut out = match store.pick(&k) {
        Some(id) => match fetch(&format!("{API}/get/{id}"))? {
            Some(r) => {
                let mut g = to_get(&r);
                g["picked"] = json!(true);
                g
            }
            None => json!({ "found": false }),
        },
        None => {
            let ck = cache_key(title, artist, duration);
            let cached = ck.as_ref().and_then(|c| FOUND.lock().unwrap().get_or_insert_default().get(c).cloned());
            match cached {
                Some(v) => v,
                None => {
                    let v = lookup(title, artist, album, duration)?; // (a network error isn't remembered)
                    if let Some(c) = ck {
                        FOUND.lock().unwrap().get_or_insert_default().insert(c, v.clone());
                    }
                    v
                }
            }
        }
    };
    out["shift"] = json!(store.shift(&k));
    Ok(out)
}

pub fn register(reg: &mut crate::Registry) {
    reg.add("lyrics.get", Box::new(|ctx, args| {
        let d = args.first().and_then(|a| a["duration"].as_f64()).unwrap_or(0.0);
        Ok(get(&ctx.data_dir, &arg(&args, "title"), &arg(&args, "artist"), &arg(&args, "album"), d).unwrap_or_else(|e| {
            (ctx.log)(&format!("lyrics: {e:#}"));
            json!({ "found": false })
        }))
    }));
    reg.add("lyrics.suggest", Box::new(|_, args| {
        let (title, artist) = clean_title(&arg(&args, "title"), &arg(&args, "artist"));
        Ok(json!({ "title": title, "artist": artist }))
    }));
    reg.add("lyrics.search", Box::new(|_, args| {
        let (t, a) = (arg(&args, "title"), arg(&args, "artist"));
        let url = if a.is_empty() { format!("{API}/search?q={}", q(&t)) } else { format!("{API}/search?track_name={}&artist_name={}", q(&t), q(&a)) };
        Ok(match get_json(&url) {
            Ok(rs) => json!({ "ok": true, "results": to_rows(&rs) }),
            Err(e) => json!({ "ok": false, "error": format!("{e:#}"), "busy": e.to_string().contains("HTTP 429") }),
        })
    }));
    reg.add("lyrics.pick", Box::new(|ctx, args| {
        let id = args.first().and_then(|a| a["id"].as_i64()).unwrap_or(0);
        let k = key(&arg(&args, "title"), &arg(&args, "artist"));
        let Some(r) = fetch(&format!("{API}/get/{id}"))? else { return Ok(json!({ "found": false })) };
        let store = Store::open(&ctx.data_dir);
        store.set_pick(&k, Some(id));
        let mut g = to_get(&r);
        g["picked"] = json!(true);
        g["shift"] = json!(store.shift(&k));
        Ok(g)
    }));
    reg.add("lyrics.forget", Box::new(|ctx, args| {
        let (t, a) = (arg(&args, "title"), arg(&args, "artist"));
        Store::open(&ctx.data_dir).set_pick(&key(&t, &a), None);
        let d = args.first().and_then(|x| x["duration"].as_f64()).unwrap_or(0.0);
        Ok(get(&ctx.data_dir, &t, &a, &arg(&args, "album"), d).unwrap_or_else(|_| json!({ "found": false })))
    }));
    reg.add("lyrics.shift", Box::new(|ctx, args| {
        let ms = args.first().and_then(|a| a["ms"].as_i64()).unwrap_or(0).clamp(-60_000, 60_000);
        Store::open(&ctx.data_dir).set_shift(&key(&arg(&args, "title"), &arg(&args, "artist")), ms);
        Ok(Value::Null)
    }));
}
