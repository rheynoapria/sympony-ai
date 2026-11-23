//! To-do sync with Google Tasks (Settings → Todo → Sync with). Sign-in through the browser (services::oauth), the
//! refresh token in the secrets file, the account, list and links in `todosync.json`. A thread syncs every 5 minutes
//! and 5 s after the Todo store changes; `todosync` goes out with the state whenever it changes.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use services::todosync::{plan, rebase, Link, Remote, Snap};
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;

const API: &str = "https://tasks.googleapis.com/tasks/v1";
const REFRESH: &str = "todoSyncGoogleRefresh";

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default)]
struct Saved {
    account: String,
    list: Option<Value>, // {id, name}
    links: Vec<Link>,
    last: i64,
    /// bumped by sign-in/out and a list picked: a sync that began before writes nothing
    #[serde(skip)]
    gen: u64,
}

#[derive(Default)]
pub struct Sync {
    saved: Mutex<Saved>,
    token: Mutex<Option<(String, Instant)>>, // access token, valid until
    signing_in: AtomicBool,
    cancel: AtomicBool,
    syncing: AtomicBool,
    force: AtomicBool, // Sync now: past the guard
    error: Mutex<String>,
    kick: Mutex<Option<Sender<()>>>,
}

/// Sympony's own Google client (built in from `.signing/oauth.env` by install.sh), else the one pasted in Settings.
fn client(app: &AppHandle) -> Option<(String, String, bool)> {
    if let (Some(id), Some(secret)) = (option_env!("SYMPONY_GOOGLE_CLIENT_ID"), option_env!("SYMPONY_GOOGLE_CLIENT_SECRET")) {
        if !id.is_empty() {
            return Some((id.into(), secret.into(), true));
        }
    }
    let a = app.state::<App>();
    let id = a.settings.get()["todoSyncGoogleClientId"].as_str().unwrap_or("").trim().to_string();
    let secret = a.settings.secret_value("todoSyncGoogleClientSecret").unwrap_or_default();
    (!id.is_empty()).then_some((id, secret.trim().to_string(), false))
}

fn file(app: &AppHandle) -> std::path::PathBuf {
    app.state::<App>().data_dir.join("todosync.json")
}

fn save(app: &AppHandle) {
    let s = app.state::<Sync>().saved.lock().unwrap().clone();
    let tmp = file(app).with_extension("json.tmp");
    if serde_json::to_vec(&s).is_ok_and(|b| std::fs::write(&tmp, b).is_ok()) {
        let _ = std::fs::rename(tmp, file(app));
    }
}

fn state(app: &AppHandle) -> Value {
    let a = app.state::<App>();
    let s = app.state::<Sync>();
    let saved = s.saved.lock().unwrap().clone();
    let c = client(app);
    json!({
        "provider": a.settings.get()["todoSync"],
        "name": "Google Tasks",
        "ready": {"google": c.is_some(), "microsoft": false},
        "builtIn": {"google": c.as_ref().is_some_and(|c| c.2)},
        "signingIn": s.signing_in.load(Ordering::SeqCst),
        "signedIn": a.settings.secret_value(REFRESH).is_some(),
        "account": saved.account,
        "list": saved.list,
        "last": if saved.last > 0 { json!(saved.last) } else { Value::Null },
        "syncing": s.syncing.load(Ordering::SeqCst),
        "error": *s.error.lock().unwrap(),
    })
}

fn tell(app: &AppHandle) -> Value {
    let v = state(app);
    let _ = app.emit("todosync", &v);
    v
}

fn set_error(app: &AppHandle, e: &str) {
    *app.state::<Sync>().error.lock().unwrap() = e.to_string();
}

