use serde_json::json;
use std::collections::HashSet;

#[test]
fn the_macs_language_and_the_one_used() {
    use services::i18n::*;
    assert_eq!(system_codes("(\n    \"en-ID\",\n    \"id-ID\"\n)"), ["en-ID", "id-ID"]);
    let offered = ["id", "fr", "zh", "ar"].map(String::from);
    assert_eq!(resolve("auto", &["fr-CA".into()], &offered), "fr");
    assert_eq!(resolve("auto", &["en-ID".into(), "id-ID".into()], &offered), "en");
    assert_eq!(resolve("auto", &["zh-Hans-CN".into()], &offered), "zh");
    assert_eq!(resolve("auto", &["xx".into()], &offered), "en");
    assert_eq!(resolve("id", &["en-ID".into()], &offered), "id");
    assert_eq!(resolve("", &[], &offered), "en");
    assert!(valid_code("id") && valid_code("pt-BR") && !valid_code("../x") && !valid_code("") && !valid_code("abcdefghijk"));
}

#[test]
fn a_downloaded_table_is_checked() {
    use services::i18n::table;
    assert_eq!(table(br#"{"Settings": "Pengaturan"}"#).unwrap()["Settings"], "Pengaturan");
    assert!(table(br#"{"a": 1}"#).is_err());
    assert!(table(b"[]").is_err());
    assert!(table(b"<html>404</html>").is_err());
    assert!(table(b"{}").is_err());
}

#[test]
fn the_offered_list() {
    use services::i18n::offered;
    let l = json!({"languages": [{"code": "id", "name": "Bahasa Indonesia", "ready": true}, {"code": "ar", "name": "العربية", "ready": true, "rtl": true},
        {"code": "xx", "name": "Draft", "ready": false}, {"code": "../bad", "name": "Bad", "ready": true}]});
    let o = offered(&l);
    assert_eq!(o.iter().map(|x| (x.0.as_str(), x.2)).collect::<Vec<_>>(), [("id", false), ("ar", true)]);
}

const H: i64 = 3_600_000;
const M: i64 = 60_000;

#[test]
fn warm_after_sunset_back_at_sunrise() {
    use services::warmth::level;
    let (rise, set) = (6 * H, 18 * H);
    assert_eq!(level(3 * H, rise, set, 60), 0.6); // night
    assert!((level(6 * H + 15 * M, rise, set, 60) - 0.4).abs() < 1e-9); // a third of the way back
    assert_eq!(level(12 * H, rise, set, 60), 0.0);
    assert!((level(18 * H + 15 * M, rise, set, 60) - 0.2).abs() < 1e-9);
    assert_eq!(level(20 * H, rise, set, 100), 1.0);
    assert_eq!(level(20 * H, rise, set, 0), 0.0);
}

#[test]
fn prayer_reminders_come_once() {
    use services::prayer::due_events;
    let t0 = 1_793_507_940_000i64; // Dzuhur
    let msg = json!({"type": "prayer", "ok": true, "names": {"fajr": "Subuh", "sunrise": "Terbit", "dhuhr": "Dzuhur", "asr": "Ashar", "maghrib": "Maghrib", "isha": "Isya"},
        "days": [{"date": "2026-11-01", "fajr": t0 - 7 * H, "sunrise": t0 - 6 * H, "dhuhr": t0, "asr": t0 + 3 * H, "maghrib": t0 + 6 * H, "isha": t0 + 7 * H}]});
    let s = json!({"prayerEnabled": true, "prayerBefore": 10, "prayerList": {"fajr": true, "dhuhr": true, "asr": false, "maghrib": true, "isha": true}});
    let mut sent = HashSet::new();
    assert!(due_events(&msg, &s, t0 - 20 * M, &mut sent).is_empty());
    let soon = due_events(&msg, &s, t0 - 9 * M, &mut sent);
    assert_eq!(soon, vec![json!({"t": {"key": "dhuhr", "name": "Dzuhur", "at": t0, "id": "2026-11-01:dhuhr"}, "soon": true})]);
    assert!(due_events(&msg, &s, t0 - 5 * M, &mut sent).is_empty());
    let due = due_events(&msg, &s, t0 + 1000, &mut sent);
    assert_eq!(due, vec![json!({"t": {"key": "dhuhr", "name": "Dzuhur", "at": t0, "id": "2026-11-01:dhuhr"}, "sound": true})]);
    assert!(due_events(&msg, &s, t0 + 30_000, &mut sent).is_empty());
    // Ashar is off: nothing
    assert!(due_events(&msg, &s, t0 + 3 * H + 1000, &mut sent).is_empty());
    // woke long after Maghrib (over 10 minutes): missed, not rung late
    assert!(due_events(&msg, &s, t0 + 6 * H + 11 * M, &mut HashSet::new()).iter().all(|e| e["sound"] != true));
    // Terbit (on by default)
    let mut sent2 = HashSet::new();
    let r = due_events(&msg, &s, t0 - 6 * H + 500, &mut sent2);
    assert_eq!(r[0]["t"]["key"], "sunrise");
    // off: nothing at all
    assert!(due_events(&msg, &json!({"prayerEnabled": false}), t0 + 1000, &mut HashSet::new()).is_empty());
}

#[test]
fn a_translation_cant_carry_code() {
    use services::i18n::table;
    assert!(table(r#"{"Settings": "<b>Pengaturan</b> <i>x</i><br><code>a</code><kbd>K</kbd><span class=\"ok\">ok</span>"}"#.as_bytes()).is_ok());
    assert!(table(br#"{"Settings": "<img src=x onerror=alert(1)>"}"#).is_err());
    assert!(table(br#"{"Settings": "<b onclick=x>a</b>"}"#).is_err());
    assert!(table(br#"{"Settings": "<script>x</script>"}"#).is_err());
    assert!(table(br#"{"Settings": "<span class=\"ok\" onmouseover=x>a</span>"}"#).is_err());
    // a plain "<" in text is fine
    assert!(table(br#"{"a < b": "a < b"}"#).is_ok());
}

#[test]
fn terbit_has_its_own_switch_and_late_means_ten_minutes() {
    use services::prayer::due_events;
    let t0 = 1_793_507_940_000i64;
    let msg = json!({"ok": true, "names": {"fajr": "Subuh", "sunrise": "Terbit"},
        "days": [{"date": "2026-11-01", "fajr": t0 - H, "sunrise": t0}]});
    let off = json!({"prayerEnabled": true, "prayerBefore": 10, "prayerList": {"fajr": true, "sunrise": false}});
    assert!(due_events(&msg, &off, t0 + 1000, &mut HashSet::new()).is_empty());
    let on = json!({"prayerEnabled": true, "prayerBefore": 10, "prayerList": {"fajr": false, "sunrise": true}});
    assert_eq!(due_events(&msg, &on, t0 + 1000, &mut HashSet::new())[0]["t"]["key"], "sunrise");
    // its countdown too
    assert_eq!(due_events(&msg, &on, t0 - 5 * M, &mut HashSet::new())[0]["soon"], true);
    // 8 minutes late (woke just after): still rung, as the frontend's own fallback would
    assert_eq!(due_events(&msg, &on, t0 + 8 * M, &mut HashSet::new())[0]["sound"], true);
    assert!(due_events(&msg, &on, t0 + 11 * M, &mut HashSet::new()).is_empty());
}

#[test]
fn auto_takes_the_first_language_offered() {
    use services::i18n::resolve;
    let offered = ["es", "id"].map(String::from);
    assert_eq!(resolve("auto", &["pt-BR".into(), "es-ES".into()], &offered), "es");
}

#[test]
fn bad_sun_times_dont_warm_the_day() {
    use services::warmth::level;
    // sunset before sunrise (broken data): the usual 06:00 / 18:00 shape isn't assumed, nothing warm at noon
    assert_eq!(level(12 * H, 18 * H, 6 * H, 60), 0.0);
}
