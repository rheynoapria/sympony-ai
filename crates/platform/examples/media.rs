//! What Sympony's Music reads on Windows, and its controls: `cargo run -p platform --example media` (what plays, its
//! cover's size) or `-- <app> play|pause|toggle|next|prev|shuffle|repeat|seek <seconds>`, `<app>` as `poll` gives it
//! (e.g. `media_source.exe`, from `--example media_source`).
#[cfg(windows)]
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if let [app, action, rest @ ..] = a.as_slice() {
        let value = rest.first().and_then(|v| v.parse::<f64>().ok()).map(serde_json::Value::from).unwrap_or_default();
        println!("{app} {action}: {}", platform::os::media::command(app, action, &value));
        std::thread::sleep(std::time::Duration::from_millis(700));
    }
    println!("{:#}", platform::os::media::poll());
    match platform::os::media::artwork() {
        Some(b) => println!("cover: {} bytes ({})", b.len(), if b.starts_with(b"\x89PNG") { "PNG" } else { "JPEG?" }),
        None => println!("cover: none"),
    }
}

#[cfg(not(windows))]
fn main() {
    println!("macOS reads now playing through src-tauri/helper/media_mac.js");
}
