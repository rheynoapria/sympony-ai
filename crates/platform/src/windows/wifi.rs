//! Wi-Fi on Windows through the Native Wifi API (wlanapi): whether it's on, the network in use and its signal, the
//! networks around (a fresh scan when asked), the saved ones, joining and leaving. Switching it on or off goes
//! through Windows' radio switches (`radios.rs`). Reached as `radios::…`, the names macOS has.
//!
//! Since Windows 11 24H2, Windows tells network names only to apps allowed the location ("Let desktop apps access
//! your location"): a list it refuses reads as names hidden, which the Wi-Fi tab explains as on macOS.
use super::radios::Net;
use super::shell::wide;
use std::ffi::c_void;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use windows_sys::core::GUID;
use windows_sys::Win32::Foundation::{ERROR_ACCESS_DENIED, HANDLE};
use windows_sys::Win32::NetworkManagement::WiFi::*;

/// The Wlan client, opened once for as long as Sympony runs, hearing how scans and connections end (the handle as a
/// number: a raw handle isn't Send).
fn client() -> Option<HANDLE> {
    static CLIENT: OnceLock<Option<usize>> = OnceLock::new();
    let h = CLIENT.get_or_init(|| {
        let (mut version, mut h) = (0u32, std::ptr::null_mut());
        // SAFETY: out-params are locals; the handle stays open for the process' life, `heard` with it
        unsafe {
            if WlanOpenHandle(2, std::ptr::null(), &mut version, &mut h) != 0 {
                return None;
            }
            WlanRegisterNotification(h, WLAN_NOTIFICATION_SOURCE_ACM, 1, Some(heard), std::ptr::null(), std::ptr::null(), std::ptr::null_mut());
        }
        Some(h as usize)
    });
    h.map(|h| h as HANDLE)
}

/// The first Wi-Fi adapter: the client and the adapter's id.
fn adapter() -> Option<(HANDLE, GUID)> {
    let h = client()?;
    let mut list = std::ptr::null_mut();
    // SAFETY: Windows allocates the list, read while it's held and freed once
    unsafe {
        if WlanEnumInterfaces(h, std::ptr::null(), &mut list) != 0 || list.is_null() {
            return None;
        }
        let id = ((*list).dwNumberOfItems > 0).then(|| (*list).InterfaceInfo[0].InterfaceGuid);
        WlanFreeMemory(list as *const c_void);
        id.map(|id| (h, id))
    }
}

/// One of the adapter's readings (`op`), copied out.
unsafe fn query<T: Copy>(h: HANDLE, id: &GUID, op: WLAN_INTF_OPCODE) -> Option<T> {
    let (mut size, mut data) = (0u32, std::ptr::null_mut());
    if WlanQueryInterface(h, id, op, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut()) != 0 || data.is_null() {
        return None;
    }
    let v = (size as usize >= std::mem::size_of::<T>()).then(|| *(data as *const T));
    WlanFreeMemory(data);
    v
}

fn ssid(s: &DOT11_SSID) -> String {
    String::from_utf8_lossy(&s.ucSSID[..(s.uSSIDLength as usize).min(32)]).into_owned()
}

fn text(w: &[u16]) -> String {
    String::from_utf16_lossy(&w[..w.iter().position(|c| *c == 0).unwrap_or(w.len())])
}

/// Wi-Fi's radio (on unless switched off, in Windows or by a laptop's switch); None without a Wi-Fi adapter.
pub fn wifi_on() -> Option<bool> {
    let (h, id) = adapter()?;
    // SAFETY: the reading is copied out of Windows' memory, freed in `query`
    let r: WLAN_RADIO_STATE = unsafe { query(h, &id, wlan_intf_opcode_radio_state) }?;
    let phys = &r.PhyRadioState[..(r.dwNumberOfPhys as usize).min(64)];
    Some(phys.iter().any(|p| p.dot11SoftwareRadioState == dot11_radio_state_on && p.dot11HardwareRadioState == dot11_radio_state_on))
}

