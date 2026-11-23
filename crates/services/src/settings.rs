//! settings.json in the data folder over the defaults (`crates/contract/defaults/settings.json`).
//! Secrets live in the OS store; `get()` only says whether each is set (`has_<key>`).
use platform::Secrets;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

pub const SECRET_KEYS: &[&str] =
    &["githubToken", "todoSyncGoogleClientSecret", "todoSyncGoogleRefresh", "vlcPassword", "voiceCloudKey", "brainKey", "symponyAiKey", "ponyMcpSecrets"];
/// AI API keys of before phase 5 (AI goes through the agents installed on the Mac now): removed from the secrets file.
pub const RETIRED_KEYS: &[&str] = &["claudeApiKey", "geminiApiKey", "openaiApiKey", "tavilyApiKey"];

/// Whether this binary was built with a hosted Sympony AI router endpoint (official releases only).
pub fn has_builtin_ai() -> bool {
    option_env!("SYMPONY_AI_URL").is_some_and(|u| !u.trim().is_empty())
}

pub struct Settings {
    file: PathBuf,
    defaults: Map<String, Value>,
    saved: Mutex<Map<String, Value>>, // what settings.json holds (only what differs from or was set over the defaults)
    secrets: Arc<dyn Secrets>,
    /// which secrets are set: asked once at load (the Keychain can prompt), kept up to date by `secret`
    has: Mutex<Map<String, Value>>,
    /// pre-merged read-only snapshot (`defaults` + `saved` + `has`) so hot background loops avoid deep-cloning 300 keys
    cached: RwLock<Arc<Value>>,
    /// settings.json couldn't be read or moved aside: never write over it
    protect: bool,
}

fn is_secret(k: &str) -> bool {
    SECRET_KEYS.contains(&k) || k.starts_with("has_")
}

const RETIRED_CAT_KEYS: &[&str] = &[
    "catEnabled",
    "catLook",
    "catColor",
    "catSide",
    "catSize",
    "catOpacity",
    "catAutoHide",
    "catChat",
    "catFreeAt",
    "catHideWhenOpen",
    "catSkin",
    "catSleep",
];

/// Migrates unsupported legacy notch look/color values, retires removed Dashboard/glanceSlots and legacy buddy (`cat*`)
/// settings, and appends any newly added default modules missing from a saved `modules` list.
pub fn migrate_notch(saved: &mut Map<String, Value>) {
    if saved
        .get("notchLook")
        .and_then(Value::as_str)
        .is_some_and(|v| !matches!(v, "black" | "glass" | "color"))
    {
        saved.remove("notchLook");
    }
    if let Some(v) = saved.get("notchColor") {
        let valid = v.as_str().is_some_and(|s| {
            s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
        });
        if !valid {
            saved.remove("notchColor");
        }
    }
    saved.remove("glanceSlots");
    saved.remove("dashboardWidgets");
    for k in RETIRED_CAT_KEYS {
        saved.remove(*k);
    }
    if saved.contains_key("mochiFace") && !saved.get("ponyV1").and_then(Value::as_bool).unwrap_or(false) {
        saved.remove("mochiFace");
        saved.insert("ponyFace".into(), Value::Bool(true));
        saved.insert("ponyV1".into(), Value::Bool(true));
    }
    // (old builds forcibly saved updateCheck: false while the legacy updater URLs were dead; restore default once)
    if saved.get("updateCheck") == Some(&Value::Bool(false))
        && !saved.get("updaterV1").and_then(Value::as_bool).unwrap_or(false)
    {
        saved.remove("updateCheck");
        saved.insert("updaterV1".into(), Value::Bool(true));
    }
    // (Sympony AI is the default brain for new installs; one that already ran keeps the agent it was using)
    if !saved.is_empty() && !saved.contains_key("ponyBrain") {
        saved.insert("ponyBrain".into(), Value::from("agent"));
    }
    if let Some(Value::Array(mods)) = saved.get_mut("modules") {
        mods.retain(|item| item.get("id").and_then(Value::as_str) != Some("dashboard"));
        if let Ok(Value::Object(defaults)) = serde_json::from_str::<Value>(include_str!("../../contract/defaults/settings.json")) {
            if let Some(Value::Array(def_mods)) = defaults.get("modules") {
                for dm in def_mods {
                    if let Some(id) = dm.get("id").and_then(Value::as_str) {
                        let exists = mods.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(id));
                        if !exists {
                            mods.push(dm.clone());
                        }
                    }
                }
            }
        }
    }
}

