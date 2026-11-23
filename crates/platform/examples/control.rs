//! What Control's quick tiles read and set: `cargo run -p platform --example control` (dark mode, brightness),
//! `-- brightness <0-100>`, `-- watch <seconds>` (prints each brightness change), `-- awake <seconds>` (keeps awake
//! that long). Switching dark mode, locking and the
//! screenshot tool change the screen: try those from the Control tab.
fn main() {
    use platform::os::{radios, system};
    use std::time::{Duration, Instant};
    let a: Vec<String> = std::env::args().skip(1).collect();
    println!("dark mode: {}", radios::dark_mode());
    println!("brightness: {:?}", system::brightness());
    match a.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["brightness", n] => {
            let t = Instant::now();
            system::set_brightness(n.parse().unwrap_or(100));
            println!("set in {:?}", t.elapsed());
            for _ in 0..6 {
                std::thread::sleep(Duration::from_millis(250));
                println!("brightness: {:?}", system::brightness());
            }
        }
        ["watch", s] => {
            // (the brightness keys, Windows' slider: each change as it comes)
            let (end, mut last) = (Instant::now() + Duration::from_secs(s.parse().unwrap_or(10)), system::brightness());
            while Instant::now() < end {
                std::thread::sleep(Duration::from_millis(50));
                let now = system::brightness();
                if now != last {
                    println!("brightness: {now:?}");
                    last = now;
                }
            }
        }
        ["awake", s] => {
            println!("before: {}", awake_state());
            system::keep_awake(true);
            println!("kept awake: {}", awake_state());
            std::thread::sleep(Duration::from_secs(s.parse().unwrap_or(5)));
            system::keep_awake(false);
            println!("after: {}", awake_state());
        }
        _ => {}
    }
}

/// What the system is being kept on for, by any app (Windows' execution state).
#[cfg(windows)]
fn awake_state() -> String {
    use windows_sys::Win32::System::Power::{CallNtPowerInformation, SystemExecutionState};
    let mut state = 0u32;
    // SAFETY: a u32 out-buffer with its size, outliving the call
    unsafe { CallNtPowerInformation(SystemExecutionState, std::ptr::null(), 0, (&raw mut state).cast(), 4) };
    format!("{state:#x} (display {}, system {})", state & 2 != 0, state & 1 != 0)
}

#[cfg(not(windows))]
fn awake_state() -> String {
    "(read on Windows only)".into()
}
