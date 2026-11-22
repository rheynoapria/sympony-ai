use platform::Secrets;
use services::secrets::FileSecrets;
use std::collections::HashMap;
use std::sync::Mutex;

struct Old(Mutex<HashMap<String, String>>, Mutex<usize>);
impl Secrets for Old {
    fn get(&self, key: &str) -> Option<String> {
        *self.1.lock().unwrap() += 1;
        self.0.lock().unwrap().get(key).cloned()
    }
    fn set(&self, _: &str, _: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

#[test]
fn round_trip_encrypted() {
    let d = tempfile::tempdir().unwrap();
    let s = FileSecrets::open(d.path(), None, &[]);
    s.set("githubToken", "ghp_secret123").unwrap();
    let raw = std::fs::read_to_string(d.path().join("secrets.json")).unwrap();
    assert!(raw.starts_with("sy1:") && !raw.contains("ghp_secret123"));
    let s = FileSecrets::open(d.path(), None, &[]);
    assert_eq!(s.get("githubToken").as_deref(), Some("ghp_secret123"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(d.path().join("secrets.key")).unwrap().permissions().mode() & 0o777, 0o600);
    }
}

#[test]
fn empty_value_removes() {
    let d = tempfile::tempdir().unwrap();
    let s = FileSecrets::open(d.path(), None, &[]);
    s.set("githubToken", "x").unwrap();
    s.set("githubToken", "").unwrap();
    assert_eq!(s.get("githubToken"), None);
}

#[test]
fn migrates_once() {
    let d = tempfile::tempdir().unwrap();
    let old = Old(Mutex::new(HashMap::from([("githubToken".to_string(), "from-keychain".to_string())])), Mutex::new(0));
    let s = FileSecrets::open(d.path(), Some(&old), &["githubToken", "claudeApiKey"]);
    assert_eq!(s.get("githubToken").as_deref(), Some("from-keychain"));
    let asked = *old.1.lock().unwrap();
    assert_eq!(asked, 2);
    // the file exists now: the Keychain isn't asked again
    let s = FileSecrets::open(d.path(), Some(&old), &["githubToken", "claudeApiKey"]);
    assert_eq!(s.get("githubToken").as_deref(), Some("from-keychain"));
    assert_eq!(*old.1.lock().unwrap(), asked);
}

#[test]
fn damaged_file_reads_unset() {
    let d = tempfile::tempdir().unwrap();
    FileSecrets::open(d.path(), None, &[]).set("githubToken", "x").unwrap();
    std::fs::write(d.path().join("secrets.json"), "sy1:garbage").unwrap();
    let s = FileSecrets::open(d.path(), None, &[]);
    assert_eq!(s.get("githubToken"), None);
    s.set("vlcPassword", "y").unwrap();
    assert_eq!(FileSecrets::open(d.path(), None, &[]).get("vlcPassword").as_deref(), Some("y"));
}
