//! The Control tab's switches: Wi-Fi (CoreWLAN), Bluetooth (IOBluetooth's preference calls, as blueutil uses), Dark
//! mode, the microphone's mute, locking the screen.
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject};
use objc2::msg_send;
use objc2_foundation::NSString;
use std::ffi::c_void;

#[link(name = "CoreWLAN", kind = "framework")]
unsafe extern "C" {}

#[link(name = "IOBluetooth", kind = "framework")]
unsafe extern "C" {
    fn IOBluetoothPreferenceGetControllerPowerState() -> i32;
    fn IOBluetoothPreferenceSetControllerPowerState(state: i32);
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFPreferencesAnyApplication: *const c_void;
    fn CFPreferencesCopyAppValue(key: *const c_void, app: *const c_void) -> *mut c_void;
    fn CFPreferencesAppSynchronize(app: *const c_void) -> u8;
}

fn wifi_iface() -> Option<Retained<AnyObject>> {
    let cls = AnyClass::get(c"CWWiFiClient")?;
    let client: Option<Retained<AnyObject>> = unsafe { msg_send![cls, sharedWiFiClient] };
    unsafe { msg_send![&*client?, interface] }
}

/// Wi-Fi's power; None without a Wi-Fi interface.
pub fn wifi_on() -> Option<bool> {
    objc2::rc::autoreleasepool(|_| wifi_iface().map(|i| unsafe { msg_send![&*i, powerOn] }))
}

/// The network's name (macOS gives it only to apps allowed Location, which Sympony asks for the weather).
pub fn wifi_ssid() -> Option<String> {
    objc2::rc::autoreleasepool(|_| {
        let i = wifi_iface()?;
        let s: Option<Retained<NSString>> = unsafe { msg_send![&*i, ssid] };
        s.map(|s| s.to_string())
    })
}

pub fn set_wifi(on: bool) -> bool {
    objc2::rc::autoreleasepool(|_| {
        let Some(i) = wifi_iface() else { return false };
        unsafe { msg_send![&*i, setPower: on, error: std::ptr::null_mut::<*mut AnyObject>()] }
    })
}

pub fn bluetooth_on() -> bool {
    unsafe { IOBluetoothPreferenceGetControllerPowerState() != 0 }
}

pub fn set_bluetooth(on: bool) {
    unsafe { IOBluetoothPreferenceSetControllerPowerState(on as i32) }
}

/// The system's appearance (it can change any time: read fresh).
pub fn dark_mode() -> bool {
    objc2::rc::autoreleasepool(|_| unsafe {
        CFPreferencesAppSynchronize(kCFPreferencesAnyApplication);
        let key = NSString::from_str("AppleInterfaceStyle");
        let v = CFPreferencesCopyAppValue(Retained::as_ptr(&key) as *const c_void, kCFPreferencesAnyApplication);
        let v: Option<Retained<AnyObject>> = Retained::from_raw(v as *mut AnyObject);
        v.and_then(|v| v.downcast::<NSString>().ok()).is_some_and(|s| s.to_string() == "Dark")
    })
}

/// Through System Events (macOS asks once to allow Sympony to control it).
pub fn set_dark_mode(on: bool) -> bool {
    let script = format!("tell application \"System Events\" to tell appearance preferences to set dark mode to {on}");
    std::process::Command::new("/usr/bin/osascript").args(["-e", &script]).status().is_ok_and(|s| s.success())
}

/// Locks the screen now (login.framework, what the menu's Lock Screen does).
pub fn lock_screen() {
    unsafe extern "C" {
        fn dlopen(path: *const i8, mode: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const i8) -> *mut c_void;
    }
    unsafe {
        let h = dlopen(c"/System/Library/PrivateFrameworks/login.framework/Versions/Current/login".as_ptr(), 1);
        let f = if h.is_null() { std::ptr::null_mut() } else { dlsym(h, c"SACLockScreenImmediate".as_ptr()) };
        if f.is_null() {
            let _ = std::process::Command::new("/usr/bin/pmset").arg("displaysleepnow").status();
            return;
        }
        let f: extern "C" fn() -> i32 = std::mem::transmute(f);
        f();
    }
}

/// The Wi-Fi signal in dBm (0 when not connected).
pub fn wifi_rssi() -> i64 {
    objc2::rc::autoreleasepool(|_| wifi_iface().map(|i| unsafe { msg_send![&*i, rssiValue] }).unwrap_or(0isize) as i64)
}

/// A network from a Wi-Fi scan: (ssid or None when macOS hides names, rssi, secure, enterprise, band).
pub type Net = (Option<String>, i64, bool, bool, String);

