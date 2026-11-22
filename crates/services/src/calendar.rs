//! The calendar's events: subscribed ICS feeds (RFC 5545, the parts calendars use) and Sympony's own events
//! (`settings.localEvents`), each repeat turned into its occurrences within a window. Times are ms; floating and
//! all-day times are in `local`, the Mac's time zone. Repeats step in the event's own wall-clock time, so a 09:00
//! meeting stays at 09:00 across a daylight-saving change.
use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Utc, Weekday};
use chrono_tz::Tz;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// A subscribed calendar (Settings → Calendar).
pub struct Feed {
    pub url: String,
    pub name: String,
    pub color: String,
}

#[derive(Clone, Copy, Debug)]
enum Zone {
    Utc,
    Named(Tz),
    Local,
}

#[derive(Clone, Copy, Debug)]
struct When {
    wall: NaiveDateTime,
    zone: Zone,
    all_day: bool,
}

/// Wall-clock time in a zone → ms (a time skipped by a clock change moves an hour on; a repeated one takes the first).
fn wall_ms(wall: NaiveDateTime, tz: Tz) -> i64 {
    match tz.from_local_datetime(&wall) {
        LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t.timestamp_millis(),
        LocalResult::None => tz.from_local_datetime(&(wall + Duration::hours(1))).earliest().map(|t| t.timestamp_millis()).unwrap_or(0),
    }
}

impl When {
    fn ms(&self, local: Tz) -> i64 {
        match self.zone {
            Zone::Utc => Utc.from_utc_datetime(&self.wall).timestamp_millis(),
            Zone::Named(tz) => wall_ms(self.wall, tz),
            Zone::Local => wall_ms(self.wall, local),
        }
    }
    fn at(&self, wall: NaiveDateTime) -> When {
        When { wall, ..*self }
    }
}

struct Prop {
    name: String,
    params: HashMap<String, String>,
    value: String,
}

/// Lines with their folded continuations joined.
fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for raw in text.split('\n') {
        let l = raw.strip_suffix('\r').unwrap_or(raw);
        if (l.starts_with(' ') || l.starts_with('\t')) && !out.is_empty() {
            out.last_mut().unwrap().push_str(&l[1..]);
        } else {
            out.push(l.to_string());
        }
    }
    out
}

fn parse_line(l: &str) -> Option<Prop> {
    let mut quoted = false;
    let colon = l.char_indices().find(|&(_, c)| {
        if c == '"' {
            quoted = !quoted;
        }
        c == ':' && !quoted
    })?.0;
    let (left, value) = (&l[..colon], &l[colon + 1..]);
    let mut parts = left.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts.filter_map(|p| p.split_once('=')).map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string())).collect();
    Some(Prop { name, params, value: value.to_string() })
}

