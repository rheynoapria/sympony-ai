//! Where the computer is: the OS's location service, and the place's name and time zone.
use serde_json::Value;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Fix {
    pub lat: f64,
    pub lon: f64,
    pub accuracy_m: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LocError {
    /// location services are off for the whole computer
    Off,
    /// this app isn't allowed
    Denied,
    /// on, allowed, but no position in time
    Unavailable,
}

pub trait Locator: Send + Sync {
    fn locate(&self, timeout: Duration) -> Result<Fix, LocError>;
    /// {name, admin, country, lat, lon, tz} for the position, or None when its name can't be looked up
    fn place(&self, fix: &Fix) -> Option<Value>;
}

/// More than 2 km from the saved place (or no saved place): worth a new place. Closer is GPS wandering.
pub fn moved_enough(saved: &Value, fix: &Fix) -> bool {
    let (Some(lat), Some(lon)) = (saved["lat"].as_f64(), saved["lon"].as_f64()) else { return true };
    let r = std::f64::consts::PI / 180.0;
    let (p1, p2) = (lat * r, fix.lat * r);
    let (dp, dl) = ((fix.lat - lat) * r, (fix.lon - lon) * r);
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    6_371_000.0 * 2.0 * a.sqrt().asin() > 2_000.0
}
