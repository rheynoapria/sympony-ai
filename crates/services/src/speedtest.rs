//! The speed test's maths (pure): ping and jitter, Mbps, Cloudflare's place, the next size to fetch.

/// The ping (the median, ms) and jitter (the mean change from one ping to the next).
pub fn ping_stats(ms: &[f64]) -> (f64, f64) {
    if ms.is_empty() {
        return (0.0, 0.0);
    }
    let mut s = ms.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = if s.len() % 2 == 1 { s[s.len() / 2] } else { (s[s.len() / 2 - 1] + s[s.len() / 2]) / 2.0 };
    let jitter = if ms.len() < 2 { 0.0 } else { ms.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (ms.len() - 1) as f64 };
    (median, jitter)
}

pub fn mbps(bytes: u64, secs: f64) -> f64 {
    if secs <= 0.0 { 0.0 } else { bytes as f64 * 8.0 / secs / 1e6 }
}

/// Cloudflare's place from a `cf-ray` ("…-SIN").
pub fn colo(ray: &str) -> Option<String> {
    let (_, c) = ray.rsplit_once('-')?;
    (c.len() == 3 && c.chars().all(|ch| ch.is_ascii_uppercase())).then(|| c.to_string())
}

/// The server's own time from `server-timing` ("cfRequestDuration;dur=12.5"), to take off the ping.
pub fn server_ms(h: &str) -> Option<f64> {
    h.split([';', ',']).find_map(|p| p.trim().strip_prefix("dur=")).and_then(|d| d.parse().ok())
}

/// The download's data at most (the upload adds about 11 MB).
pub const CAP: u64 = 80_000_000;

/// After size `i` took `secs`: the next one, when it would take under ~8 s at that speed (well inside the 30 s a
/// request may take) and the data stays under CAP.
pub fn next_size(sizes: &[u64], i: usize, secs: f64, used: u64) -> Option<u64> {
    let n = *sizes.get(i + 1)?;
    let ahead = n as f64 / sizes[i].max(1) as f64 * secs;
    (ahead < 8.0 && used + n <= CAP).then_some(n)
}