fn unescape(v: &str) -> String {
    let mut out = String::new();
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some('n') | Some('N') => out.push('\n'),
                Some(o) => out.push(o),
                None => {}
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_when(value: &str, tzid: Option<&String>, date_only: bool) -> Option<When> {
    let v = value.trim();
    if date_only || v.len() == 8 {
        let d = NaiveDate::parse_from_str(v, "%Y%m%d").ok()?;
        return Some(When { wall: d.and_time(NaiveTime::MIN), zone: Zone::Local, all_day: true });
    }
    let (body, utc) = match v.strip_suffix('Z') {
        Some(b) => (b, true),
        None => (v, false),
    };
    let wall = NaiveDateTime::parse_from_str(body, "%Y%m%dT%H%M%S").ok()?;
    let zone = if utc {
        Zone::Utc
    } else if let Some(tz) = tzid.and_then(|t| t.parse::<Tz>().ok().or_else(|| windows_zone(t))) {
        Zone::Named(tz)
    } else {
        Zone::Local
    };
    Some(When { wall, zone, all_day: false })
}

/// Outlook's feeds name zones the Windows way: the common ones.
fn windows_zone(name: &str) -> Option<Tz> {
    let iana = match name {
        "SE Asia Standard Time" => "Asia/Bangkok",
        "Singapore Standard Time" => "Asia/Singapore",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "China Standard Time" => "Asia/Shanghai",
        "India Standard Time" => "Asia/Kolkata",
        "UTC" | "Coordinated Universal Time" | "GMT Standard Time" => "Europe/London",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Romance Standard Time" => "Europe/Paris",
        "Eastern Standard Time" => "America/New_York",
        "Central Standard Time" => "America/Chicago",
        "Mountain Standard Time" => "America/Denver",
        "Pacific Standard Time" => "America/Los_Angeles",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        _ => return None,
    };
    iana.parse().ok()
}

/// `PT2H`, `P1D`, `P1DT30M`, `P2W`.
fn parse_duration(v: &str) -> Option<Duration> {
    let v = v.trim().trim_start_matches('+');
    let (neg, v) = match v.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, v),
    };
    let v = v.strip_prefix('P')?;
    let (mut total, mut num, mut time) = (Duration::zero(), String::new(), false);
    for c in v.chars() {
        match c {
            'T' => time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = std::mem::take(&mut num).parse().ok()?;
                total += match (c, time) {
                    ('W', _) => Duration::weeks(n),
                    ('D', _) => Duration::days(n),
                    ('H', true) => Duration::hours(n),
                    ('M', true) => Duration::minutes(n),
                    ('S', true) => Duration::seconds(n),
                    _ => return None,
                };
            }
        }
    }
    Some(if neg { -total } else { total })
}

#[derive(Default)]
struct Rule {
    freq: String,
    interval: i64,
    count: Option<usize>,
    until: Option<i64>,
    byday: Vec<Weekday>,
}

fn parse_rule(v: &str, local: Tz) -> Option<Rule> {
    let mut r = Rule { interval: 1, ..Default::default() };
    for part in v.split(';') {
        let (k, val) = part.split_once('=')?;
        match k.to_ascii_uppercase().as_str() {
            "FREQ" => r.freq = val.to_ascii_lowercase(),
            "INTERVAL" => r.interval = val.parse().unwrap_or(1).max(1),
            "COUNT" => r.count = val.parse().ok(),
            "UNTIL" => r.until = parse_when(val, None, false).map(|w| if w.all_day { w.ms(local) + 86_400_000 - 1 } else { w.ms(local) }),
            "BYDAY" => {
                r.byday = val
                    .split(',')
                    .filter_map(|d| match d.trim_start_matches(|c: char| c == '-' || c == '+' || c.is_ascii_digit()) {
                        "MO" => Some(Weekday::Mon),
                        "TU" => Some(Weekday::Tue),
                        "WE" => Some(Weekday::Wed),
                        "TH" => Some(Weekday::Thu),
                        "FR" => Some(Weekday::Fri),
                        "SA" => Some(Weekday::Sat),
                        "SU" => Some(Weekday::Sun),
                        _ => None,
                    })
                    .collect()
            }
            _ => {}
        }
    }
    matches!(r.freq.as_str(), "daily" | "weekly" | "monthly" | "yearly").then_some(r)
}

fn add_months(d: NaiveDate, months: i64) -> Option<NaiveDate> {
    let m0 = d.year() as i64 * 12 + d.month0() as i64 + months;
    NaiveDate::from_ymd_opt((m0 / 12) as i32, (m0 % 12) as u32 + 1, d.day())
}

