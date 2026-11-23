//! One reading of each system watcher: `cargo run -p platform --example readings`.
fn main() {
    use platform::os::system::*;
    if let Some(id) = std::env::args().nth(1) {
        use std::io::Write;
        let png = platform::os::apps::icon_png(&id, 64.0).expect("no such app");
        std::io::stdout().write_all(&png).unwrap();
        return;
    }
    println!("idle {:.1}s locked {} fullscreen {} focus {}", platform::os::system::idle_secs(), platform::os::system::screen_locked(), platform::os::system::fullscreen_front(), platform::os::system::focus_on());
    { use platform::os::radios::*; println!("wifi {:?} {:?} bt {} dark {} mic {:?}", wifi_on(), wifi_ssid(), bluetooth_on(), dark_mode(), platform::os::system::mic()); }
    println!("volume {:?}", volume());
    println!("brightness {:?}", brightness());
    println!("caps {}", caps_lock());
    println!("outputs {:?}\ninputs {:?}", audio_devices(false), audio_devices(true));
    println!("cpu {:?} {:?} memory {:?} disk {:?} net {:?}", cpu_model(), cpu_ticks(), memory(), disk(), network());
    // TIS runs on the main queue: ask from another thread while this one serves it
    #[cfg(target_os = "macos")]
    {
        std::thread::spawn(|| {
            println!("input {:?}", input_source());
            println!("power {}", power());
            std::process::exit(0);
        });
        unsafe { dispatch_main() };
    }
    // (no main queue to serve elsewhere)
    #[cfg(not(target_os = "macos"))]
    {
        println!("input {:?}", input_source());
        println!("power {}", power());
    }
}
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn dispatch_main() -> !;
}
// (and an app icon: `cargo run -p platform --example readings -- com.apple.Safari > /tmp/icon.png`)
