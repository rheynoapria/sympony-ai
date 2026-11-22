//! cargo run -p platform --example radios: what the Bluetooth & Wi-Fi tab reads (names need Location: the terminal
//! usually has none, Sympony has).
use platform::macos::radios::*;
fn main() {
    let nets = wifi_scan(false).unwrap_or_default();
    println!("wifi: on {:?}, connected {:?}, {} networks (cached), {} named, saved {}", wifi_on(), wifi_ssid(), nets.len(), nets.iter().filter(|n| n.0.is_some()).count(), wifi_saved().len());
    for n in nets.iter().take(5) {
        println!("  {:?} {} dBm secure {} enterprise {} {}", n.0, n.1, n.2, n.3, n.4);
    }
    println!("bluetooth: on {}", bluetooth_on());
    for d in bluetooth_devices() {
        println!("  {} {:?} connected {} class {}/{} → {:?}", d.0, d.1, d.2, d.3, d.4, (d.3, d.4));
    }
}
