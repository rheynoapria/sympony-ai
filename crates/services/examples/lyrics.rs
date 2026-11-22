//! A live lyrics lookup, as the notch asks it: `cargo run -p services --example lyrics -- "<title>" "<artist>" [seconds]`.
fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let dir = std::env::temp_dir().join("sympony-lyrics-example");
    let _ = std::fs::create_dir_all(&dir);
    let ctx = services::Ctx { data_dir: dir, emit: std::sync::Arc::new(|_, _| {}), log: std::sync::Arc::new(|m| eprintln!("{m}")), changed: std::sync::Arc::new(|_| {}) };
    let mut reg = services::Registry::default();
    services::lyrics::register(&mut reg);
    let arg = serde_json::json!({ "title": a[0], "artist": a.get(1).cloned().unwrap_or_default(), "album": "", "duration": a.get(2).and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0) });
    let r = reg.call(&ctx, "lyrics.get", vec![arg]);
    let lines = r["synced"].as_array().map(|l| l.len()).unwrap_or(0);
    println!("found {} id {} timed lines {} first {:?}", r["found"], r["id"], lines, r["synced"][1]);
}
