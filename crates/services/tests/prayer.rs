use chrono::NaiveDate;
use serde_json::{json, Value};
use services::prayer::{choose, days_for, days_from_aladhan, days_from_kemenag, kemenag_city, message, Source};

fn fixture(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(format!("tests/fixtures/{name}")).unwrap()).unwrap()
}
fn bekasi() -> Value {
    json!({ "name": "Bekasi", "admin": "West Java", "country": "Indonesia", "lat": -6.2349, "lon": 106.9896, "tz": "Asia/Jakarta" })
}
fn tokyo() -> Value {
    json!({ "name": "Tokyo", "admin": "Tokyo", "country": "Japan", "lat": 35.68, "lon": 139.69, "tz": "Asia/Tokyo" })
}

#[test]
fn kemenag_days_in_place_tz() {
    let all = days_from_kemenag(&fixture("myquran-jadwal.json"), chrono_tz::Asia::Jakarta);
    assert_eq!(all.len(), 30);
    let d = &all[17];
    assert_eq!(d["date"], "2026-11-18");
    assert_eq!(d["fajr"], 1_794_949_500_000i64);
    assert_eq!(d["sunrise"], 1_794_954_120_000i64);
    for k in ["dhuhr", "asr", "maghrib", "isha"] {
        assert!(d[k].is_i64(), "{k}");
    }
}

#[test]
fn aladhan_days_for_dates() {
    let dates = [NaiveDate::from_ymd_opt(2026, 11, 18).unwrap(), NaiveDate::from_ymd_opt(2026, 11, 19).unwrap()];
    let days = days_from_aladhan(&fixture("aladhan-calendar.json"), &dates);
    assert_eq!(days.len(), 2);
    assert_eq!(days[0]["date"], "2026-11-18");
    assert_eq!(days[0]["fajr"], 1_794_949_500_000i64);
    assert_eq!(days[1]["date"], "2026-11-19");
}

#[test]
fn kemenag_city_prefers_the_city() {
    assert_eq!(kemenag_city(&fixture("myquran-kota.json"), "Bekasi"), Some(("1221".into(), "KOTA BEKASI".into())));
}

#[test]
fn choose_kemenag_in_indonesia() {
    let s = json!({ "weatherLocation": bekasi(), "prayerLocation": null, "prayerKemenag": null, "prayerMethod": "auto" });
    assert_eq!(choose(&s, Some(("1221".into(), "KOTA BEKASI".into()))), Source::Kemenag { city_id: "1221".into(), city: "KOTA BEKASI".into() });
    // a city picked in Settings wins
    let s2 = json!({ "weatherLocation": bekasi(), "prayerKemenag": { "id": "1301", "name": "KOTA JAKARTA" }, "prayerMethod": "auto" });
    assert_eq!(choose(&s2, None), Source::Kemenag { city_id: "1301".into(), city: "KOTA JAKARTA".into() });
}

#[test]
fn choose_aladhan_abroad() {
    // "auto" is the authority for the place's country (Settings' list); elsewhere Muslim World League (3)
    let s = json!({ "weatherLocation": tokyo(), "prayerMethod": "auto" });
    assert_eq!(choose(&s, None), Source::Aladhan { method: Some(3), tune: None });
    let kl = json!({ "weatherLocation": { "name": "Kuala Lumpur", "country": "Malaysia", "lat": 3.1, "lon": 101.7, "tz": "Asia/Kuala_Lumpur" }, "prayerMethod": "auto" });
    assert_eq!(choose(&kl, None), Source::Aladhan { method: Some(17), tune: None });
    let s3 = json!({ "weatherLocation": tokyo(), "prayerMethod": "3" });
    assert_eq!(choose(&s3, None), Source::Aladhan { method: Some(3), tune: None });
}

#[test]
fn choose_aladhan_without_city_match() {
    let s = json!({ "weatherLocation": bekasi(), "prayerMethod": "auto" });
    assert_eq!(choose(&s, None), Source::Aladhan { method: Some(20), tune: Some("2,2,0,4,2,4,0,3,0".into()) });
}

#[test]
fn no_place_message() {
    let m = message(&json!({}), Err("Pick a city under Prayer Times or Weather".into()));
    assert_eq!(m["type"], "prayer");
    assert_eq!(m["ok"], false);
    assert_eq!(m["error"], "Pick a city under Prayer Times or Weather");
}

#[test]
fn indonesian_names_and_source() {
    let m = message(&bekasi(), Ok((vec![json!({"date": "2026-11-18"})], Source::Kemenag { city_id: "1221".into(), city: "KOTA BEKASI".into() })));
    assert_eq!(m["ok"], true);
    assert_eq!(m["source"], "Kemenag RI");
    assert_eq!(m["names"]["fajr"], "Subuh");
    assert_eq!(m["names"]["isha"], "Isya");
    assert_eq!(m["place"], "Bekasi");
    let a = message(&tokyo(), Ok((vec![], Source::Aladhan { method: Some(3), tune: None })));
    assert_eq!(a["source"], "Aladhan");
    assert_eq!(a["names"]["fajr"], "Fajr");
}

