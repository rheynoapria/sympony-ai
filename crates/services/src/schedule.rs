//! When the timed work (location, weather, prayer times) runs: every 30 minutes of wall-clock time, and at once after
//! the Mac wakes (macOS doesn't count sleep in a sleeping thread's timer, so the wall clock tells).

/// `wall_since_last` / `awake_since_last`: ms since the last run by the wall clock and by a monotonic clock.
/// Due after 30 wall minutes, or when the wall clock ran more than a minute ahead of the awake time (it slept).
pub fn due(wall_since_last: i64, awake_since_last: i64) -> bool {
    wall_since_last >= 30 * 60_000 || wall_since_last - awake_since_last > 60_000
}

/// `clock:changed`: between two readings `(wall ms, monotonic ms, UTC offset s)` the wall clock moved more than 5 s
/// away from the monotonic one (set by hand, or the Mac slept: either way the chime re-arms), or the time zone changed.
pub fn clock_changed(prev: (i64, i64, i32), now: (i64, i64, i32)) -> bool {
    ((now.0 - prev.0) - (now.1 - prev.1)).abs() > 5_000 || now.2 != prev.2
}