/// The walls an event repeats at (its first included), stepping in its own zone, until `to` or the rule ends.
fn occurrences(start: When, rule: &Rule, from: i64, to: i64, local: Tz) -> Vec<NaiveDateTime> {
    let (date, time) = (start.wall.date(), start.wall.time());
    let mut out = vec![];
    // a long series without a count starts near the window: steps skipped by their longest possible length
    // (a day of 25 h, a month of 31 days…), so never past an occurrence in it
    let longest = match rule.freq.as_str() {
        "daily" => 25,
        "weekly" => 7 * 24 + 1,
        "monthly" => 31 * 24 + 1,
        _ => 366 * 24 + 1,
    } * 3_600_000 * rule.interval;
    let mut k: i64 = if rule.count.is_none() { ((from - start.ms(local)) / longest - 1).max(0) } else { 0 };
    let first = k;
    let push = |out: &mut Vec<NaiveDateTime>, d: NaiveDate| -> bool {
        // false: past the end
        let w = d.and_time(time);
        let ms = start.at(w).ms(local);
        if ms > to || rule.until.is_some_and(|u| ms > u) || rule.count.is_some_and(|c| out.len() >= c) {
            return false;
        }
        out.push(w);
        true
    };
    while k - first < 20_000 {
        let go = match rule.freq.as_str() {
            "daily" => push(&mut out, date + Duration::days(k * rule.interval)),
            "weekly" if !rule.byday.is_empty() => {
                let monday = date - Duration::days(date.weekday().num_days_from_monday() as i64) + Duration::weeks(k * rule.interval);
                let mut days: Vec<NaiveDate> = rule.byday.iter().map(|w| monday + Duration::days(w.num_days_from_monday() as i64)).filter(|d| *d >= date).collect();
                days.sort();
                days.into_iter().all(|d| push(&mut out, d))
            }
            "weekly" => push(&mut out, date + Duration::weeks(k * rule.interval)),
            "monthly" => match add_months(date, k * rule.interval) {
                Some(d) => push(&mut out, d),
                None => true,
            },
            _ => match add_months(date, 12 * k * rule.interval) {
                Some(d) => push(&mut out, d),
                None => true,
            },
        };
        if !go {
            break;
        }
        k += 1;
    }
    out
}

#[derive(Default)]
struct Ev {
    uid: String,
    title: String,
    location: String,
    description: String,
    url: String,
    organizer: String,
    cancelled: bool,
    start: Option<When>,
    end: Option<When>,
    duration: Option<Duration>,
    rule: Option<String>,
    exdates: Vec<When>,
    recurrence_id: Option<When>,
}

fn event_json(id: String, e: &Ev, start: i64, end: i64, all_day: bool, source: &str, color: &str, provider: &str, repeat: Option<&str>) -> Value {
    let opt = |s: &str| if s.is_empty() { Value::Null } else { json!(s) };
    json!({"id": id, "uid": e.uid, "title": e.title, "start": start, "end": end, "allDay": all_day, "location": e.location,
           "description": opt(&e.description), "url": opt(&e.url), "organizer": opt(&e.organizer), "color": opt(color),
           "source": source, "provider": provider, "repeat": repeat})
}

