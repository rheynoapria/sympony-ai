//! Ask other AIs: `ask_ai`
//! opens Claude, ChatGPT or Gemini in the user's browser and profile (default browser unless Settings picks one; the
//! last used profile unless Settings picks one) or the Claude app, puts the prompt in and sends it, follows the answer
//! through Accessibility and brings it back as a line in Pony's chat (`pony:agentDone`). The user doesn't have to stay
//! there: the page opens behind their app, the window comes forward for about a second while the prompt goes in as
//! real keys and Return sends it, then the user's app is back in front and the answer is followed in the background.
//! (A value set through Accessibility only changes what the page shows: Claude, ChatGPT and Gemini wait for real
//! input events, so sending fully in the background would need a browser extension.) Every ask waits on a card. Jobs answer to the bridge's agent_status /
//! agent_send / agent_stop by their id ("ai1"…). Only `platform::ax` is used, so a Windows backend fits the same.
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::App;
use platform::ax;
use services::askai::{self, Follow, Site};

const FIND: Duration = Duration::from_secs(30);
const ANSWER: Duration = Duration::from_secs(600);
/// No change this long while the window isn't in front: its browser stopped drawing it, so the chat offers a peek.
const PEEK_AFTER: Duration = Duration::from_secs(8);
/// How long a peek keeps the window in front at most (the answer is in once it's been the same for three looks).
const PEEK_MAX: Duration = Duration::from_secs(8);

struct Job {
    site: &'static Site,
    running: bool,
    answer: Arc<Mutex<String>>,
    pid: i32,
    win: Option<ax::El>,
    stop: Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Default)]
pub struct AskAi {
    jobs: Mutex<HashMap<String, Job>>,
    next: Mutex<u32>,
}

/// Whether Pony may ask other AIs (Settings → Pony Assistant → Abilities, off until turned on).
pub fn available(app: &AppHandle) -> bool {
    app.state::<App>().settings.get()["ponyAskAi"] == true
}

pub fn owns(app: &AppHandle, id: &str) -> bool {
    app.state::<AskAi>().jobs.lock().unwrap().contains_key(id)
}

/// The browser and profile to use: (bundle id, name, profile folder Settings picked or "" for the last used one).
fn browser(app: &AppHandle) -> (String, String, String) {
    let set = app.state::<App>().settings.get();
    let picked = set["ponyAskBrowser"].as_str().filter(|b| !b.is_empty()).map(String::from);
    let bundle = picked.or_else(ax::default_browser).filter(|b| askai::browser(b).is_some() && ax::installed(b)).unwrap_or_else(|| "com.apple.Safari".into());
    let (_, name, dir) = askai::browser(&bundle).unwrap_or(("", "Safari", None));
    // (the last used profile is where a background tab lands anyway; another one needs a new window)
    let profile = match dir {
        None => String::new(),
        Some(d) => set["ponyAskProfile"].as_str().filter(|p| !p.is_empty() && *p != askai::profiles(&local_state(d)).1).map(String::from).unwrap_or_default(),
    };
    (bundle, name.to_string(), profile)
}

