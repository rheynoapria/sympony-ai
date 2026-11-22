use platform::Secrets;
use serde_json::json;
use services::settings::Settings;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Mem(Mutex<HashMap<String, String>>);
impl Secrets for Mem {
    fn get(&self, k: &str) -> Option<String> { self.0.lock().unwrap().get(k).cloned() }
    fn set(&self, k: &str, v: &str) -> anyhow::Result<()> { self.0.lock().unwrap().insert(k.into(), v.into()); Ok(()) }
}

fn defaults() -> serde_json::Value {
    serde_json::from_str(include_str!("../../contract/defaults/settings.json")).unwrap()
}

#[test]
fn get_merges_defaults_and_file() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("settings.json"), r#"{"notchWidth": 90}"#).unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    assert_eq!(s.get()["notchWidth"], 90);
    assert_eq!(s.get()["expandedHeight"], defaults()["expandedHeight"]);
}

#[test]
fn set_saves_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    let out = s.set(json!({ "clock24h": true }));
    assert_eq!(out["clock24h"], true);
    let file: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.path().join("settings.json")).unwrap()).unwrap();
    assert_eq!(file["clock24h"], true);
    assert!(!dir.path().join("settings.json.tmp").exists());
}

#[test]
fn secrets_never_in_file() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    assert_eq!(s.get()["has_githubToken"], false);
    s.secret("githubToken", "ghp_x").unwrap();
    s.set(json!({ "githubToken": "leak" }));
    let text = std::fs::read_to_string(dir.path().join("settings.json")).unwrap();
    assert!(!text.contains("githubToken"), "{text}");
    assert_eq!(s.get()["has_githubToken"], true);
}

#[test]
fn broken_file_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("settings.json"), "{not json").unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    assert_eq!(s.get()["expandedHeight"], defaults()["expandedHeight"]);
    let kept: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.broken-")).collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(std::fs::read_to_string(kept[0].path()).unwrap(), "{not json");
}

#[test]
fn reset_restores_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    s.set(json!({ "notchWidth": 123 }));
    assert_eq!(s.reset()["notchWidth"], defaults()["notchWidth"]);
}

#[test]
fn unreadable_file_is_kept_not_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let bytes = [0xff, 0xfe, b'{', b'}'];
    std::fs::write(dir.path().join("settings.json"), bytes).unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    s.set(json!({ "clock24h": true }));
    let kept: Vec<_> = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.broken-")).collect();
    assert_eq!(kept.len(), 1);
    assert_eq!(std::fs::read(kept[0].path()).unwrap(), bytes);
}

#[derive(Default)]
struct Counting(Mutex<usize>);
impl Secrets for Counting {
    fn get(&self, _: &str) -> Option<String> { *self.0.lock().unwrap() += 1; None }
    fn set(&self, _: &str, _: &str) -> anyhow::Result<()> { Ok(()) }
}

#[test]
fn get_doesnt_ask_the_keychain_each_time() {
    let dir = tempfile::tempdir().unwrap();
    let c = Arc::new(Counting::default());
    let s = Settings::load(dir.path(), c.clone());
    let after_load = *c.0.lock().unwrap();
    for _ in 0..10 { s.get(); }
    assert_eq!(*c.0.lock().unwrap(), after_load);
}

#[test]
fn two_broken_files_in_a_second_both_kept() {
    let dir = tempfile::tempdir().unwrap();
    for text in ["{one", "{two"] {
        std::fs::write(dir.path().join("settings.json"), text).unwrap();
        Settings::load(dir.path(), Arc::new(Mem::default()));
    }
    let n = std::fs::read_dir(dir.path()).unwrap().filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("settings.json.broken-")).count();
    assert_eq!(n, 2);
}

#[test]
fn saved_is_only_what_the_user_set() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("settings.json"), r#"{"notchWidth": 90}"#).unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    // (a backup keeps choices, not today's defaults; the one exception: an install from before Sympony AI keeps
    // the agent brain it was using)
    assert_eq!(s.saved(), json!({"notchWidth": 90, "ponyBrain": "agent"}));
}

#[test]
fn new_installs_think_with_sympony_ai() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    let expected = if services::settings::has_builtin_ai() { "sympony" } else { "agent" };
    assert_eq!(s.get()["ponyBrain"], expected);
    assert_eq!(s.saved(), json!({}));
    std::fs::write(dir.path().join("settings.json"), r#"{"ponyBrain": "api"}"#).unwrap();
    assert_eq!(Settings::load(dir.path(), Arc::new(Mem::default())).get()["ponyBrain"], "api");
}

#[test]
fn snapshot_and_bool_or_reflect_updates() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    assert!(!s.bool_or("ytVideoFill", false));
    s.set(json!({"ytVideoFill": true}));
    assert!(s.bool_or("ytVideoFill", false));
    assert_eq!(s.snapshot()["ytVideoFill"], true);
}

#[test]
fn yt_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let s = Settings::load(dir.path(), Arc::new(Mem::default()));
    assert_eq!(s.get()["ytVideo"], true);
    assert_eq!(s.get()["ytVideoFill"], false);
}
