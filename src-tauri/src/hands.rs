//! Pony's Hands: `screen_do` acts on
//! the elements Eyes numbered, several steps per call (fewer model calls: they're most of an agent's time), through
//! Accessibility first (press, value, menu bar: no pointer, no focus taken), keys or a click only when needed. Before a
//! step the element is checked and found again by role and label if the window moved on; after it, the window is
//! given time to settle; the answer is what changed, not the whole list. Sending, buying, paying or deleting asks on a
//! card. While Pony works, the screen's edges glow and Pony's own cursor goes to what it acts on (`hands.html`).
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::commands::App;
use platform::ax::{self, Node};
use services::hands as h;

const LABEL: &str = "hands";

/// The last view of a window Eyes read in a run: its numbered elements, to act on.
struct View {
    pid: i32,
    app: String,
    bundle: String,
    win: ax::El,
    nodes: Vec<Node>,
    els: Vec<ax::El>,
    map: Vec<usize>,
    /// text spots from an OCR read (t1, t2…): their label and centres on screen
    spots: Vec<(String, f64, f64)>,
}

#[derive(Default)]
pub struct Hands {
    views: Mutex<HashMap<String, View>>,
    actions: Mutex<HashMap<String, usize>>,
    /// per run: the steps that worked (elements by role and label) and the last changes, for routine_save
    trail: Mutex<HashMap<String, (Vec<Value>, String)>>,
    /// the runs already told how to act (with their first screen read, not in every request's system prompt)
    taught: Mutex<std::collections::HashSet<String>>,
    /// top-left (logical points) of the monitor the `hands.html` overlay currently covers
    origin: Mutex<(f64, f64)>,
    /// last `show` payload, re-sent on freshly created `hands.html` once PageLoadEvent::Finished fires
    pending_show: Mutex<Option<Value>>,
    shown: AtomicU64,
}

/// Whether Pony may act on the screen (Settings → Abilities → Eyes → Hands; Eyes must be on too).
pub fn available(app: &AppHandle) -> bool {
    let s = app.state::<App>().settings.get();
    s["ponyEyes"] == true && s["ponyHands"] == true
}

/// Eyes read a window as elements: Hands acts on that view.
#[allow(clippy::too_many_arguments)]
pub fn remember(app: &AppHandle, session: &str, pid: i32, name: &str, bundle: &str, win: ax::El, nodes: Vec<Node>, els: Vec<ax::El>, map: Vec<usize>) {
    app.state::<Hands>().views.lock().unwrap().insert(session.to_string(), View { pid, app: name.to_string(), bundle: bundle.to_string(), win, nodes, els, map, spots: vec![] });
}

/// An OCR read's text spots go with the view.
pub fn remember_spots(app: &AppHandle, session: &str, at: Vec<(String, f64, f64)>) {
    if let Some(v) = app.state::<Hands>().views.lock().unwrap().get_mut(session) {
        v.spots = at;
    }
}

/// How to act and use routines, once per run, after the first screen read that Hands can act on.
pub fn how_to_act(app: &AppHandle, session: &str) -> Option<String> {
    (available(app) && app.state::<Hands>().taught.lock().unwrap().insert(session.to_string()))
        .then(|| format!("{}\n\n{}", h::RULES, services::routines::RULES))
}

/// The run ended: its view goes and any active overlay fades out smoothly.
pub fn forget(app: &AppHandle, session: &str) {
    if let Some(h) = app.try_state::<Hands>() {
        let had = h.views.lock().unwrap().remove(session).is_some();
        h.actions.lock().unwrap().remove(session);
        h.trail.lock().unwrap().remove(session);
        h.taught.lock().unwrap().remove(session);
        if had {
            let gen = h.shown.fetch_add(1, Ordering::SeqCst) + 1;
            end_later_ms(app, gen, 900);
        }
    }
}

fn center(n: &Node) -> (f64, f64) {
    (n.frame.0 + n.frame.2 / 2.0, n.frame.1 + n.frame.3 / 2.0)
}

