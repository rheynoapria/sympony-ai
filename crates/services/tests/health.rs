use serde_json::json;
use services::health::{Cfg, Health, Nudge};

const MIN: i64 = 60_000;
const DAY: &str = "2026-11-18";

/// The app ticks every few seconds: tick each minute from `from` to `to` (inclusive), at the PC.
fn run(h: &mut Health, from: i64, to: i64, c: &Cfg) -> Vec<Nudge> {
    let mut out = vec![];
    let mut t = from;
    while t <= to {
        out.extend(h.tick(t, 1000, c, DAY));
        t += MIN;
    }
    out
}

fn cfg() -> Cfg {
    Cfg::from_settings(&json!({"healthEnabled": true, "healthWaterGoal": 3, "healthBreakGoal": 6, "healthMindfulGoal": 5,
        "healthBreakReminders": true, "healthBreakInterval": 50, "healthWaterReminders": true, "healthWaterInterval": 60,
        "healthEyeBreaks": true, "healthEyeInterval": 20, "healthEyeDuration": 20}))
}

#[test]
fn water_goal_reached_once() {
    let c = cfg();
    let mut h = Health::default();
    assert_eq!(h.water(1, 0, &c, DAY)["goalReached"], false);
    h.water(1, 0, &c, DAY);
    let v = h.water(1, 0, &c, DAY);
    assert_eq!((v["goalReached"].as_bool(), v["today"]["water"].as_i64(), v["goals"]["water"].as_i64()), (Some(true), Some(3), Some(3)));
    assert_eq!(h.water(1, 0, &c, DAY)["goalReached"], false);
    // never below zero
    for _ in 0..9 {
        h.water(-1, 0, &c, DAY);
    }
    assert_eq!(h.view(&c, DAY)["today"]["water"], 0);
}

#[test]
fn break_reminder_after_active_minutes() {
    let c = Cfg { eye: false, water_rem: false, ..cfg() };
    let mut h = Health::default();
    assert!(run(&mut h, 0, 49 * MIN, &c).is_empty());
    assert_eq!(h.tick(50 * MIN, 1000, &c, DAY), vec![Nudge::Remind(json!({"kind": "break", "minutes": 50}))]);
    // not again right away; again after another interval
    assert_eq!(run(&mut h, 51 * MIN, 100 * MIN, &c).len(), 1);
    h.break_done(101 * MIN, DAY);
    assert_eq!(h.view(&c, DAY)["today"]["breaks"], 1);
    assert_eq!(h.view(&c, DAY)["lastBreakAt"], 101 * MIN);
    assert!(run(&mut h, 101 * MIN, 140 * MIN, &c).is_empty());
}

#[test]
fn idle_counts_as_break() {
    let c = Cfg { water_rem: false, ..cfg() };
    let mut h = Health::default();
    run(&mut h, 0, 0, &c);
    // away from about 30 to 50 minutes (the eye break at 20 came before): nothing fires while away
    run(&mut h, MIN, 30 * MIN, &c);
    let mut t = 31 * MIN;
    while t <= 50 * MIN {
        assert!(h.tick(t, t - 30 * MIN, &c, DAY).is_empty());
        t += MIN;
    }
    assert_eq!(h.view(&c, DAY)["lastBreakAt"], 0, "not rewritten while away");
    // back at 51: the break ends there, and the intervals count from it
    assert!(h.tick(51 * MIN, 1000, &c, DAY).is_empty());
    assert_eq!(h.view(&c, DAY)["lastBreakAt"], 51 * MIN);
    assert!(run(&mut h, 52 * MIN, 70 * MIN, &c).is_empty());
    assert_eq!(h.tick(71 * MIN, 1000, &c, DAY), vec![Nudge::EyeBreak(20)]);
}

#[test]
fn water_reminders_stop_at_goal() {
    let c = Cfg { eye: false, break_rem: false, ..cfg() };
    let mut h = Health::default();
    assert!(run(&mut h, 0, 59 * MIN, &c).is_empty());
    assert_eq!(h.tick(60 * MIN, 1000, &c, DAY), vec![Nudge::Remind(json!({"kind": "water", "glasses": 0, "goal": 3}))]);
    for _ in 0..3 {
        h.water(1, 61 * MIN, &c, DAY);
    }
    assert!(run(&mut h, 61 * MIN, 200 * MIN, &c).is_empty());
}

#[test]
fn off_settings_never_remind() {
    let c = Cfg { enabled: false, ..cfg() };
    let mut h = Health::default();
    assert!(run(&mut h, 0, 500 * MIN, &c).is_empty());
}

#[test]
fn streak_counts_consecutive_days() {
    let c = cfg();
    let mut h = Health::default();
    for d in ["2026-11-14", "2026-11-16", "2026-11-17"] {
        for _ in 0..3 {
            h.water(1, 0, &c, d);
        }
    }
    // today nothing yet: the run up to yesterday still counts
    assert_eq!(h.view(&c, DAY)["streak"], 2);
    for _ in 0..3 {
        h.water(1, 0, &c, DAY);
    }
    assert_eq!(h.view(&c, DAY)["streak"], 3);
    assert_eq!(h.view(&c, "2026-11-20")["streak"], 0);
}

#[test]
fn day_change() {
    let c = cfg();
    let mut h = Health::default();
    h.water(2, 0, &c, DAY);
    h.mindful(1, DAY);
    let v = h.view(&c, "2026-11-19");
    assert_eq!(v["today"], json!({"water": 0, "breaks": 0, "mindful": 0}));
    assert_eq!(h.view(&c, DAY)["today"], json!({"water": 2, "breaks": 0, "mindful": 1}));
}

#[test]
fn restart_does_not_fire_at_once() {
    let c = cfg();
    let mut h = Health::default();
    h.tick(0, 0, &c, DAY);
    let saved = serde_json::to_string(&h).unwrap();
    let mut h: Health = serde_json::from_str(&saved).unwrap();
    assert!(h.tick(MIN, 1000, &c, DAY).is_empty());
}

#[test]
fn waking_from_sleep_counts_as_a_break() {
    let c = cfg();
    let mut h = Health::default();
    h.tick(0, 0, &c, DAY);
    // the Mac slept 8 hours: the first tick after has a fresh input (idle small) but a long gap
    assert!(h.tick(480 * MIN, 1000, &c, DAY).is_empty());
    assert_eq!(h.view(&c, DAY)["lastBreakAt"], 480 * MIN);
    assert!(h.tick(481 * MIN, 1000, &c, DAY).is_empty());
}

#[test]
fn restart_keeps_last_break() {
    let c = cfg();
    let mut h = Health::default();
    h.tick(0, 0, &c, DAY);
    h.break_done(10 * MIN, DAY);
    let mut h: Health = serde_json::from_str(&serde_json::to_string(&h).unwrap()).unwrap();
    h.tick(20 * MIN, 1000, &c, DAY);
    assert_eq!(h.view(&c, DAY)["lastBreakAt"], 10 * MIN);
}
