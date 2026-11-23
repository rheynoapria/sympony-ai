//! Now playing on Windows: the system media controls (GlobalSystemMediaTransportControls, the media flyout by the
//! volume), which Spotify, the browsers, Media Player, VLC… all report to. Answers in the shape `media_mac.js`'s
//! "music" part has, so `services::media::from_poll` reads both alike.
use serde_json::{json, Value};
use std::sync::Mutex;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Media::MediaPlaybackAutoRepeatMode as Repeat;

/// The manager (asked for once: about 10 ms each time).
static MANAGER: Mutex<Option<Manager>> = Mutex::new(None);

fn manager() -> Option<Manager> {
    // (the calls below wait on their answers, which a UI thread mustn't)
    super::mta();
    let mut m = MANAGER.lock().unwrap();
    if m.is_none() {
        *m = Manager::RequestAsync().and_then(|op| op.join()).ok();
    }
    m.clone()
}

/// After a call failed: ask for a new manager next time (the old one dies with Explorer, for one).
fn forget() {
    *MANAGER.lock().unwrap() = None;
}

fn sessions(m: &Manager) -> Vec<Session> {
    m.GetSessions().map(|v| v.into_iter().collect()).unwrap_or_default()
}

fn status(s: &Session) -> Option<Status> {
    s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).ok()
}

fn app(s: &Session) -> String {
    s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default()
}

/// Which song to show: what plays wins over what's paused (as on macOS), Windows' own pick (the flyout's) first.
fn pick(m: &Manager) -> Option<Session> {
    let current = m.GetCurrentSession().ok();
    let all = sessions(m);
    let playing = |s: &Session| status(s) == Some(Status::Playing);
    current.iter().find(|s| playing(s)).cloned().or_else(|| all.iter().find(|s| playing(s)).cloned()).or(current).or_else(|| all.into_iter().next())
}


/// 1601 → 1970 (a WinRT DateTime counts 100 ns ticks from 1601).
const UNIX_EPOCH_TICKS: i64 = 11_644_473_600 * 10_000_000;

/// 100 ns ticks since 1601 now.
fn ticks_now() -> i64 {
    let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (unix.as_nanos() / 100) as i64 + UNIX_EPOCH_TICKS
}

fn repeat_name(r: Repeat) -> &'static str {
    match r {
        Repeat::Track => "track",
        Repeat::List => "list",
        _ => "none",
    }
}

/// What's playing, as `media_mac.js`'s `nowPlaying` answers: `{state: "stopped"}` when nothing is.
pub fn poll() -> Value {
    let Some(m) = manager() else { return json!({ "state": "stopped" }) };
    let Some(s) = pick(&m) else {
        if m.GetSessions().is_err() {
            forget();
        }
        return json!({ "state": "stopped" });
    };
    read(&s).unwrap_or_else(|_| {
        forget();
        json!({ "state": "stopped" })
    })
}

