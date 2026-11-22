//! Prayer times: Kemenag RI (myquran.com) in Indonesia, Aladhan elsewhere; today's and tomorrow's, sent to the
//! frontend as a `helper` message `{type: "prayer", …}` (notch.js prayerTimes). Months are cached in `prayer.json`
//! so cached schedules work offline immediately.
use chrono::{DateTime, Datelike, NaiveDate, NaiveTime, TimeZone};
use chrono_tz::Tz;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const TUNE_ID: &str = "2,2,0,4,2,4,0,3,0";
const KEYS: [(&str, &str, &str); 7] = [
    // (ours, Kemenag's, Aladhan's)
    ("imsak", "imsak", "Imsak"), ("fajr", "subuh", "Fajr"), ("sunrise", "terbit", "Sunrise"), ("dhuhr", "dzuhur", "Dhuhr"),
    ("asr", "ashar", "Asr"), ("maghrib", "maghrib", "Maghrib"), ("isha", "isya", "Isha"),
];

#[derive(Debug, Clone, PartialEq)]
pub enum Source {
    Kemenag { city_id: String, city: String },
    Aladhan { method: Option<u32>, tune: Option<String> },
}

/// The place prayer times are for: `prayerLocation` if it has a position, else `weatherLocation`.
pub fn place(settings: &Value) -> Option<Value> {
    let ok = |p: &Value| p["lat"].is_number() && p["lon"].is_number();
    [&settings["prayerLocation"], &settings["weatherLocation"]].into_iter().find(|p| ok(p)).cloned()
}

fn in_indonesia(p: &Value) -> bool {
    p["country"].as_str().is_some_and(|c| c.eq_ignore_ascii_case("Indonesia"))
}

/// Aladhan's method for "auto": the authority of the place's country (the ones Settings lists), else Muslim World League.
pub fn auto_method(country: &str) -> u32 {
    match country.to_lowercase().as_str() {
        "indonesia" => 20,
        "malaysia" => 17,
        "singapore" => 11,
        "turkey" | "türkiye" | "turkiye" => 13,
        "saudi arabia" => 4,
        "united states" | "canada" => 2,
        "egypt" => 5,
        "pakistan" => 1,
        "united arab emirates" => 16,
        "kuwait" => 9,
        "qatar" => 10,
        "france" => 12,
        "russia" => 14,
        "morocco" => 21,
        "jordan" => 23,
        "tunisia" => 18,
        "algeria" => 19,
        "portugal" => 22,
        "bahrain" | "oman" => 8,
        _ => 3,
    }
}

pub fn choose(settings: &Value, kemenag_match: Option<(String, String)>) -> Source {
    let p = place(settings).unwrap_or(Value::Null);
    let method = settings["prayerMethod"].as_str().and_then(|m| m.parse().ok()).or(settings["prayerMethod"].as_u64().map(|m| m as u32))
        .or_else(|| Some(auto_method(p["country"].as_str().unwrap_or_default())));
    if !in_indonesia(&p) {
        return Source::Aladhan { method, tune: None };
    }
    let picked = &settings["prayerKemenag"];
    if let (Some(id), Some(name)) = (picked["id"].as_str(), picked["name"].as_str()) {
        return Source::Kemenag { city_id: id.into(), city: name.into() };
    }
    match kemenag_match {
        Some((city_id, city)) => Source::Kemenag { city_id, city },
        None => Source::Aladhan { method, tune: Some(TUNE_ID.into()) },
    }
}

/// The myquran city for a place name: "KOTA <NAME>" if there is one, else the first result.
pub fn kemenag_city(resp: &Value, name: &str) -> Option<(String, String)> {
    let list = resp["data"].as_array()?;
    let want = format!("KOTA {}", name.to_uppercase());
    let pick = list.iter().find(|c| c["lokasi"].as_str() == Some(&want)).or_else(|| list.first())?;
    Some((pick["id"].as_str()?.to_string(), pick["lokasi"].as_str()?.to_string()))
}

/// A month of Kemenag times ("04:05" in the place's time zone) as epoch ms.
pub fn days_from_kemenag(resp: &Value, tz: Tz) -> Vec<Value> {
    let Some(list) = resp["data"]["jadwal"].as_array() else { return vec![] };
    list.iter().filter_map(|d| {
        let date = NaiveDate::parse_from_str(d["date"].as_str()?, "%Y-%m-%d").ok()?;
        let mut out = Map::new();
        out.insert("date".into(), json!(date.to_string()));
        for (ours, theirs, _) in KEYS {
            let t = NaiveTime::parse_from_str(d[theirs].as_str()?, "%H:%M").ok()?;
            out.insert(ours.into(), json!(tz.from_local_datetime(&date.and_time(t)).earliest()?.timestamp_millis()));
        }
        Some(Value::Object(out))
    }).collect()
}