/// The network in use; None when not connected (or Windows keeps its name from Sympony).
pub fn wifi_ssid() -> Option<String> {
    let (h, id) = adapter()?;
    // SAFETY: as in `wifi_on`
    let c: WLAN_CONNECTION_ATTRIBUTES = unsafe { query(h, &id, wlan_intf_opcode_current_connection) }?;
    (c.isState == wlan_interface_state_connected).then(|| ssid(&c.wlanAssociationAttributes.dot11Ssid)).filter(|s| !s.is_empty())
}

/// The signal of the network in use, in dBm (0 when not connected).
pub fn wifi_rssi() -> i64 {
    // SAFETY: as in `wifi_on`
    adapter().and_then(|(h, id)| unsafe { query::<i32>(h, &id, wlan_intf_opcode_rssi) }).map_or(0, i64::from)
}

/// A network the adapter sees (Windows lists one with a saved profile and, again, one without).
struct Seen {
    ssid: String,
    profile: Option<String>,
    secure: bool,
    auth: DOT11_AUTH_ALGORITHM,
    cipher: DOT11_CIPHER_ALGORITHM,
    quality: u32,
}

/// The networks around (as of the adapter's last scan). Err: Windows' error (ERROR_ACCESS_DENIED: no location).
fn seen(h: HANDLE, id: &GUID) -> Result<Vec<Seen>, u32> {
    let mut list = std::ptr::null_mut();
    // SAFETY: Windows allocates the list, read while it's held and freed once
    unsafe {
        let e = WlanGetAvailableNetworkList(h, id, 0, std::ptr::null(), &mut list);
        if e != 0 || list.is_null() {
            return Err(e);
        }
        let all = std::slice::from_raw_parts((*list).Network.as_ptr(), (*list).dwNumberOfItems as usize);
        let out = all
            .iter()
            .filter(|n| n.dot11BssType == dot11_BSS_type_infrastructure)
            .map(|n| Seen {
                ssid: ssid(&n.dot11Ssid),
                profile: (n.dwFlags & WLAN_AVAILABLE_NETWORK_HAS_PROFILE != 0).then(|| text(&n.strProfileName)).filter(|p| !p.is_empty()),
                secure: n.bSecurityEnabled != 0,
                auth: n.dot11DefaultAuthAlgorithm,
                cipher: n.dot11DefaultCipherAlgorithm,
                quality: n.wlanSignalQuality,
            })
            .collect();
        WlanFreeMemory(list as *const c_void);
        Ok(out)
    }
}

/// Each access point heard: (network, RSSI dBm, centre frequency kHz).
fn access_points(h: HANDLE, id: &GUID) -> Vec<(String, i64, u32)> {
    let mut list = std::ptr::null_mut();
    // SAFETY: as in `seen`
    unsafe {
        if WlanGetNetworkBssList(h, id, std::ptr::null(), dot11_BSS_type_any, 0, std::ptr::null(), &mut list) != 0 || list.is_null() {
            return vec![];
        }
        let all = std::slice::from_raw_parts((*list).wlanBssEntries.as_ptr(), (*list).dwNumberOfItems as usize);
        let out = all.iter().map(|b| (ssid(&b.dot11Ssid), i64::from(b.lRssi), b.ulChCenterFrequency)).collect();
        WlanFreeMemory(list as *const c_void);
        out
    }
}

fn band(khz: u32) -> &'static str {
    match khz {
        0 => "",
        k if k < 3_000_000 => "2.4 GHz",
        k if k < 5_925_000 => "5 GHz",
        _ => "6 GHz",
    }
}

fn enterprise(auth: DOT11_AUTH_ALGORITHM) -> bool {
    [DOT11_AUTH_ALGO_WPA, DOT11_AUTH_ALGO_RSNA, DOT11_AUTH_ALGO_WPA3_ENT_192, DOT11_AUTH_ALGO_WPA3_ENT].contains(&auth)
}

