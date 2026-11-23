//! Wi-Fi, Bluetooth, dark mode and the lock screen. Dark mode (the registry's Personalize values, as Settings sets
//! them) and locking work; Wi-Fi and Bluetooth are stand-ins for now (nothing read, nothing changed).
use super::shell::wide;

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

/// Where Windows keeps Light or Dark (Settings → Personalization → Colors → Choose your mode).
const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

/// The apps' mode, which Sympony and the other apps follow ("Custom" can set Windows' own the other way); read fresh,
/// as it can change any time.
pub fn dark_mode() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let (key, name) = (wide(PERSONALIZE), wide("AppsUseLightTheme"));
    let (mut light, mut size) = (1u32, 4u32);
    // SAFETY: NUL-terminated names and a DWORD with its size, all outliving the call
    let read = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&raw mut light).cast(), &mut size)
    };
    read == 0 && light == 0
}

/// Dark (or Light) for Windows and the apps, as choosing it in Settings does; Windows is then told, so the taskbar
/// and open apps follow at once.
pub fn set_dark_mode(on: bool) -> bool {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD};
    let (key, light) = (wide(PERSONALIZE), u32::from(!on));
    let set = ["AppsUseLightTheme", "SystemUsesLightTheme"].iter().all(|n| {
        let n = wide(n);
        // SAFETY: as in `dark_mode`
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), n.as_ptr(), REG_DWORD, (&raw const light).cast(), 4) == 0 }
    });
    // (every top-level window hears it: on a thread of its own, so a slow app never holds up the tile)
    std::thread::spawn(|| {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        let topic = wide("ImmersiveColorSet");
        // SAFETY: a NUL-terminated string that outlives the call, which Windows copies to each window
        unsafe { SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, topic.as_ptr() as isize, SMTO_ABORTIFHUNG, 1000, std::ptr::null_mut()) };
    });
    set
}

/// Locks the PC now (what Win+L does).
pub fn lock_screen() {
    // SAFETY: no arguments; it only asks Windows to show the lock screen
    unsafe { windows_sys::Win32::System::Shutdown::LockWorkStation() };
}

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
