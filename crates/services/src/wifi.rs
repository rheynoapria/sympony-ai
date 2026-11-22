//! The Wi-Fi networks list (Bluetooth & Wi-Fi tab): one row per network name, the connected one first, then by signal.
use serde_json::{json, Value};

/// A network the scan saw.
pub struct Scan {
    pub ssid: String,
    pub rssi: i64,
    pub secure: bool,
    pub enterprise: bool,
    pub band: String,
}

/// Signal bars 0-4 from the RSSI (dBm), as macOS's menu draws them roughly.
pub fn bars(rssi: i64) -> i64 {
    match rssi {
        r if r >= -55 => 4,
        r if r >= -70 => 3,
        r if r >= -78 => 2,
        r if r >= -88 => 1,
        _ => 0,
    }
}

pub fn to_networks(scan: &[Scan], saved: &[String], connected: Option<&str>) -> Value {
    let mut best: Vec<&Scan> = vec![];
    for s in scan.iter().filter(|s| !s.ssid.is_empty()) {
        match best.iter_mut().find(|b| b.ssid == s.ssid) {
            Some(b) if b.rssi < s.rssi => *b = s,
            Some(_) => {}
            None => best.push(s),
        }
    }
    best.sort_by_key(|s| (Some(s.ssid.as_str()) != connected, -s.rssi));
    json!({
        "ok": true,
        "connected": connected,
        "networks": best.iter().map(|s| json!({"ssid": s.ssid, "bars": bars(s.rssi), "secure": s.secure, "saved": saved.contains(&s.ssid),
            "connected": Some(s.ssid.as_str()) == connected, "band": s.band, "enterprise": s.enterprise})).collect::<Vec<_>>(),
    })
}
