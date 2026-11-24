//! Paired Bluetooth devices: what kind each is (the frontend's icon) and whether it plays sound (connect from Sympony).

/// `(kind, audio)` from the device's class (major, minor), as IOBluetooth gives them.
pub fn kind(major: u32, minor: u32) -> (&'static str, bool) {
    match major {
        1 => ("computer", false),
        2 => ("phone", false),
        4 => (if matches!(minor, 5 | 8 | 9) { "speaker" } else { "headphones" }, true),
        5 => match ((minor >> 4) & 3, minor & 0xF) {
            (1 | 3, _) => ("keyboard", false),
            (2, _) => ("mouse", false),
            (_, 1 | 2) => ("gamepad", false),
            _ => ("device", false),
        },
        7 => ("watch", false),
        _ => ("device", false),
    }
}

/// What a failed connect means (IOReturn from IOBluetooth on macOS; on Windows an HRESULT, or -2 for a device that
/// isn't a headset or speaker), in words.
pub fn connect_error(code: i32) -> String {
    match code as u32 {
        0xe00002d6 | 0xe00002bc => "The device isn’t nearby, or it’s off".into(),
        0xe00002c1 => "Bluetooth isn’t allowed for Sympony (System Settings → Privacy & Security → Bluetooth)".into(),
        // (-2) Windows connects keyboards, mice… by itself when they're on and nearby
        0xffff_fffe => "Windows connects this device by itself when it’s on and nearby".into(),
        // (HRESULT_FROM_WIN32: ERROR_DEVICE_NOT_CONNECTED, ERROR_GEN_FAILURE, ERROR_NOT_FOUND)
        0x8007_048f | 0x8007_001f | 0x8007_0490 => "The device isn’t nearby, or it’s off".into(),
        c if c & 0x8000_0000 != 0 && c >> 16 != 0xe000 => format!("Windows couldn’t do it (error {code:#x})"),
        _ => format!("macOS couldn’t do it (error {code:#x})"),
    }
}
