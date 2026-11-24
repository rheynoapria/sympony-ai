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
    /// per-session Auto UI override (from voice commands or per-turn intent phrases)
    session_auto: Mutex<HashMap<String, bool>>,
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

/// Sets a per-session Auto UI override (voice commands, per-turn intent, or `set_auto_ui` mid-run).
pub fn set_session_auto_ui(app: &AppHandle, session: &str, on: bool) {
    if !session.is_empty() {
        app.state::<Hands>().session_auto.lock().unwrap().insert(session.to_string(), on);
    }
}

/// Whether Auto UI mode is active for `session` (per-session override first, else global `ponyAutoUi`; requires Hands on).
pub fn auto_ui_for(app: &AppHandle, session: &str) -> bool {
    if !available(app) {
        return false;
    }
    if !session.is_empty() {
        if let Some(&ov) = app.state::<Hands>().session_auto.lock().unwrap().get(session) {
            return ov;
        }
    }
    app.state::<App>().settings.get()["ponyAutoUi"] == true
}

/// `set_auto_ui` tool: persists `ponyAutoUi` in Settings (syncing notch, floating chat, and Settings UI)
/// and updates the current session immediately.
pub fn set_auto_ui(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    if !available(app) {
        return Err("Turn on Eyes and Hands first in Settings → Pony Assistant → Eyes.".into());
    }
    let Some(enabled) = args["enabled"].as_bool() else {
        return Err("set_auto_ui requires boolean `enabled`".into());
    };
    crate::commands::apply_settings_patch(app, json!({"ponyAutoUi": enabled}));
    set_session_auto_ui(app, session, enabled);
    let _ = app.emit("agent:step", json!({
        "session": session,
        "kind": "hands",
        "detail": if enabled { "Auto UI on" } else { "Auto UI off" },
    }));
    Ok(if enabled {
        "Auto UI mode is now ON (synced to the chat bar and Settings). Financial and destructive actions still ask first.".into()
    } else {
        "Auto UI mode is now OFF (back to Assisted mode).".into()
    })
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
        h.session_auto.lock().unwrap().remove(session);
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

/// Whether point `(x, y)` lies inside `win_frame` (with a small 4 pt margin) so pointer clicks never miss into another app.
fn inside_window(win_frame: (f64, f64, f64, f64), x: f64, y: f64) -> bool {
    if win_frame.2 <= 1.0 || win_frame.3 <= 1.0 {
        return true;
    }
    x >= win_frame.0 - 4.0
        && x <= win_frame.0 + win_frame.2 + 4.0
        && y >= win_frame.1 - 4.0
        && y <= win_frame.1 + win_frame.3 + 4.0
}

/// Folds the expanded Sympony notch if a pointer action targets the top-center band where the notch sits.
fn yield_for_point(app: &AppHandle, _x: f64, y: f64) {
    let (_, oy) = *app.state::<Hands>().origin.lock().unwrap();
    if y - oy < 380.0 && crate::shell::yield_notch(app) {
        std::thread::sleep(Duration::from_millis(180));
    }
}

/// Computes a horizontal point along `frame` for `frac` in `0.0..=1.0`, inset slightly from the edges.
fn point_on_bar(frame: (f64, f64, f64, f64), frac: f64) -> (f64, f64) {
    let f = frac.clamp(0.0, 1.0);
    let pad = (frame.2 * 0.02).clamp(3.0, 10.0).min(frame.2 / 4.0);
    let usable = (frame.2 - pad * 2.0).max(1.0);
    (frame.0 + pad + usable * f, frame.1 + frame.3 / 2.0)
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
            if let Some(ns) = crate::native::window(&w) {
                // SAFETY: live NSWindow on the main thread; orderFrontRegardless ensures overlay appears above focused browser/apps
                unsafe {
                    platform::os::window::style_onboarding_window(ns, 24);
                    platform::os::window::set_click_through(ns, true);
                    platform::os::window::set_window_level(ns, 24, Some(false));
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
            if let Some(ns) = crate::native::window(&w) {
                // SAFETY: a live NSWindow on the main thread; above windows, under the notch (25), clicks pass through
                unsafe {
                    platform::os::window::style_onboarding_window(ns, 24);
                    platform::os::window::set_click_through(ns, true);
                    platform::os::window::set_window_level(ns, 24, Some(false));
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
        let limit = if auto_ui_for(app, session) { h::MAX_ACTIONS_AUTO } else { h::MAX_ACTIONS };
        if *n > limit {
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
    let mut steered_before: Option<usize> = None;
    for (k, step) in steps.iter().enumerate() {
        if crate::brain::stopped(app, session) {
            stopped = Some("the user stopped Pony".into());
            break;
        }
        if crate::brain::has_steer(app, session) {
            steered_before = Some(k + 1);
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
    // (the window as it is now — re-query focused window in case a step opened a dialog/sheet/new window)
    let cur_win = ax::window(pid).unwrap_or_else(|| win.clone());
    let (nodes, els) = ax::read(&cur_win, 6000);
    let (list, map) = services::eyes::list(&nodes);
    let what = h::changes(&old_nodes, &old_map, &nodes, &map, &list);
    remember(app, session, pid, &app_name, &bundle, cur_win, nodes, els, map);
    if let Some(t) = app.state::<Hands>().trail.lock().unwrap().get_mut(session) {
        t.1 = what.chars().take(400).collect();
    }
    end_later(app, gen);
    app.state::<App>().log.line(&format!("hands: {} in {app_name}: {} done{}", steps.len(), done.len(), if stopped.is_some() { ", stopped" } else if steered_before.is_some() { ", steered" } else { "" }));
    let head = if done.is_empty() { String::new() } else { format!("Done: {}\n", done.join("; ")) };
    match (stopped, steered_before) {
        (Some(why), _) => Err(format!("{head}Stopped at {why}\n{what}")),
        (None, Some(step_no)) => Ok(format!("{head}Paused before step {step_no} because the user sent a live steering instruction. Read their latest message and follow it now.\n{what}")),
        (None, None) => Ok(format!("{head}{what}")),
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
        model: crate::agents::active_model_name(app).unwrap_or_default(),
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

fn yolo(app: &AppHandle) -> bool {
    app.state::<App>().settings.get()["ponyExecMode"] == "yolo"
}

fn label_needs_ok(label: &str, is_yolo: bool) -> bool {
    if is_yolo {
        h::destructive_or_financial(label)
    } else {
        h::risky(label)
    }
}

/// Whether the currently focused element is a search box or browser address bar (where pressing Enter searches/navigates, not buys/deletes).
fn focused_is_search_or_address(v: &View) -> bool {
    v.map.iter().any(|&i| {
        let n = &v.nodes[i];
        if !n.focused {
            return false;
        }
        if n.subrole == "AXSearchField" {
            return true;
        }
        if matches!(n.role.as_str(), "AXTextField" | "AXComboBox") {
            let l = n.label.to_lowercase();
            return ["search", "cari", "telusuri", "address", "url", "location", "omnibox", "find"]
                .iter()
                .any(|w| l.contains(w));
        }
        false
    })
}

/// Whether the current remembered view has an enabled risky submit button (`AXButton` only, never random page `AXLink`s)
/// while focus is NOT in a search/address field, so pressing Enter/Cmd+Enter asks first in Ask mode.
fn has_risky_button(app: &AppHandle, session: &str) -> bool {
    let st = app.state::<Hands>();
    let views = st.views.lock().unwrap();
    let Some(v) = views.get(session) else { return false };
    if focused_is_search_or_address(v) {
        return false;
    }
    v.map.iter().any(|&i| {
        let n = &v.nodes[i];
        n.enabled && n.role == "AXButton" && h::risky(&n.label)
    })
}

/// `screen_watch`: passively watches the active window in Rust (0 LLM tokens, no mouse movement) until an AI/app
/// response finishes and settles, or optional `wait_for` text appears, or `timeout_s` expires. Refreshes the
/// remembered view so Pony can summarize results and continue acting immediately.
pub fn watch(app: &AppHandle, session: &str, args: &Value) -> Result<String, String> {
    if !available(app) {
        return Err("Hands are off (Settings → Pony Assistant → Abilities → Eyes)".into());
    }
    if ax::secure_input() {
        return Err("A password field is active, so Pony doesn't watch now.".into());
    }
    let skip: Vec<String> = app.state::<App>().settings.snapshot()["ponyEyesSkip"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();
    let me = std::process::id() as i32;
    let wanted_app = args["app"].as_str().map(str::trim).filter(|s| !s.is_empty());

    let (pid, app_name, bundle, win, old_nodes, old_map) = if let Some(req) = wanted_app {
        let Some((pid, name, bundle)) = ax::find_running_app(req, me) else {
            return Err(format!("Couldn't find running app \"{req}\" to watch."));
        };
        if services::eyes::skipped(&bundle, &skip) {
            return Err(format!("{name} is kept private, so Pony doesn't watch it."));
        }
        let Some(win) = ax::window(pid) else {
            return Err(format!("{name} shows no window Sympony can watch."));
        };
        let (nodes, _) = ax::read(&win, 6000);
        let (_, map) = services::eyes::list(&nodes);
        (pid, name, bundle, win, nodes, map)
    } else {
        let cached = {
            let st = app.state::<Hands>();
            let views = st.views.lock().unwrap();
            views.get(session).map(|v| (v.pid, v.app.clone(), v.bundle.clone(), v.win.clone(), v.nodes.clone(), v.map.clone()))
        };
        if let Some(c) = cached {
            if services::eyes::skipped(&c.2, &skip) {
                return Err(format!("{} is kept private, so Pony doesn't watch it.", c.1));
            }
            c
        } else {
            let Some((pid, name, bundle)) = ax::front_app(me) else {
                return Err("There is no window to watch. Call screen_read first.".into());
            };
            if services::eyes::skipped(&bundle, &skip) {
                return Err(format!("{name} is kept private, so Pony doesn't watch it."));
            }
            let Some(win) = ax::window(pid) else {
                return Err(format!("{name} shows no window Sympony can watch."));
            };
            let (nodes, _) = ax::read(&win, 6000);
            let (_, map) = services::eyes::list(&nodes);
            (pid, name, bundle, win, nodes, map)
        }
    };

    let timeout_s = args["timeout_s"].as_f64().unwrap_or(120.0).clamp(5.0, 300.0) as f32;
    let settle_s = args["settle_s"].as_f64().unwrap_or(2.5).clamp(1.5, 10.0) as f32;
    let wait_for = args["wait_for"].as_str().map(String::from);

    let baseline_text = services::eyes::text(&old_nodes);
    let mut tracker = h::WatchTracker::new(baseline_text.clone(), wait_for, settle_s, timeout_s);

    let _ = app.emit("agent:step", json!({"session": session, "kind": "watch", "detail": app_name.chars().take(60).collect::<String>()}));
    let gen = begin(app, &app_name, win.frame());
    show(app, json!({"do": "watch", "status": app_name, "elapsed": 0, "busy": false}));

    let started = std::time::Instant::now();
    let mut last_ui_sec = 0u64;
    let (cur_win, final_nodes, final_els, outcome, steered) = loop {
        let mut wake_for_steer = false;
        for _ in 0..4 {
            std::thread::sleep(Duration::from_millis(200));
            if crate::brain::stopped(app, session) {
                end_later_ms(app, gen, 400);
                return Err("the user stopped Pony while watching".into());
            }
            if crate::brain::has_steer(app, session) {
                wake_for_steer = true;
                break;
            }
        }
        if ax::secure_input() {
            end_later_ms(app, gen, 400);
            return Err("a password field became active, so Pony stopped watching".into());
        }
        if ax::front_app(me).is_some_and(|(_, _, b)| services::eyes::skipped(&b, &skip)) {
            end_later_ms(app, gen, 400);
            return Err("a private app came to the front, so Pony stopped watching".into());
        }

        let cur_win = ax::window(pid).unwrap_or_else(|| win.clone());
        let (nodes, els) = ax::read(&cur_win, 6000);
        if wake_for_steer {
            break (cur_win, nodes, els, h::WatchState::Watching, true);
        }
        if nodes.is_empty() {
            end_later_ms(app, gen, 400);
            return Err(format!("{app_name}'s window closed or became unreadable while watching."));
        }
        let url = nodes.iter().find(|n| n.role == "AXWebArea").map(|n| n.url.clone()).unwrap_or_default();
        if services::eyes::blocked_url(&url) {
            end_later_ms(app, gen, 400);
            return Err("That page is a password manager or vault, so Pony stopped watching.".into());
        }
        let busy = h::is_busy(&nodes);
        let text = services::eyes::text(&nodes);
        let elapsed = started.elapsed().as_secs_f32();
        let state = tracker.tick(busy, &text, elapsed);

        let sec = started.elapsed().as_secs();
        if sec > last_ui_sec {
            last_ui_sec = sec;
            show(app, json!({"do": "watch", "status": app_name, "elapsed": sec, "busy": busy}));
        }

        if state != h::WatchState::Watching {
            break (cur_win, nodes, els, state, false);
        }
    };

    let elapsed_s = started.elapsed().as_secs();
    let title = cur_win.text("AXTitle");
    let url = final_nodes.iter().find(|n| n.role == "AXWebArea").map(|n| n.url.clone()).unwrap_or_default();
    let final_text = services::eyes::text(&final_nodes);
    let new_text = h::diff_text(&baseline_text, &final_text, 6000);
    let (list, map) = services::eyes::list(&final_nodes);
    let what = h::changes(&old_nodes, &old_map, &final_nodes, &map, &list);
    if !final_nodes.is_empty() {
        remember(app, session, pid, &app_name, &bundle, cur_win, final_nodes, final_els, map);
    }
    if steered {
        end_later_ms(app, gen, 400);
    } else {
        end_later(app, gen);
    }

    let status_line = if steered {
        format!("Watch paused early after {elapsed_s}s because the user sent a live steering instruction. Read their latest message and follow it now.")
    } else {
        match outcome {
            h::WatchState::Settled => format!("Watch finished after {elapsed_s}s (response settled)."),
            h::WatchState::Matched => format!("Watch matched target text after {elapsed_s}s."),
            h::WatchState::QuietTimeout => format!("Watch stopped after {elapsed_s}s with no new activity (the window may still be idle or hidden)."),
            h::WatchState::TimedOut | h::WatchState::Watching => format!("Watch reached {elapsed_s}s timeout (showing what appeared so far)."),
        }
    };
    app.state::<App>().log.line(&format!("hands: watch {app_name}: {status_line} (+{} chars)", new_text.len()));

    let mut body = String::new();
    if !new_text.trim().is_empty() {
        body.push_str("New text since watching started:\n");
        body.push_str(&new_text);
        body.push_str("\n\n");
    } else {
        body.push_str("(No new text appeared during watch.)\n\n");
    }
    body.push_str("Screen changes & updated element numbers:\n");
    body.push_str(&what);
    let wrapped = services::eyes::wrap(&app_name, &title, &url, &body);
    Ok(format!("{status_line}\n{wrapped}"))
}

fn one(app: &AppHandle, session: &str, pid: i32, win: &ax::El, app_name: &str, step: &Value) -> Result<String, String> {
    let is_yolo = yolo(app) || auto_ui_for(app, session);
    let kind = step["do"].as_str().unwrap_or("");
    let n = step["n"].as_u64().map(|n| n as usize);
    let target = match n {
        Some(n) => Some(element(app, session, n)?),
        None => None,
    };
    let label = target.as_ref().map(|t| t.1.label.clone()).unwrap_or_default();
    let click_at_pct = if kind == "click" { step["at"].as_f64() } else { None };
    let at = match (&target, click_at_pct) {
        (Some(t), Some(pct)) => point_on_bar(t.1.frame, pct / 100.0),
        (Some(t), None) => center(&t.1),
        (None, _) => {
            let f = win.frame();
            (f.0 + f.2 / 2.0, f.1 + f.3 / 2.0)
        }
    };
    let need = |what: &str| target.clone().ok_or(format!("{what} needs n"));
    // (sending, buying, paying, deleting: the user's OK first; YOLO only prompts on destructive/financial actions)
    let risky = match kind {
        "click" | "double_click" | "right_click" | "choose" | "slide" | "drag" => label_needs_ok(&label, is_yolo),
        "menu" => step["path"].as_array().and_then(|p| p.last()).and_then(Value::as_str).is_some_and(|l| label_needs_ok(l, is_yolo)),
        "key" => {
            let k = step["keys"].as_str().unwrap_or("").to_lowercase();
            let is_del = k.contains("delete") || k.contains("backspace");
            let is_submit = k == "enter" || k == "return" || ((k.contains("enter") || k.contains("return")) && k.contains("cmd"));
            (is_del && k.contains("cmd")) || (!is_yolo && is_submit && has_risky_button(app, session))
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
    if kind != "menu" && kind != "key" && kind != "slide" && kind != "drag" && kind != "wait" {
        let shown = if kind == "point" { step["say"].as_str().unwrap_or(&label).to_string() } else { label.chars().take(40).collect() };
        let (ox, oy) = to_overlay(app, at.0, at.1);
        show(app, json!({"do": if kind == "point" { "point" } else { "move" }, "x": ox, "y": oy, "kind": kind, "label": shown}));
        std::thread::sleep(Duration::from_millis(if kind == "point" { 900 } else { 320 }));
    }
    let wf = win.frame();
    let check_visible = |pt: (f64, f64)| -> Result<(), String> {
        if !inside_window(wf, pt.0, pt.1) {
            return Err(format!("element [{}] is scrolled out of view; scroll first before acting on it", n.unwrap_or(0)));
        }
        Ok(())
    };
    let ok = match kind {
        "wait" => {
            let ms = step["ms"].as_u64().unwrap_or(600).clamp(100, 5000);
            let started = std::time::Instant::now();
            while started.elapsed().as_millis() < ms as u128 {
                if crate::brain::stopped(app, session) {
                    return Err("the user stopped Pony".into());
                }
                if crate::brain::has_steer(app, session) {
                    return Ok(format!("wait paused early after {}ms for live user steering", started.elapsed().as_millis()));
                }
                std::thread::sleep(Duration::from_millis(80));
            }
            return Ok(format!("wait {ms}ms"));
        }
        "point" => {
            need("point")?;
            return Ok(format!("pointed at [{}]", n.unwrap_or(0)));
        }
        "click" | "double_click" | "right_click" | "hover" if step["spot"].is_string() => {
            // (a text spot from an OCR read: check risky label, then a real pointer action there)
            let k: usize = step["spot"].as_str().unwrap_or("").trim_start_matches('t').parse().map_err(|_| "spot is like t3".to_string())?;
            let (spot_label, px, py) = {
                let st = app.state::<Hands>();
                let views = st.views.lock().unwrap();
                views.get(session).and_then(|v| v.spots.get(k.wrapping_sub(1)).cloned()).ok_or(format!("There's no spot t{k}: read the screen with mode ocr again"))?
            };
            if kind != "hover" && label_needs_ok(&spot_label, is_yolo) {
                ask(app, session, format!("{app_name}\n{kind} “{spot_label}”"))?;
            }
            let (ox, oy) = to_overlay(app, px, py);
            show(app, json!({"do": "move", "x": ox, "y": oy, "kind": kind, "label": spot_label.chars().take(40).collect::<String>()}));
            std::thread::sleep(Duration::from_millis(320));
            yield_for_point(app, px, py);
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            match kind {
                "double_click" => ax::double_click_at(px, py),
                "right_click" => ax::right_click_at(px, py),
                "hover" => ax::mouse_move(px, py),
                _ => ax::click_at(px, py),
            }
            if kind != "hover" {
                show(app, json!({"do": "tap", "x": ox, "y": oy}));
            }
            ax::settle(pid, win, if kind == "hover" { 600 } else { 1500 });
            return Ok(format!("{kind} t{k}"));
        }
        "hover" => {
            let _ = need("hover")?;
            check_visible(at)?;
            yield_for_point(app, at.0, at.1);
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            ax::mouse_move(at.0, at.1);
            ax::settle(pid, win, 600);
            return Ok(format!("hover [{}]", n.unwrap_or(0)));
        }
        "right_click" => {
            let _ = need("right_click")?;
            check_visible(at)?;
            yield_for_point(app, at.0, at.1);
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            ax::right_click_at(at.0, at.1);
            true
        }
        "double_click" => {
            let _ = need("double_click")?;
            check_visible(at)?;
            yield_for_point(app, at.0, at.1);
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            ax::double_click_at(at.0, at.1);
            true
        }
        "click" => {
            let (el, ..) = need("click")?;
            if click_at_pct.is_some() {
                check_visible(at)?;
                yield_for_point(app, at.0, at.1);
                if !ax::bring(pid, win) {
                    return Err("the app couldn't come to the front".into());
                }
                ax::click_at(at.0, at.1);
                true
            } else {
                // (pressing through Accessibility needs no pointer and no focus; a click where there's no press action)
                el.act("AXPress") || {
                    check_visible(at)?;
                    yield_for_point(app, at.0, at.1);
                    if !ax::bring(pid, win) {
                        return Err("the app couldn't come to the front".into());
                    }
                    ax::click_at(at.0, at.1);
                    true
                }
            }
        }
        "slide" => {
            let (el, node, ..) = need("slide")?;
            let min_v = node.min_val.or_else(|| el.number("AXMinValue"));
            let max_v = node.max_val.or_else(|| el.number("AXMaxValue"));
            let req_val = step["value"].as_f64();
            let req_pct = step["percent"].as_f64();
            if req_val.is_none() && req_pct.is_none() {
                return Err("slide needs value or percent".into());
            }
            let (target_val, frac) = match (req_val, req_pct, min_v, max_v) {
                (Some(v), _, Some(lo), Some(hi)) if hi > lo => {
                    let clamped = v.clamp(lo, hi);
                    (Some(clamped), (clamped - lo) / (hi - lo))
                }
                (Some(v), _, _, _) => (Some(v), (v / 100.0).clamp(0.0, 1.0)),
                (None, Some(p), Some(lo), Some(hi)) if hi > lo => {
                    let f = (p / 100.0).clamp(0.0, 1.0);
                    (Some(lo + f * (hi - lo)), f)
                }
                (None, Some(p), _, _) => (None, (p / 100.0).clamp(0.0, 1.0)),
                _ => (None, 0.5),
            };
            let (tx, ty) = point_on_bar(node.frame, frac);
            let (ox, oy) = to_overlay(app, tx, ty);
            show(app, json!({"do": "move", "x": ox, "y": oy, "kind": "slide", "label": label.chars().take(40).collect::<String>()}));
            std::thread::sleep(Duration::from_millis(320));
            // 1. Try native Accessibility numeric AXValue (exact for QuickTime timeline, volume/settings sliders, etc.)
            let ax_ok = if let Some(tv) = target_val {
                let set = el.set_number("AXValue", tv);
                if set {
                    std::thread::sleep(Duration::from_millis(80));
                    match el.number("AXValue") {
                        Some(now) => {
                            let span = max_v.zip(min_v).map(|(h, l)| (h - l).abs()).unwrap_or(100.0).max(1.0);
                            (now - tv).abs() <= (span * 0.08).max(1.5)
                        }
                        None => true,
                    }
                } else {
                    false
                }
            } else {
                false
            };
            let ok_slide = if ax_ok {
                true
            } else {
                // 2. Fallback: bring app forward and click/scrub directly on the bar at the target position
                yield_for_point(app, tx, ty);
                if !ax::bring(pid, win) {
                    return Err("the app couldn't come to the front".into());
                }
                ax::click_at(tx, ty);
                true
            };
            show(app, json!({"do": "tap", "x": ox, "y": oy}));
            ax::settle(pid, win, 1500);
            if !ok_slide {
                return Err("couldn't move slider".into());
            }
            let desc = match (target_val, req_pct) {
                (Some(v), _) => format!("slide [{}] to {:.1}", n.unwrap_or(0), v),
                (None, Some(p)) => format!("slide [{}] to {:.0}%", n.unwrap_or(0), p.clamp(0.0, 100.0)),
                _ => format!("slide [{}]", n.unwrap_or(0)),
            };
            return Ok(desc);
        }
        "drag" => {
            let (el, node, ..) = need("drag")?;
            let min_v = node.min_val.or_else(|| el.number("AXMinValue"));
            let max_v = node.max_val.or_else(|| el.number("AXMaxValue"));
            let cur_v = el.number("AXValue").or_else(|| node.value.trim().parse::<f64>().ok());
            let (sx, sy) = match (cur_v, min_v, max_v) {
                (Some(c), Some(lo), Some(hi)) if hi > lo => point_on_bar(node.frame, (c - lo) / (hi - lo)),
                _ => center(&node),
            };
            let (ex, ey) = if let Some(to_n) = step["to_n"].as_u64() {
                let (_, dst, _) = element(app, session, to_n as usize)?;
                center(&dst)
            } else if let Some(pct) = step["percent"].as_f64() {
                point_on_bar(node.frame, pct / 100.0)
            } else if step["dx"].is_number() || step["dy"].is_number() {
                (sx + step["dx"].as_f64().unwrap_or(0.0), sy + step["dy"].as_f64().unwrap_or(0.0))
            } else {
                return Err("drag needs to_n, percent, or dx/dy".into());
            };
            yield_for_point(app, sx.min(ex), sy.min(ey));
            if !ax::bring(pid, win) {
                return Err("the app couldn't come to the front".into());
            }
            let (osx, osy) = to_overlay(app, sx, sy);
            let (oex, oey) = to_overlay(app, ex, ey);
            show(app, json!({"do": "move", "x": osx, "y": osy, "kind": "drag", "label": label.chars().take(40).collect::<String>()}));
            std::thread::sleep(Duration::from_millis(260));
            show(app, json!({"do": "move", "x": oex, "y": oey, "kind": "drag", "label": label.chars().take(40).collect::<String>()}));
            ax::drag(sx, sy, ex, ey);
            show(app, json!({"do": "tap", "x": oex, "y": oey}));
            ax::settle(pid, win, 1500);
            return Ok(format!("drag [{}]", n.unwrap_or(0)));
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
                    check_visible(at)?;
                    yield_for_point(app, at.0, at.1);
                    ax::click_at(at.0, at.1);
                }
                std::thread::sleep(Duration::from_millis(140));
                ax::press_combo(0, 0x0010_0000); // cmd+a: the old text goes
                std::thread::sleep(Duration::from_millis(45));
                if text.is_empty() {
                    ax::press_key(51, false); // Backspace/Delete actually clears the field
                } else {
                    ax::type_all(text);
                }
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
            let times = step["repeat"].as_u64().unwrap_or(1).clamp(1, 20);
            for i in 0..times {
                ax::press_combo(code, flags);
                if i + 1 < times {
                    std::thread::sleep(Duration::from_millis(55));
                }
            }
            true
        }
        "scroll" => {
            let dir = step["direction"].as_str().unwrap_or("down");
            yield_for_point(app, at.0, at.1);
            match dir {
                "left" | "right" => {
                    let w = wf.2.max(300.0);
                    let dx = (w * 0.6) as i32 * if dir == "left" { 1 } else { -1 };
                    ax::scroll_xy(at.0, at.1, dx, 0);
                }
                _ => {
                    let h = wf.3.max(300.0);
                    let dy = (h * 0.8) as i32 * if dir == "up" { 1 } else { -1 };
                    ax::scroll_at(at.0, at.1, dy);
                }
            }
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
