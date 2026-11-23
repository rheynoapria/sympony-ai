//! What Control's tiles read and set: `cargo run -p platform --example control` (dark mode, brightness, Wi-Fi,
//! Bluetooth, airplane mode, Do not disturb), `-- scan [fresh]` (the Wi-Fi networks around), `-- focus on|off`,
//! `-- pick` (the screen colour picker; its colour is copied), `-- copy <text>` (to the clipboard),
//! `-- brightness <0-100>`, `-- watch <seconds>` (prints each brightness change), `-- awake <seconds>` (keeps awake
//! that long). Switching dark mode, the radios or airplane mode, locking and the screenshot tool change the screen or
//! the connection: try those from the Control tab.
fn main() {
    use platform::os::{radios, system};
    use std::time::{Duration, Instant};
    let a: Vec<String> = std::env::args().skip(1).collect();
    println!("dark mode: {}", radios::dark_mode());
    println!("brightness: {:?}", system::brightness());
    println!("wi-fi on: {:?}, network: {:?} ({} dBm)", radios::wifi_on(), radios::wifi_ssid(), radios::wifi_rssi());
    println!("bluetooth on: {}, airplane mode: {:?}, do not disturb: {}", radios::bluetooth_on(), radios::airplane(), system::focus_on());
    match a.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["scan"] | ["scan", "fresh"] => {
            let t = Instant::now();
            let nets = radios::wifi_scan(a.len() == 2);
            println!("scan in {:?}; saved: {:?}", t.elapsed(), radios::wifi_saved());
            for (name, rssi, secure, enterprise, band) in nets.unwrap_or_default() {
                println!("  {name:?} {rssi} dBm {band} secure={secure} enterprise={enterprise}");
            }
        }
        ["pick"] => {
            let picked = platform::os::displays::pick_color();
            println!("picked: {picked:?}");
            if let Some([r, g, b]) = picked {
                println!("copied: {}", platform::os::files::write_text(&format!("#{r:02X}{g:02X}{b:02X}")));
            }
        }
        ["copy", text] => println!("copied: {}", platform::os::files::write_text(text)),
        ["focus", on] => {
            println!("set: {}", system::set_focus(*on == "on"));
            std::thread::sleep(Duration::from_millis(500));
            println!("do not disturb: {}", system::focus_on());
        }
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
