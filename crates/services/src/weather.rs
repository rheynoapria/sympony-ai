//! Weather from Open-Meteo in the shape the frontend reads (modules/weather.js).
use chrono::NaiveDateTime;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FIELDS: &str = "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,pressure_msl,uv_index\
&hourly=temperature_2m,weather_code,is_day,precipitation_probability\
&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max\
&forecast_days=7&timezone=auto";

pub fn forecast_url(place: &Value, unit: &str) -> String {
    let f = if unit == "f" { "&temperature_unit=fahrenheit&wind_speed_unit=mph" } else { "" };
    format!("https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}{FIELDS}{f}", place["lat"], place["lon"])
}

pub fn search_url(q: &str) -> String {
    format!("https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name={}", crate::http::q(q))
}

fn at(v: &Value, k: &str, i: usize) -> Value {
    v[k].get(i).cloned().unwrap_or(Value::Null)
}

/// `now_ms` picks the hour the 24 hourly entries start from (Open-Meteo's times are the place's local time).
pub fn from_open_meteo(r: &Value, place: &Value, unit: &str, now_ms: i64) -> Value {
    let c = &r["current"];
    let current = json!({
        "temp": c["temperature_2m"], "feels": c["apparent_temperature"], "humidity": c["relative_humidity_2m"].as_f64(),
        "wind": c["wind_speed_10m"], "uv": c["uv_index"], "pressure": c["pressure_msl"], "code": c["weather_code"],
        "day": c["is_day"].as_i64() == Some(1),
    });
    let h = &r["hourly"];
    let offset_ms = r["utc_offset_seconds"].as_i64().unwrap_or(0) * 1000;
    let local_now = chrono::DateTime::from_timestamp_millis(now_ms + offset_ms).map(|d| d.naive_utc());
    let times: Vec<NaiveDateTime> = h["time"].as_array().map(|a| {
        a.iter().filter_map(|t| NaiveDateTime::parse_from_str(t.as_str()?, "%Y-%m-%dT%H:%M").ok()).collect()
    }).unwrap_or_default();
    let start = local_now.map(|n| times.iter().take_while(|t| **t <= n).count().saturating_sub(1)).unwrap_or(0);
    let hourly: Vec<Value> = (start..times.len().min(start + 24)).map(|i| json!({
        "time": at(h, "time", i), "temp": at(h, "temperature_2m", i), "code": at(h, "weather_code", i),
        "day": at(h, "is_day", i).as_i64() == Some(1), "pop": at(h, "precipitation_probability", i),
    })).collect();
    let d = &r["daily"];
    let days = d["time"].as_array().map(Vec::len).unwrap_or(0);
    let daily: Vec<Value> = (0..days).map(|i| json!({
        "date": at(d, "time", i), "max": at(d, "temperature_2m_max", i), "min": at(d, "temperature_2m_min", i),
        "code": at(d, "weather_code", i), "sunrise": at(d, "sunrise", i), "sunset": at(d, "sunset", i),
        "uv": at(d, "uv_index_max", i), "pop": at(d, "precipitation_probability_max", i),
    })).collect();
    json!({ "location": place, "current": current, "hourly": hourly, "daily": daily,
            "windUnit": if unit == "f" { "mph" } else { "km/h" }, "updatedAt": now_ms })
}

pub fn search_results(r: &Value) -> Value {
    Value::Array(r["results"].as_array().map(|a| a.iter().map(|p| json!({
        "name": p["name"], "admin": p["admin1"], "country": p["country"],
        "lat": p["latitude"], "lon": p["longitude"], "tz": p["timezone"],
    })).collect()).unwrap_or_default())
}

/// The last weather (`weather.json` in the data folder, so it's there offline and after a restart).
pub struct Weather {
    file: PathBuf,
    last: Mutex<Value>,
}

impl Weather {
    pub fn new(data_dir: &Path) -> Self {
        let file = data_dir.join("weather.json");
        let last = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        Weather { file, last: Mutex::new(last) }
    }

    pub fn get(&self) -> Value {
        self.last.lock().unwrap().clone()
    }

    /// Fetches and keeps the result; a failure keeps the last one with `error` set. Returns what the frontend gets.
    pub fn refresh(&self, place: &Value, unit: &str, now_ms: i64, fetch: impl Fn(&str) -> anyhow::Result<Value>) -> anyhow::Result<Value> {
        let got = fetch(&forecast_url(place, unit)); // (not holding the lock: weather.get stays quick)
        let mut last = self.last.lock().unwrap();
        match got {
            Ok(r) => *last = from_open_meteo(&r, place, unit, now_ms),
            Err(e) => {
                if last.is_null() {
                    *last = json!({ "location": place });
                }
                last["error"] = Value::String(format!("{e:#}"));
            }
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&*last)?)?;
        std::fs::rename(&tmp, &self.file)?;
        Ok(last.clone())
    }
}

/// Now, in epoch ms.
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// The weather place and unit from the settings: (place, unit), no place → None.
pub fn wanted(settings: &crate::settings::Settings) -> Option<(Value, String)> {
    let s = settings.get();
    let place = s["weatherLocation"].clone();
    (place["lat"].is_number() && place["lon"].is_number()).then(|| (place, s["weatherUnit"].as_str().unwrap_or("c").to_string()))
}

/// Refreshes for the settings' place (no place: nothing) and sends the result as `weather`.
pub fn refresh_now(ctx: &crate::Ctx, settings: &crate::settings::Settings, weather: &Weather) -> anyhow::Result<Value> {
    let Some((place, unit)) = wanted(settings) else { return Ok(weather.get()) };
    let out = weather.refresh(&place, &unit, now_ms(), crate::http::get_json)?;
    if let Some(e) = out["error"].as_str() {
        (ctx.log)(&format!("weather: {e}"));
    }
    (ctx.emit)("weather", out.clone());
    Ok(out)
}

pub fn register(reg: &mut crate::Registry, deps: &crate::Deps) {
    let w = deps.weather.clone();
    reg.add("weather.get", Box::new(move |_, _| Ok(w.get())));
    let (w, s) = (deps.weather.clone(), deps.settings.clone());
    reg.add("weather.refresh", Box::new(move |ctx, _| refresh_now(ctx, &s, &w)));
    reg.add("weather.search", Box::new(|_, args| {
        let q = args.first().and_then(Value::as_str).unwrap_or_default().trim().to_string();
        if q.len() < 2 {
            return Ok(Value::Array(vec![]));
        }
        Ok(search_results(&crate::http::get_json(&search_url(&q))?))
    }));
}
