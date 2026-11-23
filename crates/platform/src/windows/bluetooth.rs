//! Bluetooth's paired devices on Windows: the list (classic and LE, as Windows' Bluetooth settings show them: whether
//! each is connected and what kind it is) and connecting or disconnecting a headset or speaker. Reached as
//! `radios::…`, the names macOS has.
//!
//! Connecting is for sound devices only, as in Windows' own Settings: its Connect asks the Bluetooth audio driver to
//! reconnect (KSPROPSETID_BtAudio, the property Windows documents for it), which is what's done here. Windows
//! connects the others (a keyboard, a mouse) by itself when they're on and nearby.
use super::radios::BtDevice;
use ::windows::core::{Interface, HSTRING, PCWSTR};
use ::windows::Devices::Bluetooth::{BluetoothDevice, BluetoothLEDevice};
use ::windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};
use windows_collections::IIterable;
use ::windows::Foundation::IPropertyValue;
use ::windows::Win32::Media::Audio::{
    eCapture, eRender, IDeviceTopology, IMMDeviceEnumerator, IPart, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE, DEVICE_STATE_UNPLUGGED,
};
use ::windows::Win32::Media::KernelStreaming::{
    IKsControl, KSIDENTIFIER, KSIDENTIFIER_0, KSIDENTIFIER_0_0, KSPROPERTY_ONESHOT_DISCONNECT, KSPROPERTY_ONESHOT_RECONNECT, KSPROPERTY_TYPE_GET,
    KSPROPSETID_BtAudio,
};
use ::windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

/// `bluetooth_connect`'s error for a device that isn't a headset or speaker (`services::bluetooth::connect_error`).
pub const NOT_AUDIO: i32 = -2;

// (the device properties asked for along with each paired device)
const ADDRESS: &str = "System.Devices.Aep.DeviceAddress";
const CONNECTED: &str = "System.Devices.Aep.IsConnected";
const APPEARANCE: &str = "System.Devices.Aep.Bluetooth.Le.Appearance";
const COD_MAJOR: &str = "System.Devices.Aep.Bluetooth.Cod.Major";
const COD_MINOR: &str = "System.Devices.Aep.Bluetooth.Cod.Minor";

/// The paired devices: (address, name, connected, class major, class minor). A device that's both classic and LE is
/// listed once, as classic.
pub fn bluetooth_devices() -> Vec<BtDevice> {
    super::mta();
    let mut out: Vec<BtDevice> = vec![];
    for le in [false, true] {
        let selector = if le { BluetoothLEDevice::GetDeviceSelectorFromPairingState(true) } else { BluetoothDevice::GetDeviceSelectorFromPairingState(true) };
        let Ok(selector) = selector else { continue };
        // (an LE device's appearance; a classic one's class of device, major and minor)
        let class: &[&str] = if le { &[APPEARANCE] } else { &[COD_MAJOR, COD_MINOR] };
        let wanted: IIterable<HSTRING> = [ADDRESS, CONNECTED].iter().chain(class).map(|k| HSTRING::from(*k)).collect::<Vec<_>>().into();
        let found = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(&selector, &wanted, DeviceInformationKind::AssociationEndpoint).and_then(|f| f.join());
        let Ok(found) = found else { continue };
        for d in (0..found.Size().unwrap_or(0)).filter_map(|i| found.GetAt(i).ok()) {
            let name = d.Name().map(|n| n.to_string()).unwrap_or_default();
            let Ok(props) = d.Properties() else { continue };
            let get = |k: &str| props.Lookup(&HSTRING::from(k)).ok().and_then(|v| v.cast::<IPropertyValue>().ok());
            let number = |k: &str| get(k).and_then(|v| v.GetUInt32().ok().or_else(|| v.GetUInt16().ok().map(u32::from)).or_else(|| v.GetUInt8().ok().map(u32::from)));
            let address = get(ADDRESS).and_then(|v| v.GetString().ok()).map(|a| a.to_string().to_lowercase()).unwrap_or_default();
            let connected = get(CONNECTED).and_then(|v| v.GetBoolean().ok()).unwrap_or(false);
            let (major, minor) = if le {
                le_class(number(APPEARANCE).unwrap_or(0) as u16)
            } else {
                (number(COD_MAJOR).unwrap_or(0), number(COD_MINOR).unwrap_or(0))
            };
            if address.is_empty() || (le && out.iter().any(|o| o.1 == name)) {
                continue;
            }
            out.push((address, name, connected, major, minor));
        }
    }
    out
}

