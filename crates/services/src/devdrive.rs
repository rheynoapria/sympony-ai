//! Test builds' way to run a script in a window (src-tauri `devdrive.rs`, `--features dev-drive`), its pure part:
//! which window a request means, and what the DevTools protocol's `Runtime.evaluate` answered.
use serde_json::Value;

/// The window `want` names among `(label, page url)`: the one with that label, else the first by label whose label
/// or page holds it (as the DevTools way matched pages). `Err` says which windows there are.
pub fn pick(want: &str, windows: &[(String, String)]) -> Result<String, String> {
    let mut all: Vec<&(String, String)> = windows.iter().collect();
    all.sort();
    let found = all.iter().find(|(label, _)| label == want).or_else(|| {
        (!want.is_empty()).then(|| all.iter().find(|(label, url)| label.contains(want) || url.contains(want))).flatten()
    });
    match found {
        Some((label, _)) => Ok(label.clone()),
        None => {
            let there: Vec<String> = all.iter().map(|(label, url)| format!("{label} ({url})")).collect();
            Err(format!("no window {want:?}; there are: {}", there.join(", ")))
        }
    }
}

/// What `Runtime.evaluate` (`returnByValue`, `awaitPromise`) answered: the script's value (`null` for `undefined`),
/// or what it threw, or the protocol's own error.
pub fn result_of(raw: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(raw).map_err(|e| format!("an odd answer from WebView2: {e}"))?;
    if let Some(msg) = v["message"].as_str().filter(|_| v.get("code").is_some()) {
        return Err(msg.to_string());
    }
    if let Some(ex) = v.get("exceptionDetails") {
        let text = ex["exception"]["description"].as_str().or_else(|| ex["text"].as_str()).unwrap_or("the script threw");
        return Err(text.to_string());
    }
    Ok(v["result"].get("value").cloned().unwrap_or(Value::Null))
}