/// Aladhan's month, the days asked for (ISO 8601 times with the offset).
pub fn days_from_aladhan(resp: &Value, dates: &[NaiveDate]) -> Vec<Value> {
    let Some(list) = resp["data"].as_array() else { return vec![] };
    dates.iter().filter_map(|want| {
        let d = list.iter().find(|d| {
            d["date"]["gregorian"]["date"].as_str().and_then(|s| NaiveDate::parse_from_str(s, "%d-%m-%Y").ok()) == Some(*want)
        })?;
        let mut out = Map::new();
        out.insert("date".into(), json!(want.to_string()));
        for (ours, _, theirs) in KEYS {
            let t = DateTime::parse_from_rfc3339(d["timings"][theirs].as_str()?).ok()?;
            out.insert(ours.into(), json!(t.timestamp_millis()));
        }
        Some(Value::Object(out))
    }).collect()
}

/// Today and tomorrow in the place's time zone.
pub fn days_for(now_ms: i64, tz: Tz) -> [NaiveDate; 2] {
    let today = tz.timestamp_millis_opt(now_ms).single().map(|d| d.date_naive()).unwrap_or_default();
    [today, today.succ_opt().unwrap_or(today)]
}

pub fn message(place: &Value, result: Result<(Vec<Value>, Source), String>) -> Value {
    match result {
        Err(error) => json!({ "type": "prayer", "ok": false, "error": error, "place": place["name"] }),
        Ok((days, source)) => {
            let id = in_indonesia(place);
            let names = if id {
                json!({ "imsak": "Imsak", "fajr": "Subuh", "sunrise": "Terbit", "dhuhr": "Dzuhur", "asr": "Ashar", "maghrib": "Maghrib", "isha": "Isya" })
            } else {
                json!({ "imsak": "Imsak", "fajr": "Fajr", "sunrise": "Sunrise", "dhuhr": "Dhuhr", "asr": "Asr", "maghrib": "Maghrib", "isha": "Isha" })
            };
            let source = match source { Source::Kemenag { .. } => "Kemenag RI", Source::Aladhan { .. } => "Aladhan" };
            json!({ "type": "prayer", "ok": true, "days": days, "names": names, "source": source, "place": place["name"], "tz": place["tz"] })
        }
    }
}

/// `prayer.json`: cached months, city matches, and the last message.
pub struct Prayer {
    file: PathBuf,
    cache: Mutex<Map<String, Value>>,
    last: Mutex<Value>,
}

type Fetch<'a> = &'a dyn Fn(&str) -> anyhow::Result<Value>;

impl Prayer {
    pub fn new(data_dir: &Path) -> Self {
        let file = data_dir.join("prayer.json");
        let cache = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Prayer { file, cache: Mutex::new(cache), last: Mutex::new(Value::Null) }
    }

    pub fn last(&self) -> Value {
        self.last.lock().unwrap().clone()
    }