/// The networks around, one per access point (a fresh scan first when `scan`); None without Wi-Fi. When Windows keeps
/// the names from Sympony, one network without a name says so.
pub fn wifi_scan(scan: bool) -> Option<Vec<Net>> {
    let (h, id) = adapter()?;
    if scan {
        let since = heard_until_now();
        // SAFETY: the client and adapter are Windows' own; no SSID or extra data
        if unsafe { WlanScan(h, &id, std::ptr::null(), std::ptr::null(), std::ptr::null()) } == 0 {
            let done = [wlan_notification_acm_scan_complete, wlan_notification_acm_scan_fail];
            wait_for(since, Duration::from_secs(6), |e| done.contains(&(e.code as i32)).then_some(()));
        }
    }
    let nets = match seen(h, &id) {
        Ok(n) => n,
        Err(ERROR_ACCESS_DENIED) => return Some(vec![(None, 0, false, false, String::new())]),
        Err(_) => return Some(vec![]),
    };
    let points = access_points(h, &id);
    let mut out = vec![];
    for n in nets.iter().filter(|n| !n.ssid.is_empty()) {
        let heard: Vec<_> = points.iter().filter(|(s, ..)| *s == n.ssid).collect();
        if heard.is_empty() {
            // (Windows' quality runs 0-100 over -100 to -50 dBm)
            out.push((Some(n.ssid.clone()), i64::from(n.quality) / 2 - 100, n.secure, enterprise(n.auth), String::new()));
        }
        for (_, rssi, khz) in heard {
            out.push((Some(n.ssid.clone()), *rssi, n.secure, enterprise(n.auth), band(*khz).to_string()));
        }
    }
    Some(out)
}