/// The networks around (a fresh scan when `scan`, else what the last one saw). None without Wi-Fi.
pub fn wifi_scan(scan: bool) -> Option<Vec<Net>> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let i = wifi_iface()?;
        // (a fresh scan fails when macOS holds scans back for a moment: then what the last one saw)
        let fresh: Option<Retained<AnyObject>> = if scan {
            msg_send![&*i, scanForNetworksWithName: std::ptr::null::<AnyObject>(), error: std::ptr::null_mut::<*mut AnyObject>()]
        } else {
            None
        };
        let set: Option<Retained<AnyObject>> = match fresh {
            Some(f) => Some(f),
            None => msg_send![&*i, cachedScanResults],
        };
        let Some(set) = set else { return Some(vec![]) };
        let all: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&*set, allObjects];
        Some(
            all.iter()
                .map(|n| {
                    let ssid: Option<Retained<NSString>> = msg_send![&*n, ssid];
                    let rssi: isize = msg_send![&*n, rssiValue];
                    let sec = |s: isize| -> bool { msg_send![&*n, supportsSecurity: s] };
                    let chan: Option<Retained<AnyObject>> = msg_send![&*n, wlanChannel];
                    let band: isize = chan.map(|c| msg_send![&*c, channelBand]).unwrap_or(0);
                    let band = match band {
                        1 => "2.4 GHz",
                        2 => "5 GHz",
                        3 => "6 GHz",
                        _ => "",
                    };
                    (ssid.map(|s| s.to_string()), rssi as i64, !sec(0), [7, 8, 9, 10, 12].iter().any(|s| sec(*s)), band.to_string())
                })
                .collect(),
        )
    })
}

/// The networks this Mac knows (System Settings → Wi-Fi → Known networks).
pub fn wifi_saved() -> Vec<String> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let Some(i) = wifi_iface() else { return vec![] };
        let conf: Option<Retained<AnyObject>> = msg_send![&*i, configuration];
        let Some(conf) = conf else { return vec![] };
        let profiles: Option<Retained<AnyObject>> = msg_send![&*conf, networkProfiles];
        let Some(profiles) = profiles else { return vec![] };
        let arr: Retained<objc2_foundation::NSArray<AnyObject>> = msg_send![&*profiles, array];
        arr.iter()
            .filter_map(|p| {
                let s: Option<Retained<NSString>> = msg_send![&*p, ssid];
                s.map(|s| s.to_string())
            })
            .collect()
    })
}

fn wifi_device() -> Option<String> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let i = wifi_iface()?;
        let n: Option<Retained<NSString>> = msg_send![&*i, interfaceName];
        n.map(|n| n.to_string())
    })
}

/// Joins a network (`networksetup` uses the saved password for a known one). Err: what macOS said.
pub fn wifi_join(ssid: &str, password: &str) -> Result<(), String> {
    let dev = wifi_device().ok_or("This Mac has no Wi-Fi")?;
    let mut cmd = std::process::Command::new("/usr/sbin/networksetup");
    cmd.args(["-setairportnetwork", &dev, ssid]);
    if !password.is_empty() {
        cmd.arg(password);
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    // (it prints the trouble and exits 0 all the same)
    let said = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)).trim().to_string();
    if out.status.success() && said.is_empty() { Ok(()) } else { Err(if said.is_empty() { "Couldn’t connect".into() } else { said }) }
}

pub fn wifi_leave() {
    objc2::rc::autoreleasepool(|_| {
        if let Some(i) = wifi_iface() {
            let _: () = unsafe { msg_send![&*i, disassociate] };
        }
    })
}

/// A paired Bluetooth device: (address, name, connected, class major, class minor).
pub type BtDevice = (String, String, bool, u32, u32);

/// The paired devices (none while Bluetooth is off or not allowed).
pub fn bluetooth_devices() -> Vec<BtDevice> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let Some(cls) = AnyClass::get(c"IOBluetoothDevice") else { return vec![] };
        let list: Option<Retained<objc2_foundation::NSArray<AnyObject>>> = msg_send![cls, pairedDevices];
        list.map(|l| {
            l.iter()
                .map(|d| {
                    let addr: Option<Retained<NSString>> = msg_send![&*d, addressString];
                    let name: Option<Retained<NSString>> = msg_send![&*d, name];
                    let connected: bool = msg_send![&*d, isConnected];
                    let major: u32 = msg_send![&*d, deviceClassMajor];
                    let minor: u32 = msg_send![&*d, deviceClassMinor];
                    let addr = addr.map(|a| a.to_string()).unwrap_or_default();
                    (addr.clone(), name.map(|n| n.to_string()).unwrap_or(addr), connected, major, minor)
                })
                .collect()
        })
        .unwrap_or_default()
    })
}

/// Connects (or disconnects) the device with this address (already checked to be paired). Err: macOS's IOReturn.
/// Synchronous (seconds, until the device answers or the page times out), as blueutil uses it.
pub fn bluetooth_connect(address: &str, on: bool) -> Result<(), i32> {
    objc2::rc::autoreleasepool(|_| unsafe {
        let cls = AnyClass::get(c"IOBluetoothDevice").ok_or(-1)?;
        let a = NSString::from_str(address);
        let d: Option<Retained<AnyObject>> = msg_send![cls, deviceWithAddressString: &*a];
        let d = d.ok_or(-1)?;
        let r: i32 = if on { msg_send![&*d, openConnection] } else { msg_send![&*d, closeConnection] };
        if r == 0 { Ok(()) } else { Err(r) }
    })
}
