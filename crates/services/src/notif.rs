//! Other apps' notifications: a macOS usernoted record or a Windows toast → a note, and the history (newest first,
//! read/unseen, pruned by days and count), kept encrypted in notif-history.json (AES-256-GCM).
use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const COCOA_EPOCH: i64 = 978_307_200; // 2001-01-01 in Unix seconds
const DAY_MS: i64 = 86_400_000;

pub struct Note {
    pub app_id: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
    pub at: i64, // Unix ms
    /// what the app asked to be given back when it's clicked (a Windows toast's `launch`; none on macOS)
    pub launch: String,
}

/// A `record.data` binary plist `{app, date, req: {titl, subt, body}}`; `app_id` from the `app` table wins.
pub fn parse_record(data: &[u8], app_id: &str) -> Option<Note> {
    let v: plist::Value = plist::from_bytes(data).ok()?;
    let d = v.as_dictionary()?;
    let req = d.get("req").and_then(|r| r.as_dictionary());
    let text = |k: &str| req.and_then(|r| r.get(k)).and_then(|s| s.as_string()).unwrap_or("").trim().to_string();
    let date = d.get("date").and_then(|x| {
        x.as_real().or_else(|| x.as_signed_integer().map(|i| i as f64)).or_else(|| {
            x.as_date().map(|t| std::time::SystemTime::from(t).duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64() - COCOA_EPOCH as f64).unwrap_or(0.0))
        })
    });
    let app = if app_id.is_empty() { d.get("app").and_then(|a| a.as_string()).unwrap_or("").to_string() } else { app_id.to_string() };
    // (no date, or none that makes sense: it came now)
    let at = date.filter(|d| *d > 0.0).map(|d| (d as i64 + COCOA_EPOCH) * 1000).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    Some(Note { app_id: app, title: text("titl"), subtitle: text("subt"), body: text("body"), at, launch: String::new() })
}

