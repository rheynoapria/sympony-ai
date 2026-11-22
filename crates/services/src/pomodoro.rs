//! Pomodoro (focus, short and long breaks) and the Timer: the state every window shows, moved on by the app's clock
//! thread (`tick`) and the buttons. Times in ms; `now` and the local day (`YYYY-MM-DD`) are passed in.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MIN: i64 = 60_000;

/// Settings → Pomodoro.
#[derive(Clone, Debug)]
pub struct Config {
    pub work: i64,
    pub short: i64,
    pub long: i64,
    pub cycles: u32,
    pub auto_break: bool,
    pub auto_work: bool,
    pub sound: bool,
}

impl Config {
    pub fn from_settings(s: &Value) -> Config {
        let min = |k: &str, d: i64| s[k].as_f64().map(|m| (m.clamp(1.0, 600.0) * MIN as f64) as i64).unwrap_or(d * MIN);
        Config {
            work: min("pomoWork", 25),
            short: min("pomoShort", 5),
            long: min("pomoLong", 15),
            cycles: s["pomoCycles"].as_u64().unwrap_or(4).clamp(1, 12) as u32,
            auto_break: s["pomoAutoBreak"].as_bool().unwrap_or(true),
            auto_work: s["pomoAutoWork"].as_bool().unwrap_or(false),
            sound: s["pomoSound"].as_bool().unwrap_or(true),
        }
    }

    fn length(&self, phase: &str) -> i64 {
        match phase {
            "short" => self.short,
            "long" => self.long,
            _ => self.work,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Pomodoro {
    phase: String,
    running: bool,
    remaining: i64,
    ends_at: i64,
    total: i64,
    cycle: u32,
    done_today: u32,
    focus_today: i64,
    day: String,
}

impl Pomodoro {
    /// Not running and not begun (or never set): the phase's length from the settings, as they are now.
    fn fresh(&mut self, cfg: &Config) {
        if self.phase.is_empty() {
            self.phase = "work".into();
        }
        let len = cfg.length(&self.phase);
        if !self.running && (self.total == 0 || self.remaining == self.total) && self.total != len {
            self.total = len;
            self.remaining = len;
        }
    }

    fn roll_day(&mut self, day: &str) {
        if self.day != day {
            self.day = day.into();
            self.done_today = 0;
            self.focus_today = 0;
        }
    }

    pub fn view(&mut self, cfg: &Config, day: &str) -> Value {
        self.fresh(cfg);
        self.roll_day(day);
        json!({"phase": self.phase, "running": self.running, "remaining": self.remaining, "endsAt": self.ends_at,
               "total": self.total, "cycle": self.cycle, "cycles": cfg.cycles, "doneToday": self.done_today,
               "focusToday": self.focus_today})
    }

    pub fn running(&self) -> bool {
        self.running
    }

    pub fn start(&mut self, now: i64, cfg: &Config) {
        self.fresh(cfg);
        if !self.running {
            self.running = true;
            self.ends_at = now + self.remaining.max(0);
        }
    }

    pub fn pause(&mut self, now: i64) {
        if self.running {
            self.running = false;
            self.remaining = (self.ends_at - now).max(0);
        }
    }

    pub fn toggle(&mut self, now: i64, cfg: &Config) {
        if self.running {
            self.pause(now)
        } else {
            self.start(now, cfg)
        }
    }

    pub fn reset(&mut self, cfg: &Config) {
        self.phase = "work".into();
        self.running = false;
        self.cycle = 0;
        self.total = cfg.work;
        self.remaining = cfg.work;
    }

    /// The phase given, stopped at its full length.
    pub fn set_phase(&mut self, phase: &str, cfg: &Config) {
        self.phase = if matches!(phase, "short" | "long") { phase } else { "work" }.into();
        self.running = false;
        self.total = cfg.length(&self.phase);
        self.remaining = self.total;
    }

    /// After work (`cycle` already counted): the long break every `cycles` sessions, else the short one.
    fn next_phase(&self, cfg: &Config) -> &'static str {
        if self.phase != "work" {
            "work"
        } else if self.cycle % cfg.cycles.max(1) == 0 {
            "long"
        } else {
            "short"
        }
    }

    /// On to the next phase without counting this one, stopped.
    pub fn skip(&mut self, _now: i64, cfg: &Config) {
        let next = if self.phase == "work" && (self.cycle + 1) % cfg.cycles.max(1) == 0 { "long" } else if self.phase == "work" { "short" } else { "work" };
        self.set_phase(next, cfg);
    }

    /// The running phase ended (once, however long ago): counted, the next one set and started when the settings
    /// say so. Returns `pomodoro:done`'s payload.
    pub fn tick(&mut self, now: i64, cfg: &Config, day: &str) -> Option<Value> {
        self.roll_day(day);
        if !self.running || now < self.ends_at {
            return None;
        }
        let finished = self.phase.clone();
        if finished == "work" {
            self.cycle += 1;
            self.done_today += 1;
            self.focus_today += self.total;
        }
        let next = self.next_phase(cfg);
        self.set_phase(next, cfg);
        if if next == "work" { cfg.auto_work } else { cfg.auto_break } {
            self.start(now, cfg);
        }
        Some(json!({"finished": finished, "sound": cfg.sound}))
    }
}

/// Settings → Pomodoro → "When the Timer ends, Pomodoro's short break starts" (`timerThenBreak`), unless one runs.
pub fn after_timer(p: &mut Pomodoro, cfg: &Config, then_break: bool, now: i64) {
    if then_break && !p.running {
        p.set_phase("short", cfg);
        p.start(now, cfg);
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Timer {
    active: bool,
    running: bool,
    left: i64,
    ends_at: i64,
    total: i64,
    last: i64,
}

impl Timer {
    pub fn view(&self) -> Value {
        json!({"active": self.active, "running": self.running, "left": self.left, "endsAt": self.ends_at, "total": self.total, "last": self.last})
    }

    pub fn start(&mut self, ms: i64, now: i64) {
        self.last = ms;
        self.run(ms, now);
    }

    fn run(&mut self, ms: i64, now: i64) {
        let ms = ms.max(1000);
        *self = Timer { active: true, running: true, left: ms, ends_at: now + ms, total: ms, last: self.last };
    }

    pub fn toggle(&mut self, now: i64) {
        if !self.active {
            return;
        }
        if self.running {
            self.left = (self.ends_at - now).max(0);
        } else {
            self.ends_at = now + self.left;
        }
        self.running = !self.running;
    }

    pub fn stop(&mut self) {
        *self = Timer { last: self.last, ..Timer::default() };
    }

    /// More time on the running one; on a finished one ("+5 min"), it runs again for `ms`.
    pub fn add(&mut self, ms: i64, now: i64) {
        if !self.active {
            return self.run(ms, now);
        }
        self.total += ms;
        if self.running {
            self.ends_at += ms;
        } else {
            self.left += ms;
        }
    }

    /// Ended: the length it had (for `timer:done`), once.
    pub fn tick(&mut self, now: i64) -> Option<i64> {
        if !(self.active && self.running && now >= self.ends_at) {
            return None;
        }
        let total = self.total;
        self.stop();
        Some(total)
    }
}
