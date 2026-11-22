//! Screen Time: the seconds each app spends in front, per day and hour, with the switches between apps. The app's
//! clock thread calls `tick` once a second while someone is at the Mac; days are `YYYY-MM-DD`, kept 30 days.
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

const KEEP_DAYS: i64 = 30;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
struct AppUse {
    name: String,
    secs: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
struct Day {
    apps: BTreeMap<String, AppUse>,
    hours: Vec<i64>,
    switches: i64,
}

impl Default for Day {
    fn default() -> Self {
        Day { apps: BTreeMap::new(), hours: vec![0; 24], switches: 0 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct ScreenTime {
    days: BTreeMap<String, Day>,
    #[serde(skip)]
    last: Option<String>,
}

/// App categories, by bundle id (a trailing `*`: any id starting so), and their colors.
const CATEGORIES: &[(&str, &str, &[&str])] = &[
    ("Browsing", "#64d2ff", &["com.apple.Safari", "com.google.Chrome*", "com.brave.Browser*", "org.mozilla.firefox", "com.microsoft.edgemac*", "company.thebrowser.Browser", "com.operasoftware.Opera*", "com.vivaldi.Vivaldi", "app.zen-browser.zen"]),
    ("Development", "#0a84ff", &["com.microsoft.VSCode*", "com.apple.dt.Xcode", "com.jetbrains.*", "com.googlecode.iterm2", "com.apple.Terminal", "dev.warp.*", "com.todesktop.*", "dev.zed.Zed*", "com.github.GitHubClient", "com.sublimetext.*", "com.postmanlabs.mac", "com.mitchellh.ghostty", "com.anthropic.claudefordesktop"]),
    ("Communication", "#30d158", &["com.tinyspeck.slackmacgap", "com.apple.MobileSMS", "com.apple.mail", "us.zoom.xos", "com.microsoft.teams*", "net.whatsapp.WhatsApp*", "ru.keepcoder.Telegram", "com.hnc.Discord", "com.microsoft.Outlook", "com.apple.FaceTime"]),
    ("Entertainment", "#ff375f", &["com.spotify.client", "com.apple.Music", "com.apple.TV", "com.apple.podcasts", "com.netflix.*", "org.videolan.vlc", "com.colliderli.iina", "com.valvesoftware.steam"]),
    ("Productivity", "#ff9f0a", &["com.microsoft.Word", "com.microsoft.Excel", "com.microsoft.Powerpoint", "com.apple.iWork.*", "notion.id", "md.obsidian", "com.apple.Notes", "com.apple.reminders", "com.apple.iCal", "com.apple.Preview", "com.readdle.*", "com.linear", "com.culturedcode.ThingsMac"]),
    ("Creativity", "#bf5af2", &["com.figma.Desktop", "com.adobe.*", "com.apple.FinalCut*", "com.bohemiancoding.sketch3", "com.apple.garageband*", "com.apple.logic*", "com.apple.Photos", "com.blackmagic-design.*"]),
    ("Social", "#ffd60a", &["com.twitter.*", "com.facebook.*", "com.atebits.Tweetie2", "com.burbn.instagram"]),
    ("System", "#8e8e93", &["com.apple.finder", "com.apple.systempreferences", "com.apple.ActivityMonitor", "com.apple.AppStore", "com.apple.Console"]),
];

pub fn category(bundle_id: &str) -> (&'static str, &'static str) {
    for (name, color, ids) in CATEGORIES {
        if ids.iter().any(|p| match p.strip_suffix('*') {
            Some(pre) => bundle_id.starts_with(pre),
            None => bundle_id == *p,
        }) {
            return (name, color);
        }
    }
    ("Other", "#636366")
}

impl ScreenTime {
    pub fn days(&self) -> Vec<String> {
        self.days.keys().cloned().collect()
    }

    /// A second of `id` (bundle id) in front, at `hour` of `day`.
    pub fn tick(&mut self, id: &str, name: &str, day: &str, hour: u32) {
        if !self.days.contains_key(day) {
            if let Ok(d) = NaiveDate::parse_from_str(day, "%Y-%m-%d") {
                let cut = (d - chrono::Duration::days(KEEP_DAYS)).format("%Y-%m-%d").to_string();
                self.days.retain(|k, _| *k > cut);
            }
        }
        let d = self.days.entry(day.to_string()).or_default();
        if self.last.as_deref().is_some_and(|l| l != id) {
            d.switches += 1;
        }
        self.last = Some(id.to_string());
        let a = d.apps.entry(id.to_string()).or_default();
        a.name = name.to_string();
        a.secs += 1;
        if let Some(h) = d.hours.get_mut(hour as usize) {
            *h += 1;
        }
    }

    /// The tab's numbers for today or the last 7 days; `current` = the app in front now, `icon` its picture by id.
    pub fn summary(&self, range: &str, today: &str, current: Option<&str>, icon: &dyn Fn(&str) -> Option<String>) -> Value {
        let n = if range == "week" { 7 } else { 1 };
        let first = NaiveDate::parse_from_str(today, "%Y-%m-%d").map(|d| (d - chrono::Duration::days(n - 1)).format("%Y-%m-%d").to_string()).unwrap_or_default();
        let (mut apps, mut hours, mut switches): (HashMap<&str, (&str, i64)>, Vec<i64>, i64) = (HashMap::new(), vec![0; 24], 0);
        for (_, d) in self.days.range(first..=today.to_string()) {
            for (id, a) in &d.apps {
                let e = apps.entry(id.as_str()).or_insert((a.name.as_str(), 0));
                e.1 += a.secs;
            }
            for (i, h) in d.hours.iter().enumerate().take(24) {
                hours[i] += h;
            }
            switches += d.switches;
        }
        let mut list: Vec<(&str, &str, i64)> = apps.into_iter().map(|(id, (name, secs))| (id, name, secs)).collect();
        list.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(b.1)));
        let mut cats: Vec<(&str, &str, i64)> = vec![];
        for (id, _, secs) in &list {
            let (name, color) = category(id);
            match cats.iter_mut().find(|c| c.0 == name) {
                Some(c) => c.2 += secs,
                None => cats.push((name, color, *secs)),
            }
        }
        cats.sort_by(|a, b| b.2.cmp(&a.2).then(a.0.cmp(b.0)));
        json!({
            "total": list.iter().map(|a| a.2).sum::<i64>(),
            "categories": cats.iter().map(|(n, c, s)| json!({"name": n, "color": c, "secs": s})).collect::<Vec<_>>(),
            "hours": hours,
            // (the tab lists 7: only those go, with their icons)
            "apps": list.iter().take(7).map(|(id, name, secs)| json!({"name": name, "icon": icon(id), "secs": secs})).collect::<Vec<_>>(),
            "switches": switches,
            "current": current.map(|c| json!({"name": c})),
        })
    }
}
