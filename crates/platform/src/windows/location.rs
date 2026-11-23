//! Where the computer is: Windows' location service (`Windows.Devices.Geolocation`), as Settings → Privacy &
//! security → Location allows it: Location services for the whole PC, "Let apps access your location", "Let desktop
//! apps access your location" (Sympony is a desktop app) and, where Windows asks each desktop app (Windows 11 24H2
//! on), Sympony's own answer. The place's name comes from OpenStreetMap (Nominatim: Windows has no reverse geocoding
//! for desktop apps), its time zone from Open-Meteo (Weather's forecasts; this PC's when it can't be reached).
use crate::location::{Fix, LocError, Locator};
use ::windows::core::HSTRING;
use ::windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
use ::windows::Foundation::TimeSpan;
use ::windows::Security::Authorization::AppCapabilityAccess::{AppCapability, AppCapabilityAccessStatus};
use serde_json::{json, Value};
use std::sync::mpsc;
use std::time::Duration;

/// Sympony's say in Settings → Privacy & security → Location.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Consent {
    /// Location services is off for the whole PC
    Off,
    /// apps, desktop apps or Sympony aren't allowed
    Denied,
    /// Windows will ask (its prompt) the first time Sympony looks
    NotAsked,
    Allowed,
}

const STORE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location";

/// A consent store's "Allow" / "Deny" (`Value` under `key`, in the machine's or the user's part of the registry).
fn store_value(machine: bool, key: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let (key, name) = (super::shell::wide(key), super::shell::wide("Value"));
    let (mut buf, mut size) = ([0u16; 32], 64u32);
    let root = if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER };
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return None;
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

fn consent() -> Consent {
    let deny = |v: Option<String>| v.is_some_and(|v| v.eq_ignore_ascii_case("Deny"));
    if deny(store_value(true, STORE)) {
        return Consent::Off;
    }
    if deny(store_value(false, STORE)) || deny(store_value(false, &format!(r"{STORE}\NonPackaged"))) {
        return Consent::Denied;
    }
    // (Sympony's own answer, under its path with `#` for `\`)
    let own = std::env::current_exe().ok().and_then(|p| store_value(false, &format!(r"{STORE}\NonPackaged\{}", p.to_string_lossy().replace('\\', "#"))));
    match own.as_deref() {
        Some(v) if v.eq_ignore_ascii_case("Deny") => return Consent::Denied,
        Some(v) if v.eq_ignore_ascii_case("Allow") => return Consent::Allowed,
        _ => {}
    }
    super::mta();
    match AppCapability::Create(&HSTRING::from("location")).and_then(|c| c.CheckAccess()) {
        Ok(AppCapabilityAccessStatus::UserPromptRequired) => Consent::NotAsked,
        Ok(AppCapabilityAccessStatus::DeniedByUser) => Consent::Denied,
        Ok(AppCapabilityAccessStatus::DeniedBySystem) => Consent::Off,
        // (allowed, or a Windows that doesn't ask desktop apps: the switches above decide)
        _ => Consent::Allowed,
    }
}

/// `"granted" | "denied" | "notAsked"`, as on macOS.
pub fn status() -> &'static str {
    match consent() {
        Consent::Allowed => "granted",
        Consent::NotAsked => "notAsked",
        Consent::Off | Consent::Denied => "denied",
    }
}

/// Windows' prompt, when it has one for Sympony and hasn't had an answer; doesn't wait for it.
pub fn request() {
    if consent() == Consent::NotAsked {
        std::thread::spawn(|| {
            super::mta();
            let _ = Geolocator::RequestAccessAsync().and_then(|a| a.join());
        });
    }
}

fn span(d: Duration) -> TimeSpan {
    // (in 100 ns)
    TimeSpan { Duration: (d.as_nanos() / 100).min(i64::MAX as u128) as i64 }
}

/// `f` on its own thread, given up on after `limit` (it keeps going, its answer dropped).
fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> Option<T> + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        super::mta();
        let _ = tx.send(f());
    });
    rx.recv_timeout(limit).ok().flatten()
}

pub struct CoreLocation;

impl Locator for CoreLocation {
    fn locate(&self, timeout: Duration) -> Result<Fix, LocError> {
        match consent() {
            Consent::Off => return Err(LocError::Off),
            Consent::Denied => return Err(LocError::Denied),
            // a person reading Windows' prompt gets a minute, not the usual timeout
            Consent::NotAsked => {
                let asked = within(timeout.max(Duration::from_secs(60)), || Geolocator::RequestAccessAsync().and_then(|a| a.join()).ok());
                match asked {
                    Some(GeolocationAccessStatus::Allowed) => {}
                    Some(GeolocationAccessStatus::Denied) => return Err(LocError::Denied),
                    _ => return Err(LocError::Unavailable),
                }
            }
            Consent::Allowed => {}
        }
        super::mta();
        // a position from the last two minutes, or a new one within the timeout
        let found = Geolocator::new().and_then(|g| g.GetGeopositionAsyncWithAgeAndTimeout(span(Duration::from_secs(120)), span(timeout))).and_then(|op| op.join());
        match found {
            Ok(p) => {
                let c = p.Coordinate().map_err(|_| LocError::Unavailable)?;
                let at = c.Point().and_then(|pt| pt.Position()).map_err(|_| LocError::Unavailable)?;
                Ok(Fix { lat: at.Latitude, lon: at.Longitude, accuracy_m: c.Accuracy().unwrap_or(0.0) })
            }
            // (turned off or refused meanwhile)
            Err(e) if e.code() == ::windows::Win32::Foundation::E_ACCESSDENIED => Err(if consent() == Consent::Off { LocError::Off } else { LocError::Denied }),
            Err(_) => Err(LocError::Unavailable),
        }
    }

