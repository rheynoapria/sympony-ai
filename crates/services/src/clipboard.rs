//! Clipboard history (pure): pinned ones first, then newest; the limit doesn't count pins; the same copy again moves
//! up. Colour codes get `color` ("#rrggbb" or "rgba(r, g, b, a)", as the frontend checks it).
use serde_json::{json, Value};

/// How much of a copied text is kept (characters; `len` still says how long it was): every copy rewrites and sends
/// the whole history.
pub const KEEP: usize = 20_000;

pub fn text_item(text: &str, id: &mut dyn FnMut() -> String, now: i64) -> Value {
    let kept: String = text.chars().take(KEEP).collect();
    let mut v = json!({"id": id(), "kind": if crate::shelf::is_link(text) { "link" } else { "text" }, "text": kept,
        "len": text.chars().count(), "pinned": false, "at": now});
    if let Some(c) = color(text) {
        v["color"] = json!(c);
    }
    v
}

/// What makes two copies the same: an image's hash, else its text.
fn key(v: &Value) -> &Value {
    if v["hash"].is_string() { &v["hash"] } else { &v["text"] }
}

fn order(list: &mut [Value]) {
    list.sort_by(|a, b| (b["pinned"] == true).cmp(&(a["pinned"] == true)).then(b["at"].as_i64().cmp(&a["at"].as_i64())));
}

/// Adds a copy (or moves the same one up, its id and pin kept); returns what fell off the end (its image to delete).
pub fn push(list: &mut Vec<Value>, item: Value, max: usize) -> Vec<Value> {
    if let Some(old) = list.iter_mut().find(|x| key(x) == key(&item) && x["kind"] == item["kind"]) {
        old["at"] = item["at"].clone();
    } else {
        list.push(item);
    }
    order(list);
    trim(list, max)
}

/// Drops the oldest unpinned ones over `max`; returns them.
pub fn trim(list: &mut Vec<Value>, max: usize) -> Vec<Value> {
    let mut n = 0;
    let mut gone = vec![];
    list.retain(|x| {
        if x["pinned"] == true {
            return true;
        }
        n += 1;
        if n > max {
            gone.push(x.clone());
            false
        } else {
            true
        }
    });
    gone
}

pub fn pin(list: &mut [Value], id: &str, on: bool) {
    if let Some(x) = list.iter_mut().find(|x| x["id"] == id) {
        x["pinned"] = json!(on);
    }
    order(list);
}

/// Takes one out; returns it.
pub fn remove(list: &mut Vec<Value>, id: &str) -> Option<Value> {
    let i = list.iter().position(|x| x["id"] == id)?;
    Some(list.remove(i))
}

/// All but the pinned; returns what went.
pub fn clear(list: &mut Vec<Value>) -> Vec<Value> {
    let (keep, gone) = std::mem::take(list).into_iter().partition(|x| x["pinned"] == true);
    *list = keep;
    gone
}

fn alpha(a: f64) -> String {
    // (rounded first: 0.9996 is 1, 0.0001 is 0)
    let r = (a * 1000.0).round() / 1000.0;
    if r <= 0.0 { "0".into() } else if r >= 1.0 { "1".into() } else {
        let s = format!("{:.3}", r);
        s.trim_start_matches('0').trim_end_matches('0').to_string()
    }
}

/// A colour code alone: #rgb, #rrggbb, #rrggbbaa, rgb(), rgba().
pub fn color(text: &str) -> Option<String> {
    let t = text.trim().to_ascii_lowercase();
    if let Some(h) = t.strip_prefix('#') {
        if !h.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let full = match h.len() {
            3 => h.chars().flat_map(|c| [c, c]).collect::<String>(),
            6 | 8 => h.to_string(),
            _ => return None,
        };
        let b = |i: usize| u8::from_str_radix(&full[i..i + 2], 16).ok();
        return if full.len() == 6 { Some(format!("#{full}")) } else { Some(format!("rgba({}, {}, {}, {})", b(0)?, b(2)?, b(4)?, alpha(b(6)? as f64 / 255.0))) };
    }
    let inner = t.strip_prefix("rgba(").or_else(|| t.strip_prefix("rgb("))?.strip_suffix(')')?;
    let parts: Vec<&str> = inner.split(',').map(str::trim).collect();
    let c: Vec<u8> = parts.iter().take(3).map(|p| p.parse::<u8>().ok()).collect::<Option<_>>()?;
    match parts.len() {
        3 => Some(format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])),
        4 => {
            let a: f64 = parts[3].parse().ok().filter(|a: &f64| (0.0..=1.0).contains(a))?;
            Some(format!("rgba({}, {}, {}, {})", c[0], c[1], c[2], alpha(a)))
        }
        _ => None,
    }
}