/// An LE device's appearance (Bluetooth's assigned numbers) as the classic class (major, minor) it stands for, so
/// `services::bluetooth::kind` reads both.
fn le_class(appearance: u16) -> (u32, u32) {
    let (category, sub) = (appearance >> 6, appearance & 0x3f);
    match category {
        0x001 => (2, 0),
        0x002 => (1, 0),
        0x003 => (7, 0),
        // HID: keyboard, mouse, joystick, gamepad
        0x00f => match sub {
            1 => (5, 0x10),
            2 => (5, 0x20),
            3 => (5, 0x01),
            4 => (5, 0x02),
            _ => (5, 0),
        },
        // audio sink (a speaker), wearable audio (earbuds, headphones), hearing aid
        0x021 => (4, 5),
        0x025 | 0x029 => (4, 6),
        _ => (0, 0),
    }
}

/// Connects (or disconnects) a paired headset or speaker. Err: `NOT_AUDIO` for another kind of device, or Windows'
/// HRESULT.
pub fn bluetooth_connect(address: &str, on: bool) -> Result<(), i32> {
    let hex: String = address.chars().filter(char::is_ascii_hexdigit).collect::<String>().to_lowercase();
    let drivers = if hex.len() == 12 { audio_drivers(&hex) } else { vec![] };
    if drivers.is_empty() {
        return Err(NOT_AUDIO);
    }
    let what = if on { KSPROPERTY_ONESHOT_RECONNECT } else { KSPROPERTY_ONESHOT_DISCONNECT };
    let ask = KSIDENTIFIER { Anonymous: KSIDENTIFIER_0 { Anonymous: KSIDENTIFIER_0_0 { Set: KSPROPSETID_BtAudio, Id: what.0 as u32, Flags: KSPROPERTY_TYPE_GET } } };
    let mut last = Err(NOT_AUDIO);
    for ks in drivers {
        let mut returned = 0u32;
        // SAFETY: a property request with its size and no data either way, on the driver's own IKsControl
        match unsafe { ks.KsProperty(&ask, std::mem::size_of::<KSIDENTIFIER>() as u32, std::ptr::null_mut(), 0, &mut returned) } {
            Ok(()) => return Ok(()),
            Err(e) => last = Err(e.code().0),
        }
    }
    last
}

/// The Bluetooth audio drivers (one for music, one for calls) of the device at `hex` (its address, digits only):
/// each sound output or input of Windows, connected or not, leads to the driver behind it, whose id names the device.
fn audio_drivers(hex: &str) -> Vec<IKsControl> {
    super::mta();
    let mut out = vec![];
    // SAFETY: COM objects on this thread's apartment (mta), each released when dropped; the ids Windows hands back are
    // copied, then freed with CoTaskMemFree
    unsafe {
        let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return out };
        let states = DEVICE_STATE(DEVICE_STATE_ACTIVE.0 | DEVICE_STATE_UNPLUGGED.0);
        for flow in [eRender, eCapture] {
            let Ok(all) = devices.EnumAudioEndpoints(flow, states) else { continue };
            for i in 0..all.GetCount().unwrap_or(0) {
                let driver = (|| {
                    let topology: IDeviceTopology = all.Item(i).ok()?.Activate(CLSCTX_ALL, None).ok()?;
                    let part: IPart = topology.GetConnector(0).ok()?.GetConnectedTo().ok()?.cast().ok()?;
                    let id = part.GetTopologyObject().ok()?.GetDeviceId().ok()?;
                    let text = id.to_string().unwrap_or_default().to_lowercase();
                    let device = text.contains(hex).then(|| devices.GetDevice(PCWSTR(id.0)).ok()).flatten();
                    CoTaskMemFree(Some(id.0 as *const _));
                    device?.Activate::<IKsControl>(CLSCTX_ALL, None).ok()
                })();
                out.extend(driver);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::le_class;

    #[test]
    fn le_appearances_read_as_classic_classes() {
        assert_eq!(le_class(0x03c1), (5, 0x10)); // keyboard
        assert_eq!(le_class(0x03c2), (5, 0x20)); // mouse
        assert_eq!(le_class(0x0941), (4, 6)); // earbud
        assert_eq!(le_class(0x0841), (4, 5)); // speaker
        assert_eq!(le_class(0x00c1), (7, 0)); // watch
        assert_eq!(le_class(0), (0, 0));
    }
}
