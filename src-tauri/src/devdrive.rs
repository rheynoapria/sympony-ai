//! Test builds only (`--features dev-drive`; the shipped app is built without it): a live check runs a script in one
//! of the app's windows and gets back its value, as the DevTools protocol's `Runtime.evaluate` gives it, from the app
//! itself (WebView2's `CallDevToolsProtocolMethod`). Starting WebView2 with a remote debugging port instead gets the
//! app ended by Microsoft Defender's behaviour monitoring (#73).
//!
//! `sympony --dev-eval <window> <script | @file>` sends `{type: "dev_eval", key, window, script}` over `agent.sock`,
//! with the key the app wrote to `<data>/dev-drive.key` when it started, and prints the value as JSON (or
//! `{"error": …}`, exit code 1). `<window>` is a window's label or a part of its page (`notch.html`).
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::commands::App;
use crate::mcp::UnixStream;

const KEY_FILE: &str = "dev-drive.key";
/// How long a script may run (one that waits on the app, an import or a dialog, takes a while).
const WAIT: Duration = Duration::from_secs(60);

struct Key(String);

/// A new key for this run, for `--dev-eval` to read.
pub fn start(app: &AppHandle) {
    let key = services::oauth::random();
    let path = app.state::<App>().data_dir.join(KEY_FILE);
    let log = &app.state::<App>().log;
    match std::fs::write(&path, &key) {
        Ok(()) => log.line("dev-drive: on (a test build): scripts run in the windows over agent.sock"),
        Err(e) => log.line(&format!("dev-drive: no key file: {e}")),
    }
    app.manage(Key(key));
}

/// A `dev_eval` request on `agent.sock` (mcp.rs): `{ok, value}` or `{ok: false, error}`; `None` for anything else.
pub fn route(app: &AppHandle, req: &Value) -> Option<Value> {
    if req["type"] != "dev_eval" {
        return None;
    }
    let key = app.try_state::<Key>()?;
    if req["key"].as_str() != Some(key.0.as_str()) {
        return Some(json!({"ok": false, "error": "wrong key (is this the test build's own data folder?)"}));
    }
    let window = req["window"].as_str().unwrap_or("");
    let script = req["script"].as_str().unwrap_or("");
    Some(match eval(app, window, script) {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(e) => json!({"ok": false, "error": e}),
    })
}

fn eval(app: &AppHandle, want: &str, script: &str) -> Result<Value, String> {
    let all: Vec<(String, String)> = app.webview_windows().into_iter()
        .map(|(label, w)| (label, w.url().map(|u| u.to_string()).unwrap_or_default()))
        .collect();
    let label = services::devdrive::pick(want, &all)?;
    let window = app.get_webview_window(&label).ok_or("the window closed")?;
    let params = json!({"expression": script, "returnByValue": true, "awaitPromise": true}).to_string();
    services::devdrive::result_of(&evaluate(&window, params)?)
}

/// `Runtime.evaluate` in the window's WebView2; its answer (JSON) comes back on the main thread.
#[cfg(windows)]
fn evaluate(window: &tauri::WebviewWindow, params: String) -> Result<String, String> {
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    window.with_webview(move |view| {
        let failed = tx.clone();
        let call = move || -> Result<(), String> {
            let core = unsafe { view.controller().CoreWebView2() }.map_err(|e| e.to_string())?;
            let method = CoTaskMemPWSTR::from("Runtime.evaluate");
            let params = CoTaskMemPWSTR::from(params.as_str());
            let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |res, json| {
                let _ = tx.send(res.map(|()| json).map_err(|e| e.to_string()));
                Ok(())
            }));
            unsafe { core.CallDevToolsProtocolMethod(*method.as_ref().as_pcwstr(), *params.as_ref().as_pcwstr(), &done) }
                .map_err(|e| e.to_string())
        };
        if let Err(e) = call() {
            let _ = failed.send(Err(e));
        }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(WAIT).map_err(|_| format!("no answer in {} s", WAIT.as_secs()))?
}

#[cfg(not(windows))]
fn evaluate(_window: &tauri::WebviewWindow, _params: String) -> Result<String, String> {
    Err("dev-drive runs scripts on Windows only".into())
}

/// `sympony --dev-eval <window> <script | @file>` (main.rs): prints the value as JSON; the exit code.
pub fn client(window: &str, script: &str) -> i32 {
    let fail = |e: String| {
        println!("{}", json!({"error": e}));
        1
    };
    let script = match script.strip_prefix('@') {
        Some(file) => match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => return fail(format!("can't read {file}: {e}")),
        },
        None => script.to_string(),
    };
    let data = services::paths::data_dir();
    let Ok(key) = std::fs::read_to_string(data.join(KEY_FILE)) else {
        return fail("no dev-drive.key in the data folder: is a dev-drive build running on it?".into());
    };
    let Ok(mut s) = UnixStream::connect(data.join("agent.sock")) else {
        return fail("Sympony isn't running on this data folder".into());
    };
    let _ = s.set_read_timeout(Some(WAIT + Duration::from_secs(5)));
    let req = json!({"type": "dev_eval", "key": key.trim(), "window": window, "script": script});
    if let Err(e) = writeln!(s, "{req}") {
        return fail(e.to_string());
    }
    let mut line = String::new();
    if BufReader::new((&s).take(64 << 20)).read_line(&mut line).is_err() || line.is_empty() {
        return fail("Sympony didn't answer".into());
    }
    let v: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
    if v["ok"] == true {
        println!("{}", v["value"]);
        0
    } else {
        fail(v["error"].as_str().unwrap_or("an odd answer").to_string())
    }
}
