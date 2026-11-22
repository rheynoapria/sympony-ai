//! The Health tab: today's water, breaks and mindful minutes against their goals, a streak, and the reminders (a break
//! after so long at the Mac, a glass of water, an eye break). Times in ms; `now`, the time since the last input and the
//! local day (`YYYY-MM-DD`) are passed in.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MIN: i64 = 60_000;
/// Away from the Mac this long: a break (nothing reminds meanwhile; the intervals count from the return).
const AWAY: i64 = 5 * MIN;
const KEEP_DAYS: i64 = 90;

/// Settings → Health.
#[derive(Clone, Debug)]
pub struct Cfg {
    pub enabled: bool,
    pub goals: [i64; 3], // water, breaks, mindful
    pub break_rem: bool,
    pub break_every: i64,
    pub water_rem: bool,
    pub water_every: i64,
    pub eye: bool,
    pub eye_every: i64,
    pub eye_secs: i64,
}

impl Cfg {
    pub fn from_settings(s: &Value) -> Cfg {
        let n = |k: &str, d: i64, lo: i64, hi: i64| s[k].as_i64().unwrap_or(d).clamp(lo, hi);
        Cfg {
            enabled: s["healthEnabled"].as_bool().unwrap_or(true),
            goals: [n("healthWaterGoal", 8, 1, 30), n("healthBreakGoal", 6, 1, 30), n("healthMindfulGoal", 5, 1, 120)],
            break_rem: s["healthBreakReminders"].as_bool().unwrap_or(true),
            break_every: n("healthBreakInterval", 50, 5, 240) * MIN,
            water_rem: s["healthWaterReminders"].as_bool().unwrap_or(false),
            water_every: n("healthWaterInterval", 60, 5, 240) * MIN,
            eye: s["healthEyeBreaks"].as_bool().unwrap_or(false),
            eye_every: n("healthEyeInterval", 20, 5, 240) * MIN,
            eye_secs: n("healthEyeDuration", 20, 5, 300),
        }
    }
}

/// What `tick` asks the app to do.
#[derive(Debug, PartialEq)]
pub enum Nudge {
    /// `health:remind`'s payload
    Remind(Value),
    /// open the eye-break window for so many seconds
    EyeBreak(i64),
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(default)]
struct Day {
    water: i64,
    breaks: i64,
    mindful: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Health {
    days: BTreeMap<String, Day>,
    last_break_at: i64,
    #[serde(skip)]
    started: bool,
    #[serde(skip)]
    break_nag: i64,
    #[serde(skip)]
    water_at: i64,
    #[serde(skip)]
    eye_at: i64,
    #[serde(skip)]
    last_tick: i64,
    #[serde(skip)]
    away: bool,
}

impl Health {
    fn day(&mut self, day: &str) -> &mut Day {
        if !self.days.contains_key(day) {
            if let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") {
                let cut = (d - chrono::Duration::days(KEEP_DAYS)).format("%Y-%m-%d").to_string();
                self.days.retain(|k, _| *k > cut);
            }
        }
        self.days.entry(day.to_string()).or_default()
    }

    fn reached(d: &Day, g: &[i64; 3]) -> bool {
        d.water >= g[0] || d.breaks >= g[1] || d.mindful >= g[2]
    }

    /// Days in a row with a goal reached, up to today (or yesterday, while today has none yet).
    fn streak(&self, cfg: &Cfg, day: &str) -> i64 {
        let Ok(mut d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") else { return 0 };
        let ok = |d: NaiveDate| self.days.get(&d.format("%Y-%m-%d").to_string()).is_some_and(|x| Self::reached(x, &cfg.goals));
        if !ok(d) {
            d = d.pred_opt().unwrap_or(d);
        }
        let mut n = 0;
        while ok(d) {
            n += 1;
            d = match d.pred_opt() {
                Some(p) => p,
                None => break,
            };
        }
        n
    }

    pub fn view(&mut self, cfg: &Cfg, day: &str) -> Value {
        let t = *self.day(day);
        json!({"today": {"water": t.water, "breaks": t.breaks, "mindful": t.mindful},
               "goals": {"water": cfg.goals[0], "breaks": cfg.goals[1], "mindful": cfg.goals[2]},
               "lastBreakAt": self.last_break_at, "streak": self.streak(cfg, day)})
    }

    /// Glasses added (or taken back, never below 0); `goalReached` when this one reached the goal.
    pub fn water(&mut self, n: i64, now: i64, cfg: &Cfg, day: &str) -> Value {
        let d = self.day(day);
        let before = d.water;
        d.water = (d.water + n).max(0);
        let reached = before < cfg.goals[0] && d.water >= cfg.goals[0];
        if n > 0 {
            self.water_at = now;
        }
        let mut v = self.view(cfg, day);
        v["goalReached"] = json!(reached);
        v
    }

    pub fn break_done(&mut self, now: i64, day: &str) {
        self.day(day).breaks += 1;
        self.last_break_at = now;
    }

    pub fn mindful(&mut self, n: i64, day: &str) {
        let d = self.day(day);
        d.mindful = (d.mindful + n).max(0);
    }

    pub fn eye_done(&mut self, now: i64) {
        self.eye_at = now;
    }

    /// Every few seconds: the reminders due. `idle` = ms since the last keyboard or mouse input.
    pub fn tick(&mut self, now: i64, idle: i64, cfg: &Cfg, day: &str) -> Vec<Nudge> {
        if !self.started {
            // (a restart: the last break stays as it was, the reminders count from now)
            self.started = true;
            self.last_break_at = if self.last_break_at > 0 { self.last_break_at } else { now };
            self.break_nag = now;
            self.water_at = now;
            self.eye_at = now;
            self.last_tick = now;
        }
        // away: no input for a while, or no tick at all (the Mac slept). Nothing reminds meanwhile; the return is
        // the end of a break, and every interval counts from it.
        let slept = now - self.last_tick >= AWAY;
        self.last_tick = now;
        if idle >= AWAY && !slept {
            self.away = true;
            return vec![];
        }
        if self.away || slept {
            self.away = false;
            self.last_break_at = now;
            self.break_nag = now;
            self.water_at = now;
            self.eye_at = now;
            return vec![];
        }
        let mut out = vec![];
        if !cfg.enabled {
            return out;
        }
        if cfg.break_rem && now - self.last_break_at.max(self.break_nag) >= cfg.break_every {
            self.break_nag = now;
            out.push(Nudge::Remind(json!({"kind": "break", "minutes": (now - self.last_break_at) / MIN})));
        }
        let glasses = self.day(day).water;
        if cfg.water_rem && glasses < cfg.goals[0] && now - self.water_at >= cfg.water_every {
            self.water_at = now;
            out.push(Nudge::Remind(json!({"kind": "water", "glasses": glasses, "goal": cfg.goals[0]})));
        }
        if cfg.eye && now - self.eye_at >= cfg.eye_every {
            self.eye_at = now;
            out.push(Nudge::EyeBreak(cfg.eye_secs));
        }
        out
    }
}
