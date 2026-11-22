//! "Detect" in Settings and the "Use my current location" mode, over the OS's `Locator`.
use crate::settings::Settings;
use platform::location::{moved_enough, Fix, LocError, Locator};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub const TIMEOUT: Duration = Duration::from_secs(15);

fn reason(e: LocError) -> &'static str {
    match e {
        LocError::Off => "off",
        LocError::Denied => "denied",
        LocError::Unavailable => "unavailable",
    }
}

/// The place for a position: its name if it can be looked up, else the position with the saved place's time zone.
fn place_for(settings: &Settings, loc: &dyn Locator, fix: &Fix) -> (Value, bool) {
    match loc.place(fix) {
        Some(p) => (p, true),
        None => {
            // the saved place's country and time zone: prayer times need both (Kemenag, the tz)
            let saved = settings.get()["weatherLocation"].clone();
            (json!({ "name": null, "admin": null, "country": saved["country"], "lat": fix.lat, "lon": fix.lon, "tz": saved["tz"] }), false)
        }
    }
}

/// `which`: "weather" or "prayer"; saves the place found (prayer also forgets a Kemenag city picked before).
pub fn detect(settings: &Settings, loc: &dyn Locator, which: &str) -> Value {
    let fix = match loc.locate(TIMEOUT) {
        Ok(f) => f,
        Err(e) => return json!({ "ok": false, "reason": reason(e) }),
    };
    let (place, named) = place_for(settings, loc, &fix);
    if which == "prayer" {
        settings.set(json!({ "prayerLocation": place, "prayerKemenag": null }));
    } else {
        settings.set(json!({ "weatherLocation": place }));
    }
    json!({ "ok": true, "place": place, "named": named })
}

/// "Use my current location": `Ok(Some(new weather place))` when the computer moved more than 2 km, `Ok(None)` when
/// it didn't or the mode is off (then no name lookup, no network), `Err` when there's no position (for the log).
pub fn auto_tick(settings: &Settings, loc: &dyn Locator) -> Result<Option<Value>, LocError> {
    if settings.get()["locationAuto"] != true {
        return Ok(None);
    }
    let fix = loc.locate(TIMEOUT)?;
    if !moved_enough(&settings.get()["weatherLocation"], &fix) {
        return Ok(None);
    }
    let (place, _) = place_for(settings, loc, &fix);
    settings.set(json!({ "weatherLocation": place }));
    Ok(Some(place))
}

static BUSY: AtomicBool = AtomicBool::new(false);

/// `location.detect(which)`: one at a time (`{ok:false, reason:"busy"}` while one runs).
pub fn register(reg: &mut crate::Registry, deps: &crate::Deps) {
    let (s, loc) = (deps.settings.clone(), deps.locator.clone());
    reg.add("location.detect", Box::new(move |ctx, args| {
        if BUSY.swap(true, Ordering::SeqCst) {
            return Ok(json!({ "ok": false, "reason": "busy" }));
        }
        struct Release;
        impl Drop for Release {
            fn drop(&mut self) {
                BUSY.store(false, Ordering::SeqCst);
            }
        }
        let release = Release;
        let which = args.first().and_then(Value::as_str).unwrap_or("weather").to_string();
        let r = detect(&s, loc.as_ref(), &which);
        drop(release);
        if r["ok"] == true {
            let key = if which == "prayer" { "prayerLocation" } else { "weatherLocation" };
            (ctx.changed)(&json!({ key: r["place"] }));
        }
        Ok(r)
    }));
}
