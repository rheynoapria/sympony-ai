//! A stream player for the radio: Windows' MediaPlayer (MP3, AAC, HLS). It stays out of the system media controls:
//! Music shows the radio itself, and would otherwise read Sympony's own player back as another app's. Main thread
//! only, as on macOS: the player lives in that thread's own slot.
use ::windows::core::HSTRING;
use ::windows::Foundation::{TypedEventHandler, Uri};
use ::windows::Media::Core::MediaSource;
use ::windows::Media::Playback::{MediaPlaybackState, MediaPlayer, MediaPlayerFailedEventArgs};
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

thread_local! {
    /// the player, and why it failed (MediaFailed comes on another thread)
    static PLAYER: RefCell<Option<(MediaPlayer, Arc<Mutex<Option<String>>>)>> = const { RefCell::new(None) };
}

#[derive(Debug, PartialEq)]
pub enum State {
    Stopped,
    Connecting,
    Playing,
    /// the player's reason
    Failed(String),
}

/// Plays `url` at `volume` (0-1) instead of what played. False: not an address, or Windows' player couldn't start.
pub fn play(url: &str, volume: f32) -> bool {
    let Ok(uri) = Uri::CreateUri(&HSTRING::from(url)) else { return false };
    stop();
    let failed = Arc::new(Mutex::new(None));
    let started = (|| -> ::windows::core::Result<MediaPlayer> {
        let p = MediaPlayer::new()?;
        p.CommandManager()?.SetIsEnabled(false)?;
        p.SetVolume(volume.clamp(0.0, 1.0) as f64)?;
        let why = failed.clone();
        p.MediaFailed(&TypedEventHandler::<MediaPlayer, MediaPlayerFailedEventArgs>::new(move |_, args| {
            let text = args.as_ref().map(|a| reason(a.Error().ok(), a.ErrorMessage().map(|m| m.to_string()).unwrap_or_default())).unwrap_or_default();
            *why.lock().unwrap() = Some(text);
            Ok(())
        }))?;
        p.SetSource(&MediaSource::CreateFromUri(&uri)?)?;
        p.Play()?;
        Ok(p)
    })();
    match started {
        Ok(p) => {
            PLAYER.with(|s| *s.borrow_mut() = Some((p, failed)));
            true
        }
        Err(_) => false,
    }
}

/// Why it failed, in words: Windows' own message, else what its error kind means.
fn reason(kind: Option<::windows::Media::Playback::MediaPlayerError>, message: String) -> String {
    use ::windows::Media::Playback::MediaPlayerError as E;
    if !message.trim().is_empty() {
        return message.trim().to_string();
    }
    match kind {
        Some(E::NetworkError) => "The station can’t be reached",
        Some(E::SourceNotSupported) => "This station’s stream isn’t one Windows can play",
        Some(E::DecodingError) => "The station’s stream couldn’t be decoded",
        Some(E::Aborted) => "The station stopped sending",
        _ => "",
    }
    .to_string()
}

pub fn stop() {
    PLAYER.with(|s| {
        if let Some((p, _)) = s.borrow_mut().take() {
            let _ = p.Pause();
            let _ = p.Close();
        }
    });
}

pub fn set_volume(volume: f32) {
    PLAYER.with(|s| {
        if let Some((p, _)) = s.borrow().as_ref() {
            let _ = p.SetVolume(volume.clamp(0.0, 1.0) as f64);
        }
    });
}

pub fn state() -> State {
    PLAYER.with(|s| {
        let b = s.borrow();
        let Some((p, failed)) = b.as_ref() else { return State::Stopped };
        if let Some(why) = failed.lock().unwrap().clone() {
            return State::Failed(why);
        }
        match p.PlaybackSession().and_then(|s| s.PlaybackState()) {
            Ok(MediaPlaybackState::Playing) => State::Playing,
            // (nothing yet, opening, filling its buffer)
            Ok(MediaPlaybackState::None | MediaPlaybackState::Opening | MediaPlaybackState::Buffering) => State::Connecting,
            // (paused by itself: the stream ended or stalled for good)
            _ => State::Failed(String::new()),
        }
    })
}