/// A feed's events overlapping `[from, to)`. Not a calendar (a sign-in page, say): none.
pub fn parse_ics(text: &str, feed: &Feed, from: i64, to: i64, local: Tz) -> Vec<Value> {
    let mut evs: Vec<Ev> = vec![];
    let mut cur: Option<Ev> = None;
    let mut inner = 0; // inside a block within the event (a VALARM reminder): its properties aren't the event's
    for line in unfold(text) {
        let Some(p) = parse_line(&line) else { continue };
        match (p.name.as_str(), p.value.as_str()) {
            ("BEGIN", "VEVENT") => (cur, inner) = (Some(Ev::default()), 0),
            ("END", "VEVENT") => evs.extend(cur.take()),
            ("BEGIN", _) if cur.is_some() => inner += 1,
            ("END", _) if cur.is_some() => inner = (inner - 1).max(0),
            _ => {
                let Some(e) = cur.as_mut() else { continue };
                if inner > 0 {
                    continue;
                }
                let date = p.params.get("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE"));
                let tz = p.params.get("TZID");
                match p.name.as_str() {
                    "UID" => e.uid = p.value.clone(),
                    "SUMMARY" => e.title = unescape(&p.value),
                    "LOCATION" => e.location = unescape(&p.value),
                    "DESCRIPTION" => e.description = unescape(&p.value),
                    "URL" => e.url = p.value.clone(),
                    "ORGANIZER" => e.organizer = p.params.get("CN").cloned().unwrap_or_else(|| p.value.trim_start_matches("mailto:").to_string()),
                    "STATUS" => e.cancelled = p.value.eq_ignore_ascii_case("CANCELLED"),
                    "DTSTART" => e.start = parse_when(&p.value, tz, date),
                    "DTEND" => e.end = parse_when(&p.value, tz, date),
                    "DURATION" => e.duration = parse_duration(&p.value),
                    "RRULE" => e.rule = Some(p.value.clone()),
                    "EXDATE" => e.exdates.extend(p.value.split(',').filter_map(|v| parse_when(v, tz, date))),
                    "RECURRENCE-ID" => e.recurrence_id = parse_when(&p.value, tz, date),
                    _ => {}
                }
            }
        }
    }
    // occurrences moved or cancelled one by one replace their slot in the series
    let moved: HashSet<(String, i64)> = evs.iter().filter_map(|e| Some((e.uid.clone(), e.recurrence_id?.ms(local)))).collect();
    let mut out = vec![];
    for e in &evs {
        let Some(start) = e.start else { continue };
        let length = match (e.end, e.duration) {
            (Some(end), _) => end.wall - start.wall,
            (None, Some(d)) => d,
            (None, None) if start.all_day => Duration::days(1),
            _ => Duration::zero(),
        };
        let rule = if e.recurrence_id.is_some() { None } else { e.rule.as_deref().and_then(|r| parse_rule(r, local)) };
        let walls = match &rule {
            Some(r) => occurrences(start, r, from, to, local),
            None => vec![start.wall],
        };
        let skip: HashSet<i64> = e.exdates.iter().map(|w| w.ms(local)).collect();
        for w in walls {
            let s = start.at(w).ms(local);
            let end = start.at(w + length).ms(local);
            if e.cancelled || skip.contains(&s) || (e.recurrence_id.is_none() && moved.contains(&(e.uid.clone(), s))) || end <= from || s >= to {
                continue;
            }
            out.push(event_json(format!("{}|{}|{s}", feed.url, e.uid), e, s, end, start.all_day, &feed.name, &feed.color, "ics", rule.as_ref().map(|r| r.freq.as_str())));
        }
    }
    out.sort_by_key(|e| e["start"].as_i64());
    out
}

/// Sympony's own events (`settings.localEvents`: `{id, title, start, end, location, repeat}`) within `[from, to)`.
pub fn expand_local(list: &Value, from: i64, to: i64, local: Tz) -> Vec<Value> {
    let mut out = vec![];
    for x in list.as_array().into_iter().flatten() {
        let (Some(id), Some(s0)) = (x["id"].as_str(), x["start"].as_i64()) else { continue };
        let e0 = x["end"].as_i64().filter(|e| *e > s0).unwrap_or(s0 + 30 * 60_000);
        let Some(start) = DateTime::from_timestamp_millis(s0).map(|t| t.with_timezone(&local).naive_local()) else { continue };
        let when = When { wall: start, zone: Zone::Local, all_day: x["allDay"] == true };
        let length = Duration::milliseconds(e0 - s0);
        let repeat = x["repeat"].as_str().filter(|r| *r != "none");
        let walls = match repeat.and_then(|r| parse_rule(&format!("FREQ={}", r.to_ascii_uppercase()), local)) {
            Some(rule) => occurrences(when, &rule, from, to, local),
            None => vec![start],
        };
        let e = Ev { uid: id.into(), title: x["title"].as_str().unwrap_or("").into(), location: x["location"].as_str().unwrap_or("").into(), ..Default::default() };
        for w in walls {
            let s = when.at(w).ms(local);
            let end = when.at(w + length).ms(local);
            if end <= from || s >= to {
                continue;
            }
            out.push(event_json(format!("sympony|{id}|{s}"), &e, s, end, when.all_day, "Sympony", "", "sympony", repeat));
        }
    }
    out
}

/// The Mac's time zone (`/etc/localtime` points into the zoneinfo folder); UTC when it can't be read.
pub fn local_tz() -> Tz {
    std::fs::read_link("/etc/localtime")
        .ok()
        .and_then(|p| p.to_string_lossy().split("zoneinfo/").nth(1).and_then(|n| n.parse().ok()))
        .unwrap_or(Tz::UTC)
}
