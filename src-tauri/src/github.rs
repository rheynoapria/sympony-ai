//! The GitHub tab's pull requests: fetched every 5 minutes while it's on and a token is set, and when those change;
//! sent as `github` when the list changes. A failed fetch keeps the last list, with the error.
use serde_json::{json, Value};
use services::github::{to_items, MINE_Q, REVIEW_Q};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

pub struct Github {
    last: Mutex<Value>,
    kick: Mutex<Sender<()>>,
}

pub fn kick(app: &AppHandle) {
    if let Some(g) = app.try_state::<Github>() {
        let _ = g.kick.lock().unwrap().send(());
    }
}

fn search(token: &str, q: &str) -> Result<Value, String> {
    let url = format!("https://api.github.com/search/issues?per_page=50&q={}", services::http::q(q));
    let auth = format!("Bearer {token}");
    match services::http::get_json_with(&url, &[("Authorization", &auth), ("Accept", "application/vnd.github+json")]) {
        Ok((200, v)) => Ok(v),
        Ok((401, _)) => Err("GitHub didn’t accept the token. Check it in Settings → GitHub.".into()),
        Ok((s, v)) => Err(format!("GitHub answered {s}{}", v["message"].as_str().map(|m| format!(": {m}")).unwrap_or_default())),
        Err(_) => Err("Couldn’t reach GitHub".into()),
    }
}

/// Fetches now; the answer the tab shows.
fn refresh(app: &AppHandle) -> Value {
    let a = app.state::<App>();
    let s = a.settings.get();
    let token = a.settings.secret_value("githubToken").filter(|_| s["githubEnabled"] != false);
    let g = app.state::<Github>();
    let v = match token {
        None => json!({"needsSetup": true, "items": []}),
        Some(t) => {
            let mine = if s["githubIncludeMine"] != false { search(&t, MINE_Q).map(Some) } else { Ok(None) };
            match (search(&t, REVIEW_Q), mine) {
                (Ok(r), Ok(m)) => json!({"items": to_items(&r, m.as_ref()), "updatedAt": chrono::Utc::now().timestamp_millis()}),
                (Err(e), _) | (_, Err(e)) => {
                    let mut last = g.last.lock().unwrap().clone();
                    if !last.is_object() || last["needsSetup"] == true {
                        last = json!({"items": []});
                    }
                    last["error"] = json!(e);
                    last
                }
            }
        }
    };
    let mut last = g.last.lock().unwrap();
    if *last != v {
        *last = v.clone();
        let _ = app.emit("github", &v);
    }
    v
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    let (tx, rx) = channel::<()>();
    app.manage(Github { last: Mutex::new(Value::Null), kick: Mutex::new(tx) });
    let h = app.clone();
    reg.add("github.get", Box::new(move |_, _| {
        let last = h.state::<Github>().last.lock().unwrap().clone();
        Ok(if last.is_null() { refresh(&h) } else { last })
    }));
    let h = app.clone();
    reg.add("github.refresh", Box::new(move |_, _| Ok(refresh(&h))));
    let h = app.clone();
    std::thread::spawn(move || loop {
        // (registered before the app's state is in place)
        while h.try_state::<App>().is_none() {
            std::thread::sleep(Duration::from_millis(200));
        }
        refresh(&h);
        let _ = rx.recv_timeout(Duration::from_secs(5 * 60));
    });
}
