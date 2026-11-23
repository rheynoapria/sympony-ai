//! The System tab over one second, beside Task Manager: `cargo run -p platform --example stats` (the battery, CPU
//! and network rates measured over one second, memory, disk, the session). `--example readings` gives one of each.
fn main() {
    use platform::os::system;
    use std::time::Duration;
    println!("power: {}", system::power());
    println!("cpu: {}", system::cpu_model());
    let (t0, n0) = (system::cpu_ticks(), system::network());
    std::thread::sleep(Duration::from_secs(1));
    let (t1, n1) = (system::cpu_ticks(), system::network());
    if let (Some(a), Some(b)) = (t0, t1) {
        let d: Vec<u64> = (0..4).map(|i| u64::from(b[i].wrapping_sub(a[i]))).collect();
        let total: u64 = d.iter().sum();
        println!("cpu busy: {:.1}%", if total > 0 { (total - d[2]) as f64 * 100.0 / total as f64 } else { 0.0 });
    }
    let gb = |b: u64| b as f64 / 1024f64.powi(3);
    if let Some((total, [page, internal, purgeable, wired, compressed])) = system::memory() {
        let used = (internal.saturating_sub(purgeable) + wired + compressed) * page;
        println!("memory: {:.1} of {:.1} GB used (apps {:.1}, wired {:.1}); pressure {:?}", gb(used), gb(total), gb(internal * page), gb(wired * page), system::memory_pressure());
    }
    if let Some((total, free)) = system::disk() {
        println!("disk {:?}: {:.0} GB free of {:.0} GB", system::disk_name(), gb(free), gb(total));
    }
    println!("network: {:.1} KB/s down, {:.1} KB/s up, wired {}", n1.0.saturating_sub(n0.0) as f64 / 1024.0, n1.1.saturating_sub(n0.1) as f64 / 1024.0, n1.2);
    println!("idle {:.1} s, locked {}, fullscreen app {}, caps lock {}", system::idle_secs(), system::screen_locked(), system::fullscreen_front(), system::caps_lock());
    #[cfg(not(target_os = "macos"))]
    if let Some(d) = platform::os::displays::displays_here().first() {
        let wins = system::onscreen_windows(d.frame, std::process::id());
        println!("windows on {:?}: {}", d.name, wins.len());
    }
}
