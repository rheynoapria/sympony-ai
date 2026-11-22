//! The adhan the owner picked: which files are taken, and the settings a pick or a removal writes.
use serde_json::{json, Value};

/// Maximum adhan audio size: a recording, not an album.
pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// A file that can be the adhan: `(MIME type, lowercase extension)`, or the message Settings shows.
pub fn check(name: &str, size: u64) -> Result<(&'static str, String), String> {
    let ext = std::path::Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "aif" | "aiff" => "audio/aiff",
        _ => return Err("That isn’t an audio file (MP3, M4A, WAV, OGG…)".into()),
    };
    if size > MAX_BYTES {
        return Err("That file is over 25 MB; pick a shorter recording".into());
    }
    Ok((mime, ext))
}

/// The settings for slot `which` ("default" or "fajr") holding the file `name` ("" once removed). The adhan turns on
/// with its first file (Settings' switch asks for one) and off without it.
pub fn patch(which: &str, name: &str) -> Value {
    if which == "fajr" {
        json!({"adhanFajrFile": name})
    } else {
        json!({"adhanFile": name, "adhanOn": !name.is_empty()})
    }
}
