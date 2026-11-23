//! Sound on Windows (Core Audio): the default output's volume and mute, the default input's mute (the mic), and the
//! outputs / inputs to choose from. Reached as `system::…`, the names macOS has.
use ::windows::core::{Interface, GUID, HRESULT, PCWSTR};
use ::windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use ::windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use ::windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator,
    DEVICE_STATE_ACTIVE,
};
use ::windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};

fn flow(input: bool) -> EDataFlow {
    if input { eCapture } else { eRender }
}

fn devices() -> Option<IMMDeviceEnumerator> {
    super::mta();
    // SAFETY: a COM object created on this thread's apartment (mta), released when dropped
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()
}

/// The default output (or input), as Windows' sound settings show it.
fn default_device(input: bool) -> Option<IMMDevice> {
    // SAFETY: as in `devices`
    unsafe { devices()?.GetDefaultAudioEndpoint(flow(input), eConsole) }.ok()
}

fn endpoint(input: bool) -> Option<IAudioEndpointVolume> {
    // SAFETY: as in `devices`; Activate hands back the interface asked for
    unsafe { default_device(input)?.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) }.ok()
}

/// A device's id (Windows' own string: `{0.0.0.00000000}.{…}`).
fn id_of(d: &IMMDevice) -> Option<String> {
    // SAFETY: the string Windows hands back is copied, then freed with CoTaskMemFree as its docs ask
    unsafe {
        let p = d.GetId().ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const _));
        s
    }
}

/// The number Sympony knows a device by (`audio.setDefault` sends it back): from its id, so it stays the same while
/// the list changes.
fn number(id: &str) -> u32 {
    // (FNV-1a)
    id.bytes().fold(0x811c_9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x0100_0193))
}

/// The sound outputs (or inputs): (id, name, is the default).
pub fn audio_devices(input: bool) -> Vec<(u32, String, bool)> {
    let Some(e) = devices() else { return vec![] };
    let default = default_device(input).and_then(|d| id_of(&d));
    // SAFETY: as in `devices`; each device and its property store are released when dropped
    unsafe {
        let Ok(all) = e.EnumAudioEndpoints(flow(input), DEVICE_STATE_ACTIVE) else { return vec![] };
        let mut out = vec![];
        for i in 0..all.GetCount().unwrap_or(0) {
            let Ok(d) = all.Item(i) else { continue };
            let Some(id) = id_of(&d) else { continue };
            let name = d.OpenPropertyStore(STGM_READ).and_then(|p| p.GetValue(&PKEY_Device_FriendlyName)).map(|v| v.to_string()).unwrap_or_default();
            out.push((number(&id), if name.is_empty() { id.clone() } else { name }, default.as_deref() == Some(id.as_str())));
        }
        out
    }
}

/// Makes a device the default output (or input), for every use (sound, communications); false when it's gone or
/// refused.
pub fn set_default_device(n: u32, input: bool) -> bool {
    let Some(e) = devices() else { return false };
    // SAFETY: as in `audio_devices`
    let id = unsafe {
        let Ok(all) = e.EnumAudioEndpoints(flow(input), DEVICE_STATE_ACTIVE) else { return false };
        (0..all.GetCount().unwrap_or(0)).filter_map(|i| all.Item(i).ok()).filter_map(|d| id_of(&d)).find(|id| number(id) == n)
    };
    id.is_some_and(|id| [eConsole, eMultimedia, eCommunications].iter().all(|r| policy::set_default(&id, *r)))
}

/// The default output's volume (0-100) and mute; None when it has no volume of its own.
pub fn volume() -> Option<(u8, bool)> {
    let v = endpoint(false)?;
    // SAFETY: as in `endpoint`
    unsafe {
        let level = v.GetMasterVolumeLevelScalar().ok()?;
        let muted = v.GetMute().ok()?.as_bool();
        Some(((level * 100.0).round().clamp(0.0, 100.0) as u8, muted))
    }
}

/// The default output's volume (0-100); above 0 it's unmuted too, as on macOS.
pub fn set_volume(level: u8) {
    if let Some(v) = endpoint(false) {
        // SAFETY: as in `endpoint`
        unsafe {
            let _ = v.SetMasterVolumeLevelScalar(level.min(100) as f32 / 100.0, std::ptr::null());
            if level > 0 {
                let _ = v.SetMute(false, std::ptr::null());
            }
        }
    }
}

pub fn toggle_mute() {
    if let Some(v) = endpoint(false) {
        // SAFETY: as in `endpoint`
        unsafe {
            if let Ok(m) = v.GetMute() {
                let _ = v.SetMute(!m.as_bool(), std::ptr::null());
            }
        }
    }
}

/// `(available, muted)`: available when there's an input (a mic) whose mute can be set.
pub fn mic() -> (bool, bool) {
    match endpoint(true) {
        // SAFETY: as in `endpoint`
        Some(v) => unsafe { v.GetMute() }.map(|m| (true, m.as_bool())).unwrap_or((false, false)),
        None => (false, false),
    }
}

pub fn toggle_mic() {
    if let Some(v) = endpoint(true) {
        // SAFETY: as in `endpoint`
        unsafe {
            if let Ok(m) = v.GetMute() {
                let _ = v.SetMute(!m.as_bool(), std::ptr::null());
            }
        }
    }
}

/// Windows has no public call to change the default device: its own Sound settings use IPolicyConfig (undocumented,
/// unchanged since Windows 7, used the same way by the tools that switch devices). Only `SetDefaultEndpoint` is
/// called, through its place in the interface's table.
mod policy {
    use super::*;

    const CLSID_POLICY_CONFIG: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
    const IID_POLICY_CONFIG: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);
    /// IUnknown's 3, then GetMixFormat … SetPropertyValue (10): SetDefaultEndpoint is the 14th.
    const SET_DEFAULT_ENDPOINT: usize = 13;
    type SetDefaultEndpoint = unsafe extern "system" fn(*mut std::ffi::c_void, PCWSTR, ERole) -> HRESULT;

    pub fn set_default(id: &str, role: ERole) -> bool {
        let wide: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the object is created and asked for IPolicyConfig through COM; the call goes through that interface's
        // own table, with a null-terminated id that outlives it; `cfg` releases it when dropped
        unsafe {
            let Ok(unknown) = CoCreateInstance::<_, ::windows::core::IUnknown>(&CLSID_POLICY_CONFIG, None, CLSCTX_ALL) else { return false };
            let mut raw = std::ptr::null_mut();
            if unknown.query(&IID_POLICY_CONFIG, &mut raw).is_err() || raw.is_null() {
                return false;
            }
            let cfg = ::windows::core::IUnknown::from_raw(raw);
            let table = *(cfg.as_raw() as *const *const usize);
            let call: SetDefaultEndpoint = std::mem::transmute(*table.add(SET_DEFAULT_ENDPOINT));
            call(cfg.as_raw(), PCWSTR(wide.as_ptr()), role).is_ok()
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_device_keeps_its_number() {
        let id = "{0.0.0.00000000}.{6a3e1b52-0000-4f2a-9c1e-1a2b3c4d5e6f}";
        assert_eq!(super::number(id), super::number(id));
        assert_ne!(super::number(id), super::number("{0.0.1.00000000}.{6a3e1b52-0000-4f2a-9c1e-1a2b3c4d5e6f}"));
    }
}
