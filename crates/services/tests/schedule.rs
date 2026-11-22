use services::schedule::due;

const MIN: i64 = 60_000;

#[test]
fn every_30_minutes_of_wall_time() {
    assert!(!due(29 * MIN, 29 * MIN));
    assert!(due(30 * MIN, 30 * MIN));
}

#[test]
fn right_after_waking() {
    // 5 awake minutes, but the wall clock moved 3 hours: the Mac slept
    assert!(due(180 * MIN, 5 * MIN));
}

#[test]
fn not_for_a_small_drift() {
    assert!(!due(10 * MIN + 20_000, 10 * MIN));
}

#[test]
fn clock_jump_and_zone() {
    use services::schedule::clock_changed;
    // 1 s later on both clocks, same zone: nothing
    assert!(!clock_changed((0, 0, 25200), (1000, 1000, 25200)));
    // the wall clock put forward or back more than 5 s
    assert!(clock_changed((0, 0, 25200), (61_000, 1000, 25200)));
    assert!(clock_changed((60_000, 0, 25200), (1000, 1000, 25200)));
    // a new time zone
    assert!(clock_changed((0, 0, 25200), (1000, 1000, 28800)));
}
