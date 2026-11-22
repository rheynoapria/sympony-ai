use serde_json::json;
use services::pomodoro::{after_timer, Config, Pomodoro, Timer};

const MIN: i64 = 60_000;
const DAY: &str = "2026-11-18";

fn cfg() -> Config {
    Config::from_settings(&json!({"pomoWork": 25, "pomoShort": 5, "pomoLong": 15, "pomoCycles": 4, "pomoAutoBreak": true, "pomoAutoWork": false, "pomoSound": true}))
}

#[test]
fn start_pause_resume_keeps_remaining() {
    let c = cfg();
    let mut p = Pomodoro::default();
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["running"].as_bool(), v["remaining"].as_i64(), v["total"].as_i64()), (Some("work"), Some(false), Some(25 * MIN), Some(25 * MIN)));
    p.start(0, &c);
    assert_eq!(p.view(&c, DAY)["endsAt"], 25 * MIN);
    p.pause(10 * MIN);
    let v = p.view(&c, DAY);
    assert_eq!((v["running"].as_bool(), v["remaining"].as_i64()), (Some(false), Some(15 * MIN)));
    p.toggle(20 * MIN, &c);
    assert_eq!(p.view(&c, DAY)["endsAt"], 35 * MIN);
}

#[test]
fn work_end_starts_break_and_counts() {
    let c = cfg();
    let mut p = Pomodoro::default();
    p.start(0, &c);
    assert!(p.tick(25 * MIN - 1, &c, DAY).is_none());
    let done = p.tick(25 * MIN, &c, DAY).unwrap();
    assert_eq!(done, json!({"finished": "work", "sound": true}));
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["running"].as_bool(), v["cycle"].as_i64(), v["doneToday"].as_i64(), v["focusToday"].as_i64()), (Some("short"), Some(true), Some(1), Some(1), Some(25 * MIN)));
    // the break ends; auto work is off: work waits
    let done = p.tick(31 * MIN, &c, DAY).unwrap();
    assert_eq!(done["finished"], "short");
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["running"].as_bool(), v["remaining"].as_i64()), (Some("work"), Some(false), Some(25 * MIN)));
}

#[test]
fn long_break_every_cycles() {
    let c = cfg();
    let mut p = Pomodoro::default();
    let mut now = 0;
    for _ in 0..3 {
        p.set_phase("work", &c);
        p.start(now, &c);
        now += 25 * MIN;
        p.tick(now, &c, DAY);
        assert_eq!(p.view(&c, DAY)["phase"], "short");
    }
    p.set_phase("work", &c);
    p.start(now, &c);
    p.tick(now + 25 * MIN, &c, DAY);
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["total"].as_i64(), v["cycles"].as_i64()), (Some("long"), Some(15 * MIN), Some(4)));
}

#[test]
fn sleep_through_end_is_one_done() {
    let c = Config { auto_work: true, ..cfg() };
    let mut p = Pomodoro::default();
    p.start(0, &c);
    // asleep for 3 hours: one done, the break starts now (not back in time)
    assert!(p.tick(180 * MIN, &c, DAY).is_some());
    assert_eq!(p.view(&c, DAY)["endsAt"], 185 * MIN);
    assert!(p.tick(180 * MIN + 1000, &c, DAY).is_none());
}

#[test]
fn new_length_applies_when_idle() {
    let mut p = Pomodoro::default();
    p.view(&cfg(), DAY);
    let c = Config { work: 50 * MIN, ..cfg() };
    let v = p.view(&c, DAY);
    assert_eq!((v["remaining"].as_i64(), v["total"].as_i64()), (Some(50 * MIN), Some(50 * MIN)));
    // a paused session part way keeps its time
    p.start(0, &c);
    p.pause(5 * MIN);
    let v = p.view(&cfg(), DAY);
    assert_eq!(v["remaining"], 45 * MIN);
}

#[test]
fn day_change_resets_counts() {
    let c = cfg();
    let mut p = Pomodoro::default();
    p.start(0, &c);
    p.tick(25 * MIN, &c, DAY);
    assert_eq!(p.view(&c, DAY)["doneToday"], 1);
    let v = p.view(&c, "2026-11-19");
    assert_eq!((v["doneToday"].as_i64(), v["focusToday"].as_i64()), (Some(0), Some(0)));
}

#[test]
fn skip_and_reset() {
    let c = cfg();
    let mut p = Pomodoro::default();
    p.start(0, &c);
    p.skip(MIN, &c);
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["running"].as_bool(), v["doneToday"].as_i64()), (Some("short"), Some(false), Some(0)));
    p.reset(&c);
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["cycle"].as_i64(), v["remaining"].as_i64()), (Some("work"), Some(0), Some(25 * MIN)));
}

#[test]
fn timer_start_toggle_done() {
    let mut t = Timer::default();
    assert_eq!(t.view()["active"], false);
    t.start(10 * MIN, 0);
    t.toggle(4 * MIN);
    let v = t.view();
    assert_eq!((v["running"].as_bool(), v["left"].as_i64(), v["last"].as_i64()), (Some(false), Some(6 * MIN), Some(10 * MIN)));
    t.toggle(5 * MIN);
    assert_eq!(t.view()["endsAt"], 11 * MIN);
    assert!(t.tick(11 * MIN - 1).is_none());
    assert_eq!(t.tick(11 * MIN), Some(10 * MIN));
    assert_eq!(t.view()["active"], false);
    assert!(t.tick(12 * MIN).is_none());
}

#[test]
fn timer_add_after_done_runs_again() {
    let mut t = Timer::default();
    t.start(10 * MIN, 0);
    t.add(MIN, MIN);
    assert_eq!((t.view()["total"].as_i64(), t.view()["endsAt"].as_i64()), (Some(11 * MIN), Some(11 * MIN)));
    t.tick(11 * MIN);
    t.add(5 * MIN, 20 * MIN);
    let v = t.view();
    assert_eq!((v["active"].as_bool(), v["running"].as_bool(), v["endsAt"].as_i64(), v["total"].as_i64(), v["last"].as_i64()), (Some(true), Some(true), Some(25 * MIN), Some(5 * MIN), Some(10 * MIN)));
    t.stop();
    assert_eq!(t.view()["active"], false);
}

#[test]
fn timer_then_break() {
    let c = cfg();
    let mut p = Pomodoro::default();
    after_timer(&mut p, &c, true, 0);
    let v = p.view(&c, DAY);
    assert_eq!((v["phase"].as_str(), v["running"].as_bool()), (Some("short"), Some(true)));
    // a running Pomodoro is left alone; the setting off does nothing
    let mut p = Pomodoro::default();
    p.start(0, &c);
    after_timer(&mut p, &c, true, MIN);
    assert_eq!(p.view(&c, DAY)["phase"], "work");
    let mut p = Pomodoro::default();
    after_timer(&mut p, &c, false, 0);
    assert_eq!(p.view(&c, DAY)["running"], false);
}
