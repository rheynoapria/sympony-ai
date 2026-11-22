use serde_json::{json, Value};
use services::weather::{forecast_url, from_open_meteo, search_results, Weather};

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("tests/fixtures/{name}")).unwrap()).unwrap()
}
fn jakarta() -> Value {
    json!({ "name": "Jakarta", "admin": "Jakarta", "country": "Indonesia", "lat": -6.2, "lon": 106.8, "tz": "Asia/Jakarta" })
}
// the fixture's `current.time`, 2026-11-18T20:45 at UTC+7
const NOW: i64 = 1_795_009_500_000;

#[test]
fn maps_current() {
    let w = from_open_meteo(&fixture("open-meteo-forecast.json"), &jakarta(), "c", NOW);
    let c = &w["current"];
    assert_eq!(c["temp"], 25.5);
    assert_eq!(c["feels"], 31.1);
    assert_eq!(c["humidity"], 94.0);
    assert_eq!(c["wind"], 5.2);
    assert_eq!(c["pressure"], 1013.8);
    assert_eq!(c["uv"], 0.0);
    assert_eq!(c["code"], 51);
    assert_eq!(c["day"], false);
    assert_eq!(w["location"]["name"], "Jakarta");
    assert_eq!(w["windUnit"], "km/h");
    assert_eq!(w["updatedAt"], NOW);
}

#[test]
fn hourly_starts_at_now() {
    let w = from_open_meteo(&fixture("open-meteo-forecast.json"), &jakarta(), "c", NOW);
    let h = w["hourly"].as_array().unwrap();
    assert_eq!(h.len(), 24);
    assert_eq!(h[0]["time"], "2026-11-18T20:00");
    for k in ["temp", "code", "day", "pop"] {
        assert!(!h[0][k].is_null(), "{k}");
    }
}

#[test]
fn seven_days() {
    let w = from_open_meteo(&fixture("open-meteo-forecast.json"), &jakarta(), "c", NOW);
    let d = w["daily"].as_array().unwrap();
    assert_eq!(d.len(), 7);
    assert_eq!(d[0]["date"], "2026-11-18");
    for k in ["max", "min", "code", "sunrise", "sunset", "uv", "pop"] {
        assert!(!d[0][k].is_null(), "{k}");
    }
}

#[test]
fn fahrenheit_url_and_wind_unit() {
    let u = forecast_url(&jakarta(), "f");
    assert!(u.starts_with("https://api.open-meteo.com/v1/forecast?latitude=-6.2&longitude=106.8&current="));
    for field in ["precipitation_probability", "uv_index", "relative_humidity_2m", "wind_speed_10m", "sunrise", "sunset"] {
        assert!(u.contains(field), "missing {field} in forecast URL");
    }
    assert!(u.ends_with("&forecast_days=7&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph"));
    assert!(!forecast_url(&jakarta(), "c").contains("fahrenheit"));
    let w = from_open_meteo(&fixture("open-meteo-forecast.json"), &jakarta(), "f", NOW);
    assert_eq!(w["windUnit"], "mph");
}

#[test]
fn search_maps_places() {
    let r = search_results(&fixture("open-meteo-search.json"));
    let first = &r[0];
    assert_eq!(first["name"], "Bekasi");
    assert_eq!(first["admin"], "West Java");
    assert_eq!(first["country"], "Indonesia");
    assert_eq!(first["tz"], "Asia/Jakarta");
    assert!(first["lat"].is_f64() && first["lon"].is_f64());
}

#[test]
fn failed_refresh_keeps_last_and_sets_error() {
    let dir = tempfile::tempdir().unwrap();
    let w = Weather::new(dir.path());
    let good = fixture("open-meteo-forecast.json");
    let ok = w.refresh(&jakarta(), "c", NOW, |_| Ok(good.clone())).unwrap();
    assert_eq!(ok["current"]["temp"], 25.5);
    let after = w.refresh(&jakarta(), "c", NOW + 1, |_| anyhow::bail!("offline")).unwrap();
    assert_eq!(after["current"]["temp"], 25.5);
    assert!(after["error"].as_str().unwrap().contains("offline"));
    // and it was saved: a new Weather (restart) still has it
    assert_eq!(Weather::new(dir.path()).get()["current"]["temp"], 25.5);
}
