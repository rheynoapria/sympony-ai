use serde_json::{json, Value};
use services::{Ctx, Registry};
use std::sync::{Arc, Mutex};

fn ctx() -> (Ctx, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let l = lines.clone();
    let ctx = Ctx {
        data_dir: std::env::temp_dir(),
        emit: Arc::new(|_, _| {}),
        log: Arc::new(move |m: &str| l.lock().unwrap().push(m.to_string())),
        changed: Arc::new(|_| {}),
    };
    (ctx, lines)
}

#[test]
fn stub_for_unknown_method() {
    let (ctx, lines) = ctx();
    let reg = Registry::default();
    assert_eq!(reg.call(&ctx, "weather.get", vec![]), Value::Null);
    assert_eq!(reg.call(&ctx, "weather.get", vec![]), Value::Null);
    let seen = lines.lock().unwrap().iter().filter(|l| *l == "not implemented: weather.get").count();
    assert_eq!(seen, 1);
}

#[test]
fn contract_stub_is_returned() {
    let (ctx, _) = ctx();
    assert_eq!(Registry::default().call(&ctx, "shelf.list", vec![]), json!([]));
}

#[test]
fn handler_result_passes_through() {
    let (ctx, _) = ctx();
    let mut reg = Registry::default();
    reg.add("store.get", Box::new(|_, args| Ok(json!({ "got": args }))));
    assert_eq!(reg.call(&ctx, "store.get", vec![json!("todo")]), json!({ "got": ["todo"] }));
}

#[test]
fn handler_error_returns_stub_and_logs() {
    let (ctx, lines) = ctx();
    let mut reg = Registry::default();
    reg.add("shelf.list", Box::new(|_, _| anyhow::bail!("disk on fire")));
    assert_eq!(reg.call(&ctx, "shelf.list", vec![]), json!([]));
    assert!(lines.lock().unwrap().iter().any(|l| l.contains("shelf.list") && l.contains("disk on fire")));
}
