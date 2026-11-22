#![allow(deprecated)] // CLGeocoder and CLPlacemark: MapKit replaces them, but they still work and need no extra framework
//! Location Services. The manager lives on the main thread (CoreLocation delivers there); `locate` is called from a
//! background thread and checks the manager's state on the main queue every 250 ms, so no delegate object is needed.
use crate::location::{Fix, LocError, Locator};
use block2::RcBlock;
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_core_location::{CLAuthorizationStatus, CLGeocoder, CLLocation, CLLocationManager, CLPlacemark};
use objc2_foundation::{NSArray, NSError};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

thread_local! {
    // main thread only
    static MANAGER: RefCell<Option<Retained<CLLocationManager>>> = const { RefCell::new(None) };
    static GEOCODER: RefCell<Option<Retained<CLGeocoder>>> = const { RefCell::new(None) };
}

/// Never call from the main thread: it waits for the main queue.
pub(crate) fn on_main<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    assert!(objc2::MainThreadMarker::new().is_none(), "on_main called on the main thread");
    let out = Arc::new(Mutex::new(None));
    let o = out.clone();
    DispatchQueue::main().exec_sync(move || *o.lock().unwrap() = Some(f()));
    let v = out.lock().unwrap().take();
    v.expect("ran on the main queue")
}

fn manager() -> Retained<CLLocationManager> {
    MANAGER.with(|m| m.borrow_mut().get_or_insert_with(|| unsafe { CLLocationManager::new() }).clone())
}

/// Current Location Services authorization in the `perm` service shape: `"granted" | "denied" | "notAsked"`.
pub fn status() -> &'static str {
    let read = || unsafe {
        match manager().authorizationStatus() {
            CLAuthorizationStatus::AuthorizedAlways | CLAuthorizationStatus::AuthorizedWhenInUse => "granted",
            CLAuthorizationStatus::NotDetermined => "notAsked",
            _ => "denied",
        }
    };
    if objc2::MainThreadMarker::new().is_some() {
        read()
    } else {
        on_main(read)
    }
}

/// Non-blocking location permission request: triggers macOS's dialog on the main queue if not determined.
pub fn request() {
    DispatchQueue::main().exec_async(|| unsafe {
        let m = manager();
        if m.authorizationStatus() == CLAuthorizationStatus::NotDetermined {
            m.requestWhenInUseAuthorization();
        }
    });
}

enum Now {
    Denied,
    Waiting,
    /// the permission prompt is up
    Asking,
    Got(Fix),
}

pub struct CoreLocation;

impl Locator for CoreLocation {
    /// Never on the main thread (it waits on the main queue).
    fn locate(&self, timeout: Duration) -> Result<Fix, LocError> {
        let started = Instant::now();
        on_main(|| unsafe {
            let m = manager();
            if m.authorizationStatus() == CLAuthorizationStatus::NotDetermined {
                m.requestWhenInUseAuthorization();
            }
            m.startUpdatingLocation();
        });
        let result = loop {
            // (a class method Apple asks not to call on the main thread)
            if !unsafe { CLLocationManager::locationServicesEnabled_class() } {
                break Err(LocError::Off);
            }
            let now = on_main(|| unsafe {
                let m = manager();
                let st = m.authorizationStatus();
                if st == CLAuthorizationStatus::Denied || st == CLAuthorizationStatus::Restricted {
                    return Now::Denied;
                }
                if st == CLAuthorizationStatus::NotDetermined {
                    return Now::Asking;
                }
                match m.location() {
                    // a position from the last two minutes
                    Some(l) if l.timestamp().timeIntervalSinceNow() > -120.0 => {
                        let c = l.coordinate();
                        Now::Got(Fix { lat: c.latitude, lon: c.longitude, accuracy_m: l.horizontalAccuracy() })
                    }
                    _ => Now::Waiting,
                }
            });
            match now {
                Now::Denied => break Err(LocError::Denied),
                Now::Got(f) => break Ok(f),
                Now::Waiting if started.elapsed() > timeout => break Err(LocError::Unavailable),
                // a person reading the prompt gets a minute, not the usual timeout
                Now::Asking if started.elapsed() > timeout.max(Duration::from_secs(60)) => break Err(LocError::Unavailable),
                Now::Waiting | Now::Asking => std::thread::sleep(Duration::from_millis(250)),
            }
        };
        on_main(|| unsafe { manager().stopUpdatingLocation() });
        result
    }

    /// Apple's reverse geocoding: locality, administrative area, country and the place's time zone.
    fn place(&self, fix: &Fix) -> Option<Value> {
        let (tx, rx) = mpsc::channel::<Option<Value>>();
        let (lat, lon) = (fix.lat, fix.lon);
        on_main(move || unsafe {
            let loc = CLLocation::initWithLatitude_longitude(CLLocation::alloc(), lat, lon);
            let tx = Mutex::new(Some(tx));
            let done = RcBlock::new(move |marks: *mut NSArray<CLPlacemark>, _err: *mut NSError| {
                let place = marks.as_ref().and_then(|a| a.firstObject()).map(|p| {
                    let s = |v: Option<Retained<objc2_foundation::NSString>>| v.map(|v| v.to_string());
                    json!({
                        "name": s(p.locality()).or(s(p.administrativeArea())),
                        "admin": s(p.administrativeArea()),
                        "country": s(p.country()),
                        "lat": lat, "lon": lon,
                        "tz": p.timeZone().map(|t| t.name().to_string()),
                    })
                });
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(place);
                }
            });
            let g = GEOCODER.with(|g| g.borrow_mut().get_or_insert_with(|| CLGeocoder::new()).clone());
            #[allow(deprecated)]
            g.reverseGeocodeLocation_completionHandler(&loc, RcBlock::as_ptr(&done));
        });
        rx.recv_timeout(Duration::from_secs(10)).ok().flatten().filter(|p| p["name"].is_string())
    }
}