fn local_state(dir: &str) -> Value {
    let p = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Application Support").join(dir).join("Local State");
    std::fs::read(p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

/// The user's app, to give the front back to: the app in front, or (when that's Sympony, after its card) the one
/// whose window is on top.
fn user_app() -> Option<i32> {
    let me = std::process::id() as i32;
    ax::front_pid().filter(|&p| p != me).or_else(|| ax::front_app(me).map(|a| a.0))
}

fn declined() -> Result<String, String> {
    Err("The user said no. Don't try another way; ask them what they'd like instead.".into())
}

/// `ask_ai`: after the user's OK, a job that types the prompt and follows the answer.
pub fn call(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    if !available(app) {
        return Err("Asking other AIs is off (Settings → Pony Assistant → Abilities)".into());
    }
    let site = askai::site(args["ai"].as_str().unwrap_or("")).ok_or("ai must be claude, chatgpt, gemini or claude_app")?;
    let prompt = args["prompt"].as_str().unwrap_or("").trim().to_string();
    if prompt.is_empty() {
        return Err("ask_ai needs a prompt".into());
    }
    if !ax::trusted(false) {
        let _ = ax::trusted(true);
        return Err("Sympony needs the Accessibility permission to type into another app. Tell the user to turn it on in System Settings → Privacy & Security → Accessibility.".into());
    }
    let via = match site.app {
        Some(b) if !ax::installed(b) => return Err(format!("{} isn't installed on this Mac", site.name)),
        Some(_) => String::new(),
        None => {
            let (_, name, profile) = browser(app);
            format!(" · {name}{}", if profile.is_empty() { String::new() } else { format!(" ({profile})") })
        }
    };
    let detail = format!("{}{via}\n{prompt}", site.name);
    if !matches!(crate::exec::approve(app, session, json!({"tool": "ask_ai", "detail": detail, "canAlways": false})).as_str(), "once" | "always") {
        return declined();
    }
    let id = {
        let st = app.state::<AskAi>();
        let mut n = st.next.lock().unwrap();
        *n += 1;
        format!("ai{n}")
    };
    let job = Job { site, running: true, answer: Arc::default(), pid: 0, win: None, stop: Arc::default() };
    app.state::<AskAi>().jobs.lock().unwrap().insert(id.clone(), job);
    let _ = app.emit("agent:step", json!({"session": session, "kind": "agent", "detail": format!("{} · {}", site.name, prompt.chars().take(40).collect::<String>())}));
    let (app2, id2) = (app.clone(), id.clone());
    std::thread::spawn(move || {
        let r = start(&app2, &id2, site, &prompt);
        finish(&app2, &id2, r);
    });
    Ok(format!("Asking {} (job {id}). Its answer comes to this chat as a message when it's done; don't wait for it. (The browser pauses a window that is completely hidden: tell the user the answer arrives once that window shows, even partly.)", site.name))
}

/// Opens the site, puts the prompt in, sends and follows. Ok: the answer.
fn start(app: &AppHandle, id: &str, site: &'static Site, prompt: &str) -> Result<String, String> {
    let back = user_app();
    let bundle = match site.app {
        Some(b) => {
            ax::open_background("", site.url);
            b.to_string()
        }
        None => {
            let (bundle, _, profile) = browser(app);
            if profile.is_empty() {
                ax::open_background(&bundle, site.url);
            } else {
                ax::open_with(&bundle, &askai::browser_args(&profile, site.url));
            }
            bundle
        }
    };
    let t0 = Instant::now();
    let mut gave_back = false;
    let (pid, win) = loop {
        if t0.elapsed() > FIND {
            return Err(format!("{} didn't open a page Pony could use", site.name));
        }
        std::thread::sleep(Duration::from_millis(if gave_back { 700 } else { 250 }));
        let Some(pid) = ax::pid_of(&bundle) else { continue };
        // (a browser brings itself forward when it opens a link: the user's app goes back in front while the page loads)
        if !gave_back {
            if let Some(b) = back.filter(|&b| b != pid && ax::is_front(pid)) {
                ax::activate(b);
                gave_back = true;
            } else if t0.elapsed() > Duration::from_secs(2) {
                gave_back = true;
            }
        }
        let Some(win) = ax::window(pid) else { continue };
        let (nodes, els) = ax::read(&win, 8000);
        let Some(area) = nodes.iter().find(|n| n.role == "AXWebArea" && n.url.contains(site.host)) else { continue };
        if askai::needs_login(&area.url) {
            return Err(format!("{} asks the user to sign in first (the page is left open for them)", site.name));
        }
        // (the Claude app opens on its last mode: Code sessions are not where a question goes)
        if site.app.is_some() && nodes.iter().any(|n| n.role == "AXRadioButton" && n.label == "Code" && n.value == "1") {
            if let Some(j) = nodes.iter().position(|n| n.role == "AXRadioButton" && n.label.starts_with("Chat")) {
                els[j].act("AXPress");
                std::thread::sleep(Duration::from_millis(1200));
                ax::open_background("", site.url);
            }
            continue;
        }
        if askai::composer(&nodes, site).is_some() {
            break (pid, win);
        }
    };
    if let Some(j) = app.state::<AskAi>().jobs.lock().unwrap().get_mut(id) {
        j.pid = pid;
        j.win = Some(win.clone());
    }
    type_and_follow(app, id, site, pid, &win, prompt, back)
}

/// Puts `prompt` in the window's chat box and sends it (in the background, else a quick moment in front), then
/// follows the answer.
/// `back`: the user's app, given the front again after typing.
fn type_and_follow(app: &AppHandle, id: &str, site: &'static Site, pid: i32, win: &ax::El, prompt: &str, back: Option<i32>) -> Result<String, String> {
    in_front(site, pid, win, prompt, back.filter(|&b| b != pid))?;
    // (it went once the box let go of it and it shows in the conversation)
    if !(0..8).any(|_| {
        std::thread::sleep(Duration::from_millis(400));
        askai::sent(&ax::read(win, 8000).0, site, prompt)
    }) {
        return Err(format!("{} didn't take the message (it may still be in its chat box)", site.name));
    }
    app.state::<App>().log.line(&format!("ask ai: {} asked ({} chars)", site.name, prompt.chars().count()));
    let (sent, mut f) = (Instant::now(), Follow::default());
    let (answer, stop) = {
        let st = app.state::<AskAi>();
        let jobs = st.jobs.lock().unwrap();
        let j = jobs.get(id).ok_or("gone")?;
        (j.answer.clone(), j.stop.clone())
    };
    let (mut moved, mut asked, mut was) = (Instant::now(), false, (String::new(), false));
    loop {
        // (closer looks while the window is in front, so a peek is short)
        std::thread::sleep(Duration::from_millis(if ax::is_front(pid) { 500 } else { 1500 }));
        if stop.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("Stopped.".into());
        }
        let (nodes, _) = ax::read(win, 8000);
        if nodes.is_empty() {
            return Err(format!("The {} window was closed", site.name));
        }
        let text = askai::answer(&nodes, site, prompt);
        *answer.lock().unwrap() = text.clone();
        let writing = askai::answering(&nodes, site);
        if (text.as_str(), writing) != (was.0.as_str(), was.1) {
            was = (text.clone(), writing);
            moved = Instant::now();
            if asked {
                asked = false;
                let _ = app.emit_to(crate::notch::LABEL, "pony:aiPeeked", json!({"id": id}));
            }
        }
        // (a window hidden behind others isn't drawn by its browser, so the answer stands still: the chat offers to
        // show it for a moment rather than pulling it forward while the user works)
        if !asked && moved.elapsed() > PEEK_AFTER && !ax::is_front(pid) {
            asked = true;
            let _ = app.emit_to(crate::notch::LABEL, "pony:aiPeek", json!({"id": id, "name": site.name}));
        }
        if f.look(writing, &text, sent.elapsed().as_secs_f32()) {
            return Ok(text);
        }
        if sent.elapsed() > ANSWER {
            return if text.is_empty() { Err(format!("{} didn't answer in 10 minutes", site.name)) } else { Ok(text) };
        }
    }
}

/// The window comes forward, the prompt goes in as real keys at once and Return sends it, then the user's app comes
/// back once the page shows it went (one to three seconds).
fn in_front(site: &Site, pid: i32, win: &ax::El, prompt: &str, back: Option<i32>) -> Result<(), String> {
    let _driving = crate::shell::Driving::start();
    let (nodes, els) = ax::read(win, 8000);
    let c = askai::composer(&nodes, site).ok_or("The chat box wasn't found")?;
    ax::bring(pid, win);
    std::thread::sleep(Duration::from_millis(150));
    els[c].set_flag("AXFocused", true);
    std::thread::sleep(Duration::from_millis(200));
    // (never into another app: the user moving away stops it)
    let r = if !ax::is_front(pid) {
        Err("Another app was in front, so Pony didn't type (nothing was sent)".to_string())
    } else {
        ax::type_all(prompt);
        std::thread::sleep(Duration::from_millis(300));
        if ax::is_front(pid) {
            ax::press_key(36, false);
            // (in front until the page shows it went: a hidden page isn't redrawn, so it would still look unsent)
            let t = Instant::now();
            while t.elapsed() < Duration::from_secs(3) && !askai::sent(&ax::read(win, 8000).0, site, prompt) {
                std::thread::sleep(Duration::from_millis(200));
            }
            Ok(())
        } else {
            Err("The user switched apps while Pony was typing, so nothing was sent".to_string())
        }
    };
    std::thread::sleep(Duration::from_millis(250));
    if let Some(b) = back {
        ax::activate(b);
    }
    r
}

fn finish(app: &AppHandle, id: &str, r: Result<String, String>) {
    let name = {
        let st = app.state::<AskAi>();
        let mut jobs = st.jobs.lock().unwrap();
        let Some(j) = jobs.get_mut(id) else { return };
        j.running = false;
        j.site.name
    };
    let (failed, text) = match r {
        Ok(t) => (false, t),
        Err(e) => (true, e),
    };
    app.state::<App>().log.line(&format!("ask ai: {name} {}", if failed { "failed" } else { "answered" }));
    let _ = app.emit_to(crate::notch::LABEL, "pony:agentDone", json!({"id": id, "project": name, "ai": true, "failed": failed, "text": text.chars().take(6000).collect::<String>()}));
}

/// The bridge's tools on an ask_ai job.
pub fn status(app: &AppHandle, id: &str) -> Result<String, String> {
    let st = app.state::<AskAi>();
    let jobs = st.jobs.lock().unwrap();
    let j = jobs.get(id).ok_or("No such job")?;
    Ok(format!("{} · {}\n{}", j.site.name, if j.running { "answering" } else { "done" }, j.answer.lock().unwrap().chars().take(6000).collect::<String>()))
}

pub fn send(app: &AppHandle, session: &str, id: &str, message: &str) -> Result<String, String> {
    let (site, pid, win, running) = {
        let st = app.state::<AskAi>();
        let jobs = st.jobs.lock().unwrap();
        let j = jobs.get(id).ok_or("No such job")?;
        (j.site, j.pid, j.win.clone(), j.running)
    };
    if running {
        return Err("It's still answering; wait for it, or stop it first".into());
    }
    let win = win.ok_or("That conversation's window is gone; use ask_ai again")?;
    if !matches!(crate::exec::approve(app, session, json!({"tool": "ask_ai", "detail": format!("{}\n{message}", site.name), "canAlways": false})).as_str(), "once" | "always") {
        return declined();
    }
    if let Some(j) = app.state::<AskAi>().jobs.lock().unwrap().get_mut(id) {
        j.running = true;
        j.stop.store(false, std::sync::atomic::Ordering::Relaxed);
    }
    let (app2, id2, msg) = (app.clone(), id.to_string(), message.to_string());
    std::thread::spawn(move || {
        let back = user_app();
        let r = type_and_follow(&app2, &id2, site, pid, &win, &msg, back);
        finish(&app2, &id2, r);
    });
    Ok(format!("Sent to {}. Its answer comes to this chat when it's done.", site.name))
}

pub fn stop(app: &AppHandle, id: &str) -> Result<String, String> {
    let st = app.state::<AskAi>();
    let jobs = st.jobs.lock().unwrap();
    let j = jobs.get(id).ok_or("No such job")?;
    j.stop.store(true, std::sync::atomic::Ordering::Relaxed);
    // (the site's own Stop button, so it stops writing too)
    if let Some(win) = &j.win {
        let (nodes, els) = ax::read(win, 8000);
        if let Some(i) = askai::page(&nodes, j.site.host).find(|&i| askai::answering(std::slice::from_ref(&nodes[i]), j.site)) {
            els[i].act("AXPress");
        }
    }
    Ok("Stopped.".into())
}

/// "Show for a moment" (the chat's card): the window comes forward until the answer is in (at most `PEEK_MAX`), then
/// the user's app is back, unless they went somewhere else meanwhile.
fn peek(app: &AppHandle, id: &str) {
    let (pid, win) = {
        let st = app.state::<AskAi>();
        let jobs = st.jobs.lock().unwrap();
        match jobs.get(id) {
            Some(Job { pid, win: Some(w), running: true, .. }) => (*pid, w.clone()),
            _ => return,
        }
    };
    let _driving = crate::shell::Driving::start();
    let back = user_app().filter(|&b| b != pid);
    let brought = ax::bring(pid, &win);
    let t = Instant::now();
    while t.elapsed() < PEEK_MAX && app.state::<AskAi>().jobs.lock().unwrap().get(id).is_some_and(|j| j.running) {
        std::thread::sleep(Duration::from_millis(300));
    }
    let front = ax::is_front(pid);
    if let Some(b) = back.filter(|_| front) {
        ax::activate(b);
    }
    app.state::<App>().log.line(&format!("ask ai: peek {id}: brought {brought}, {:.1} s, back to {back:?} (front {front}, {:?})", t.elapsed().as_secs_f32(), ax::front_pid()));
}

pub fn list(app: &AppHandle) -> Vec<String> {
    app.state::<AskAi>().jobs.lock().unwrap().iter().map(|(id, j)| format!("{id} · {} · {} (ask_ai)", if j.running { "answering" } else { "done" }, j.site.name)).collect()
}

pub fn register(reg: &mut services::Registry, app: &AppHandle) {
    app.manage(AskAi::default());
    let h = app.clone();
    reg.add("pony.aiPeek", Box::new(move |_, a| {
        let (h, id) = (h.clone(), a.first().and_then(Value::as_str).unwrap_or("").to_string());
        std::thread::spawn(move || peek(&h, &id));
        Ok(json!(true))
    }));
    // (Settings → Ask other AIs: the browsers here, the default one, and each one's profiles)
    reg.add("pony.askBrowsers", Box::new(|_, _| {
        let default = ax::default_browser().unwrap_or_default();
        let list: Vec<Value> = askai::BROWSERS.iter().filter(|b| ax::installed(b.0)).map(|(id, name, dir)| {
            let (profiles, last) = dir.map(|d| askai::profiles(&local_state(d))).unwrap_or_default();
            json!({"id": id, "name": name, "profiles": profiles, "last": last})
        }).collect();
        Ok(json!({"default": default, "browsers": list}))
    }));
}

/// The runner's own steps on this Mac (opens a tab behind the app in front and asks): `ASK=gemini cargo test
/// --manifest-path src-tauri/Cargo.toml askai::live -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn live() {
        let site = askai::site(&std::env::var("ASK").unwrap_or("gemini".into())).unwrap();
        let bundle = site.app.map(String::from).or_else(ax::default_browser).unwrap();
        let prompt = "Balas hanya dengan satu kata: ping";
        let front = ax::front_pid();
        let name = |p: Option<i32>| p.map(|p| p.to_string()).unwrap_or_default();
        println!("front before: {}", name(front));
        ax::open_background(if site.app.is_some() { "" } else { &bundle }, site.url);
        let t0 = Instant::now();
        let mut gave_back = false;
        let (pid, win) = loop {
            assert!(t0.elapsed() < FIND, "no page");
            std::thread::sleep(Duration::from_millis(250));
            let Some(pid) = ax::pid_of(&bundle) else { continue };
            if !gave_back {
                if let Some(b) = front.filter(|&b| b != pid && ax::is_front(pid)) {
                    ax::activate(b);
                    println!("gave the front back after {:.1} s", t0.elapsed().as_secs_f32());
                    gave_back = true;
                }
            }
            let Some(win) = ax::window(pid) else { continue };
            let nodes = ax::read(&win, 8000).0;
            if nodes.iter().any(|n| n.role == "AXWebArea" && n.url.contains(site.host)) && askai::composer(&nodes, site).is_some() {
                break (pid, win);
            }
        };
        println!("{} ready in {:.1} s; front {} (Brave {pid})", site.name, t0.elapsed().as_secs_f32(), name(ax::front_pid()));
        let t1 = Instant::now();
        in_front(site, pid, &win, prompt, front.filter(|&b| b != pid)).unwrap();
        println!("typed and sent in {:.1} s; front now {} (before {})", t1.elapsed().as_secs_f32(), name(ax::front_pid()), name(front));
        assert!((0..8).any(|_| { std::thread::sleep(Duration::from_millis(400)); askai::sent(&ax::read(&win, 8000).0, site, prompt) }), "not sent");
        let (sent, mut f) = (Instant::now(), Follow::default());
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            let nodes = ax::read(&win, 8000).0;
            let text = askai::answer(&nodes, site, prompt);
            if f.look(askai::answering(&nodes, site), &text, sent.elapsed().as_secs_f32()) {
                println!("answer after {:.1} s: {text:?}", sent.elapsed().as_secs_f32());
                assert!(text.to_lowercase().contains("pong") || text.to_lowercase().contains("ping"));
                break;
            }
            assert!(sent.elapsed() < Duration::from_secs(90), "no answer; last {text:?}");
        }
    }
}
