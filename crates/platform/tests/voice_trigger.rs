use platform::voice::{KeyInput, TriggerEvent, TriggerLogic, VoiceKey};

#[test]
fn hold_250_starts() {
    let mut t = TriggerLogic::new();
    assert_eq!(t.on_event(KeyInput::TargetDown, 1000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::Tick, 1249), vec![]);
    assert_eq!(t.on_event(KeyInput::Tick, 1250), vec![TriggerEvent::HoldStart]);
    // Further ticks while holding do not re-emit HoldStart.
    assert_eq!(t.on_event(KeyInput::Tick, 1500), vec![]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 2000), vec![TriggerEvent::Up]);
}

#[test]
fn short_press_ignored() {
    let mut t = TriggerLogic::new();
    assert_eq!(t.on_event(KeyInput::TargetDown, 1000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 1180), vec![]);
    assert_eq!(t.on_event(KeyInput::Tick, 1500), vec![]);
}

#[test]
fn trigger_ignores_combo() {
    let mut t = TriggerLogic::new();
    // ⌥ down, then `e` down (typing é), held past 250ms, then released: must Cancel and never HoldStart.
    assert_eq!(t.on_event(KeyInput::TargetDown, 1000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::OtherKey, 1060), vec![TriggerEvent::Cancel]);
    assert_eq!(t.on_event(KeyInput::Tick, 1300), vec![]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 1350), vec![]);
}

#[test]
fn double_tap_enters_handsfree() {
    let mut t = TriggerLogic::new();
    assert_eq!(t.on_event(KeyInput::TargetDown, 1000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 1080), vec![]);
    assert_eq!(t.on_event(KeyInput::TargetDown, 1200), vec![TriggerEvent::Down]);
    assert_eq!(
        t.on_event(KeyInput::TargetUp, 1260),
        vec![TriggerEvent::DoubleTap]
    );
    // Tap again stops hands-free.
    assert_eq!(t.on_event(KeyInput::TargetDown, 4000), vec![]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 4070), vec![TriggerEvent::Up]);
}

#[test]
fn esc_cancels() {
    let mut t = TriggerLogic::new();
    // Esc during active hold cancels and suppresses trailing Up.
    assert_eq!(t.on_event(KeyInput::TargetDown, 1000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::Tick, 1250), vec![TriggerEvent::HoldStart]);
    assert_eq!(t.on_event(KeyInput::Esc, 1500), vec![TriggerEvent::Cancel]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 1600), vec![]);

    // Esc during hands-free cancels cleanly.
    assert_eq!(t.on_event(KeyInput::TargetDown, 2000), vec![TriggerEvent::Down]);
    assert_eq!(t.on_event(KeyInput::TargetUp, 2050), vec![]);
    assert_eq!(t.on_event(KeyInput::TargetDown, 2150), vec![TriggerEvent::Down]);
    assert_eq!(
        t.on_event(KeyInput::TargetUp, 2200),
        vec![TriggerEvent::DoubleTap]
    );
    assert_eq!(t.on_event(KeyInput::Esc, 2600), vec![TriggerEvent::Cancel]);

    // VoiceKey round-trip check.
    assert_eq!(VoiceKey::from_setting("right_option"), VoiceKey::RightOption);
    assert_eq!(VoiceKey::RightOption.as_setting(), "right_option");
    assert_eq!(
        VoiceKey::from_setting("right_option+right_shift"),
        VoiceKey::Combo("right_option+right_shift".into())
    );
}

#[test]
#[ignore]
#[cfg(target_os = "macos")]
fn insert_fallback_restores_clipboard() {
    use platform::macos::voice::{is_secure_input_enabled, MacInsert};
    use platform::voice::{Insert, InsertResult};
    use std::process::Command;
    use std::thread;
    use std::time::Duration;

    // Seed pasteboard with "ORIGINAL".
    let mut pbcopy = Command::new("/usr/bin/pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .expect("spawn pbcopy");
    use std::io::Write;
    pbcopy.stdin.as_mut().unwrap().write_all(b"ORIGINAL").unwrap();
    pbcopy.wait().unwrap();

    let ins = MacInsert::new();
    let res = ins.insert("halo");
    thread::sleep(Duration::from_millis(450));
    let out = Command::new("/usr/bin/pbpaste").output().expect("pbpaste");
    let pb = String::from_utf8_lossy(&out.stdout).to_string();

    if is_secure_input_enabled() || !platform::macos::banners::trusted(false) {
        assert_eq!(res, InsertResult::Copied);
        assert_eq!(pb, "halo", "fallback must leave dictated text on pasteboard");
    } else {
        assert_eq!(res, InsertResult::Typed);
        assert_eq!(pb, "ORIGINAL", "clipboard must be restored after 300ms");
    }
}
