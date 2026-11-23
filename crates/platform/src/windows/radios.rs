//! Wi-Fi, Bluetooth, dark mode and the lock screen (stand-in: nothing read, nothing changed yet).

pub fn wifi_on() -> Option<bool> {
    None
}

pub fn wifi_ssid() -> Option<String> {
    None
}

pub fn set_wifi(_on: bool) -> bool {
    false
}

pub fn bluetooth_on() -> bool {
    false
}

pub fn set_bluetooth(_on: bool) {}

pub fn dark_mode() -> bool {
    false
}

pub fn set_dark_mode(_on: bool) -> bool {
    false
}

pub fn lock_screen() {}

pub fn wifi_rssi() -> i64 {
    0
}

/// (name, RSSI dBm, secured, enterprise, band), as on macOS.
pub type Net = (Option<String>, i64, bool, bool, String);

pub fn wifi_scan(_scan: bool) -> Option<Vec<Net>> {
    None
}

pub fn wifi_saved() -> Vec<String> {
    vec![]
}

pub fn wifi_join(_ssid: &str, _password: &str) -> Result<(), String> {
    Err("Wi-Fi isn't available on Windows yet".into())
}

pub fn wifi_leave() {}

/// (address, name, connected, major class, minor class), as on macOS.
pub type BtDevice = (String, String, bool, u32, u32);

pub fn bluetooth_devices() -> Vec<BtDevice> {
    vec![]
}

pub fn bluetooth_connect(_address: &str, _on: bool) -> Result<(), i32> {
    Err(-1)
}
