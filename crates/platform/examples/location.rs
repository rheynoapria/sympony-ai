//! Sympony's "Detect my location", in two halves: `cargo run -p platform --example location` prints the permission;
//! `-- locate` finds this computer's position (rounded); `-- place <lat> <lon>` looks up the place at a position you
//! give. On a Mac only the permission is printed: CoreLocation's calls wait on the main queue, which nothing runs here.
use platform::location::{Fix, Locator};
use std::time::Duration;

fn main() {
    println!("permission: {}", platform::os::location::status());
    let args: Vec<String> = std::env::args().skip(1).collect();
    if cfg!(target_os = "macos") {
        return;
    }
    let loc = platform::os::location::CoreLocation;
    match args.first().map(String::as_str) {
        Some("locate") => match loc.locate(Duration::from_secs(15)) {
            Ok(fix) => println!("position: {:.2}, {:.2} (±{:.0} m)", fix.lat, fix.lon, fix.accuracy_m),
            Err(e) => println!("no position: {e:?}"),
        },
        Some("place") => {
            let num = |i: usize| args.get(i).and_then(|a| a.parse::<f64>().ok()).expect("place <lat> <lon>");
            let fix = Fix { lat: num(1), lon: num(2), accuracy_m: 0.0 };
            println!("place: {}", loc.place(&fix).map_or("(no name found)".into(), |p| p.to_string()));
        }
        _ => {}
    }
}
