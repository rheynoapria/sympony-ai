//! The Shelf (pure): where files are and bits of text, kept in `shelf.json` (nothing copied). The app adds what each
//! item looks like now (`view`) and its thumbnail.
use serde_json::{json, Value};

/// A lone http(s) address (no spaces): a link.
pub fn is_link(t: &str) -> bool {
    let t = t.trim();
    (t.starts_with("http://") || t.starts_with("https://")) && t.len() > 8 && !t.chars().any(char::is_whitespace)
}

/// Adds files (`{kind: file, path, from?}`) and texts (`{kind: text, text}`, a lone address becomes a link) at the
/// end; what's there already isn't added again.
pub fn add(list: &mut Vec<Value>, items: &[Value], id: &mut dyn FnMut() -> String, now: i64) {
    for it in items {
        let mut e = match it["kind"].as_str() {
            Some("file") => match it["path"].as_str().filter(|p| !p.is_empty()) {
                Some(p) if !list.iter().any(|x| x["path"] == p) => json!({"kind": "file", "path": p}),
                _ => continue,
            },
            Some("text") | Some("link") => match it["text"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                Some(t) if !list.iter().any(|x| x["text"] == t) => json!({"kind": if is_link(t) { "link" } else { "text" }, "text": t}),
                _ => continue,
            },
            _ => continue,
        };
        let mut v = json!({"id": id()});
        for (k, x) in e.as_object_mut().unwrap().iter_mut() {
            v[k] = x.take();
        }
        if it["from"] == "phone" {
            v["from"] = json!("phone");
        }
        v["at"] = json!(now);
        list.push(v);
    }
}

const PHOTO: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tif", "tiff"];

pub fn is_photo(path: &str) -> bool {
    std::path::Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| PHOTO.contains(&e.to_ascii_lowercase().as_str()))
}

/// An item as the Shelf shows it: `stat` is the file's (is a folder, size) now, None when it's gone.
pub fn view(e: &Value, stat: Option<(bool, u64)>) -> Value {
    let mut v = e.clone();
    match e["kind"].as_str() {
        Some("file") => {
            let p = e["path"].as_str().unwrap_or("");
            v["name"] = json!(std::path::Path::new(p).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string()));
            let dir = stat.is_some_and(|s| s.0);
            v["photo"] = json!(!dir && is_photo(p));
            v["isDir"] = json!(dir);
            v["size"] = match stat { Some((false, n)) => json!(n), _ => Value::Null };
            v["missing"] = json!(stat.is_none());
        }
        Some("link") => {
            let t = e["text"].as_str().unwrap_or("");
            let host = t.split("://").nth(1).unwrap_or(t).split(['/', '?', '#']).next().unwrap_or(t);
            v["name"] = json!(host.trim_start_matches("www."));
        }
        _ => {
            let t = e["text"].as_str().unwrap_or("");
            let line = t.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
            v["name"] = json!(if line.chars().count() > 60 { format!("{}…", line.chars().take(60).collect::<String>()) } else { line.to_string() });
        }
    }
    if let Some(o) = v.as_object_mut() {
        o.remove("at");
    }
    v
}

/// `name`, or "name 2.ext", "name 3.ext"… the first not `taken` (a zip, a copy or a conversion beside the original).
pub fn unique_name(name: &str, taken: &dyn Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (2..).map(|n| format!("{stem} {n}{ext}")).find(|n| !taken(n)).unwrap()
}
