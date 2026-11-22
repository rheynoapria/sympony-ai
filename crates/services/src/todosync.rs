//! To-do sync: the Todo store's items and one Google Tasks list kept the same, both ways. `plan` is the whole decision
//! (pure): from the items here, the tasks there and the links of the last sync, what to write here, what to create,
//! change and delete there, and the links after. Per field, the side that changed since the last sync wins; when both
//! did, this Mac. Google keeps a due *day*: a due time here is kept while the day matches.
use chrono::{DateTime, NaiveDate, NaiveTime, TimeZone};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// What one task says, in the terms both sides share.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Snap {
    pub text: String,
    pub done: bool,
    pub day: Option<String>, // YYYY-MM-DD
}

/// A task in the Google list.
#[derive(Clone, Debug)]
pub struct Remote {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub day: Option<String>,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Link {
    pub local: String,
    pub remote: String,
    pub snap: Snap,
}

#[derive(Debug, Default)]
pub struct Plan {
    /// the Todo store's items after the sync
    pub items: Vec<Value>,
    /// tasks to create there: (local id, what) — link them once created
    pub create: Vec<(String, Snap)>,
    /// tasks to change there: (remote id, what)
    pub update: Vec<(String, Snap)>,
    pub delete: Vec<String>,
    pub links: Vec<Link>,
}

fn day_of(ms: i64, tz: Tz) -> Option<String> {
    DateTime::from_timestamp_millis(ms).map(|t| t.with_timezone(&tz).format("%Y-%m-%d").to_string())
}

fn local_snap(item: &Value, tz: Tz) -> Snap {
    Snap { text: item["text"].as_str().unwrap_or("").to_string(), done: item["done"] == true, day: item["due"].as_i64().and_then(|d| day_of(d, tz)) }
}

fn remote_snap(r: &Remote) -> Snap {
    Snap { text: r.title.clone(), done: r.done, day: r.day.clone() }
}

/// `day` at the time of day `like` has (09:00 without one), in ms.
fn due_on(day: &str, like: Option<i64>, tz: Tz) -> Option<i64> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let time = like.and_then(DateTime::from_timestamp_millis).map(|t| t.with_timezone(&tz).time()).unwrap_or(NaiveTime::from_hms_opt(9, 0, 0)?);
    tz.from_local_datetime(&date.and_time(time)).earliest().map(|t| t.timestamp_millis())
}

/// A repeating task's next time after `after` (`repeat: {days: [0-6, Sunday first], time: "HH:MM"}`), as data.js's
/// nextRepeat.
fn next_repeat(rep: &Value, after: i64, tz: Tz) -> Option<i64> {
    let (h, m) = rep["time"].as_str().unwrap_or("08:00").split_once(':').map(|(h, m)| (h.parse().unwrap_or(8), m.parse().unwrap_or(0)))?;
    let days: Vec<u32> = rep["days"].as_array()?.iter().filter_map(|d| d.as_u64().map(|d| d as u32)).collect();
    let start = DateTime::from_timestamp_millis(after)?.with_timezone(&tz).date_naive();
    (0..=7).find_map(|i| {
        use chrono::Datelike;
        let d = start + chrono::Duration::days(i);
        let t = tz.from_local_datetime(&d.and_time(NaiveTime::from_hms_opt(h, m, 0)?)).earliest()?.timestamp_millis();
        (days.contains(&d.weekday().num_days_from_sunday()) && t > after).then_some(t)
    })
}

/// Writes `m` into a local item that said `was`. A repeating task ticked off there goes on as todoDone does it here:
/// the done one keeps no repeat, a fresh copy takes it for its next time (returned, to add).
fn apply(item: &mut Value, m: &Snap, was: &Snap, tz: Tz, now: i64) -> Option<Value> {
    let mut next = None;
    if m.done && !was.done && item["repeat"].is_object() {
        let rep = item["repeat"].clone();
        let due = next_repeat(&rep, now.max(item["due"].as_i64().unwrap_or(0)), tz);
        let mut n = json!({"id": format!("{}-{now:x}", item["id"].as_str().unwrap_or("t")), "text": m.text, "done": false, "created": now, "repeat": rep});
        if let Some(d) = due {
            n["due"] = json!(d);
        }
        if !item["lateMin"].is_null() {
            n["lateMin"] = item["lateMin"].clone();
        }
        if let Some(o) = item.as_object_mut() {
            o.remove("repeat");
        }
        item["repeated"] = json!(true);
        next = Some(n);
    }
    if m.text != was.text {
        item["text"] = json!(m.text);
    }
    if m.done != was.done {
        item["done"] = json!(m.done);
        if m.done {
            item["doneAt"] = json!(now);
        } else if let Some(o) = item.as_object_mut() {
            o.remove("doneAt");
        }
    }
    // (a repeating task keeps its time: its day comes from its repeat)
    if m.day != was.day && item["repeat"].is_null() && !item["repeated"].as_bool().unwrap_or(false) {
        match m.day.as_deref().and_then(|d| due_on(d, item["due"].as_i64(), tz)) {
            Some(due) => item["due"] = json!(due),
            None => {
                if let Some(o) = item.as_object_mut() {
                    o.remove("due");
                }
            }
        }
    }
    next
}

/// Per field: here's change, else there's, else as it was.
fn merge(base: &Snap, here: &Snap, there: &Snap) -> Snap {
    fn pick<T: PartialEq + Clone>(b: &T, h: &T, t: &T) -> T {
        if h != b { h.clone() } else { t.clone() }
    }
    Snap { text: pick(&base.text, &here.text, &there.text), done: pick(&base.done, &here.done, &there.done), day: pick(&base.day, &here.day, &there.day) }
}

