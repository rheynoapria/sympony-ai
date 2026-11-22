//! The cover for the song playing: from the helper (MediaRemote or Apple Music), else online lookup on Apple iTunes
//! Search (`itunes.apple.com`) then Deezer (`deezer.com`) when Settings allow it (`artOnline`, on by default — applies
//! to browser tracks too so turning `artOnline` off stops all third-party cover lookups). Looked up on its own thread,
//! so a new song shows at once and its cover a moment later; once per song (a miss too), again after a minute on network failure.
use crate::commands::App;
use serde_json::Value;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct Slot {
    key: String,
    art: Value,
    busy: bool,
    retry_at: Option<Instant>,
}

pub fn fill(app: &AppHandle, m: &mut Value) {
    if m["active"] != true || m["artwork"].is_string() {
        return;
    }
    let key = services::media::art_key(m);
    let mut s = crate::media::art_slot(app);
    let retry = s.key == key && !s.busy && s.retry_at.is_some_and(|t| Instant::now() >= t);
    if s.key != key || retry {
        *s = Slot { key: key.clone(), art: Value::Null, busy: true, retry_at: None };
        let (app, song) = (app.clone(), m.clone());
        std::thread::spawn(move || {
            let found = find(&app, &song);
            let mut s = crate::media::art_slot(&app);
            if s.key != key {
                return; // another song by now
            }
            s.busy = false;
            match found {
                Ok(Some(url)) => {
                    s.art = Value::String(url.clone());
                    drop(s);
                    crate::media::art_arrived(&app, &key, url);
                }
                Ok(None) => {}
                Err(()) => s.retry_at = Some(Instant::now() + Duration::from_secs(60)),
            }
        });
    }
    m["artwork"] = s.art.clone();
}

/// Err when the network failed (worth another try later).
fn find(app: &AppHandle, m: &Value) -> Result<Option<String>, ()> {
    let a = app.state::<App>();
    let (title, artist) = (m["title"].as_str().unwrap_or(""), m["artist"].as_str().unwrap_or(""));
    if m["arts"] == 1 {
        let path = a.data_dir.join("helper/art.img");
        let _ = std::fs::remove_file(&path);
        if crate::media::ask_art(app, &path) {
            if let Some(url) = std::fs::read(&path).ok().and_then(|b| services::media::data_url(&b)) {
                return Ok(Some(url));
            }
        }
    }
    if a.settings.bool_or("artOnline", true) && !title.is_empty() && !artist.is_empty() {
        let mut net_err = false;
        match services::http::get_json(&services::media::itunes_url(artist, title)) {
            Ok(r) => {
                if let Some(url) = services::media::itunes_cover(&r, title, artist) {
                    return Ok(Some(url));
                }
            }
            Err(_) => net_err = true,
        }
        match services::http::get_json(&services::media::deezer_url(artist, title)) {
            Ok(r) => {
                if let Some(url) = services::media::deezer_cover(&r, title, artist) {
                    return Ok(Some(url));
                }
            }
            Err(e) => {
                a.log.line(&format!("artwork: Deezer: {e:#}"));
                return Err(());
            }
        }
        if net_err {
            return Err(());
        }
    }
    a.log.line(&format!("artwork: none found for \"{title}\""));
    Ok(None)
}
