use serde_json::json;
use services::adhan::{check, patch, MAX_BYTES};

#[test]
fn audio_files_only_and_not_too_big() {
    assert_eq!(check("Adhan Makkah.MP3", 3_000_000), Ok(("audio/mpeg", "mp3".to_string())));
    assert_eq!(check("a.m4a", 1).unwrap().0, "audio/mp4");
    assert_eq!(check("a.wav", 1).unwrap().0, "audio/wav");
    assert!(check("notes.pdf", 1).unwrap_err().contains("audio"));
    assert!(check("noext", 1).is_err());
    assert!(check("long.mp3", MAX_BYTES + 1).unwrap_err().contains("25 MB"));
}

#[test]
fn settings_patch_per_slot() {
    assert_eq!(patch("default", "Makkah.mp3"), json!({"adhanFile": "Makkah.mp3", "adhanOn": true}));
    assert_eq!(patch("fajr", "Subuh.mp3"), json!({"adhanFajrFile": "Subuh.mp3"}));
    // cleared: the default one turns the adhan off
    assert_eq!(patch("default", ""), json!({"adhanFile": "", "adhanOn": false}));
    assert_eq!(patch("fajr", ""), json!({"adhanFajrFile": ""}));
}
