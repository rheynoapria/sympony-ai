//! The System tab's numbers: the math between two readings.

/// The CPU's busy share (0..1) between two readings of its tick counters (user, system, idle, nice), which wrap.
pub fn cpu_busy(prev: [u32; 4], now: [u32; 4]) -> f64 {
    let d: Vec<u64> = (0..4).map(|i| now[i].wrapping_sub(prev[i]) as u64).collect();
    let total: u64 = d.iter().sum();
    if total == 0 {
        return 0.0;
    }
    (total - d[2]) as f64 / total as f64
}

/// Activity Monitor's "Memory Used" in bytes: app memory (internal - purgeable) + wired + compressed, from page counts.
pub fn mem_used(page: u64, internal: u64, purgeable: u64, wired: u64, compressed: u64) -> u64 {
    (internal.saturating_sub(purgeable) + wired + compressed) * page
}

/// Activity Monitor's memory breakdown in bytes: total used (clamped to `total` when > 0), app, wired, and compressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemBreakdown {
    pub used: u64,
    pub app: u64,
    pub wired: u64,
    pub compressed: u64,
}

pub fn mem_breakdown(page: u64, internal: u64, purgeable: u64, wired: u64, compressed: u64, total: u64) -> MemBreakdown {
    let app = internal.saturating_sub(purgeable).saturating_mul(page);
    let wired = wired.saturating_mul(page);
    let compressed = compressed.saturating_mul(page);
    let raw_used = app.saturating_add(wired).saturating_add(compressed);
    let used = if total > 0 { raw_used.min(total) } else { raw_used };
    MemBreakdown { used, app, wired, compressed }
}

/// Maps macOS `kern.memorystatus_vm_pressure_level` (1 normal, 2 warning, 4 critical) to its UI label.
pub fn memory_pressure_label(level: u32) -> Option<&'static str> {
    match level {
        1 => Some("normal"),
        2 => Some("warn"),
        4 => Some("critical"),
        _ => None,
    }
}

/// Normalizes a volume display name (trims whitespace; empty becomes `None`).
pub fn clean_volume_name(raw: &str) -> Option<String> {
    let s = raw.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// Windows' Wi-Fi signal quality (0-100) from the RSSI in dBm, as Windows maps it: -100 → 0, -50 or better → 100.
pub fn wifi_quality(rssi: i64) -> u8 {
    (2 * (rssi + 100)).clamp(0, 100) as u8
}