fn read(s: &Session) -> windows::core::Result<Value> {
    let state = match s.GetPlaybackInfo()?.PlaybackStatus()? {
        Status::Playing => "playing",
        Status::Paused | Status::Changing | Status::Opened => "paused",
        _ => return Ok(json!({ "state": "stopped" })),
    };
    let info = s.GetPlaybackInfo()?;
    let props = s.TryGetMediaPropertiesAsync()?.join()?;
    let (title, artist, album) = (props.Title()?.to_string(), props.Artist()?.to_string(), props.AlbumTitle()?.to_string());
    let app = app(s);
    let rate = info.PlaybackRate().and_then(|r| r.Value()).ok().filter(|r| *r > 0.0).unwrap_or(1.0);
    let tl = s.GetTimelineProperties()?;
    let start = tl.StartTime()?.Duration;
    let duration = (tl.EndTime()?.Duration - start).max(0) as f64 / 1e7;
    // the position as of LastUpdatedTime: where it is by now while playing
    let mut position = (tl.Position()?.Duration - start).max(0) as f64 / 1e7;
    let updated = tl.LastUpdatedTime().map(|t| t.UniversalTime).unwrap_or(0);
    if state == "playing" && updated > 0 {
        position += ((ticks_now() - updated).max(0) as f64 / 1e7) * rate;
    }
    if duration > 0.0 {
        position = position.min(duration);
    }
    let c = info.Controls()?;
    let on = |f: windows::core::Result<bool>| f.unwrap_or(false);
    Ok(json!({
        "state": state,
        // (no stable id from the apps: the song itself, as for the browsers on macOS)
        "id": format!("{title}|{artist}|{album}"),
        "title": title, "artist": artist, "album": album, "app": app,
        "duration": duration, "position": position, "rate": rate, "stream": "",
        // when the app last told its position (ms since 1970): a new one (a seek, a stall) is sent at once
        "stamp": if updated > 0 { (updated - UNIX_EPOCH_TICKS) / 10_000 } else { 0 },
        "arts": i32::from(props.Thumbnail().is_ok()),
        "shuffle": info.IsShuffleActive().and_then(|v| v.Value()).ok(),
        "repeat": info.AutoRepeatMode().and_then(|v| v.Value()).ok().map(repeat_name),
        "canShuffle": on(c.IsShuffleEnabled()), "canRepeat": on(c.IsRepeatEnabled()),
        "canPrev": on(c.IsPreviousEnabled()), "canNext": on(c.IsNextEnabled()),
        "canSeek": on(c.IsPlaybackPositionEnabled()),
    }))
}

/// A control for `app` (the `app` of the song shown: only that one, never another app's song): play, pause, toggle,
/// next, prev, seek (`value` in seconds), shuffle, repeat (each press: off → all → one → off). False: the app said
/// no, or isn't there any more.
pub fn command(app_id: &str, action: &str, value: &Value) -> bool {
    let Some(m) = manager() else { return false };
    let Some(s) = sessions(&m).into_iter().find(|s| !app_id.is_empty() && app(s) == app_id) else { return false };
    let asked = (|| -> windows::core::Result<bool> {
        let op = match action {
            "play" => s.TryPlayAsync()?,
            "pause" => s.TryPauseAsync()?,
            "toggle" => s.TryTogglePlayPauseAsync()?,
            "next" => s.TrySkipNextAsync()?,
            "prev" => s.TrySkipPreviousAsync()?,
            "seek" => {
                let secs = value.as_f64().unwrap_or(0.0).max(0.0);
                let start = s.GetTimelineProperties()?.StartTime()?.Duration;
                s.TryChangePlaybackPositionAsync(start + (secs * 1e7) as i64)?
            }
            "shuffle" => {
                let on = s.GetPlaybackInfo()?.IsShuffleActive().and_then(|v| v.Value()).unwrap_or(false);
                s.TryChangeShuffleActiveAsync(!on)?
            }
            "repeat" => {
                let now = s.GetPlaybackInfo()?.AutoRepeatMode().and_then(|v| v.Value()).unwrap_or(Repeat::None);
                s.TryChangeAutoRepeatModeAsync(match now {
                    Repeat::None => Repeat::List,
                    Repeat::List => Repeat::Track,
                    _ => Repeat::None,
                })?
            }
            _ => return Ok(false),
        };
        op.join()
    })();
    asked.unwrap_or(false)
}

/// The cover of the song `poll` shows now, as its app gave it (JPEG or PNG bytes).
pub fn artwork() -> Option<Vec<u8>> {
    use windows::Storage::Streams::DataReader;
    let m = manager()?;
    let s = pick(&m)?;
    let stream = s.TryGetMediaPropertiesAsync().ok()?.join().ok()?.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = u32::try_from(stream.Size().ok()?).ok().filter(|n| *n > 0 && *n <= 16 << 20)?;
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let got = reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0; got as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes).filter(|b| !b.is_empty())
}
