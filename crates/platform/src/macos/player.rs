//! A stream player (AVFoundation's AVPlayer: MP3, AAC, HLS), for the radio. Main thread only: the player lives in
//! that thread's own slot.
use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_av_foundation::{AVPlayer, AVPlayerItemStatus, AVPlayerTimeControlStatus};
use objc2_foundation::{NSString, NSURL};
use std::cell::RefCell;

thread_local! {
    static PLAYER: RefCell<Option<Retained<AVPlayer>>> = const { RefCell::new(None) };
}

#[derive(Debug, PartialEq)]
pub enum State {
    Stopped,
    Connecting,
    Playing,
    /// AVFoundation's reason
    Failed(String),
}

/// Plays `url` at `volume` (0-1), instead of what played. False: not on the main thread or not an address.
pub fn play(url: &str, volume: f32) -> bool {
    let Some(mtm) = MainThreadMarker::new() else { return false };
    objc2::rc::autoreleasepool(|_| {
        let Some(u) = NSURL::URLWithString(&NSString::from_str(url)) else { return false };
        stop();
        let p = unsafe { AVPlayer::playerWithURL(&u, mtm) };
        unsafe {
            p.setVolume(volume.clamp(0.0, 1.0));
            p.play();
        }
        PLAYER.with(|s| *s.borrow_mut() = Some(p));
        true
    })
}

pub fn stop() {
    PLAYER.with(|s| {
        if let Some(p) = s.borrow_mut().take() {
            unsafe {
                p.pause();
                p.replaceCurrentItemWithPlayerItem(None);
            }
        }
    });
}

pub fn set_volume(volume: f32) {
    PLAYER.with(|s| {
        if let Some(p) = s.borrow().as_ref() {
            unsafe { p.setVolume(volume.clamp(0.0, 1.0)) };
        }
    });
}

pub fn state() -> State {
    objc2::rc::autoreleasepool(|_| {
        PLAYER.with(|s| {
            let b = s.borrow();
            let Some(p) = b.as_ref() else { return State::Stopped };
            let item = unsafe { p.currentItem() };
            if let Some(i) = &item {
                if unsafe { i.status() } == AVPlayerItemStatus::Failed {
                    let why = unsafe { i.error() }.map(|e| e.localizedDescription().to_string()).unwrap_or_default();
                    return State::Failed(why);
                }
            }
            match unsafe { p.timeControlStatus() } {
                AVPlayerTimeControlStatus::Playing => State::Playing,
                AVPlayerTimeControlStatus::WaitingToPlayAtSpecifiedRate => State::Connecting,
                // (paused by itself: the stream ended or stalled for good)
                _ => State::Failed(String::new()),
            }
        })
    })
}