pub fn plan(local: &[Value], remote: &[Remote], links: &[Link], tz: Tz, now: i64) -> Plan {
    let mut p = Plan { items: local.to_vec(), ..Default::default() };
    let there: HashMap<&str, &Remote> = remote.iter().filter(|r| !r.deleted).map(|r| (r.id.as_str(), r)).collect();
    let mut linked_local: HashSet<String> = HashSet::new();
    let mut linked_remote: HashSet<String> = HashSet::new();
    let mut added = vec![];
    for l in links {
        let idx = p.items.iter().position(|i| i["id"].as_str() == Some(l.local.as_str()));
        let Some(i) = idx else {
            // missing here without having been trashed (an older page saved over the sync, a purge): not a delete
            // there — unlinked, and Google's task comes back here as new
            continue;
        };
        linked_local.insert(l.local.clone());
        linked_remote.insert(l.remote.clone());
        match (!p.items[i]["deletedAt"].is_null(), there.get(l.remote.as_str())) {
            (true, Some(_)) => p.delete.push(l.remote.clone()),
            (true, None) => {}
            (false, None) => {
                p.items[i]["deletedAt"] = json!(now);
            }
            (false, Some(r)) => {
                let (here, rs) = (local_snap(&p.items[i], tz), remote_snap(r));
                let m = merge(&l.snap, &here, &rs);
                if m != here {
                    added.extend(apply(&mut p.items[i], &m, &here, tz, now));
                }
                if m != rs {
                    p.update.push((l.remote.clone(), m.clone()));
                }
                p.links.push(Link { snap: m, ..l.clone() });
            }
        }
    }
    p.items.extend(added);
    // not linked yet: the same name (and done or not) on both sides is one task (the first sync), the rest is new
    let mut fresh_remote: Vec<&Remote> = remote.iter().filter(|r| !r.deleted && !linked_remote.contains(&r.id)).collect();
    for i in 0..p.items.len() {
        let item = &p.items[i];
        let id = item["id"].as_str().unwrap_or("").to_string();
        if id.is_empty() || linked_local.contains(&id) || !item["deletedAt"].is_null() {
            continue;
        }
        let here = local_snap(item, tz);
        if let Some(k) = fresh_remote.iter().position(|r| r.title.trim() == here.text.trim() && r.done == here.done) {
            let r = fresh_remote.remove(k);
            let m = merge(&remote_snap(r), &here, &remote_snap(r));
            if m != remote_snap(r) {
                p.update.push((r.id.clone(), m.clone()));
            }
            p.links.push(Link { local: id, remote: r.id.clone(), snap: m });
        } else {
            p.create.push((id, here));
        }
    }
    for r in fresh_remote.into_iter().filter(|r| !r.done) {
        let id = format!("g{}", r.id);
        let mut item = json!({"id": id, "text": r.title, "done": false, "created": now});
        if let Some(due) = r.day.as_deref().and_then(|d| due_on(d, None, tz)) {
            item["due"] = json!(due);
        }
        p.items.push(item);
        p.links.push(Link { local: id, remote: r.id.clone(), snap: remote_snap(r) });
    }
    p
}

/// The sync's changes to the items (`before` → `planned`) laid over the store as it is now (`now`): an edit made here
/// while the sync ran stays, and so does what the sync brought.
pub fn rebase(before: &[Value], planned: &[Value], now: &[Value]) -> Vec<Value> {
    let old: HashMap<&str, &Value> = before.iter().filter_map(|i| Some((i["id"].as_str()?, i))).collect();
    let mut out = now.to_vec();
    for p in planned {
        let Some(id) = p["id"].as_str() else { continue };
        match old.get(id) {
            Some(o) if *o == p => {}
            Some(o) => {
                if let Some(cur) = out.iter_mut().find(|i| i["id"].as_str() == Some(id)) {
                    // only the fields the sync changed; the rest as they are now
                    for (k, v) in p.as_object().into_iter().flatten() {
                        if o.get(k) != Some(v) {
                            cur[k] = v.clone();
                        }
                    }
                    for k in o.as_object().into_iter().flatten().map(|(k, _)| k).filter(|k| p.get(*k).is_none()) {
                        if let Some(c) = cur.as_object_mut() {
                            c.remove(k);
                        }
                    }
                }
            }
            None => {
                if !out.iter().any(|i| i["id"].as_str() == Some(id)) {
                    out.push(p.clone());
                }
            }
        }
    }
    out
}

/// Too much at once for one sync (more than half of the linked tasks deleted there or trashed here, past 3): most
/// likely something went wrong (a store that read as empty, another list), so nothing is written. `Sync now` passes it.
pub fn guard(p: &Plan, links: &[Link], before: &[Value]) -> Result<(), String> {
    let linked: HashSet<&str> = links.iter().map(|l| l.local.as_str()).collect();
    let was_trashed: HashSet<&str> = before.iter().filter(|i| !i["deletedAt"].is_null()).filter_map(|i| i["id"].as_str()).collect();
    let trashed = p.items.iter().filter(|i| !i["deletedAt"].is_null()).filter_map(|i| i["id"].as_str()).filter(|id| linked.contains(id) && !was_trashed.contains(id)).count();
    let n = links.len();
    let worst = p.delete.len().max(trashed);
    if worst > 3 && worst * 2 > n {
        return Err(format!("This sync would remove {worst} of {n} tasks at once, so it stopped. If that’s right, press Sync now."));
    }
    Ok(())
}