fn kick(app: &AppHandle) {
    if let Some(tx) = app.state::<Sync>().kick.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

/// A fresh access token (refreshed when old). Err: what to tell; Google refusing the refresh token signs out.
fn token(app: &AppHandle) -> Result<String, String> {
    let s = app.state::<Sync>();
    if let Some((t, until)) = s.token.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(t);
        }
    }
    let a = app.state::<App>();
    let refresh = a.settings.secret_value(REFRESH).ok_or("Not signed in")?;
    let (id, secret, _) = client(app).ok_or("Google Tasks isn’t set up in this build")?;
    let form = [("client_id", id.as_str()), ("client_secret", secret.as_str()), ("refresh_token", refresh.as_str()), ("grant_type", "refresh_token")];
    match services::http::post_form("https://oauth2.googleapis.com/token", &form) {
        Ok((200, v)) => {
            let t = v["access_token"].as_str().unwrap_or("").to_string();
            let secs = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
            *s.token.lock().unwrap() = Some((t.clone(), Instant::now() + Duration::from_secs(secs)));
            Ok(t)
        }
        Ok((_, v)) if v["error"] == "invalid_grant" => {
            let _ = a.settings.secret(REFRESH, "");
            Err("Google signed Sympony out (the access was removed or expired). Sign in again.".into())
        }
        Ok((st, v)) => Err(format!("Google said no ({st}): {}", v["error_description"].as_str().or(v["error"].as_str()).unwrap_or(""))),
        Err(_) => Err("Couldn’t reach Google".into()),
    }
}

fn call(app: &AppHandle, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
    let t = token(app)?;
    let url = if path.starts_with("https://") { path.to_string() } else { format!("{API}{path}") };
    match services::http::bearer(method, &url, &t, body) {
        Ok((s, v)) if (200..300).contains(&s) => Ok(v),
        Ok((401, _)) => {
            *app.state::<Sync>().token.lock().unwrap() = None;
            Err("Google didn’t accept the sign-in; trying again next time".into())
        }
        Ok((404, _)) => Err("not found".into()),
        Ok((s, v)) => Err(format!("Google Tasks answered {s}: {}", v["error"]["message"].as_str().unwrap_or(""))),
        Err(_) => Err("Couldn’t reach Google".into()),
    }
}

fn lists(app: &AppHandle) -> Result<Vec<Value>, String> {
    let v = call(app, "GET", "/users/@me/lists?maxResults=100", None)?;
    Ok(v["items"].as_array().into_iter().flatten().map(|l| json!({"id": l["id"], "name": l["title"]})).collect())
}