/// Whether node `i` is inside a web page (its editors want real keys, not a value set from outside).
fn in_web(nodes: &[Node], i: usize) -> bool {
    let mut d = nodes[i].depth;
    for n in nodes[..i].iter().rev() {
        if n.depth < d {
            if n.role == "AXWebArea" {
                return true;
            }
            d = n.depth;
        }
    }
    false
}

// ---- the overlay

/// Picks the monitor (logical origin & size) containing `target_frame`'s center, falling back to primary.
fn monitor_rect(app: &AppHandle, target_frame: (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
    let cx = target_frame.0 + target_frame.2 / 2.0;
    let cy = target_frame.1 + target_frame.3 / 2.0;
    if let Ok(mons) = app.available_monitors() {
        for m in &mons {
            let sf = m.scale_factor();
            let pos = m.position().to_logical::<f64>(sf);
            let sz = m.size().to_logical::<f64>(sf);
            if cx >= pos.x && cx <= pos.x + sz.width && cy >= pos.y && cy <= pos.y + sz.height {
                return (pos.x, pos.y, sz.width, sz.height);
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let sf = m.scale_factor();
            let pos = m.position().to_logical::<f64>(sf);
            let sz = m.size().to_logical::<f64>(sf);
            (pos.x, pos.y, sz.width, sz.height)
        })
        .unwrap_or((0.0, 0.0, 1512.0, 982.0))
}

/// Ensures the fullscreen `hands.html` overlay exists and is visible on the target window's display,
/// serialized on the main thread so it cannot race with `end_later`'s hide/close closures.
fn overlay(app: &AppHandle, gen: u64, target_frame: (f64, f64, f64, f64)) -> bool {
    let (tx, rx) = mpsc::channel();
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        if a.state::<Hands>().shown.load(Ordering::SeqCst) != gen {
            let _ = tx.send(false);
            return;
        }
        let (mx, my, mw, mh) = monitor_rect(&a, target_frame);
        *a.state::<Hands>().origin.lock().unwrap() = (mx, my);
        if let Some(w) = a.get_webview_window(LABEL) {
            let _ = w.set_position(LogicalPosition::new(mx, my));
            let _ = w.set_size(LogicalSize::new(mw, mh));
            let _ = w.show();
            if let Ok(ns) = w.ns_window() {
                // SAFETY: live NSWindow on the main thread; orderFrontRegardless ensures overlay appears above focused browser/apps
                unsafe {
                    platform::macos::window::style_onboarding_window(ns, 24);
                    platform::macos::window::set_click_through(ns, true);
                    platform::macos::window::set_window_level(ns, 24, Some(false));
                }
            }
            let _ = tx.send(false);
            return;
        }
        let built = WebviewWindowBuilder::new(&a, LABEL, WebviewUrl::App("hands.html".into()))
            .initialization_script(crate::page_globals())
            .title("Pony")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .focusable(false)
            .focused(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .visible_on_all_workspaces(true)
            .position(mx, my)
            .inner_size(mw, mh)
            .on_page_load(|w, p| {
                if p.event() == PageLoadEvent::Finished {
                    let h = w.app_handle();
                    if let Some(payload) = h.state::<Hands>().pending_show.lock().unwrap().clone() {
                        let _ = h.emit_to(LABEL, "hands", payload);
                    }
                }
            })
            .build();
        let created = if let Ok(w) = built {
            if let Ok(ns) = w.ns_window() {
                // SAFETY: a live NSWindow on the main thread; above windows, under the notch (25), clicks pass through
                unsafe {
                    platform::macos::window::style_onboarding_window(ns, 24);
                    platform::macos::window::set_click_through(ns, true);
                    platform::macos::window::set_window_level(ns, 24, Some(false));
                }
            }
            true
        } else {
            false
        };
        let _ = tx.send(created);
    });
    let created = rx.recv_timeout(Duration::from_secs(3)).unwrap_or(false);
    if created {
        // (a newly created page needs a moment to attach its event listener)
        std::thread::sleep(Duration::from_millis(450));
    }
    created
}

fn show(app: &AppHandle, what: Value) {
    let _ = app.emit_to(LABEL, "hands", what);
}

fn to_overlay(app: &AppHandle, x: f64, y: f64) -> (f64, f64) {
    let (ox, oy) = *app.state::<Hands>().origin.lock().unwrap();
    (x - ox, y - oy)
}

/// Shows the glowing screen edges while Eyes inspects the screen with Hands enabled.
pub fn peek_overlay(app: &AppHandle, app_name: &str, target_frame: (f64, f64, f64, f64)) {
    let gen = begin(app, app_name, target_frame);
    end_later_ms(app, gen, 8000);
}

/// Shows the glow and Pony's cursor; they go away a moment after the last step.
fn begin(app: &AppHandle, status: &str, target_frame: (f64, f64, f64, f64)) -> u64 {
    let gen = app.state::<Hands>().shown.fetch_add(1, Ordering::SeqCst) + 1;
    let s = app.state::<App>().settings.snapshot();
    let payload = json!({"do": "show", "status": status, "shape": s["ponyShape"], "color": s["ponyColor"]});
    *app.state::<Hands>().pending_show.lock().unwrap() = Some(payload.clone());
    overlay(app, gen, target_frame);
    show(app, payload);
    gen
}

fn end_later(app: &AppHandle, gen: u64) {
    end_later_ms(app, gen, 8000);
}

fn end_later_ms(app: &AppHandle, gen: u64, wait_ms: u64) {
    let a = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(wait_ms));
        if a.state::<Hands>().shown.load(Ordering::SeqCst) != gen {
            return;
        }
        *a.state::<Hands>().pending_show.lock().unwrap() = None;
        show(&a, json!({"do": "hide"}));
        // Let the CSS fade finish, then check generation + hide NSWindow atomically on the main thread.
        std::thread::sleep(Duration::from_millis(350));
        let a_hide = a.clone();
        let _ = a.run_on_main_thread(move || {
            if a_hide.state::<Hands>().shown.load(Ordering::SeqCst) == gen {
                if let Some(w) = a_hide.get_webview_window(LABEL) {
                    let _ = w.hide();
                }
            }
        });
        // After 60 s idle, check generation + close WKWebView atomically on the main thread to reclaim ~80-150 MB RAM.
        for _ in 0..12 {
            std::thread::sleep(Duration::from_secs(5));
            if a.state::<Hands>().shown.load(Ordering::SeqCst) != gen {
                return;
            }
        }
        let a_close = a.clone();
        let _ = a.run_on_main_thread(move || {
            if a_close.state::<Hands>().shown.load(Ordering::SeqCst) == gen {
                if let Some(w) = a_close.get_webview_window(LABEL) {
                    let _ = w.close();
                }
            }
        });
    });
}