#[test]
fn rolls_over_after_midnight() {
    let tz = chrono_tz::Asia::Jakarta;
    let before = days_for(1_795_019_400_000, tz); // 23:30 on the 18th
    let after = days_for(1_795_023_000_000, tz); // 00:30 on the 19th
    assert_eq!(before.map(|d| d.to_string()), ["2026-11-18", "2026-11-19"]);
    assert_eq!(after.map(|d| d.to_string()), ["2026-11-19", "2026-11-20"]);
}

const NOW: i64 = 1_794_985_200_000; // 2026-11-18 14:00 in Jakarta

#[test]
fn offline_with_cached_times_still_works() {
    let dir = tempfile::tempdir().unwrap();
    let month = days_from_kemenag(&fixture("myquran-jadwal.json"), chrono_tz::Asia::Jakarta);
    let cache = json!({ "city:BEKASI": { "id": "1221", "name": "KOTA BEKASI" }, "kemenag:1221:2026-11": { "days": month } });
    std::fs::write(dir.path().join("prayer.json"), cache.to_string()).unwrap();
    let p = services::prayer::Prayer::new(dir.path());
    let calls = std::cell::Cell::new(0);
    let m = p.compute(&json!({ "weatherLocation": bekasi(), "prayerMethod": "auto" }), NOW, &|_| { calls.set(calls.get() + 1); anyhow::bail!("offline") });
    assert_eq!(m["ok"], true, "{m}");
    assert_eq!(m["source"], "Kemenag RI");
    assert_eq!(m["days"].as_array().unwrap().len(), 2);
    assert_eq!(calls.get(), 0);
}

#[test]
fn offline_without_cache_says_so() {
    let dir = tempfile::tempdir().unwrap();
    let p = services::prayer::Prayer::new(dir.path());
    let m = p.compute(&json!({ "weatherLocation": tokyo(), "prayerMethod": "auto" }), NOW, &|_| anyhow::bail!("offline"));
    assert_eq!(m["ok"], false);
    assert!(m["error"].as_str().unwrap().contains("internet"));
}

const NOV30: i64 = 1_796_022_000_000; // 2026-11-30 14:00 in Jakarta

#[test]
fn offline_on_a_months_last_day_keeps_today() {
    let dir = tempfile::tempdir().unwrap();
    let month = days_from_kemenag(&fixture("myquran-jadwal.json"), chrono_tz::Asia::Jakarta);
    let cache = json!({ "city:BEKASI": { "id": "1221", "name": "KOTA BEKASI" }, "kemenag:1221:2026-11": { "days": month } });
    std::fs::write(dir.path().join("prayer.json"), cache.to_string()).unwrap();
    let p = services::prayer::Prayer::new(dir.path());
    let m = p.compute(&json!({ "weatherLocation": bekasi(), "prayerMethod": "auto" }), NOV30, &|_| anyhow::bail!("offline"));
    assert_eq!(m["ok"], true, "{m}");
    let days = m["days"].as_array().unwrap();
    assert_eq!(days.len(), 1);
    assert_eq!(days[0]["date"], "2026-11-30");
}

#[test]
fn offline_after_changing_place_doesnt_show_the_old_place() {
    let dir = tempfile::tempdir().unwrap();
    let month = days_from_kemenag(&fixture("myquran-jadwal.json"), chrono_tz::Asia::Jakarta);
    let cache = json!({ "city:BEKASI": { "id": "1221", "name": "KOTA BEKASI" }, "kemenag:1221:2026-11": { "days": month } });
    std::fs::write(dir.path().join("prayer.json"), cache.to_string()).unwrap();
    let p = services::prayer::Prayer::new(dir.path());
    let offline = |_: &str| -> anyhow::Result<Value> { anyhow::bail!("offline") };
    assert_eq!(p.compute(&json!({ "weatherLocation": bekasi(), "prayerMethod": "auto" }), NOW, &offline)["ok"], true);
    let m = p.compute(&json!({ "weatherLocation": tokyo(), "prayerMethod": "auto" }), NOW, &offline);
    assert_eq!(m["ok"], false, "{m}");
    assert_eq!(m["place"], "Tokyo");
}

#[test]
fn an_empty_aladhan_month_isnt_cached() {
    let dir = tempfile::tempdir().unwrap();
    let p = services::prayer::Prayer::new(dir.path());
    let s = json!({ "weatherLocation": tokyo(), "prayerMethod": "auto" });
    assert_eq!(p.compute(&s, NOW, &|_| Ok(json!({ "data": [] })))["ok"], false);
    let good = fixture("aladhan-calendar.json");
    let calls = std::cell::Cell::new(0);
    p.compute(&s, NOW, &|_| { calls.set(calls.get() + 1); Ok(good.clone()) });
    assert_eq!(calls.get(), 1); // fetched again, not the empty month from the cache
}