/// Waits (5 minutes at most, or until `cancel`) for the browser to come back to `listener` with this sign-in's
/// `state`: the code in it and the browser's connection, for `done_page` once the code is exchanged; or what went
/// wrong ("" when cancelled; a refusal in the browser gets its page here).
pub(crate) fn loopback_code(listener: &std::net::TcpListener, state: &str, cancel: &AtomicBool, what: &str) -> Result<(String, std::net::TcpStream), String> {
    let until = Instant::now() + Duration::from_secs(300);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(String::new());
        }
        if Instant::now() > until {
            return Err("The browser didn’t come back in 5 minutes".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                // (a browser may open a connection and say nothing: never wait on one long)
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                use std::io::Read;
                let mut line = String::new();
                let _ = BufReader::new((&stream).take(16 << 10)).read_line(&mut line);
                // only the answer to this sign-in counts; anything else (a favicon, a stray request) is turned away
                if !line.contains(&format!("state={state}")) {
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                return match services::oauth::parse_redirect(&line, state) {
                    Ok(code) => Ok((code, stream)),
                    Err(e) => {
                        let e = if e == "access_denied" { "You didn’t allow it in the browser".to_string() } else { e };
                        done_page(stream, what, Err(&e));
                        Err(e)
                    }
                };
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// The sign-in's answer to the browser tab (`services::oauth::done_page`), in Sympony's language.
pub(crate) fn done_page(mut stream: std::net::TcpStream, what: &str, result: Result<&str, &str>) {
    let page = services::oauth::done_page(crate::lang::using() == "id", what, result);
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}");
}

/// The browser sign-in: a one-time listener on 127.0.0.1, Google's page in the browser, the code → tokens.
fn sign_in(app: &AppHandle) -> Result<(), String> {
    let (id, secret, _) = client(app).ok_or("Google Tasks isn’t set up in this build")?;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let (verifier, state) = (services::oauth::random(), services::oauth::random());
    let url = services::oauth::auth_url(&id, &redirect, &services::oauth::challenge(&verifier), &state);
    platform::os::shell::open(&url);
    let s = app.state::<Sync>();
    let (code, tab) = loopback_code(&listener, &state, &s.cancel, "Google Tasks")?;
    done_page(tab, "Google Tasks", Ok(""));
    let form = [("code", code.as_str()), ("client_id", id.as_str()), ("client_secret", secret.as_str()), ("redirect_uri", redirect.as_str()),
                ("grant_type", "authorization_code"), ("code_verifier", verifier.as_str())];
    let v = match services::http::post_form("https://oauth2.googleapis.com/token", &form) {
        Ok((200, v)) => v,
        Ok((_, v)) => return Err(format!("Google said no: {}", v["error_description"].as_str().or(v["error"].as_str()).unwrap_or(""))),
        Err(_) => return Err("Couldn’t reach Google".into()),
    };
    let refresh = v["refresh_token"].as_str().ok_or("Google gave no lasting access; try again")?;
    // (Google lets the user untick a permission: without Tasks there's nothing to sync)
    if !v["scope"].as_str().unwrap_or("").contains("auth/tasks") {
        let _ = services::http::post_form("https://oauth2.googleapis.com/revoke", &[("token", refresh)]);
        return Err("Allow Sympony to see and edit your Google Tasks (the box in Google's page), then sign in again".into());
    }
    app.state::<App>().settings.secret(REFRESH, refresh).map_err(|e| e.to_string())?;
    let t = v["access_token"].as_str().unwrap_or("").to_string();
    *s.token.lock().unwrap() = Some((t, Instant::now() + Duration::from_secs(v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60))));
    let who = call(app, "GET", "https://www.googleapis.com/oauth2/v2/userinfo", None).ok();
    let mut saved = s.saved.lock().unwrap();
    let account = who.and_then(|w| w["email"].as_str().map(String::from)).unwrap_or_default();
    // the same account again (Google ended the last sign-in): its list and links stay
    if account != saved.account || account.is_empty() {
        let gen = saved.gen + 1;
        *saved = Saved { account, gen, ..Saved::default() };
    }
    Ok(())
}

fn remote_tasks(app: &AppHandle, list: &str) -> Result<Vec<Remote>, String> {
    let mut out = vec![];
    let mut page = String::new();
    loop {
        let path = format!("/lists/{}/tasks?showCompleted=true&showHidden=true&showDeleted=true&maxResults=100{}", services::http::q(list), page);
        let v = call(app, "GET", &path, None).map_err(|e| if e == "not found" { "That Google Tasks list is gone; pick another in Settings".into() } else { e })?;
        for t in v["items"].as_array().into_iter().flatten() {
            out.push(Remote {
                id: t["id"].as_str().unwrap_or("").into(),
                title: t["title"].as_str().unwrap_or("").into(),
                done: t["status"] == "completed",
                day: t["due"].as_str().map(|d| d.chars().take(10).collect()),
                deleted: t["deleted"] == true,
            });
        }
        match v["nextPageToken"].as_str() {
            Some(n) => page = format!("&pageToken={}", services::http::q(n)),
            None => return Ok(out),
        }
    }
}

fn task_body(s: &Snap) -> Value {
    json!({"title": s.text, "status": if s.done { "completed" } else { "needsAction" },
           "due": s.day.as_ref().map(|d| format!("{d}T00:00:00.000Z")), "completed": Value::Null})
}

/// The Todo store's items. Err when it can't be read: a sync then does nothing (an empty list would read as
/// "everything deleted here").
fn todo_items(app: &AppHandle) -> Result<Vec<Value>, String> {
    let a = app.state::<App>();
    let path = a.data_dir.join("todo.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Couldn’t read the tasks here: {e}"))?;
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| "The tasks here couldn’t be read; nothing was synced".to_string())?;
    match &v["items"] {
        Value::Array(a) => Ok(a.clone()),
        Value::Null => Ok(vec![]),
        _ => Err("The tasks here couldn’t be read; nothing was synced".into()),
    }
}