// ---- screen_do

/// One `screen_do`. Err: what the model reads.
pub fn call(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    if !available(app) {
        return Err("Hands are off (Settings → Pony Assistant → Abilities → Eyes)".into());
    }
    let steps = args["steps"].as_array().cloned().unwrap_or_default();
    if steps.is_empty() == args["routine"].is_null() {
        return Err("screen_do takes steps or a routine (one listed with the screen), not both".into());
    }
    if steps.len() > h::MAX_STEPS {
        return Err(format!("At most {} steps in one screen_do", h::MAX_STEPS));
    }
    {
        let st = app.state::<Hands>();
        let mut acts = st.actions.lock().unwrap();
        let n = acts.entry(session.to_string()).or_default();
        *n += steps.len();
        if *n > h::MAX_ACTIONS {
            return Err("That's a lot of steps for one request: stop and tell the user where it got stuck.".into());
        }
    }
    let (pid, app_name, bundle, win) = {
        let st = app.state::<Hands>();
        let views = st.views.lock().unwrap();
        let v = views.get(session).ok_or("Read the screen first: screen_read (mode elements)")?;
        (v.pid, v.app.clone(), v.bundle.clone(), v.win.clone())
    };
    // (a routine that worked before: its steps, each element found again by role and label as it goes)
    let replay = match args["routine"].as_str() {
        Some(id) => {
            let (for_app, steps) = services::routines::replay_steps(&services::routines::load(&routines_file()), id)?;
            if for_app != bundle {
                return Err(format!("Routine {id} is for another app"));
            }
            Some(steps)
        }
        None => None,
    };
    // (a replay's fills can take new text, in order: the same routine for other words)
    let replay = replay.map(|mut steps| {
        let mut texts = args["texts"].as_array().into_iter().flatten().filter_map(Value::as_str);
        for s in steps.iter_mut().filter(|s| s["do"] == "fill") {
            match texts.next() {
                Some(t) => s["text"] = json!(t),
                None => break,
            }
        }
        steps
    });
    let steps = replay.clone().unwrap_or(steps);
    let skip: Vec<String> = app.state::<App>().settings.snapshot()["ponyEyesSkip"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    if services::eyes::skipped(&bundle, &skip) {
        return Err(format!("{app_name} is kept private, so Pony doesn't act there."));
    }
    if ax::secure_input() {
        return Err("A password field is active, so Pony doesn't act now.".into());
    }
    let _ = app.emit("agent:step", json!({"session": session, "kind": "hands", "detail": app_name.chars().take(60).collect::<String>()}));
    let _driving = crate::shell::Driving::start();
    let gen = begin(app, &app_name, win.frame());
    let (old_nodes, old_map) = {
        let st = app.state::<Hands>();
        let views = st.views.lock().unwrap();
        let v = &views[session];
        (v.nodes.clone(), v.map.clone())
    };
    let mut done = vec![];
    let mut stopped: Option<String> = None;
    for (k, step) in steps.iter().enumerate() {
        if crate::brain::stopped(app, session) {
            stopped = Some("the user stopped Pony".into());
            break;
        }
        // Re-check Secure Input and private app guard before every step (an earlier step could open a password prompt).
        if ax::secure_input() {
            stopped = Some("a password field became active".into());
            break;
        }
        if ax::front_app(std::process::id() as i32).is_some_and(|(_, _, b)| services::eyes::skipped(&b, &skip)) {
            stopped = Some("a private app came to the front".into());
            break;
        }
        let mut step = step.clone();
        if let Some(r) = step.get("ref").cloned() {
            // (a replayed step: its element in the window as it is now)
            match find_ref(app, session, r["role"].as_str().unwrap_or(""), r["label"].as_str().unwrap_or("")) {
                Some(n) => step["n"] = json!(n),
                None => {
                    stopped = Some(format!("step {} of the routine: {} “{}” isn't on screen; go on yourself from here", k + 1, step["do"].as_str().unwrap_or("?"), r["label"].as_str().unwrap_or("")));
                    break;
                }
            }
        }
        let target = step["n"].as_u64().and_then(|n| node_of(app, session, n as usize));
        match one(app, session, pid, &win, &app_name, &step) {
            Ok(line) => {
                done.push(line);
                // (the trail keeps the element by role and label: numbers change between views)
                let mut kept = step.clone();
                if let Some(o) = kept.as_object_mut() {
                    o.remove("n");
                    if let Some(t) = &target {
                        o.insert("ref".into(), json!({"role": t.role, "label": t.label}));
                    }
                }
                if kept["do"] != "point" {
                    app.state::<Hands>().trail.lock().unwrap().entry(session.to_string()).or_default().0.push(kept);
                }
            }
            Err(e) => {
                stopped = Some(format!("step {} ({}): {e}", k + 1, step["do"].as_str().unwrap_or("?")));
                break;
            }
        }
    }
    // (the window as it is now: the changes, and the new numbers for the next call)
    let (nodes, els) = ax::read(&win, 6000);
    let (list, map) = services::eyes::list(&nodes);
    let what = h::changes(&old_nodes, &old_map, &nodes, &map, &list);
    remember(app, session, pid, &app_name, &bundle, win, nodes, els, map);
    if let Some(t) = app.state::<Hands>().trail.lock().unwrap().get_mut(session) {
        t.1 = what.chars().take(400).collect();
    }
    end_later(app, gen);
    app.state::<App>().log.line(&format!("hands: {} in {app_name}: {} done{}", steps.len(), done.len(), if stopped.is_some() { ", stopped" } else { "" }));
    let head = if done.is_empty() { String::new() } else { format!("Done: {}\n", done.join("; ")) };
    match stopped {
        Some(why) => Err(format!("{head}Stopped at {why}\n{what}")),
        None => Ok(format!("{head}{what}")),
    }
}

/// The element numbered `n` in the run's view, checked: if the window moved on, found again by role and label.
fn element(app: &AppHandle, session: &str, n: usize) -> Result<(ax::El, Node, bool), String> {
    let st = app.state::<Hands>();
    let mut views = st.views.lock().unwrap();
    let v = views.get_mut(session).ok_or("Read the screen first")?;
    let i = *v.map.get(n.wrapping_sub(1)).ok_or(format!("There's no element [{n}] in the last view"))?;
    let (el, node) = (v.els[i].clone(), v.nodes[i].clone());
    if el.text("AXRole") == node.role {
        let web = in_web(&v.nodes, i);
        return Ok((el, node, web));
    }
    // (gone or replaced: the same role and label in a fresh view)
    let (nodes, els) = ax::read(&v.win, 6000);
    let (_, map) = services::eyes::list(&nodes);
    let k = h::refind(&v.nodes, &v.map, n, &nodes, &map).ok_or(format!("[{n}] “{}” isn't on screen any more: read the screen again", node.label))?;
    let j = map[k - 1];
    let out = (els[j].clone(), nodes[j].clone(), in_web(&nodes, j));
    v.nodes = nodes;
    v.els = els;
    v.map = map;
    Ok(out)
}

fn routines_file() -> std::path::PathBuf {
    crate::pony::memory_file().with_file_name("routines.json")
}

/// The node numbered `n` in the run's view.
fn node_of(app: &AppHandle, session: &str, n: usize) -> Option<Node> {
    let st = app.state::<Hands>();
    let views = st.views.lock().unwrap();
    let v = views.get(session)?;
    v.map.get(n.checked_sub(1)?).map(|&i| v.nodes[i].clone())
}

/// A replayed step's element in a fresh view of the window: its number there.
fn find_ref(app: &AppHandle, session: &str, role: &str, label: &str) -> Option<usize> {
    let st = app.state::<Hands>();
    let mut views = st.views.lock().unwrap();
    let v = views.get_mut(session)?;
    let (nodes, els) = ax::read(&v.win, 6000);
    let (_, map) = services::eyes::list(&nodes);
    let k = map.iter().position(|&i| nodes[i].role == role && nodes[i].label == label)?;
    v.nodes = nodes;
    v.els = els;
    v.map = map;
    Some(k + 1)
}

/// `routine_save`: the run's steps on the screen as an attempt at `intent`.
pub fn save_routine(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    let intent = args["intent"].as_str().unwrap_or("").trim();
    if intent.is_empty() {
        return Err("routine_save needs intent".into());
    }
    let (bundle, name) = {
        let st = app.state::<Hands>();
        let views = st.views.lock().unwrap();
        let v = views.get(session).ok_or("Nothing was done on the screen in this run")?;
        (v.bundle.clone(), v.app.clone())
    };
    let (steps, changed) = app.state::<Hands>().trail.lock().unwrap().remove(session).unwrap_or_default();
    if steps.is_empty() {
        return Err("No steps were done on the screen in this run".into());
    }
    let attempt = services::routines::Attempt {
        at: chrono::Utc::now().timestamp_millis(),
        worked: args["worked"].as_bool().unwrap_or(false),
        steps,
        changed,
        lesson: args["lesson"].as_str().unwrap_or("").trim().chars().take(300).collect(),
        app_version: ax::app_version(&bundle).unwrap_or_default(),
        model: crate::brain::model_name(app).unwrap_or_default(),
    };
    let worked = attempt.worked;
    let id = services::routines::record(&routines_file(), &bundle, &name, intent, attempt).map_err(|e| e.to_string())?;
    app.state::<App>().log.line(&format!("hands: routine {id} in {name} {}", if worked { "worked" } else { "failed" }));
    Ok(format!("Saved as routine {id}{}.", if worked { "; next time screen_do {routine: \"".to_string() + &id + "\"} replays it" } else { String::new() }))
}

/// The routines for the app Eyes just read, to show with the screen.
pub fn routines_for(bundle: &str) -> String {
    services::routines::for_app(&services::routines::load(&routines_file()), bundle, 6)
}

fn ask(app: &AppHandle, session: &str, detail: String) -> Result<(), String> {
    match crate::exec::approve(app, session, json!({"tool": "hands", "detail": detail, "canAlways": false})).as_str() {
        "once" | "always" => Ok(()),
        _ => Err("the user said no; don't try another way, ask them what they'd like".into()),
    }
}

/// Whether the current remembered view contains a risky button/link (Send, Pay, Buy, Delete…) so pressing Enter/Cmd+Enter asks first.
fn has_risky_button(app: &AppHandle, session: &str) -> bool {
    let st = app.state::<Hands>();
    let views = st.views.lock().unwrap();
    let Some(v) = views.get(session) else { return false };
    v.map.iter().any(|&i| {
        let n = &v.nodes[i];
        matches!(n.role.as_str(), "AXButton" | "AXLink" | "AXMenuItem") && h::risky(&n.label)
    })
}

fn one(app: &AppHandle, session: &str, pid: i32, win: &ax::El, app_name: &str, step: &Value) -> Result<String, String> {
    let kind = step["do"].as_str().unwrap_or("");
    let n = step["n"].as_u64().map(|n| n as usize);
    let target = match n {
        Some(n) => Some(element(app, session, n)?),
        None => None,
    };
    let label = target.as_ref().map(|t| t.1.label.clone()).unwrap_or_default();
    let at = target.as_ref().map(|t| center(&t.1)).unwrap_or_else(|| {
        let f = win.frame();
        (f.0 + f.2 / 2.0, f.1 + f.3 / 2.0)
    });
    let need = |what: &str| target.clone().ok_or(format!("{what} needs n"));
    // (sending, buying, paying, deleting: the user's OK first)
    let risky = match kind {
        "click" | "choose" => h::risky(&label),
        "menu" => step["path"].as_array().and_then(|p| p.last()).and_then(Value::as_str).is_some_and(h::risky),
        "key" => {
            let k = step["keys"].as_str().unwrap_or("").to_lowercase();
            let is_del = k.contains("delete") || k.contains("backspace");
            let is_submit = k == "enter" || k == "return" || ((k.contains("enter") || k.contains("return")) && k.contains("cmd"));
            (is_del && k.contains("cmd")) || (is_submit && has_risky_button(app, session))
        }
        _ => false,
    };
    if risky {
        let what = match kind {
            "menu" => step["path"].as_array().map(|p| p.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" › ")).unwrap_or_default(),
            "key" => step["keys"].as_str().unwrap_or("").to_string(),
            _ => format!("“{label}”"),
        };
        ask(app, session, format!("{app_name}\n{} {what}", kind))?;
    }
    if kind != "menu" && kind != "key" {
        let shown = if kind == "point" { step["say"].as_str().unwrap_or(&label).to_string() } else { label.chars().take(40).collect() };
        let (ox, oy) = to_overlay(app, at.0, at.1);
        show(app, json!({"do": if kind == "point" { "point" } else { "move" }, "x": ox, "y": oy, "kind": kind, "label": shown}));
        std::thread::sleep(Duration::from_millis(if kind == "point" { 900 } else { 320 }));
    }
    let ok = match kind {
        "point" => {
            need("point")?;
            return Ok(format!("pointed at [{}]", n.unwrap_or(0)));
        }
        "click" if step["spot"].is_string() => {
            // (a text spot from an OCR read: check risky label, then a real click there)
            let k: usize = step["spot"].as_str().unwrap_or("").trim_start_matches('t').parse().map_err(|_| "spot is like t3".to_string())?;
            let (spot_label, px, py) = {
                let st = app.state::<Hands>();
                let views = st.views.lock().unwrap();
                views.get(session).and_then(|v| v.spots.get(k.wrapping_sub(1)).cloned()).ok_or(format!("There's no spot t{k}: read the screen with mode ocr again"))?
            };
            if h::risky(&spot_label) {
                ask(app, session, format!("{app_name}\nclick “{spot_label}”"))?;
            }
            let (ox, oy) = to_overlay(app, px, py);
            show(app, json!({"do": "move", "x": ox, "y": oy, "kind": "click", "label": spot_label.chars().take(40).collect::<String>()}));
            std::thread::sleep(Duration::from_millis(320));
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            ax::click_at(px, py);
            show(app, json!({"do": "tap", "x": ox, "y": oy}));
            ax::settle(pid, win, 1500);
            return Ok(format!("click t{k}"));
        }
        "click" => {
            let (el, ..) = need("click")?;
            // (pressing through Accessibility needs no pointer and no focus; a click where there's no press action)
            el.act("AXPress") || {
                if !ax::bring(pid, win) {
                    return Err("the app couldn't come to the front".into());
                }
                ax::click_at(at.0, at.1);
                true
            }
        }
        "fill" => {
            let (el, node, web) = need("fill")?;
            if node.subrole == "AXSecureTextField" {
                return Err("Pony doesn't type passwords".into());
            }
            let text = step["text"].as_str().unwrap_or("");
            // (a page's editors want real keys; a native field takes its value, checked)
            let set = !web && el.set_flag("AXFocused", true) && el.set_text("AXValue", text) && el.value("AXValue") == text;
            set || {
                if !ax::bring(pid, win) {
                    return Err("the app couldn't come to the front".into());
                }
                if web || !el.set_flag("AXFocused", true) {
                    ax::click_at(at.0, at.1);
                }
                std::thread::sleep(Duration::from_millis(140));
                ax::press_combo(0, 0x0010_0000); // cmd+a: the old text goes
                ax::type_all(text);
                true
            }
        }
        "choose" => {
            let (el, ..) = need("choose")?;
            ax::choose(&el, step["option"].as_str().unwrap_or(""))
        }
        "key" => {
            let (code, flags) = h::keys(step["keys"].as_str().unwrap_or("")).ok_or("unknown keys")?;
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            ax::press_combo(code, flags);
            true
        }
        "scroll" => {
            let h = win.frame().3.max(300.0);
            let dy = (h * 0.8) as i32 * if step["direction"] == "up" { 1 } else { -1 };
            ax::scroll_at(at.0, at.1, dy);
            true
        }
        "menu" => {
            let path: Vec<String> = step["path"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
            ax::menu_path(pid, &path)
        }
        _ => return Err(format!("unknown step {kind}")),
    };
    if !ok {
        return Err(match kind {
            "choose" => format!("no option “{}” there", step["option"].as_str().unwrap_or("")),
            "menu" => "no such menu item (or it's disabled)".into(),
            _ => "it didn't work".into(),
        });
    }
    if kind != "menu" && kind != "key" {
        let (ox, oy) = to_overlay(app, at.0, at.1);
        show(app, json!({"do": "tap", "x": ox, "y": oy}));
    }
    ax::settle(pid, win, 1500);
    Ok(match (kind, n) {
        (_, Some(n)) => format!("{kind} [{n}]{}", if label.is_empty() { String::new() } else { format!(" “{}”", label.chars().take(30).collect::<String>()) }),
        ("menu", _) => format!("menu {}", step["path"].as_array().map(|p| p.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" › ")).unwrap_or_default()),
        _ => format!("{kind} {}", step["keys"].as_str().or(step["direction"].as_str()).unwrap_or("")),
    })
}

pub fn register(app: &AppHandle) {
    app.manage(Hands::default());
}
