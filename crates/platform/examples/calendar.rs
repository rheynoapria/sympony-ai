//! The computer's own calendars as Sympony reads them: `cargo run -p platform --example calendar` prints the
//! permission and how many events there are in the next 60 days, and in how many calendars (not what they say).
fn main() {
    use platform::os::calendar;
    println!("permission: {} ({})", calendar::perm_status(), calendar::status_name());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    let events = calendar::events(now, now + 60 * 86_400_000);
    let mut sources: Vec<String> = events.iter().filter_map(|e| e["source"].as_str().map(String::from)).collect();
    sources.sort();
    sources.dedup();
    let all_day = events.iter().filter(|e| e["allDay"] == true).count();
    let repeating = events.iter().filter(|e| e["repeat"].is_string()).count();
    println!("next 60 days: {} events ({all_day} all-day, {repeating} repeating) in {} calendars", events.len(), sources.len());
}