/// One sync. Err: what Settings shows.
fn run(app: &AppHandle) -> Result<(), String> {
    let s = app.state::<Sync>();
    let (list, gen, links) = {
        let saved = s.saved.lock().unwrap();
        (saved.list.clone().and_then(|l| l["id"].as_str().map(String::from)).ok_or("Choose a list")?, saved.gen, saved.links.clone())
    };
    let remote = remote_tasks(app, &list)?;
    let before = todo_items(app)?;
    let tz = services::calendar::local_tz();
    let now = chrono::Utc::now().timestamp_millis();
    let mut p = plan(&before, &remote, &links, tz, now);
    if !s.force.swap(false, Ordering::SeqCst) {
        services::todosync::guard(&p, &links, &before)?;
    }
    let stale = || s.saved.lock().unwrap().gen != gen;
    let base = format!("/lists/{}/tasks", services::http::q(&list));
    for id in &p.delete {
        if stale() {
            return Ok(());
        }
        match call(app, "DELETE", &format!("{base}/{}", services::http::q(id)), None) {
            Ok(_) => {}
            Err(e) if e == "not found" => {}
            Err(e) => return Err(e),
        }
    }
    for (id, snap) in &p.update {
        call(app, "PATCH", &format!("{base}/{}", services::http::q(id)), Some(&task_body(snap)))?;
    }
    for (local, snap) in &p.create {
        let v = call(app, "POST", &base, Some(&task_body(snap)))?;
        if let Some(rid) = v["id"].as_str() {
            p.links.push(Link { local: local.clone(), remote: rid.into(), snap: snap.clone() });
        }
    }
    // the store as it is now, with the sync's changes laid over it (an edit made meanwhile stays)
    // (another list or account since this sync began: its links and items are for nothing now)
    let mut saved = s.saved.lock().unwrap();
    if saved.gen != gen {
        return Ok(());
    }
    let items = rebase(&before, &p.items, &todo_items(app)?);
    if items != before {
        let a = app.state::<App>();
        services::store::set(&a.ctx, "todo", json!({"items": items})).map_err(|e| e.to_string())?;
    }
    saved.links = p.links;
    saved.last = now;
    Ok(())
}

fn sync_once(app: &AppHandle) {
    let a = app.state::<App>();
    let s = app.state::<Sync>();
    let on = a.settings.get()["todoSync"] == "google";
    if !on || a.settings.secret_value(REFRESH).is_none() || s.saved.lock().unwrap().list.is_none() || s.signing_in.load(Ordering::SeqCst) {
        return;
    }
    s.syncing.store(true, Ordering::SeqCst);
    tell(app);
    let r = run(app);
    s.syncing.store(false, Ordering::SeqCst);
    match r {
        Ok(()) => set_error(app, ""),
        Err(e) => {
            a.log.line(&format!("todo sync: {e}"));
            set_error(app, &e);
        }
    }
    save(app);
    tell(app);
}

