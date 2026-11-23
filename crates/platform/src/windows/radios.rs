//! Wi-Fi, Bluetooth, airplane mode, dark mode and the lock screen. Wi-Fi's networks are `wifi.rs`' (Native Wifi).
//! Wi-Fi and Bluetooth are switched through Windows' radio switches (Windows.Devices.Radios, what the quick settings
//! use); airplane mode is Windows' own; dark mode is the registry's Personalize values, as Settings sets them.
//! Bluetooth's devices are stand-ins for now.
use super::shell::wide;
use ::windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};

pub use super::wifi::{wifi_join, wifi_leave, wifi_on, wifi_rssi, wifi_saved, wifi_scan, wifi_ssid};

/// (name, RSSI dBm, secured, enterprise, band), as on macOS.
pub type Net = (Option<String>, i64, bool, bool, String);

/// Windows' switch for this kind of radio; None without one.
fn radio(kind: RadioKind) -> Option<Radio> {
    super::mta();
    let all = Radio::GetRadiosAsync().ok()?.join().ok()?;
    (0..all.Size().ok()?).filter_map(|i| all.GetAt(i).ok()).find(|r| r.Kind().is_ok_and(|k| k == kind))
}

/// Switches a radio as the quick settings do; false without one, or when Windows refused (Settings → Privacy &
/// security → Radios can keep apps from it).
fn switch(kind: RadioKind, on: bool) -> bool {
    let Some(r) = radio(kind) else { return false };
    let allowed = |s: windows::core::Result<RadioAccessStatus>| s.is_ok_and(|s| s == RadioAccessStatus::Allowed);
    allowed(Radio::RequestAccessAsync().and_then(|a| a.join()))
        && allowed(r.SetStateAsync(if on { RadioState::On } else { RadioState::Off }).and_then(|a| a.join()))
}

pub fn set_wifi(on: bool) -> bool {
    switch(RadioKind::WiFi, on)
}

pub fn bluetooth_on() -> bool {
    radio(RadioKind::Bluetooth).and_then(|r| r.State().ok()) == Some(RadioState::On)
}

pub fn set_bluetooth(on: bool) {
    switch(RadioKind::Bluetooth, on);
}

/// Airplane mode, Windows' own (Settings → Network & internet): the system's switch for all its radios is off.
pub fn airplane() -> Option<bool> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
    let key = wide(r"SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState");
    let (mut v, mut size) = (0u32, 4u32);
    // SAFETY: a NUL-terminated key, the default value (no name) and a DWORD with its size, all outliving the call
    let read = unsafe { RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), std::ptr::null(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&raw mut v).cast(), &mut size) };
    (read == 0).then_some(v == 1)
}

/// Airplane mode on or off, as the quick settings' button does it: through Windows' radio manager (IRadioManager,
/// undocumented, the same since Windows 8). False when Windows refused.
pub fn set_airplane(on: bool) -> bool {
    // (RadioManagementAPI, IRadioManager: IsRMSupported, GetUIRadioInstances, GetSystemRadioState, then
    // SetSystemRadioState, the 7th; its argument is whether the radios may be on)
    const SET_SYSTEM_RADIO_STATE: usize = 6;
    type SetSystemRadioState = unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> windows::core::HRESULT;
    let Some(rm) = super::Undocumented::new(0x581333f6_28db_41be_bc7a_ff201f12f3f6, 0xdb3afbfb_08e6_46c6_aa70_bf9a34c30ab7) else { return false };
    // SAFETY: SetSystemRadioState's own signature, called with its object
    unsafe {
        let (this, call) = rm.method::<SetSystemRadioState>(SET_SYSTEM_RADIO_STATE);
        call(this, i32::from(!on)).is_ok()
    }
}

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

/// (address, name, connected, major class, minor class), as on macOS.
pub type BtDevice = (String, String, bool, u32, u32);

pub fn bluetooth_devices() -> Vec<BtDevice> {
    vec![]
}

pub fn bluetooth_connect(_address: &str, _on: bool) -> Result<(), i32> {
    Err(-1)
}