    fn cached(&self, key: &str, fetch: impl FnOnce() -> anyhow::Result<Value>) -> anyhow::Result<Value> {
        if let Some(v) = self.cache.lock().unwrap().get(key) {
            return Ok(v.clone());
        }
        let v = fetch()?;
        let mut c = self.cache.lock().unwrap();
        c.insert(key.into(), v.clone());
        let tmp = self.file.with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_vec(&*c)?).is_ok() {
            let _ = std::fs::rename(&tmp, &self.file);
        }
        Ok(v)
    }

    /// Today's and tomorrow's times for the settings, as the frontend's message (kept as `last`).
    pub fn compute(&self, settings: &Value, now_ms: i64, fetch: Fetch) -> Value {
        let Some(p) = place(settings) else {
            return self.keep(message(&json!({}), Err("Pick a city under Prayer Times or Weather".into())));
        };
        let tz: Tz = p["tz"].as_str().and_then(|t| t.parse().ok()).unwrap_or(chrono_tz::UTC);
        let dates = days_for(now_ms, tz);
        let name = p["name"].as_str().unwrap_or_default().to_string();
        let matched = if in_indonesia(&p) && settings["prayerKemenag"]["id"].is_null() && !name.is_empty() {
            self.cached(&format!("city:{}", name.to_uppercase()), || {
                let r = fetch(&format!("https://api.myquran.com/v2/sholat/kota/cari/{}", crate::http::q(&name)))?;
                Ok(kemenag_city(&r, &name).map(|(id, n)| json!({ "id": id, "name": n })).unwrap_or(Value::Null))
            }).ok().and_then(|v| Some((v["id"].as_str()?.to_string(), v["name"].as_str()?.to_string())))
        } else {
            None
        };
        let source = choose(settings, matched);
        let months: Vec<NaiveDate> = {
            let mut m: Vec<NaiveDate> = dates.iter().map(|d| d.with_day(1).unwrap()).collect();
            m.dedup();
            m
        };
        let mut days = Vec::new();
        for m in months {
            let ym = format!("{}-{:02}", m.year(), m.month());
            let got = match &source {
                Source::Kemenag { city_id, .. } => self.cached(&format!("kemenag:{city_id}:{ym}"), || {
                    let r = fetch(&format!("https://api.myquran.com/v2/sholat/jadwal/{city_id}/{}/{:02}", m.year(), m.month()))?;
                    let d = days_from_kemenag(&r, tz);
                    anyhow::ensure!(!d.is_empty(), "Kemenag returned no times");
                    Ok(json!({ "days": d }))
                }),
                Source::Aladhan { method, tune } => {
                    let key = format!("aladhan:{}:{}:{}:{ym}", p["lat"], p["lon"], method.map(|n| n.to_string()).unwrap_or("auto".into()));
                    self.cached(&key, || {
                        let mut url = format!("https://api.aladhan.com/v1/calendar/{}/{}?latitude={}&longitude={}&iso8601=true", m.year(), m.month(), p["lat"], p["lon"]);
                        if let Some(n) = method { url += &format!("&method={n}"); }
                        if let Some(t) = tune { url += &format!("&tune={t}"); }
                        let r = fetch(&url)?;
                        let all: Vec<NaiveDate> = (1..=31).filter_map(|d| NaiveDate::from_ymd_opt(m.year(), m.month(), d)).collect();
                        let d = days_from_aladhan(&r, &all);
                        anyhow::ensure!(!d.is_empty(), "Aladhan returned no times");
                        Ok(json!({ "days": d }))
                    })
                }
            };
            // a month that can't be had (offline, tomorrow in a month not cached yet) is skipped: the days found still count
            if let Ok(v) = got {
                days.extend(v["days"].as_array().cloned().unwrap_or_default());
            }
        }
        let wanted: Vec<String> = dates.iter().map(|d| d.to_string()).collect();
        let days: Vec<Value> = days.into_iter().filter(|d| d["date"].as_str().is_some_and(|s| wanted.iter().any(|w| w == s))).collect();
        if days.is_empty() {
            return self.keep(message(&p, Err("Couldn’t get prayer times. Check the internet connection.".into())));
        }
        self.keep(message(&p, Ok((days, source))))
    }

    fn keep(&self, m: Value) -> Value {
        *self.last.lock().unwrap() = m.clone();
        m
    }
}

pub fn register(reg: &mut crate::Registry) {
    reg.add("prayer.search", Box::new(|_, args| {
        let q = args.first().and_then(Value::as_str).unwrap_or_default().trim().to_string();
        if q.len() < 2 {
            return Ok(Value::Array(vec![]));
        }
        let r = crate::http::get_json(&format!("https://api.myquran.com/v2/sholat/kota/cari/{}", crate::http::q(&q)))?;
        Ok(Value::Array(r["data"].as_array().map(|a| a.iter().map(|c| json!({ "id": c["id"], "name": c["lokasi"] })).collect()).unwrap_or_default()))
    }));
}

/// The `prayer:due` events now: a prayer's time (`sound`, at most 10 minutes late, as the frontend's own fallback:
/// one missed asleep longer isn't rung) and its countdown `prayerBefore` minutes ahead (`soon`), each once (`sent`
/// keeps "id" and "id:soon"). The ones on in `prayerList` (Terbit has its own). Nothing while prayers are off.
pub fn due_events(msg: &Value, settings: &Value, now: i64, sent: &mut std::collections::HashSet<String>) -> Vec<Value> {
    if settings["prayerEnabled"] != true || msg["ok"] != true {
        return vec![];
    }
    let list = &settings["prayerList"];
    let before = settings["prayerBefore"].as_i64().unwrap_or(10).max(0) * 60_000;
    let mut out = vec![];
    for d in msg["days"].as_array().into_iter().flatten() {
        let date = d["date"].as_str().unwrap_or("");
        for key in ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] {
            let Some(at) = d[key].as_i64().filter(|_| list[key] != false) else { continue };
            let id = format!("{date}:{key}");
            let t = json!({"key": key, "name": msg["names"][key].as_str().unwrap_or(key), "at": at, "id": id});
            if now >= at && now - at <= 600_000 && sent.insert(id.clone()) {
                out.push(json!({"t": t, "sound": true}));
            } else if before > 0 && now < at && now >= at - before && sent.insert(format!("{id}:soon")) {
                out.push(json!({"t": t, "soon": true}));
            }
        }
    }
    out
}