pub fn register(reg: &mut services::Registry, app: &AppHandle, dir: &std::path::Path) {
    let saved: Saved = std::fs::read(dir.join("todosync.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    app.manage(Sync { saved: Mutex::new(saved), ..Default::default() });
    let h = app.clone();
    reg.add("todosync.state", Box::new(move |_, _| Ok(state(&h))));
    let h = app.clone();
    reg.add("todosync.lists", Box::new(move |_, _| lists(&h).map(Value::from).map_err(anyhow::Error::msg)));
    let h = app.clone();
    reg.add("todosync.signIn", Box::new(move |_, _| {
        let s = h.state::<Sync>();
        if !s.signing_in.swap(true, Ordering::SeqCst) {
            s.cancel.store(false, Ordering::SeqCst);
            set_error(&h, "");
            let h2 = h.clone();
            std::thread::spawn(move || {
                let r = sign_in(&h2);
                h2.state::<Sync>().signing_in.store(false, Ordering::SeqCst);
                if let Err(e) = r {
                    set_error(&h2, &e);
                }
                save(&h2);
                tell(&h2);
            });
        }
        Ok(tell(&h))
    }));
    let h = app.clone();
    reg.add("todosync.cancel", Box::new(move |_, _| {
        h.state::<Sync>().cancel.store(true, Ordering::SeqCst);
        Ok(state(&h))
    }));
    let h = app.clone();
    reg.add("todosync.signOut", Box::new(move |_, _| {
        let a = h.state::<App>();
        if let Some(t) = a.settings.secret_value(REFRESH) {
            let _ = services::http::post_form("https://oauth2.googleapis.com/revoke", &[("token", t.as_str())]);
        }
        let _ = a.settings.secret(REFRESH, "");
        let s = h.state::<Sync>();
        *s.token.lock().unwrap() = None;
        {
            let mut saved = s.saved.lock().unwrap();
            let gen = saved.gen + 1;
            *saved = Saved { gen, ..Saved::default() };
        }
        set_error(&h, "");
        save(&h);
        Ok(tell(&h))
    }));
    let h = app.clone();
    reg.add("todosync.syncNow", Box::new(move |_, _| {
        h.state::<Sync>().force.store(true, Ordering::SeqCst);
        kick(&h);
        Ok(state(&h))
    }));
    let h = app.clone();
    reg.add("todosync.setList", Box::new(move |_, a| {
        let id = a.first().and_then(Value::as_str).unwrap_or("").to_string();
        let name = a.get(1).and_then(Value::as_str).unwrap_or("").to_string();
        {
            let st = h.state::<Sync>();
            let mut saved = st.saved.lock().unwrap();
            // another list: nothing is linked to it yet
            if saved.list.as_ref().and_then(|l| l["id"].as_str()) != Some(id.as_str()) {
                saved.links.clear();
                saved.gen += 1;
            }
            saved.list = Some(json!({"id": id, "name": name}));
        }
        save(&h);
        kick(&h);
        Ok(tell(&h))
    }));
    let h = app.clone();
    reg.add("todosync.newList", Box::new(move |_, _| {
        match call(&h, "POST", "/users/@me/lists", Some(&json!({"title": "Sympony"}))) {
            Ok(v) => {
                let st = h.state::<Sync>();
                let mut saved = st.saved.lock().unwrap();
                saved.list = Some(json!({"id": v["id"], "name": "Sympony"}));
                saved.links.clear();
                saved.gen += 1;
            }
            Err(e) => set_error(&h, &e),
        }
        save(&h);
        kick(&h);
        Ok(tell(&h))
    }));
}

/// Every 5 minutes, at once when asked (`syncNow`, a list picked), and 5 s after the Todo store changes.
pub fn start(app: &AppHandle) {
    let (tx, rx) = channel();
    *app.state::<Sync>().kick.lock().unwrap() = Some(tx);
    let app = app.clone();
    std::thread::spawn(move || {
        let todo = app.state::<App>().data_dir.join("todo.json");
        let stamp = || std::fs::metadata(&todo).and_then(|m| m.modified()).ok();
        let (mut seen, mut last) = (stamp(), Instant::now() - Duration::from_secs(600));
        loop {
            let asked = rx.recv_timeout(Duration::from_secs(2)).is_ok();
            let changed = stamp() != seen;
            if asked || changed || last.elapsed() >= Duration::from_secs(300) {
                if changed && !asked {
                    std::thread::sleep(Duration::from_secs(5)); // (a few edits in a row: one sync)
                }
                sync_once(&app);
                seen = stamp();
                last = Instant::now();
            }
        }
    });
}