impl Settings {
    /// A file that doesn't parse is kept as `settings.json.broken-<unix secs>` and Sympony starts from the defaults.
    pub fn load(data_dir: &Path, secrets: Arc<dyn Secrets>) -> Self {
        let file = data_dir.join("settings.json");
        let mut defaults = match serde_json::from_str(include_str!("../../contract/defaults/settings.json")) {
            Ok(Value::Object(m)) => m,
            _ => unreachable!("defaults/settings.json is an object"),
        };
        // Open-source builds without a built-in hosted Sympony AI URL default to local CLI agents instead of `"sympony"`.
        if !has_builtin_ai() {
            defaults.insert("ponyBrain".into(), Value::from("agent"));
        }
        let mut protect = false;
        let saved = match std::fs::read(&file) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(_) => {
                protect = true;
                Map::new()
            }
            Ok(bytes) => match serde_json::from_slice(&bytes) {
                Ok(Value::Object(m)) => m,
                _ => {
                    protect = std::fs::rename(&file, crate::paths::broken_name(&file)).is_err();
                    Map::new()
                }
            },
        };
        let mut saved: Map<String, Value> = saved.into_iter().filter(|(k, _)| !is_secret(k)).collect();
        migrate_notch(&mut saved);
        let has: Map<String, Value> = SECRET_KEYS.iter().map(|k| (format!("has_{k}"), Value::Bool(secrets.get(k).is_some()))).collect();
        let merged = Self::merge(&defaults, &saved, &has);
        Settings {
            file,
            defaults,
            saved: Mutex::new(saved),
            secrets,
            has: Mutex::new(has),
            cached: RwLock::new(Arc::new(merged)),
            protect,
        }
    }

    fn merge(defaults: &Map<String, Value>, saved: &Map<String, Value>, has: &Map<String, Value>) -> Value {
        let mut out = defaults.clone();
        out.extend(saved.iter().map(|(k, v)| (k.clone(), v.clone())));
        out.extend(has.iter().map(|(k, v)| (k.clone(), v.clone())));
        Value::Object(out)
    }

    fn rebuild(&self, saved: &Map<String, Value>, has: &Map<String, Value>) -> Arc<Value> {
        let next = Arc::new(Self::merge(&self.defaults, saved, has));
        *self.cached.write().unwrap() = next.clone();
        next
    }

    /// Zero-copy read snapshot for background loops (an atomic refcount increment, no JSON deep-cloning).
    pub fn snapshot(&self) -> Arc<Value> {
        self.cached.read().unwrap().clone()
    }

    /// Fast boolean lookup without cloning the settings object.
    pub fn bool_or(&self, key: &str, default: bool) -> bool {
        self.cached.read().unwrap().get(key).and_then(Value::as_bool).unwrap_or(default)
    }

    pub fn get(&self) -> Value {
        (**self.cached.read().unwrap()).clone()
    }

    /// Only what the user set (no defaults, no secrets flags): what a backup keeps.
    pub fn saved(&self) -> Value {
        Value::Object(self.saved.lock().unwrap().clone())
    }

    /// Merges `patch` (secrets and `has_` flags in it are ignored: they go through `secret`), saves, returns `get()`.
    pub fn set(&self, patch: Value) -> Value {
        if let Value::Object(p) = patch {
            let mut saved = self.saved.lock().unwrap();
            saved.extend(p.into_iter().filter(|(k, _)| !is_secret(k)));
            self.save(&saved);
            let has = self.has.lock().unwrap();
            let snap = self.rebuild(&saved, &has);
            return (*snap).clone();
        }
        self.get()
    }

    pub fn reset(&self) -> Value {
        let mut saved = self.saved.lock().unwrap();
        saved.clear();
        self.save(&saved);
        let has = self.has.lock().unwrap();
        let snap = self.rebuild(&saved, &has);
        (*snap).clone()
    }

    /// A secret's value, for the service that uses it (never sent to the pages).
    pub fn secret_value(&self, key: &str) -> Option<String> {
        SECRET_KEYS.contains(&key).then(|| self.secrets.get(key)).flatten()
    }

    pub fn secret(&self, key: &str, value: &str) -> anyhow::Result<()> {
        anyhow::ensure!(SECRET_KEYS.contains(&key), "{key} isn't a secret setting");
        self.secrets.set(key, value)?;
        let saved = self.saved.lock().unwrap();
        let mut has = self.has.lock().unwrap();
        has.insert(format!("has_{key}"), Value::Bool(!value.is_empty()));
        self.rebuild(&saved, &has);
        Ok(())
    }

    fn save(&self, saved: &Map<String, Value>) {
        if self.protect {
            return;
        }
        let _ = crate::paths::write_private(&self.file, &serde_json::to_vec_pretty(saved).unwrap_or_default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn migrate_notch_keeps_supported_looks_and_color_strips_legacy() {
        for look in ["black", "glass", "color"] {
            let mut m: Map<String, Value> =
                serde_json::from_value(json!({"notchLook": look, "notchColor": "#1c2b4d"})).unwrap();
            migrate_notch(&mut m);
            assert_eq!(m.get("notchLook"), Some(&json!(look)));
            assert_eq!(m.get("notchColor"), Some(&json!("#1c2b4d")));
        }

        let mut legacy: Map<String, Value> =
            serde_json::from_value(json!({"notchLook": "wallpaper", "notchColor": "not-a-hex"})).unwrap();
        migrate_notch(&mut legacy);
        assert!(!legacy.contains_key("notchLook"));
        assert!(!legacy.contains_key("notchColor"));
    }

    #[test]
    fn migrate_notch_drops_dashboard_module_and_appends_missing_default_modules() {
        let mut m: Map<String, Value> = serde_json::from_value(json!({
            "modules": [
                {"id": "home", "on": true},
                {"id": "dashboard", "on": true},
                {"id": "weather", "on": true},
                {"id": "todo", "on": false}
            ],
            "dashboardWidgets": ["weather", "toggles", "launcher", "dayprogress"],
            "glanceSlots": ["weather", "battery", "nextevent", "prayer", "todo", "pomodoro"]
        }))
        .unwrap();
        migrate_notch(&mut m);
        assert!(!m.contains_key("dashboardWidgets"));
        assert!(!m.contains_key("glanceSlots"));
        let mods = m.get("modules").and_then(Value::as_array).unwrap();
        // Original user order and on-flags preserved at the front, with dashboard removed
        assert_eq!(mods[0], json!({"id": "home", "on": true}));
        assert_eq!(mods[1], json!({"id": "weather", "on": true}));
        assert_eq!(mods[2], json!({"id": "todo", "on": false}));
        assert!(!mods.iter().any(|x| x.get("id").and_then(Value::as_str) == Some("dashboard")));
        // Missing default modules including launcher & notifs are appended
        assert!(mods.iter().any(|x| x == &json!({"id": "launcher", "on": false})));
        assert!(mods.iter().any(|x| x == &json!({"id": "notifs", "on": false})));
        assert!(mods.iter().any(|x| x.get("id").and_then(Value::as_str) == Some("prayer")));
    }

    #[test]
    fn migrate_notch_drops_retired_cat_buddy_keys() {
        let mut m: Map<String, Value> = serde_json::from_value(json!({
            "catEnabled": true,
            "catLook": "dog",
            "catColor": "black",
            "catSide": "left",
            "catSize": 84,
            "catOpacity": 90,
            "catAutoHide": false,
            "catChat": true,
            "catFreeAt": {"x": 100, "y": 200},
            "catHideWhenOpen": true,
            "catSkin": {"at": 1, "idle": "a.png", "sleep": "", "talk": ""},
            "catSleep": false,
            "expandedWidth": 710
        }))
        .unwrap();
        migrate_notch(&mut m);
        for k in RETIRED_CAT_KEYS {
            assert!(!m.contains_key(*k), "expected retired key {k} to be dropped");
        }
        assert_eq!(m.get("expandedWidth"), Some(&json!(710)));
    }

    #[test]
    fn migrate_sets_pony_face_once() {
        let mut m: Map<String, Value> = serde_json::from_value(json!({"mochiFace": false})).unwrap();
        migrate_notch(&mut m);
        assert_eq!(m.get("ponyFace"), Some(&json!(true)));
        assert!(!m.contains_key("mochiFace"));
        assert_eq!(m.get("ponyV1"), Some(&json!(true)));

        // Second run after user explicitly turns ponyFace off keeps it false
        m.insert("ponyFace".into(), json!(false));
        migrate_notch(&mut m);
        assert_eq!(m.get("ponyFace"), Some(&json!(false)));
        assert_eq!(m.get("ponyV1"), Some(&json!(true)));
    }

    #[test]
    fn migrate_restores_update_check_once_and_respects_user_off() {
        let mut m: Map<String, Value> = serde_json::from_value(json!({"updateCheck": false})).unwrap();
        migrate_notch(&mut m);
        assert!(!m.contains_key("updateCheck"));
        assert_eq!(m.get("updaterV1"), Some(&json!(true)));

        // After migration, explicitly turning updateCheck off stays off
        m.insert("updateCheck".into(), json!(false));
        migrate_notch(&mut m);
        assert_eq!(m.get("updateCheck"), Some(&json!(false)));
        assert_eq!(m.get("updaterV1"), Some(&json!(true)));
    }
}
