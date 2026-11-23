//! Where the computer is (stand-in: no position yet; Windows.Devices.Geolocation later).
use crate::location::{Fix, LocError, Locator};
use serde_json::Value;
use std::time::Duration;

/// `"granted" | "denied" | "notAsked"`, as on macOS.
pub fn status() -> &'static str {
    "denied"
}

pub fn request() {}

pub struct CoreLocation;

impl Locator for CoreLocation {
    fn locate(&self, _timeout: Duration) -> Result<Fix, LocError> {
        Err(LocError::Unavailable)
    }

    fn place(&self, _fix: &Fix) -> Option<Value> {
        None
    }
}
