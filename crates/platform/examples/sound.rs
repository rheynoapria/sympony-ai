//! What Control's Sound reads and sets: `cargo run -p platform --example sound` (devices, volume, mic) or
//! `-- volume <0-100>`, `-- mute`, `-- mic`, `-- default out|in <number>` (a number from the list).
fn main() {
    use platform::os::system;
    let a: Vec<String> = std::env::args().skip(1).collect();
    match a.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["volume", n] => system::set_volume(n.parse().unwrap_or(0)),
        ["mute"] => system::toggle_mute(),
        ["mic"] => system::toggle_mic(),
        ["default", kind, n] => println!("set default: {}", system::set_default_device(n.parse().unwrap_or(0), *kind == "in")),
        _ => {}
    }
    for (label, input) in [("outputs", false), ("inputs", true)] {
        println!("{label}:");
        for (n, name, default) in system::audio_devices(input) {
            println!("  {}{n}  {name}", if default { "* " } else { "  " });
        }
    }
    println!("volume (level, muted): {:?}", system::volume());
    println!("mic (available, muted): {:?}", system::mic());
}
