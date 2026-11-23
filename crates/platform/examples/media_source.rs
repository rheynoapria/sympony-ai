//! A silent stand-in for Spotify & co. while trying Sympony's Music on Windows: two made-up songs ("Sympony test 1"
//! and "2", by "Sympony", with Sympony's icon as the cover) in the system media controls, at volume 0, for
//! `cargo run -p platform --example media_source [seconds]` (default 120). Nothing of yours plays or stops.
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Media::Core::MediaSource;
    use windows::Media::MediaPlaybackType;
    use windows::Media::Playback::{MediaPlaybackItem, MediaPlaybackList, MediaPlayer};
    use windows::Storage::Streams::{DataWriter, IRandomAccessStream, InMemoryRandomAccessStream, RandomAccessStreamReference};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let secs: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(120);
    // SAFETY: once, on this thread, before any WinRT call; never undone (the process ends)
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };

    let memory = |bytes: &[u8]| -> windows::core::Result<IRandomAccessStream> {
        let s = InMemoryRandomAccessStream::new()?;
        let w = DataWriter::CreateDataWriter(&s)?;
        w.WriteBytes(bytes)?;
        w.StoreAsync()?.join()?;
        w.DetachStream()?;
        s.Seek(0)?;
        Ok(s.into())
    };
    let cover = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../frontend/icon.png")).unwrap_or_default();
    let list = MediaPlaybackList::new()?;
    for n in 1..=2 {
        let audio = memory(&silence(150 + n * 30))?;
        let item = MediaPlaybackItem::Create(&MediaSource::CreateFromStream(&audio, &HSTRING::from("audio/wav"))?)?;
        let props = item.GetDisplayProperties()?;
        props.SetType(MediaPlaybackType::Music)?;
        let music = props.MusicProperties()?;
        music.SetTitle(&HSTRING::from(format!("Sympony test {n}")))?;
        music.SetArtist(&HSTRING::from("Sympony"))?;
        music.SetAlbumTitle(&HSTRING::from("Windows port"))?;
        if !cover.is_empty() {
            props.SetThumbnail(&RandomAccessStreamReference::CreateFromStream(&memory(&cover)?)?)?;
        }
        item.ApplyDisplayProperties(&props)?;
        list.Items()?.Append(&item)?;
    }
    let player = MediaPlayer::new()?;
    player.SetVolume(0.0)?;
    player.SetSource(&list)?;
    player.Play()?;
    println!("playing (silently) for {secs} s: \"Sympony test 1\", then 2");
    // where the player is, every 2 s (what a seek from Sympony should move)
    let session = player.PlaybackSession()?;
    for _ in 0..secs / 2 {
        std::thread::sleep(std::time::Duration::from_secs(2));
        let at = session.Position().map(|t| t.Duration as f64 / 1e7).unwrap_or(-1.0);
        println!("at {at:.1} s, seekable: {}", session.CanSeek().unwrap_or(false));
    }
    Ok(())
}

/// `secs` seconds of silence as a WAV file (8 kHz, mono, 16 bit).
#[cfg(windows)]
fn silence(secs: u32) -> Vec<u8> {
    let data = secs * 8000 * 2;
    let mut w = Vec::with_capacity(44 + data as usize);
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + data).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes()); // PCM
    w.extend_from_slice(&1u16.to_le_bytes()); // mono
    w.extend_from_slice(&8000u32.to_le_bytes());
    w.extend_from_slice(&16000u32.to_le_bytes()); // bytes a second
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&data.to_le_bytes());
    w.resize(44 + data as usize, 0);
    w
}

#[cfg(not(windows))]
fn main() {}