/// A Windows toast's XML (the payload in Windows' notification database): the first binding's texts, the first one
/// the title and the rest the body (a line each), an attribution text (`placement="attribution"`, a browser's site)
/// as the subtitle, and the toast's `launch`, handed back to its app when it's clicked. None when it isn't a toast.
pub fn parse_toast(xml: &[u8], app_id: &str, at: i64) -> Option<Note> {
    use quick_xml::events::{BytesStart, Event};
    use quick_xml::XmlVersion;
    let attr = |e: &BytesStart, name: &str| -> String {
        e.try_get_attribute(name).ok().flatten().and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok().map(|v| v.into_owned())).unwrap_or_default()
    };
    let mut r = quick_xml::Reader::from_str(std::str::from_utf8(xml).ok()?);
    let (mut toast, mut launch, mut bindings) = (false, String::new(), 0);
    let (mut texts, mut attribution) = (Vec::<String>::new(), String::new());
    // inside a text: whether it's the attribution, and what it says so far
    let mut text: Option<(bool, String)> = None;
    loop {
        match r.read_event().ok()? {
            Event::Start(e) | Event::Empty(e) if e.name().as_ref() == "toast" => {
                toast = true;
                launch = attr(&e, "launch");
            }
            Event::Start(e) if e.name().as_ref() == "binding" => bindings += 1,
            Event::Start(e) if e.name().as_ref() == "text" && bindings == 1 => text = Some((attr(&e, "placement") == "attribution", String::new())),
            Event::Text(t) => {
                if let Some((_, s)) = text.as_mut() {
                    s.push_str(&t.xml10_content());
                }
            }
            Event::GeneralRef(g) => {
                if let Some((_, s)) = text.as_mut() {
                    let name = g.xml10_content();
                    match g.resolve_char_ref().ok().flatten() {
                        Some(c) => s.push(c),
                        None => s.push_str(match name.as_ref() {
                            "amp" => "&",
                            "lt" => "<",
                            "gt" => ">",
                            "quot" => "\"",
                            "apos" => "'",
                            _ => "",
                        }),
                    }
                }
            }
            Event::End(e) if e.name().as_ref() == "text" => {
                if let Some((is_attribution, s)) = text.take() {
                    let s = s.trim().to_string();
                    if is_attribution {
                        attribution = s;
                    } else if !s.is_empty() {
                        texts.push(s);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !toast {
        return None;
    }
    let mut texts = texts.into_iter();
    let title = texts.next().unwrap_or_default();
    let body = texts.collect::<Vec<_>>().join("\n");
    Some(Note { app_id: app_id.to_string(), title, subtitle: attribution, body, at, launch })
}

pub struct History {
    /// None: kept in memory only (its key couldn't be had: the file is left alone)
    path: Option<PathBuf>,
    key: [u8; 32],
    items: Vec<Value>,
    unseen: u64,
    rev: u64,
}

impl History {
    /// Reads the file; one that can't be read (another key, damaged) is kept aside as `.unreadable` and a fresh
    /// history starts.
    pub fn open(dir: &Path, key: [u8; 32]) -> History {
        let path = dir.join("notif-history.json");
        let mut h = History { path: Some(path.clone()), key, items: vec![], unseen: 0, rev: chrono::Utc::now().timestamp_millis() as u64 };
        if let Ok(raw) = std::fs::read(&path) {
            match std::str::from_utf8(&raw).ok().and_then(|r| h.decrypt(r)) {
                Some(v) => {
                    h.items = v["items"].as_array().cloned().unwrap_or_default();
                    h.unseen = v["unseen"].as_u64().unwrap_or(0);
                }
                None => {
                    // each one kept under a name of its own (another key may still open it)
                    let _ = std::fs::rename(&path, dir.join(format!("notif-history.{}.unreadable", chrono::Utc::now().timestamp_millis())));
                }
            }
        }
        h
    }

    /// A history that is never written (nor its file moved): when the Keychain can't give its key.
    pub fn memory(_dir: &Path) -> History {
        History { path: None, key: [0; 32], items: vec![], unseen: 0, rev: chrono::Utc::now().timestamp_millis() as u64 }
    }

    fn decrypt(&self, raw: &str) -> Option<Value> {
        let bytes = base64::engine::general_purpose::STANDARD.decode(raw.trim().strip_prefix("sy1:")?).ok()?;
        if bytes.len() < 12 {
            return None;
        }
        let plain = Aes256Gcm::new_from_slice(&self.key).ok()?.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).ok()?;
        serde_json::from_slice(&plain).ok()
    }

    fn save(&mut self) {
        self.rev += 1;
        let Some(path) = self.path.clone() else { return };
        let Ok(cipher) = Aes256Gcm::new_from_slice(&self.key) else { return };
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let plain = json!({ "items": self.items, "unseen": self.unseen }).to_string();
        let Ok(ct) = cipher.encrypt(&nonce, plain.as_bytes()) else { return };
        let mut out = nonce.to_vec();
        out.extend(ct);
        let text = format!("sy1:{}", base64::engine::general_purpose::STANDARD.encode(out));
        let _ = crate::paths::write_private(&path, text.as_bytes());
    }

    /// A shown notification (`{id, aumid, app, title, body, at}`, `dnd: true` when Do not disturb held it back),
    /// unread, on top; older than `days` or past `max` go.
    pub fn add(&mut self, mut n: Value, now: i64, days: i64, max: usize) {
        n["read"] = json!(false);
        n["dnd"] = json!(n["dnd"] == true);
        self.items.insert(0, n);
        self.unseen += 1;
        let cutoff = now - days.clamp(1, 90) * DAY_MS;
        self.items.retain(|i| i["at"].as_i64().unwrap_or(0) >= cutoff);
        self.items.truncate(max.clamp(1, 1000));
        self.unseen = self.unseen.min(self.items.len() as u64);
        self.save();
    }

    /// `{items, unseen, rev}`.
    pub fn view(&self) -> Value {
        json!({ "items": self.items, "unseen": self.unseen, "rev": self.rev })
    }

    /// For notif.history: pruned to the limits now (they may have been lowered), with them (`days`, `max`).
    pub fn view_at(&mut self, now: i64, days: i64, max: usize) -> Value {
        let n = self.items.len();
        let cutoff = now - days.clamp(1, 90) * DAY_MS;
        self.items.retain(|i| i["at"].as_i64().unwrap_or(0) >= cutoff);
        self.items.truncate(max.clamp(1, 1000));
        if self.items.len() != n {
            self.unseen = self.unseen.min(self.items.len() as u64);
            self.save();
        }
        let mut v = self.view();
        v["days"] = json!(days);
        v["max"] = json!(max);
        v
    }

    /// `{unseen, rev}` for the notif:history event.
    pub fn summary(&self) -> Value {
        json!({ "unseen": self.unseen, "rev": self.rev })
    }

    pub fn read(&mut self, id: &str) {
        for i in self.items.iter_mut().filter(|i| id == "all" || i["id"].as_str() == Some(id)) {
            i["read"] = json!(true);
        }
        self.save();
    }

    pub fn remove(&mut self, id: &str) {
        self.items.retain(|i| i["id"].as_str() != Some(id));
        self.unseen = self.unseen.min(self.items.len() as u64);
        self.save();
    }

    pub fn seen(&mut self) {
        self.unseen = 0;
        self.save();
    }

    /// A banner's item learns its app's bundle id from the database row (for its icon and opening it).
    pub fn set_app(&mut self, id: &str, aumid: &str) {
        let mut hit = false;
        for i in self.items.iter_mut().filter(|i| i["id"].as_str() == Some(id) && i["aumid"].as_str().is_none_or(str::is_empty)) {
            i["aumid"] = json!(aumid);
            hit = true;
        }
        if hit {
            self.save();
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.unseen = 0;
        self.save();
    }
}

/// A fresh random key for the history (kept in the Keychain as base64).
pub fn new_key() -> [u8; 32] {
    use aes_gcm::aead::rand_core::RngCore;
    let mut k = [0u8; 32];
    OsRng.fill_bytes(&mut k);
    k
}

/// The app's name in a banner's accessibility description ("<app>, <title>, <subtitle>, <body>").
pub fn banner_app(description: &str, title: &str) -> String {
    let d = description.trim();
    if !title.is_empty() {
        if let Some(i) = d.find(&format!(", {title}")) {
            return d[..i].trim().to_string();
        }
    }
    d.split(", ").next().unwrap_or("").trim().to_string()
}

/// Banners shown the moment they appeared, waiting for their usernoted row (written seconds later) so it isn't
/// shown twice: matched by title and body within a minute, once.
#[derive(Default)]
pub struct Recent {
    items: Vec<(String, String, String, i64)>, // (id, title, body, at)
}

impl Recent {
    pub fn add(&mut self, id: &str, title: &str, body: &str, at: i64) {
        self.items.retain(|i| at - i.3 < 60_000);
        self.items.push((id.into(), title.into(), body.into(), at));
    }

    /// The banner's id this row was, if one.
    pub fn take(&mut self, title: &str, body: &str, now: i64) -> Option<String> {
        self.items.retain(|i| now - i.3 < 60_000);
        let k = self.items.iter().position(|i| i.1 == title && i.2 == body)?;
        Some(self.items.remove(k).0)
    }
}
