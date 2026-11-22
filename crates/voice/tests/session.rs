use voice::engine::VoiceError;
use voice::session::{Action, Session, TriggerEv, VState};

#[test]
fn state_machine_edges() {
    // 1. Down -> LoadModel (in hybrid mode); light mode does NOT LoadModel for Qwen.
    let mut s = Session::new(false, true);
    assert_eq!(s.on_trigger(TriggerEv::Down, 100), vec![Action::LoadModel]);
    let mut light = Session::new(true, true);
    assert_eq!(light.on_trigger(TriggerEv::Down, 100), vec![]);

    // 2. HoldStart -> OpenMic + StartStream + Notify(Listening); partials throttled <= 5/s.
    let acts = s.on_trigger(TriggerEv::HoldStart, 350);
    assert_eq!(
        acts,
        vec![
            Action::OpenMic,
            Action::StartStream,
            Action::Notify(VState::Listening { since_ms: 350 }),
        ]
    );
    assert_eq!(
        s.on_audio_chunk(0.05, Some("halo"), 500),
        vec![Action::Partial("halo".into())]
    );
    // 100 ms later (< 200 ms throttle) -> suppressed.
    assert_eq!(s.on_audio_chunk(0.05, Some("halo dunia"), 600), vec![]);
    // >= 200 ms later -> emitted.
    assert_eq!(
        s.on_audio_chunk(0.05, Some("halo dunia"), 750),
        vec![Action::Partial("halo dunia".into())]
    );

    // 3. Up after >= 0.5 s -> CloseMic + Transcribe + Notify(Transcribing).
    let up_acts = s.on_trigger(TriggerEv::Up, 1500);
    assert_eq!(
        up_acts,
        vec![
            Action::CloseMic,
            Action::Transcribe,
            Action::Notify(VState::Transcribing),
        ]
    );

    // 4. Result ok -> Notify(Inserting) + Insert(text); on_inserted -> Idle.
    let res_acts = s.on_result(Ok("Halo dunia.".into()));
    assert_eq!(
        res_acts,
        vec![
            Action::Notify(VState::Inserting),
            Action::Insert("Halo dunia.".into()),
        ]
    );
    assert_eq!(s.on_inserted(), vec![Action::Notify(VState::Idle)]);

    // 5. Audio < 0.5 s -> CloseMic + Toast("Didn't hear anything") + Idle, no Transcribe/Insert.
    s.on_trigger(TriggerEv::HoldStart, 2000);
    let short_acts = s.on_trigger(TriggerEv::Up, 2300);
    assert_eq!(
        short_acts,
        vec![
            Action::CloseMic,
            Action::Toast("Didn't hear anything".into()),
            Action::Notify(VState::Idle),
        ]
    );

    // 6. All silence result -> Toast("Didn't hear anything") + Idle, no Insert.
    s.on_trigger(TriggerEv::HoldStart, 3000);
    s.on_trigger(TriggerEv::Up, 4000);
    assert_eq!(
        s.on_result(Err(VoiceError::Silence)),
        vec![
            Action::Toast("Didn't hear anything".into()),
            Action::Notify(VState::Idle),
        ]
    );

    // 7. Cancel while listening -> CloseMic + Idle, no insert.
    s.on_trigger(TriggerEv::HoldStart, 5000);
    assert_eq!(
        s.on_trigger(TriggerEv::Cancel, 5600),
        vec![Action::CloseMic, Action::Notify(VState::Idle)]
    );

    // 8. Cancel while transcribing -> result discarded when it arrives later (no stray paste).
    s.on_trigger(TriggerEv::HoldStart, 6000);
    s.on_trigger(TriggerEv::Up, 7000);
    assert_eq!(
        s.on_trigger(TriggerEv::Cancel, 7200),
        vec![Action::Notify(VState::Idle)]
    );
    assert_eq!(s.on_result(Ok("stray text".into())), vec![]);

    // 9. 55 s warning toast and 60 s auto-stop keeping text.
    s.on_trigger(TriggerEv::HoldStart, 10_000);
    let warn = s.on_audio_chunk(0.05, None, 65_000);
    assert!(warn.iter().any(|a| matches!(a, Action::Toast(_))));
    let cap = s.on_audio_chunk(0.05, None, 70_000);
    assert_eq!(
        cap,
        vec![
            Action::CloseMic,
            Action::Transcribe,
            Action::Notify(VState::Transcribing),
        ]
    );
    let kept = s.on_result(Ok("teks enam puluh detik".into()));
    assert!(kept.contains(&Action::Insert("teks enam puluh detik".into())));
    s.on_inserted();

    // 10. Hands-free DoubleTap stops after 2 s of VAD silence.
    let hf = s.on_trigger(TriggerEv::DoubleTap, 100_000);
    assert!(hf.contains(&Action::OpenMic));
    // Speech at 101_000
    assert_eq!(s.on_audio_chunk(0.04, None, 101_000), vec![]);
    // Silence for 1.5 s -> still listening
    assert_eq!(s.on_audio_chunk(0.001, None, 102_500), vec![]);
    // Silence >= 2.0 s -> auto-stop (CloseMic + Transcribe)
    let auto_stop = s.on_audio_chunk(0.001, None, 103_000);
    assert_eq!(
        auto_stop,
        vec![
            Action::CloseMic,
            Action::Transcribe,
            Action::Notify(VState::Transcribing),
        ]
    );
}

#[test]
fn hold_without_model_toasts() {
    let mut s = Session::new(false, false);
    assert_eq!(s.on_trigger(TriggerEv::Down, 100), vec![]);
    let acts = s.on_trigger(TriggerEv::HoldStart, 350);
    assert_eq!(
        acts,
        vec![
            Action::Toast("Model not downloaded".into()),
            Action::Notify(VState::Error("Model not downloaded".into())),
        ]
    );

    // Also test VoiceError::NoModel during result.
    let mut s2 = Session::new(false, true);
    s2.on_trigger(TriggerEv::HoldStart, 1000);
    s2.on_trigger(TriggerEv::Up, 2000);
    assert_eq!(
        s2.on_result(Err(VoiceError::NoModel)),
        vec![
            Action::Toast("Model not downloaded".into()),
            Action::Notify(VState::Error("Model not downloaded".into())),
        ]
    );
}
