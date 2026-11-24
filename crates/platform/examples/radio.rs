//! The radio's stream player: `cargo run -p platform --example radio -- <url> [volume 0-1]` plays a station (at volume
//! 0 unless given) and prints the player's state as it changes for 15 s, then stops. A bad address shows Failed.
fn main() {
    use platform::os::player;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let url = args.first().expect("radio <url> [volume]");
    let volume: f32 = args.get(1).and_then(|v| v.parse().ok()).unwrap_or(0.0);
    println!("play: {}", player::play(url, volume));
    let started = std::time::Instant::now();
    let mut last = None;
    while started.elapsed() < std::time::Duration::from_secs(15) {
        let now = format!("{:?}", player::state());
        if last.as_ref() != Some(&now) {
            println!("{:>5.1}s {now}", started.elapsed().as_secs_f32());
            last = Some(now);
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    player::stop();
    println!("after stop: {:?}", player::state());
}