/// The networks Windows has a profile for (Settings → Wi-Fi → Manage known networks).
pub fn wifi_saved() -> Vec<String> {
    let Some((h, id)) = adapter() else { return vec![] };
    let mut out: Vec<String> = seen(h, &id).unwrap_or_default().into_iter().filter(|n| n.profile.is_some()).map(|n| n.ssid).collect();
    let mut list = std::ptr::null_mut();
    // SAFETY: as in `seen`
    unsafe {
        if WlanGetProfileList(h, &id, std::ptr::null(), &mut list) == 0 && !list.is_null() {
            let all = std::slice::from_raw_parts((*list).ProfileInfo.as_ptr(), (*list).dwNumberOfItems as usize);
            out.extend(all.iter().map(|p| text(&p.strProfileName)));
            WlanFreeMemory(list as *const c_void);
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Joins `ssid`: with its saved profile, or with a new one for `password` (or none, for an open network). Waits for
/// Windows to say how it went. Err: why not, in Windows' words when it gives them.
pub fn wifi_join(network: &str, password: &str) -> Result<(), String> {
    let (h, id) = adapter().ok_or("This PC has no Wi-Fi")?;
    let around = seen(h, &id).map_err(|_| "Couldn’t look for networks just now")?;
    let net = around.iter().find(|n| n.ssid == network && n.profile.is_some()).or_else(|| around.iter().find(|n| n.ssid == network));
    let saved = net.and_then(|n| n.profile.clone());
    let mut made = None;
    let profile = match saved {
        Some(p) if password.is_empty() => p,
        _ => {
            let net = net.ok_or("That network isn’t in range")?;
            let xml = profile_xml(network, net.auth, net.cipher, password)?;
            let (xml, mut reason) = (wide(&xml), 0u32);
            // SAFETY: NUL-terminated XML that outlives the call; the reason is a local
            let e = unsafe { WlanSetProfile(h, &id, 0, xml.as_ptr(), std::ptr::null(), 1, std::ptr::null(), &mut reason) };
            if e != 0 {
                return Err(reason_text(reason).unwrap_or_else(|| "Windows didn’t take that password".into()));
            }
            if net.profile.is_none() {
                made = Some(network.to_string());
            }
            network.to_string()
        }
    };
    let name = wide(&profile);
    let params = WLAN_CONNECTION_PARAMETERS {
        wlanConnectionMode: wlan_connection_mode_profile,
        strProfile: name.as_ptr(),
        pDot11Ssid: std::ptr::null_mut(),
        pDesiredBssidList: std::ptr::null_mut(),
        dot11BssType: dot11_BSS_type_infrastructure,
        dwFlags: 0,
    };
    let since = heard_until_now();
    // SAFETY: the parameters and the profile's name outlive the call
    let e = unsafe { WlanConnect(h, &id, &params, std::ptr::null()) };
    let outcome = if e != 0 {
        Some(Err(0))
    } else {
        let ends = [wlan_notification_acm_connection_complete, wlan_notification_acm_connection_attempt_fail];
        wait_for(since, Duration::from_secs(25), |e| {
            (ends.contains(&(e.code as i32)) && e.profile == profile).then_some(if e.reason == 0 { Ok(()) } else { Err(e.reason) })
        })
    };
    match outcome {
        Some(Ok(())) => Ok(()),
        failed => {
            // (a profile made for a password that didn't work isn't left behind as a saved network)
            if let Some(p) = made {
                let p = wide(&p);
                // SAFETY: NUL-terminated name that outlives the call
                unsafe { WlanDeleteProfile(h, &id, p.as_ptr(), std::ptr::null()) };
            }
            Err(match failed {
                Some(Err(reason)) => reason_text(reason).unwrap_or_else(|| "Couldn’t connect".into()),
                _ => "Couldn’t connect".into(),
            })
        }
    }
}

pub fn wifi_leave() {
    if let Some((h, id)) = adapter() {
        // SAFETY: the client and adapter are Windows' own
        unsafe { WlanDisconnect(h, &id, std::ptr::null()) };
    }
}

/// Windows' words for a Wi-Fi reason code.
fn reason_text(reason: u32) -> Option<String> {
    let mut buf = [0u16; 512];
    // SAFETY: a buffer with its length, outliving the call
    let ok = reason != 0 && unsafe { WlanReasonCodeToString(reason, buf.len() as u32, buf.as_mut_ptr(), std::ptr::null()) } == 0;
    ok.then(|| text(&buf).trim().to_string()).filter(|t| !t.is_empty())
}

/// A profile for a network seen around: its security as Windows advertised it, and the password (none when open).
/// Enterprise networks (a username) and WEP are joined from Windows' own list.
fn profile_xml(network: &str, auth: DOT11_AUTH_ALGORITHM, cipher: DOT11_CIPHER_ALGORITHM, password: &str) -> Result<String, String> {
    let aes_or_tkip = if cipher == DOT11_CIPHER_ALGO_TKIP { "TKIP" } else { "AES" };
    let (authentication, encryption, keyed) = match auth {
        DOT11_AUTH_ALGO_80211_OPEN if cipher == DOT11_CIPHER_ALGO_NONE => ("open", "none", false),
        DOT11_AUTH_ALGO_OWE => ("OWE", "AES", false),
        DOT11_AUTH_ALGO_WPA_PSK => ("WPAPSK", aes_or_tkip, true),
        DOT11_AUTH_ALGO_RSNA_PSK => ("WPA2PSK", aes_or_tkip, true),
        DOT11_AUTH_ALGO_WPA3_SAE => ("WPA3SAE", "AES", true),
        _ => return Err("Join this network from Windows’ Wi-Fi list".into()),
    };
    if keyed && password.is_empty() {
        return Err("This network needs a password".into());
    }
    let name = escape(network);
    let hex: String = network.bytes().map(|b| format!("{b:02X}")).collect();
    let key = if keyed {
        let kind = if password.len() == 64 && password.bytes().all(|b| b.is_ascii_hexdigit()) { "networkKey" } else { "passPhrase" };
        format!("<sharedKey><keyType>{kind}</keyType><protected>false</protected><keyMaterial>{}</keyMaterial></sharedKey>", escape(password))
    } else {
        String::new()
    };
    Ok(format!(
        "<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>{name}</name>\
         <SSIDConfig><SSID><hex>{hex}</hex><name>{name}</name></SSID></SSIDConfig><connectionType>ESS</connectionType>\
         <connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>{authentication}</authentication>\
         <encryption>{encryption}</encryption><useOneX>false</useOneX></authEncryption>{key}</security></MSM></WLANProfile>"
    ))
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// What the Wi-Fi service said (a scan or a connection ending), numbered as it came.
struct Heard {
    n: u64,
    code: u32,
    reason: u32,
    profile: String,
}

static HEARD: Mutex<(u64, Vec<Heard>)> = Mutex::new((0, vec![]));
static NEWS: Condvar = Condvar::new();

/// Windows calls this on a thread of its own for each notification of the client's.
unsafe extern "system" fn heard(n: *mut L2_NOTIFICATION_DATA, _: *mut c_void) {
    let Some(n) = n.as_ref() else { return };
    if n.NotificationSource != WLAN_NOTIFICATION_SOURCE_ACM {
        return;
    }
    let ends = [wlan_notification_acm_connection_complete, wlan_notification_acm_connection_attempt_fail];
    let data = (ends.contains(&(n.NotificationCode as i32)) && !n.pData.is_null() && n.dwDataSize as usize >= std::mem::size_of::<WLAN_CONNECTION_NOTIFICATION_DATA>())
        .then(|| &*(n.pData as *const WLAN_CONNECTION_NOTIFICATION_DATA));
    let mut h = HEARD.lock().unwrap();
    h.0 += 1;
    let heard = Heard { n: h.0, code: n.NotificationCode, reason: data.map_or(0, |d| d.wlanReasonCode), profile: data.map(|d| text(&d.strProfileName)).unwrap_or_default() };
    h.1.push(heard);
    if h.1.len() > 64 {
        h.1.remove(0);
    }
    NEWS.notify_all();
}

/// The number of the last thing heard: what's heard after it is news.
fn heard_until_now() -> u64 {
    HEARD.lock().unwrap().0
}

/// Waits up to `limit` for the first thing heard after `since` that `pick` takes.
fn wait_for<T>(since: u64, limit: Duration, pick: impl Fn(&Heard) -> Option<T>) -> Option<T> {
    let end = Instant::now() + limit;
    let mut h = HEARD.lock().unwrap();
    loop {
        if let Some(t) = h.1.iter().filter(|e| e.n > since).find_map(&pick) {
            return Some(t);
        }
        let left = end.checked_duration_since(Instant::now())?;
        h = NEWS.wait_timeout(h, left).unwrap().0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wpa2_network_gets_a_profile_with_its_password() {
        let xml = profile_xml("Café & Co", DOT11_AUTH_ALGO_RSNA_PSK, DOT11_CIPHER_ALGO_CCMP, "pa<ss>word").unwrap();
        assert!(xml.contains("<authentication>WPA2PSK</authentication><encryption>AES</encryption>"));
        assert!(xml.contains("<name>Café &amp; Co</name>"));
        assert!(xml.contains(&"Café & Co".bytes().map(|b| format!("{b:02X}")).collect::<String>()));
        assert!(xml.contains("<keyType>passPhrase</keyType><protected>false</protected><keyMaterial>pa&lt;ss&gt;word</keyMaterial>"));
    }

    #[test]
    fn an_open_network_needs_no_password_and_a_secure_one_does() {
        let open = profile_xml("Lobby", DOT11_AUTH_ALGO_80211_OPEN, DOT11_CIPHER_ALGO_NONE, "").unwrap();
        assert!(open.contains("<authentication>open</authentication><encryption>none</encryption>") && !open.contains("sharedKey"));
        assert!(profile_xml("Home", DOT11_AUTH_ALGO_WPA3_SAE, DOT11_CIPHER_ALGO_CCMP, "").is_err());
    }

    #[test]
    fn enterprise_and_wep_networks_are_left_to_windows() {
        assert!(profile_xml("Office", DOT11_AUTH_ALGO_RSNA, DOT11_CIPHER_ALGO_CCMP, "secret").is_err());
        assert!(profile_xml("Old", DOT11_AUTH_ALGO_80211_OPEN, DOT11_CIPHER_ALGO_WEP, "secret").is_err());
    }

    #[test]
    fn bands_come_from_the_frequency() {
        assert_eq!(band(2_437_000), "2.4 GHz");
        assert_eq!(band(5_785_000), "5 GHz");
        assert_eq!(band(5_955_000), "6 GHz");
        assert_eq!(band(0), "");
    }
}
