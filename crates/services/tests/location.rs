use platform::location::{Fix, LocError, Locator};
use platform::Secrets;
use serde_json::{json, Value};
use services::location::{auto_tick, detect};
use services::settings::Settings;
use std::sync::{Arc, Mutex};
use std::time::Duration;

struct NoSecrets;
impl Secrets for NoSecrets {
    fn get(&self, _: &str) -> Option<String> { None }
    fn set(&self, _: &str, _: &str) -> anyhow::Result<()> { Ok(()) }
}

struct Fake { fix: Result<Fix, LocError>, named: bool, places: Mutex<usize> }
impl Locator for Fake {
    fn locate(&self, _: Duration) -> Result<Fix, LocError> { self.fix }
    fn place(&self, f: &Fix) -> Option<Value> {
        *self.places.lock().unwrap() += 1;
        self.named.then(|| json!({ "name": "Bandung", "admin": "West Java", "country": "Indonesia", "lat": f.lat, "lon": f.lon, "tz": "Asia/Jakarta" }))
    }
}
fn fake(fix: Result<Fix, LocError>, named: bool) -> Fake { Fake { fix, named, places: Mutex::new(0) } }
const BANDUNG: Fix = Fix { lat: -6.9175, lon: 107.6191, accuracy_m: 20.0 };

fn settings(dir: &std::path::Path) -> Settings {
    let s = Settings::load(dir, Arc::new(NoSecrets));
    s.set(json!({ "weatherLocation": { "name": "Bekasi", "lat": -6.2349, "lon": 106.9896, "tz": "Asia/Jakarta" } }));
    s
}

#[test]
fn detect_saves_the_place() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    let r = detect(&s, &fake(Ok(BANDUNG), true), "weather");
    assert_eq!(r["ok"], true);
    assert_eq!(r["named"], true);
    assert_eq!(r["place"]["name"], "Bandung");
    assert_eq!(s.get()["weatherLocation"]["name"], "Bandung");
}

#[test]
fn detect_for_prayer_clears_the_kemenag_city() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    s.set(json!({ "prayerKemenag": { "id": "1221", "name": "KOTA BEKASI" } }));
    detect(&s, &fake(Ok(BANDUNG), true), "prayer");
    assert_eq!(s.get()["prayerLocation"]["name"], "Bandung");
    assert!(s.get()["prayerKemenag"].is_null());
}

#[test]
fn detect_without_a_name_keeps_the_position() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    let r = detect(&s, &fake(Ok(BANDUNG), false), "weather");
    assert_eq!(r["ok"], true);
    assert_eq!(r["named"], false);
    assert_eq!(s.get()["weatherLocation"]["lat"], -6.9175);
}

#[test]
fn a_nameless_place_keeps_the_country_for_kemenag() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    s.set(json!({ "weatherLocation": { "name": "Bekasi", "country": "Indonesia", "lat": -6.2349, "lon": 106.9896, "tz": "Asia/Jakarta" } }));
    detect(&s, &fake(Ok(BANDUNG), false), "weather");
    assert_eq!(s.get()["weatherLocation"]["country"], "Indonesia");
    assert_eq!(s.get()["weatherLocation"]["tz"], "Asia/Jakarta");
}

#[test]
fn detect_reports_off_and_denied_and_keeps_the_place() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    assert_eq!(detect(&s, &fake(Err(LocError::Off), true), "weather"), json!({ "ok": false, "reason": "off" }));
    assert_eq!(detect(&s, &fake(Err(LocError::Denied), true), "weather"), json!({ "ok": false, "reason": "denied" }));
    assert_eq!(detect(&s, &fake(Err(LocError::Unavailable), true), "weather"), json!({ "ok": false, "reason": "unavailable" }));
    assert_eq!(s.get()["weatherLocation"]["name"], "Bekasi");
}

#[test]
fn auto_tick_moves_only_when_far() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    let near = fake(Ok(Fix { lat: -6.2349, lon: 106.9941, accuracy_m: 20.0 }), true);
    assert_eq!(auto_tick(&s, &near), Ok(None));
    assert_eq!(*near.places.lock().unwrap(), 0); // no reverse geocoding, no network
    let far = fake(Ok(BANDUNG), true);
    assert_eq!(auto_tick(&s, &far).unwrap().unwrap()["name"], "Bandung");
    assert_eq!(s.get()["weatherLocation"]["name"], "Bandung");
}

#[test]
fn auto_tick_off_does_nothing() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    s.set(json!({ "locationAuto": false }));
    let far = fake(Ok(BANDUNG), true);
    assert_eq!(auto_tick(&s, &far), Ok(None));
    assert_eq!(s.get()["weatherLocation"]["name"], "Bekasi");
}

#[test]
fn auto_tick_reports_why_there_is_no_position() {
    let d = tempfile::tempdir().unwrap();
    let s = settings(d.path());
    assert_eq!(auto_tick(&s, &fake(Err(LocError::Denied), true)), Err(LocError::Denied));
    assert_eq!(s.get()["weatherLocation"]["name"], "Bekasi");
}

#[test]
fn detect_through_the_registry_tells_the_app_what_changed() {
    let d = tempfile::tempdir().unwrap();
    struct Here;
    impl Locator for Here {
        fn locate(&self, _: Duration) -> Result<Fix, LocError> { Ok(BANDUNG) }
        fn place(&self, f: &Fix) -> Option<Value> { Some(json!({ "name": "Bandung", "country": "Indonesia", "lat": f.lat, "lon": f.lon, "tz": "Asia/Jakarta" })) }
    }
    let deps = services::Deps::new(d.path(), Arc::new(NoSecrets), Arc::new(Here));
    let reg = services::build(&deps);
    let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
    let s2 = seen.clone();
    let ctx = services::Ctx {
        data_dir: d.path().to_path_buf(),
        emit: Arc::new(|_, _| {}),
        log: Arc::new(|_| {}),
        changed: Arc::new(move |patch: &Value| s2.lock().unwrap().push(patch.clone())),
    };
    assert_eq!(reg.call(&ctx, "location.detect", vec![json!("weather")])["ok"], true);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0]["weatherLocation"]["name"], "Bandung");
}
