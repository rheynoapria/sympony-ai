use serde_json::{json, Value};
use services::{store, Ctx};
use std::sync::{Arc, Mutex};

fn ctx(dir: &std::path::Path) -> (Ctx, Arc<Mutex<Vec<(String, Value)>>>) {
    let ev = Arc::new(Mutex::new(Vec::new()));
    let e = ev.clone();
    let ctx = Ctx {
        data_dir: dir.to_path_buf(),
        emit: Arc::new(move |c: &str, v: Value| e.lock().unwrap().push((c.to_string(), v))),
        log: Arc::new(|_: &str| {}),
        changed: Arc::new(|_| {}),
    };
    (ctx, ev)
}

#[test]
fn store_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = ctx(dir.path());
    assert_eq!(store::get(&ctx, "todo").unwrap(), Value::Null);
    store::set(&ctx, "todo", json!({ "items": [1] })).unwrap();
    assert_eq!(store::get(&ctx, "todo").unwrap(), json!({ "items": [1] }));
}

#[test]
fn store_emits_changed() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, ev) = ctx(dir.path());
    store::set(&ctx, "notes", json!({ "notes": [] })).unwrap();
    assert_eq!(ev.lock().unwrap()[0], ("store:notes".to_string(), json!({ "notes": [] })));
}

#[test]
fn store_refuses_paths() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = ctx(dir.path());
    assert!(store::set(&ctx, "../evil", json!(1)).is_err());
    assert!(store::get(&ctx, "a/b").is_err());
    // Internal files must never be readable or writable via store.*
    std::fs::write(dir.path().join("secrets.json"), r#"{"api":"secret"}"#).unwrap();
    assert!(store::get(&ctx, "secrets").is_err());
    assert!(store::set(&ctx, "secrets", json!({})).is_err());
    assert!(store::set(&ctx, "settings", json!({"ponyExec": true})).is_err());
    assert!(store::set(&ctx, "routines", json!([])).is_err());
    assert_eq!(std::fs::read_to_string(dir.path().join("secrets.json")).unwrap(), r#"{"api":"secret"}"#);
}

#[cfg(unix)]
#[test]
fn store_writes_files_with_0600_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = ctx(dir.path());
    store::set(&ctx, "todo", json!({ "items": [1] })).unwrap();
    let mode = std::fs::metadata(dir.path().join("todo.json")).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "expected 0600, got {:o}", mode);
}

#[test]
fn corrupt_store_is_kept_aside() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _) = ctx(dir.path());
    std::fs::write(dir.path().join("todo.json"), "{half").unwrap();
    assert_eq!(store::get(&ctx, "todo").unwrap(), Value::Null);
    store::set(&ctx, "todo", json!({ "items": [] })).unwrap();
    let kept: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("todo.json.broken-")).collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(std::fs::read_to_string(kept[0].path()).unwrap(), "{half");
}
