use services::stats::{clean_volume_name, cpu_busy, mem_breakdown, mem_used, memory_pressure_label};

#[test]
fn cpu_busy_is_the_share_of_non_idle_ticks_since_last() {
    // user, system, idle, nice
    let prev = [100, 50, 850, 0];
    let now = [130, 60, 910, 0]; // +30 user +10 system +60 idle
    assert!((cpu_busy(prev, now) - 0.4).abs() < 1e-9);
    assert_eq!(cpu_busy(prev, prev), 0.0); // no ticks: idle, not NaN
}

#[test]
fn cpu_busy_survives_counter_wrap() {
    let prev = [u32::MAX - 9, 0, 0, 0];
    let now = [10, 0, 20, 0]; // user +20 across the wrap, idle +20
    assert!((cpu_busy(prev, now) - 0.5).abs() < 1e-9);
}

#[test]
fn memory_used_is_app_plus_wired_plus_compressed() {
    // Activity Monitor's "Memory Used": app (internal - purgeable) + wired + compressed, in pages
    let page = 16384u64;
    let used = mem_used(page, 1000, 100, 300, 200);
    assert_eq!(used, (1000 - 100 + 300 + 200) * page);
    assert_eq!(mem_used(page, 10, 50, 0, 0), 0); // purgeable larger than internal: not negative
}

#[test]
fn wifi_quality_from_rssi() {
    use services::stats::wifi_quality;
    assert_eq!(wifi_quality(-50), 100);
    assert_eq!(wifi_quality(-75), 50);
    assert_eq!(wifi_quality(-100), 0);
    assert_eq!(wifi_quality(-30), 100);
    assert_eq!(wifi_quality(-120), 0);
}

#[test]
fn memory_breakdown_splits_app_wired_and_compressed() {
    let page = 16384u64;
    let total = 16 * 1024 * 1024 * 1024u64;
    let b = mem_breakdown(page, 1000, 100, 300, 200, total);
    assert_eq!(b.app, 900 * page);
    assert_eq!(b.wired, 300 * page);
    assert_eq!(b.compressed, 200 * page);
    assert_eq!(b.used, b.app + b.wired + b.compressed);

    // purgeable > internal never underflows
    let clamped_app = mem_breakdown(page, 10, 50, 20, 5, total);
    assert_eq!(clamped_app.app, 0);
    assert_eq!(clamped_app.used, 25 * page);

    // used clamps to total when total > 0
    let capped = mem_breakdown(page, 1000, 0, 500, 500, 1000 * page);
    assert_eq!(capped.used, 1000 * page);
}

#[test]
fn memory_pressure_maps_macos_levels() {
    assert_eq!(memory_pressure_label(1), Some("normal"));
    assert_eq!(memory_pressure_label(2), Some("warn"));
    assert_eq!(memory_pressure_label(4), Some("critical"));
    assert_eq!(memory_pressure_label(0), None);
    assert_eq!(memory_pressure_label(3), None);
    assert_eq!(memory_pressure_label(99), None);
}

#[test]
fn clean_volume_name_trims_and_rejects_blank() {
    assert_eq!(clean_volume_name("Macintosh HD"), Some("Macintosh HD".into()));
    assert_eq!(clean_volume_name("  Data Volume \n"), Some("Data Volume".into()));
    assert_eq!(clean_volume_name("   "), None);
    assert_eq!(clean_volume_name(""), None);
}