    /// The place's city, province and country (in English, as Open-Meteo's search names them) from OpenStreetMap,
    /// and its time zone; None offline or when OpenStreetMap has no name there.
    fn place(&self, fix: &Fix) -> Option<Value> {
        // (three decimals, about 100 m, are enough for a city; two, about 1 km, for a time zone: no more of the
        // position than that leaves the PC)
        let (lat, lon) = (fix.lat, fix.lon);
        let found = get_json(&format!("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat={lat:.3}&lon={lon:.3}"))?;
        let zone = get_json(&format!("https://api.open-meteo.com/v1/forecast?latitude={lat:.2}&longitude={lon:.2}&timezone=auto&forecast_days=1"));
        let tz = zone.and_then(|z| z["timezone"].as_str().map(str::to_string));
        place_from(&found, fix, tz.or_else(time_zone).as_deref())
    }
}

/// A GET's JSON within 5 s, over the HTTP client the rest of Sympony uses (`ureq`; Windows' own refuses some
/// certificates it can't check for revocation, Open-Meteo's among them). OpenStreetMap asks each app to name itself.
fn get_json(url: &str) -> Option<Value> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .user_agent(concat!("Sympony/", env!("CARGO_PKG_VERSION"), " (+https://github.com/rheynoapria/sympony-ai)"))
        .build()
        .into();
    let mut answer = agent.get(url).call().ok()?;
    serde_json::from_str(&answer.body_mut().read_to_string().ok()?).ok()
}

/// This PC's time zone as its IANA name (e.g. "Asia/Jakarta").
fn time_zone() -> Option<String> {
    let tz = ::windows::Globalization::Calendar::new().and_then(|c| c.GetTimeZone()).ok()?.to_string();
    (!tz.is_empty()).then_some(tz)
}

/// `{name, admin, country, lat, lon, tz}` from Nominatim's reverse answer: the city (or town, village, regency…),
/// the province or state, the country. A city that is a province of its own (Jakarta) is named by its part (Central
/// Jakarta), with the city as the province.
fn place_from(found: &Value, fix: &Fix, tz: Option<&str>) -> Option<Value> {
    let a = &found["address"];
    let first = |keys: &[&str]| keys.iter().find_map(|k| a[*k].as_str().filter(|s| !s.is_empty())).map(str::to_string);
    let state = first(&["state", "province", "region"]);
    let city = first(&["city", "town", "municipality", "village", "county"]);
    let (name, admin) = match (city, state) {
        (Some(city), None) => match first(&["city_district"]) {
            Some(part) => (part, Some(city)),
            None => (city, None),
        },
        (city, state) => (city.or_else(|| first(&["city_district", "state_district"])).or(state.clone())?, state),
    };
    // (Kuala Lumpur, Kuala Lumpur: once is enough)
    let admin = admin.filter(|a| *a != name);
    Some(json!({ "name": name, "admin": admin, "country": first(&["country"]), "lat": fix.lat, "lon": fix.lon, "tz": tz }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: Fix = Fix { lat: -6.2349, lon: 106.9896, accuracy_m: 30.0 };

    #[test]
    fn a_city_with_its_province_and_country() {
        let found = json!({ "address": { "city": "Bekasi", "state": "West Java", "ISO3166-2-lvl4": "ID-JB", "country": "Indonesia", "country_code": "id" } });
        let p = place_from(&found, &AT, Some("Asia/Jakarta")).unwrap();
        assert_eq!(p, json!({ "name": "Bekasi", "admin": "West Java", "country": "Indonesia", "lat": -6.2349, "lon": 106.9896, "tz": "Asia/Jakarta" }));
    }

    #[test]
    fn a_regency_when_there_is_no_city() {
        let found = json!({ "address": { "county": "Bogor", "state": "West Java", "country": "Indonesia" } });
        assert_eq!(place_from(&found, &AT, None).unwrap()["name"], "Bogor");
    }

    #[test]
    fn a_city_that_is_its_own_province_by_its_part() {
        // (Nominatim's answer at Monas)
        let found = json!({ "address": { "neighbourhood": "Gambir", "suburb": "Gambir", "city_district": "Central Jakarta", "city": "Special Capital Region of Jakarta", "ISO3166-2-lvl4": "ID-JK", "country": "Indonesia" } });
        let p = place_from(&found, &AT, None).unwrap();
        assert_eq!((p["name"].as_str(), p["admin"].as_str()), (Some("Central Jakarta"), Some("Special Capital Region of Jakarta")));
    }

    #[test]
    fn the_province_when_nothing_smaller_is_named() {
        let found = json!({ "address": { "state": "West Java", "country": "Indonesia" } });
        let p = place_from(&found, &AT, None).unwrap();
        assert_eq!((p["name"].as_str(), p["admin"].as_str()), (Some("West Java"), None));
    }

    #[test]
    fn no_name_no_place() {
        // (the sea: Nominatim answers with an error)
        assert!(place_from(&json!({ "error": "Unable to geocode" }), &AT, None).is_none());
    }
}
