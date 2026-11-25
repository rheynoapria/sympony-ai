//! Local Declarative OLED Custom Modules (Phase 1):
//! - Built-in modules stay immutable (`BUILTIN_IDS`); custom modules live strictly under `custom:<slug>`.
//! - Stored under `<data_dir>/custom-modules/<slug>/{module.json, state.json, config.json}` with owner-only perms.
//! - Zero arbitrary script execution: validated declarative JSON manifests, safe dot-path extraction,
//!   deterministic state actions, and SSRF-safe public HTTPS fetching via `crate::http::fetch_public_custom`.
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashSet};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const CUSTOM_PREFIX: &str = "custom:";
pub const SCHEMA_VERSION: u64 = 1;
pub const MAX_MODULES: usize = 24;
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;
pub const MAX_STATE_BYTES: usize = 64 * 1024;
pub const MAX_CONFIG_BYTES: usize = 32 * 1024;
pub const MAX_HTTP_DOMAINS: usize = 5;
pub const MAX_CONFIG_FIELDS: usize = 8;
pub const MAX_DATA_SOURCES: usize = 4;
pub const MAX_ACTIONS: usize = 12;
pub const MAX_VIEW_DEPTH: usize = 6;
pub const MAX_VIEW_NODES: usize = 40;
pub const MAX_STATE_ITEMS: usize = 100;
pub const MIN_POLL_SECONDS: u64 = 30;
pub const MAX_POLL_SECONDS: u64 = 86_400;
pub const MAX_HTTP_RESPONSE_BYTES: u64 = 256 * 1024;
pub const HTTP_TIMEOUT_SECS: u64 = 8;

/// Dedicated Pony Module Creator system prompt (injected ONLY when Module Creator Mode is toggled ON).
pub const CREATOR_PROMPT: &str = include_str!("custom_module_prompt.txt");

/// Immutable built-in & reserved Sympony module IDs (cannot be overwritten, shadowed, or deleted).
pub const BUILTIN_IDS: &[&str] = &[
    "home",
    "calendar",
    "prayer",
    "control",
    "shelf",
    "todo",
    "notes",
    "pomodoro",
    "weather",
    "health",
    "screentime",
    "dayprogress",
    "bluetooth",
    "stats",
    "translate",
    "chat",
    "github",
    "feed",
    "radio",
    "bookmarks",
    "aiusage",
    "worldclock",
    "teleprompter",
    "launcher",
    "notifs",
    "hitl",
    "dashboard",
    "custom",
];

pub const ALLOWED_ACCENTS: &[&str] = &[
    "emerald", "sky", "amber", "rose", "violet", "cyan", "lime", "neutral",
];

pub const ALLOWED_SIZES: &[&str] = &["1x1", "2x1", "1x2", "2x2"];

pub const ALLOWED_ICONS: &[&str] = &[
    "Boxes", "Sparkles", "TrendingUp", "Activity", "Flame", "Heart", "Zap", "Globe", "Clock",
    "CheckCircle2", "Server", "Database", "Terminal", "Code2", "Coins", "DollarSign", "Wallet",
    "Newspaper", "Rss", "Cloud", "Sun", "Moon", "Music", "Coffee", "Dumbbell", "Droplets",
    "BookOpen", "Target", "Bell", "Shield", "Cpu", "Wifi", "Gauge", "Star", "Rocket",
    "Calendar", "Timer", "ListTodo", "Bookmark", "Compass",
];

const RESERVED_NAMESPACES: &[&str] = &["state", "config", "secret", "item", "input", "meta"];

const FORBIDDEN_HEADERS: &[&str] = &[
    "host",
    "cookie",
    "content-length",
    "transfer-encoding",
    "connection",
    "proxy-authorization",
    "upgrade",
];

const ALLOWED_ACTION_KINDS: &[&str] = &[
    "refresh",
    "setState",
    "increment",
    "toggleState",
    "appendItem",
    "removeItem",
    "resetState",
    "copyText",
    "openUrl",
    "askPony",
];

const ALLOWED_NODE_TYPES: &[&str] = &[
    "stack",
    "grid",
    "scroll",
    "divider",
    "header",
    "metric",
    "sparkline",
    "progress",
    "list",
    "kv",
    "badge",
    "text",
    "empty",
    "button",
    "stepper",
    "toggleRow",
    "quickInput",
];

pub fn is_builtin_id(id: &str) -> bool {
    let trimmed = id.trim();
    !trimmed.starts_with(CUSTOM_PREFIX) && BUILTIN_IDS.iter().any(|b| b.eq_ignore_ascii_case(trimmed))
}

pub fn custom_id(slug: &str) -> String {
    format!("{CUSTOM_PREFIX}{slug}")
}

pub fn strip_custom_id(id: &str) -> Option<&str> {
    id.strip_prefix(CUSTOM_PREFIX)
}

pub fn root(data_dir: &Path) -> PathBuf {
    data_dir.join("custom-modules")
}

pub fn module_dir(data_dir: &Path, slug: &str) -> Result<PathBuf, String> {
    validate_slug(slug)?;
    Ok(root(data_dir).join(slug))
}

/// Validates a custom module slug (`a-z`, `0-9`, single hyphens, 2..=40 chars) and blocks built-in IDs.
pub fn validate_slug(slug: &str) -> Result<(), String> {
    let s = slug.trim();
    if s.is_empty() {
        return Err("Custom module slug is required".into());
    }
    if s.starts_with(CUSTOM_PREFIX) {
        return Err("Pass only the bare slug without the 'custom:' prefix".into());
    }
    if BUILTIN_IDS.iter().any(|b| b.eq_ignore_ascii_case(s)) {
        return Err(format!(
            "Built-in module '{s}' is immutable and cannot be modified or shadowed"
        ));
    }
    if s.len() < 2 || s.len() > 40 {
        return Err("Slug must be 2–40 characters long".into());
    }
    if s.starts_with('-') || s.ends_with('-') || s.contains("--") {
        return Err("Slug cannot start/end with '-' or contain '--'".into());
    }
    if !s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err("Slug may only contain lowercase a-z, 0-9, and hyphens".into());
    }
    Ok(())
}

fn is_valid_key(s: &str, max_len: usize) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else { return false };
    if !first.is_ascii_alphabetic() || s.len() > max_len {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_valid_hex_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// Validates a public domain name for `permissions.httpDomains` (exact lowercase hostname, no wildcard/IP/localhost).
pub fn validate_public_domain(raw: &str) -> Result<String, String> {
    let d = raw.trim().to_ascii_lowercase();
    if d.is_empty() || d.len() > 253 {
        return Err(format!("Invalid domain '{raw}'"));
    }
    if d.contains('*')
        || d.contains('/')
        || d.contains(':')
        || d.contains('@')
        || d.contains(' ')
        || d.contains("{{")
    {
        return Err(format!("Domain '{raw}' must be a bare hostname (e.g. api.coingecko.com)"));
    }
    if d.parse::<IpAddr>().is_ok() {
        return Err(format!("IP literals are not allowed in httpDomains ('{raw}')"));
    }
    if d == "localhost"
        || d.ends_with(".localhost")
        || d.ends_with(".local")
        || d.ends_with(".internal")
        || d.ends_with(".home.arpa")
        || !d.contains('.')
    {
        return Err(format!("Local or private domain '{raw}' is not allowed in Phase 1"));
    }
    for label in d.split('.') {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(format!("Malformed domain '{raw}'"));
        }
    }
    Ok(d)
}

/// Extracts the static host from an `https://` template URL and ensures no template braces appear in scheme/host.
fn validate_https_template_url(url: &str, allowed_domains: &BTreeSet<String>) -> Result<String, String> {
    let u = url.trim();
    if !u.starts_with("https://") {
        return Err(format!("URL '{u}' must start with https://"));
    }
    if u.contains("{{secret.") {
        return Err("Secret config values may only be used in HTTP headers, never in URLs".into());
    }
    let rest = &u["https://".len()..];
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') || authority.contains('{') || authority.contains('}') {
        return Err(format!("URL '{u}' must have a static hostname without userinfo or templates"));
    }
    let host = authority.split(':').next().unwrap_or("").to_ascii_lowercase();
    validate_public_domain(&host)?;
    if !allowed_domains.contains(&host) {
        return Err(format!(
            "URL host '{host}' must be declared in permissions.httpDomains"
        ));
    }
    Ok(u.to_string())
}

fn check_json_depth(v: &Value, depth: usize, max_depth: usize) -> Result<(), String> {
    if depth > max_depth {
        return Err(format!("JSON nesting exceeds max depth {max_depth}"));
    }
    match v {
        Value::Array(arr) => {
            for item in arr {
                check_json_depth(item, depth + 1, max_depth)?;
            }
        }
        Value::Object(map) => {
            for val in map.values() {
                check_json_depth(val, depth + 1, max_depth)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_node(
    node: &Value,
    depth: usize,
    count: &mut usize,
    action_names: &HashSet<String>,
) -> Result<(), String> {
    if depth > MAX_VIEW_DEPTH {
        return Err(format!("View tree exceeds max depth of {MAX_VIEW_DEPTH}"));
    }
    *count += 1;
    if *count > MAX_VIEW_NODES {
        return Err(format!("View tree exceeds max node count of {MAX_VIEW_NODES}"));
    }
    let obj = node.as_object().ok_or("Each view node must be a JSON object")?;
    let ty = obj.get("type").and_then(Value::as_str).ok_or("View node is missing string 'type'")?;
    if !ALLOWED_NODE_TYPES.contains(&ty) {
        return Err(format!("Unknown view node type '{ty}'"));
    }
    let check_action = |key: &str| -> Result<(), String> {
        if let Some(a) = obj.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
            if !action_names.contains(a) {
                return Err(format!("Node '{ty}' references unknown action '{a}' in '{key}'"));
            }
        }
        Ok(())
    };
    match ty {
        "stack" | "grid" | "scroll" => {
            if ty == "grid" {
                let cols = obj.get("cols").and_then(Value::as_u64).unwrap_or(2);
                if cols != 2 && cols != 3 {
                    return Err("grid.cols must be 2 or 3".into());
                }
            }
            let children = obj
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| format!("'{ty}' node requires a 'children' array"))?;
            for child in children {
                validate_node(child, depth + 1, count, action_names)?;
            }
        }
        "header" => {
            check_action("rightAction")?;
        }
        "button" => {
            let act = obj.get("action").and_then(Value::as_str).unwrap_or("");
            if act.is_empty() || !action_names.contains(act) {
                return Err(format!("button requires a valid 'action' (got '{act}')"));
            }
            if obj.get("label").and_then(Value::as_str).map(str::trim).unwrap_or("").is_empty() {
                return Err("button requires a non-empty 'label'".into());
            }
        }
        "stepper" | "toggleRow" => {
            let sk = obj.get("stateKey").and_then(Value::as_str).unwrap_or("");
            if !is_valid_key(sk, 32) {
                return Err(format!("{ty} requires a valid 'stateKey'"));
            }
        }
        "quickInput" => {
            let act = obj.get("action").and_then(Value::as_str).unwrap_or("");
            if act.is_empty() || !action_names.contains(act) {
                return Err(format!("quickInput requires a valid 'action' (got '{act}')"));
            }
        }
        "list" => {
            let items = obj.get("items").and_then(Value::as_str).unwrap_or("");
            if items.trim().is_empty() {
                return Err("list requires an 'items' expression (e.g. \"{{feed.items}}\")".into());
            }
            let item_obj = obj.get("item").and_then(Value::as_object).ok_or("list requires an 'item' template object")?;
            for key in ["onClick", "onRemove"] {
                if let Some(a) = item_obj.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    if !action_names.contains(a) {
                        return Err(format!("list.item.{key} references unknown action '{a}'"));
                    }
                }
            }
        }
        "kv" => {
            let rows = obj.get("rows").and_then(Value::as_array).ok_or("kv requires a 'rows' array")?;
            if rows.len() > 12 {
                return Err("kv supports at most 12 rows".into());
            }
        }
        "metric" => {
            if obj.get("value").and_then(Value::as_str).unwrap_or("").is_empty() {
                return Err("metric requires a 'value' string or expression".into());
            }
        }
        "progress" => {
            if obj.get("value").and_then(Value::as_str).unwrap_or("").is_empty() {
                return Err("progress requires a 'value' string or expression".into());
            }
        }
        "sparkline" => {
            if obj.get("data").and_then(Value::as_str).unwrap_or("").is_empty() {
                return Err("sparkline requires a 'data' array expression".into());
            }
        }
        _ => {}
    }
    Ok(())
}

/// Validates and canonicalizes a Custom Module v1 manifest.
pub fn validate_manifest(raw: &Value) -> Result<Value, String> {
    let serialized = serde_json::to_vec(raw).map_err(|e| format!("Invalid manifest JSON: {e}"))?;
    if serialized.len() > MAX_MANIFEST_BYTES {
        return Err(format!("Manifest exceeds max size of {} KB", MAX_MANIFEST_BYTES / 1024));
    }
    let obj = raw.as_object().ok_or("Manifest must be a JSON object")?;
    let ver = obj.get("schemaVersion").and_then(Value::as_u64).unwrap_or(0);
    if ver != SCHEMA_VERSION {
        return Err(format!("schemaVersion must be {SCHEMA_VERSION}"));
    }
    let slug = obj.get("slug").and_then(Value::as_str).unwrap_or("").trim();
    validate_slug(slug)?;

    let name = obj.get("name").and_then(Value::as_str).unwrap_or("").trim();
    if name.is_empty() || name.chars().count() > 32 {
        return Err("name must be 1–32 characters".into());
    }
    let description = obj.get("description").and_then(Value::as_str).unwrap_or("").trim();
    if description.is_empty() || description.chars().count() > 140 {
        return Err("description must be 1–140 characters".into());
    }

    let raw_icon = obj.get("icon").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("Boxes");
    let icon = ALLOWED_ICONS
        .iter()
        .find(|i| i.eq_ignore_ascii_case(raw_icon))
        .copied()
        .ok_or_else(|| format!("Unsupported icon '{raw_icon}'. Allowed icons: {}", ALLOWED_ICONS.join(", ")))?;

    let raw_accent = obj.get("accent").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("emerald");
    let accent = if let Some(named) = ALLOWED_ACCENTS.iter().find(|a| a.eq_ignore_ascii_case(raw_accent)) {
        (*named).to_string()
    } else if is_valid_hex_color(raw_accent) {
        raw_accent.to_ascii_lowercase()
    } else {
        return Err(format!(
            "accent must be one of [{}] or #rrggbb",
            ALLOWED_ACCENTS.join(", ")
        ));
    };

    let raw_size = obj.get("defaultSize").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("2x1");
    let default_size = ALLOWED_SIZES
        .iter()
        .find(|sz| sz.eq_ignore_ascii_case(raw_size))
        .copied()
        .ok_or_else(|| format!("defaultSize must be one of: {}", ALLOWED_SIZES.join(", ")))?;

    let author = match obj.get("author").and_then(Value::as_str).unwrap_or("pony") {
        "user" => "user",
        _ => "pony",
    };

    // Permissions
    let mut domains = BTreeSet::new();
    if let Some(perms) = obj.get("permissions") {
        let p_obj = perms.as_object().ok_or("permissions must be an object")?;
        if let Some(arr) = p_obj.get("httpDomains") {
            let list = arr.as_array().ok_or("permissions.httpDomains must be an array")?;
            if list.len() > MAX_HTTP_DOMAINS {
                return Err(format!("At most {MAX_HTTP_DOMAINS} httpDomains are allowed"));
            }
            for item in list {
                let d = item.as_str().ok_or("httpDomains entries must be strings")?;
                domains.insert(validate_public_domain(d)?);
            }
        }
    }

    // Config schema
    let mut config_schema_out = Vec::new();
    let mut config_keys = HashSet::new();
    if let Some(cs) = obj.get("configSchema") {
        let list = cs.as_array().ok_or("configSchema must be an array")?;
        if list.len() > MAX_CONFIG_FIELDS {
            return Err(format!("At most {MAX_CONFIG_FIELDS} configSchema fields are allowed"));
        }
        for field in list {
            let f_obj = field.as_object().ok_or("Each configSchema field must be an object")?;
            let key = f_obj.get("key").and_then(Value::as_str).unwrap_or("");
            if !is_valid_key(key, 32) {
                return Err(format!("Invalid configSchema key '{key}'"));
            }
            if !config_keys.insert(key.to_string()) {
                return Err(format!("Duplicate configSchema key '{key}'"));
            }
            let label = f_obj.get("label").and_then(Value::as_str).unwrap_or("").trim();
            if label.is_empty() || label.chars().count() > 48 {
                return Err(format!("configSchema '{key}' needs a label (1–48 chars)"));
            }
            let ty = f_obj.get("type").and_then(Value::as_str).unwrap_or("");
            if !matches!(ty, "text" | "number" | "toggle" | "select" | "secret") {
                return Err(format!("configSchema '{key}' has invalid type '{ty}'"));
            }
            if ty == "select" {
                let opts = f_obj.get("options").and_then(Value::as_array).filter(|a| !a.is_empty())
                    .ok_or_else(|| format!("configSchema select '{key}' requires non-empty options"))?;
                for o in opts {
                    if o.get("value").and_then(Value::as_str).is_none() || o.get("label").and_then(Value::as_str).is_none() {
                        return Err(format!("configSchema select '{key}' options must have string value & label"));
                    }
                }
            }
            config_schema_out.push(field.clone());
        }
    }

    // Initial state
    let initial_state = match obj.get("initialState") {
        Some(v) if !v.is_null() => {
            let map = v.as_object().ok_or("initialState must be a JSON object")?;
            if map.len() > 20 {
                return Err("initialState may have at most 20 top-level keys".into());
            }
            check_json_depth(v, 0, 3)?;
            v.clone()
        }
        _ => json!({}),
    };

    // Data sources
    let mut data_sources_out = Vec::new();
    let mut ds_ids = HashSet::new();
    if let Some(ds_val) = obj.get("dataSources") {
        let list = ds_val.as_array().ok_or("dataSources must be an array")?;
        if list.len() > MAX_DATA_SOURCES {
            return Err(format!("At most {MAX_DATA_SOURCES} dataSources are allowed"));
        }
        for ds in list {
            let d_obj = ds.as_object().ok_or("Each dataSource must be an object")?;
            let id = d_obj.get("id").and_then(Value::as_str).unwrap_or("");
            if !is_valid_key(id, 24) || RESERVED_NAMESPACES.contains(&id) {
                return Err(format!("Invalid or reserved dataSource id '{id}'"));
            }
            if !ds_ids.insert(id.to_string()) {
                return Err(format!("Duplicate dataSource id '{id}'"));
            }
            let kind = d_obj.get("kind").and_then(Value::as_str).unwrap_or("http");
            if !matches!(kind, "http" | "rss") {
                return Err(format!("dataSource '{id}' kind must be 'http' or 'rss'"));
            }
            let method = d_obj
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("GET")
                .trim()
                .to_ascii_uppercase();
            if kind == "rss" && method != "GET" {
                return Err(format!("RSS dataSource '{id}' only supports GET"));
            }
            if !matches!(method.as_str(), "GET" | "POST") {
                return Err(format!("dataSource '{id}' method must be GET or POST"));
            }
            let url = d_obj.get("url").and_then(Value::as_str).unwrap_or("");
            let clean_url = validate_https_template_url(url, &domains)?;

            let poll = d_obj
                .get("pollSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(60)
                .clamp(MIN_POLL_SECONDS, MAX_POLL_SECONDS);

            let mut norm_ds = Map::new();
            norm_ds.insert("id".into(), Value::from(id));
            norm_ds.insert("kind".into(), Value::from(kind));
            norm_ds.insert("method".into(), Value::from(method));
            norm_ds.insert("url".into(), Value::from(clean_url));
            norm_ds.insert("pollSeconds".into(), Value::from(poll));

            if let Some(hdrs) = d_obj.get("headers").and_then(Value::as_object) {
                let mut clean_hdrs = Map::new();
                for (k, v) in hdrs {
                    let kl = k.trim().to_ascii_lowercase();
                    if kl.is_empty() || FORBIDDEN_HEADERS.contains(&kl.as_str()) {
                        return Err(format!("Header '{k}' is forbidden in dataSource '{id}'"));
                    }
                    let vs = v.as_str().ok_or_else(|| format!("Header '{k}' must be a string"))?;
                    clean_hdrs.insert(k.trim().to_string(), Value::from(vs));
                }
                if !clean_hdrs.is_empty() {
                    norm_ds.insert("headers".into(), Value::Object(clean_hdrs));
                }
            }
            if let Some(body) = d_obj.get("body") {
                if !body.is_null() {
                    check_json_depth(body, 0, 4)?;
                    norm_ds.insert("body".into(), body.clone());
                }
            }
            if let Some(extract) = d_obj.get("extract").and_then(Value::as_object) {
                let mut clean_ext = Map::new();
                for (k, v) in extract {
                    if !is_valid_key(k, 32) {
                        return Err(format!("Invalid extract key '{k}' in dataSource '{id}'"));
                    }
                    let path = v.as_str().map(str::trim).filter(|s| !s.is_empty())
                        .ok_or_else(|| format!("Extract path for '{k}' must be a non-empty string"))?;
                    clean_ext.insert(k.clone(), Value::from(path));
                }
                if !clean_ext.is_empty() {
                    norm_ds.insert("extract".into(), Value::Object(clean_ext));
                }
            }
            if kind == "rss" {
                let limit = d_obj.get("limit").and_then(Value::as_u64).unwrap_or(8).clamp(1, 20);
                norm_ds.insert("limit".into(), Value::from(limit));
            }
            data_sources_out.push(Value::Object(norm_ds));
        }
    }

    // Actions
    let mut actions_out = Map::new();
    let mut action_names = HashSet::new();
    if let Some(acts) = obj.get("actions") {
        let a_obj = acts.as_object().ok_or("actions must be a JSON object")?;
        if a_obj.len() > MAX_ACTIONS {
            return Err(format!("At most {MAX_ACTIONS} actions are allowed"));
        }
        for (name, def) in a_obj {
            if !is_valid_key(name, 32) {
                return Err(format!("Invalid action name '{name}'"));
            }
            let d = def.as_object().ok_or_else(|| format!("Action '{name}' must be an object"))?;
            let kind = d.get("kind").and_then(Value::as_str).unwrap_or("");
            if !ALLOWED_ACTION_KINDS.contains(&kind) {
                return Err(format!("Action '{name}' has unsupported kind '{kind}'"));
            }
            if kind == "openUrl" {
                let u = d.get("url").and_then(Value::as_str).unwrap_or("").trim();
                if !u.starts_with("https://") && !u.starts_with("{{") {
                    return Err(format!("openUrl action '{name}' must use an https:// URL or template"));
                }
            }
            if matches!(kind, "setState" | "increment" | "toggleState" | "appendItem" | "removeItem") {
                let sk = d.get("stateKey").and_then(Value::as_str).unwrap_or("");
                if !is_valid_key(sk, 32) {
                    return Err(format!("Action '{name}' ({kind}) requires a valid stateKey"));
                }
            }
            action_names.insert(name.clone());
            actions_out.insert(name.clone(), def.clone());
        }
    }

    // View
    let view = obj.get("view").and_then(Value::as_object).ok_or("Manifest requires a 'view' object")?;
    let compact = view.get("compact").ok_or("view.compact is required")?;
    let mut node_count = 0usize;
    validate_node(compact, 0, &mut node_count, &action_names)?;
    let mut view_out = Map::new();
    view_out.insert("compact".into(), compact.clone());
    if let Some(expanded) = view.get("expanded") {
        if !expanded.is_null() {
            let mut exp_count = 0usize;
            validate_node(expanded, 0, &mut exp_count, &action_names)?;
            view_out.insert("expanded".into(), expanded.clone());
        }
    }

    Ok(json!({
        "schemaVersion": SCHEMA_VERSION,
        "slug": slug,
        "id": custom_id(slug),
        "name": name,
        "description": description,
        "icon": icon,
        "accent": accent,
        "defaultSize": default_size,
        "author": author,
        "permissions": {
            "httpDomains": domains.into_iter().collect::<Vec<_>>()
        },
        "configSchema": config_schema_out,
        "initialState": initial_state,
        "dataSources": data_sources_out,
        "actions": actions_out,
        "view": view_out,
    }))
}

/// Returns the list of declared `permissions.httpDomains` for a validated manifest.
pub fn manifest_domains(manifest: &Value) -> Vec<String> {
    manifest["permissions"]["httpDomains"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|s| s.to_ascii_lowercase())
        .collect()
}

/// Returns the set of secret config field keys declared in `configSchema`.
pub fn secret_field_keys(manifest: &Value) -> HashSet<String> {
    manifest["configSchema"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| f["type"] == "secret")
        .filter_map(|f| f["key"].as_str().map(String::from))
        .collect()
}

/// Lists all valid installed custom module manifests sorted by slug.
pub fn list_manifests(data_dir: &Path) -> Vec<Value> {
    let dir = root(data_dir);
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let Some(slug) = p.file_name().and_then(|n| n.to_str()) else { continue };
        if validate_slug(slug).is_err() {
            continue;
        }
        let m_path = p.join("module.json");
        let Ok(bytes) = std::fs::read(&m_path) else { continue };
        if bytes.len() > MAX_MANIFEST_BYTES {
            continue;
        }
        let Ok(raw) = serde_json::from_slice::<Value>(&bytes) else { continue };
        if let Ok(mut m) = validate_manifest(&raw) {
            if m["slug"].as_str() == Some(slug) {
                if let Some(obj) = m.as_object_mut() {
                    obj.insert("id".into(), Value::from(custom_id(slug)));
                }
                out.push(m);
            }
        }
    }
    out.sort_by(|a, b| a["slug"].as_str().cmp(&b["slug"].as_str()));
    out
}

pub fn read_manifest(data_dir: &Path, slug: &str) -> Result<Value, String> {
    let dir = module_dir(data_dir, slug)?;
    let path = dir.join("module.json");
    let bytes = std::fs::read(&path).map_err(|_| format!("Custom module '{slug}' not found"))?;
    let raw: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Corrupt module.json: {e}"))?;
    validate_manifest(&raw)
}

/// Validates and atomically writes `module.json`, seeding `state.json` from `initialState` on first create.
pub fn save_manifest(data_dir: &Path, raw: &Value, replace: bool) -> Result<Value, String> {
    let manifest = validate_manifest(raw)?;
    let slug = manifest["slug"].as_str().unwrap_or("");
    let dir = module_dir(data_dir, slug)?;
    let m_path = dir.join("module.json");
    let existed = m_path.is_file();
    if existed && !replace {
        return Err(format!(
            "Custom module '{slug}' already exists. Ask the user to confirm overwriting it, then pass replace: true."
        ));
    }
    if !existed {
        let current = list_manifests(data_dir);
        if current.len() >= MAX_MODULES {
            return Err(format!("Maximum of {MAX_MODULES} custom modules reached"));
        }
    }
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    crate::paths::write_private(&m_path, &bytes).map_err(|e| e.to_string())?;
    let state_path = dir.join("state.json");
    if !state_path.is_file() {
        let init = manifest.get("initialState").cloned().unwrap_or_else(|| json!({}));
        let s_bytes = serde_json::to_vec_pretty(&init).map_err(|e| e.to_string())?;
        let _ = crate::paths::write_private(&state_path, &s_bytes);
    }
    Ok(manifest)
}

pub fn delete_module(data_dir: &Path, slug: &str) -> Result<(), String> {
    let dir = module_dir(data_dir, slug)?;
    if !dir.exists() {
        return Err(format!("Custom module '{slug}' not found"));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())
}

pub fn read_state(data_dir: &Path, slug: &str, manifest: &Value) -> Value {
    let Ok(dir) = module_dir(data_dir, slug) else { return json!({}) };
    let path = dir.join("state.json");
    let mut base = manifest
        .get("initialState")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    if let Ok(bytes) = std::fs::read(&path) {
        if bytes.len() <= MAX_STATE_BYTES {
            if let Ok(Value::Object(saved)) = serde_json::from_slice::<Value>(&bytes) {
                base.extend(saved);
            }
        }
    }
    Value::Object(base)
}

pub fn write_state(data_dir: &Path, slug: &str, state: &Value) -> Result<(), String> {
    if !state.is_object() {
        return Err("State must be a JSON object".into());
    }
    let dir = module_dir(data_dir, slug)?;
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_STATE_BYTES {
        return Err(format!("Module state exceeds {} KB limit", MAX_STATE_BYTES / 1024));
    }
    crate::paths::write_private(&dir.join("state.json"), &bytes).map_err(|e| e.to_string())
}

/// Reads non-secret config merged over `configSchema` defaults (secret fields are NEVER returned).
pub fn read_config(data_dir: &Path, slug: &str, manifest: &Value) -> Value {
    let secret_keys = secret_field_keys(manifest);
    let mut out = Map::new();
    for field in manifest["configSchema"].as_array().into_iter().flatten() {
        let Some(k) = field["key"].as_str() else { continue };
        if secret_keys.contains(k) {
            continue;
        }
        if let Some(def) = field.get("default") {
            out.insert(k.to_string(), def.clone());
        }
    }
    if let Ok(dir) = module_dir(data_dir, slug) {
        if let Ok(bytes) = std::fs::read(dir.join("config.json")) {
            if bytes.len() <= MAX_CONFIG_BYTES {
                if let Ok(Value::Object(saved)) = serde_json::from_slice::<Value>(&bytes) {
                    for (k, v) in saved {
                        if !secret_keys.contains(&k) {
                            out.insert(k, v);
                        }
                    }
                }
            }
        }
    }
    Value::Object(out)
}

/// Writes non-secret config fields to `config.json` (silently drops any keys marked `secret` in `configSchema`).
pub fn write_config(data_dir: &Path, slug: &str, manifest: &Value, patch: &Value) -> Result<Value, String> {
    let secret_keys = secret_field_keys(manifest);
    let allowed_keys: HashSet<String> = manifest["configSchema"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| f["key"].as_str().map(String::from))
        .collect();
    let mut cur = read_config(data_dir, slug, manifest).as_object().cloned().unwrap_or_default();
    if let Some(map) = patch.as_object() {
        for (k, v) in map {
            if allowed_keys.contains(k) && !secret_keys.contains(k) {
                cur.insert(k.clone(), v.clone());
            }
        }
    }
    let val = Value::Object(cur);
    let bytes = serde_json::to_vec_pretty(&val).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err("Module config exceeds 32 KB limit".into());
    }
    let dir = module_dir(data_dir, slug)?;
    crate::paths::write_private(&dir.join("config.json"), &bytes).map_err(|e| e.to_string())?;
    Ok(val)
}

/// Deterministic state transition for declarative actions (`setState`, `increment`, `toggleState`, `appendItem`, `removeItem`, `resetState`).
/// Also handles direct `stepper` / `toggleRow` updates via synthetic action names `__step:<stateKey>` and `__toggle:<stateKey>`.
pub fn apply_action(
    manifest: &Value,
    current_state: &Value,
    action_name: &str,
    payload: &Value,
    now_ms: i64,
) -> Result<Value, String> {
    let mut st = current_state.as_object().cloned().unwrap_or_default();

    // Direct interactive primitive mutations (stepper / toggleRow)
    if let Some(key) = action_name.strip_prefix("__step:") {
        if !is_valid_key(key, 32) {
            return Err("Invalid stateKey".into());
        }
        let delta = payload["delta"].as_f64().unwrap_or(1.0);
        let cur = st.get(key).and_then(Value::as_f64).unwrap_or(0.0);
        let mut next = cur + delta;
        if let Some(min) = payload["min"].as_f64() {
            next = next.max(min);
        }
        if let Some(max) = payload["max"].as_f64() {
            next = next.min(max);
        }
        st.insert(key.to_string(), num_value(next));
        return Ok(Value::Object(st));
    }
    if let Some(key) = action_name.strip_prefix("__toggle:") {
        if !is_valid_key(key, 32) {
            return Err("Invalid stateKey".into());
        }
        let cur = st.get(key).and_then(Value::as_bool).unwrap_or(false);
        st.insert(key.to_string(), Value::Bool(!cur));
        return Ok(Value::Object(st));
    }

    let action = manifest["actions"]
        .get(action_name)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("Unknown action '{action_name}'"))?;
    let kind = action.get("kind").and_then(Value::as_str).unwrap_or("");
    let state_key = action.get("stateKey").and_then(Value::as_str).unwrap_or("");

    match kind {
        "resetState" => Ok(manifest.get("initialState").cloned().unwrap_or_else(|| json!({}))),
        "increment" => {
            let delta = payload.get("delta").and_then(Value::as_f64)
                .or_else(|| action.get("delta").and_then(Value::as_f64))
                .unwrap_or(1.0);
            let cur = st.get(state_key).and_then(Value::as_f64).unwrap_or(0.0);
            let mut next = cur + delta;
            if let Some(min) = action.get("min").and_then(Value::as_f64) {
                next = next.max(min);
            }
            if let Some(max) = action.get("max").and_then(Value::as_f64) {
                next = next.min(max);
            }
            st.insert(state_key.to_string(), num_value(next));
            Ok(Value::Object(st))
        }
        "toggleState" => {
            if let Some(idx) = payload.get("index").and_then(Value::as_u64).map(|i| i as usize) {
                if let Some(Value::Array(arr)) = st.get_mut(state_key) {
                    if let Some(item) = arr.get_mut(idx) {
                        if let Some(obj) = item.as_object_mut() {
                            let cur = obj.get("done").and_then(Value::as_bool).unwrap_or(false);
                            obj.insert("done".into(), Value::Bool(!cur));
                            return Ok(Value::Object(st));
                        }
                    }
                }
            }
            let cur = st.get(state_key).and_then(Value::as_bool).unwrap_or(false);
            st.insert(state_key.to_string(), Value::Bool(!cur));
            Ok(Value::Object(st))
        }
        "setState" => {
            let input_str = payload.get("input").and_then(Value::as_str).unwrap_or("").trim();
            let val = match action.get("value") {
                Some(Value::String(s)) if s.trim() == "{{input}}" => Value::from(input_str),
                Some(v) => v.clone(),
                None => Value::from(input_str),
            };
            st.insert(state_key.to_string(), val);
            Ok(Value::Object(st))
        }
        "appendItem" => {
            let text = payload
                .get("input")
                .and_then(Value::as_str)
                .or_else(|| action.get("value").and_then(Value::as_str))
                .unwrap_or("")
                .trim();
            if text.is_empty() {
                return Ok(Value::Object(st));
            }
            let max_items = action
                .get("maxItems")
                .and_then(Value::as_u64)
                .unwrap_or(50)
                .clamp(1, MAX_STATE_ITEMS as u64) as usize;
            let mut arr = st
                .get(state_key)
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            arr.insert(
                0,
                json!({
                    "id": format!("i_{now_ms}_{}", arr.len()),
                    "title": text.chars().take(200).collect::<String>(),
                    "done": false,
                    "at": now_ms,
                }),
            );
            arr.truncate(max_items);
            st.insert(state_key.to_string(), Value::Array(arr));
            Ok(Value::Object(st))
        }
        "removeItem" => {
            if let Some(Value::Array(arr)) = st.get_mut(state_key) {
                if let Some(id) = payload.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()) {
                    arr.retain(|item| item.get("id").and_then(Value::as_str) != Some(id));
                } else if let Some(idx) = payload.get("index").and_then(Value::as_u64).map(|i| i as usize) {
                    if idx < arr.len() {
                        arr.remove(idx);
                    }
                }
            }
            Ok(Value::Object(st))
        }
        _ => Ok(Value::Object(st)),
    }
}

fn num_value(n: f64) -> Value {
    if n.fract() == 0.0 && n >= (i64::MIN as f64) && n <= (i64::MAX as f64) {
        Value::from(n as i64)
    } else {
        json!((n * 1000.0).round() / 1000.0)
    }
}

/// Safe dot/index/wildcard extractor over parsed JSON (`a.b.0.c` or `prices.*.usd`).
pub fn extract_json_path(root: &Value, path: &str) -> Value {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "$" {
        return root.clone();
    }
    let segs: Vec<&str> = trimmed.strip_prefix("$.").unwrap_or(trimmed).split('.').collect();
    extract_segments(root, &segs)
}

fn extract_segments(cur: &Value, segs: &[&str]) -> Value {
    let Some((&first, rest)) = segs.split_first() else {
        return cur.clone();
    };
    if first == "*" {
        let Some(arr) = cur.as_array() else { return Value::Array(vec![]) };
        let items: Vec<Value> = arr.iter().take(60).map(|item| extract_segments(item, rest)).collect();
        return Value::Array(items);
    }
    match cur {
        Value::Object(map) => match map.get(first) {
            Some(next) => extract_segments(next, rest),
            None => Value::Null,
        },
        Value::Array(arr) => match first.parse::<usize>().ok().and_then(|i| arr.get(i)) {
            Some(next) => extract_segments(next, rest),
            None => Value::Null,
        },
        _ => Value::Null,
    }
}

fn percent_encode_component(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn value_to_inline_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

/// Interpolates `{{config.key}}` inside URL path/query (URL-encoded) while ensuring the URL host is untouched.
pub fn interpolate_url(template: &str, config: &Value) -> Result<String, String> {
    if template.contains("{{secret.") {
        return Err("Secrets cannot be interpolated into URLs".into());
    }
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return Err("Unclosed template '{{' in URL".into());
        };
        let expr = after[..end].trim();
        let val = if let Some(key) = expr.strip_prefix("config.") {
            config.get(key).map(value_to_inline_string).unwrap_or_default()
        } else {
            return Err(format!("Unsupported URL template '{{{{{expr}}}}}' (only config.<key> is allowed)"));
        };
        out.push_str(&percent_encode_component(&val));
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Interpolates `{{config.key}}` and `{{secret.key}}` in HTTP header values (strips CR/LF).
pub fn interpolate_header(template: &str, config: &Value, secrets: &Value) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            out.push_str("{{");
            rest = after;
            break;
        };
        let expr = after[..end].trim();
        let val = if let Some(key) = expr.strip_prefix("config.") {
            config.get(key).map(value_to_inline_string).unwrap_or_default()
        } else if let Some(key) = expr.strip_prefix("secret.") {
            secrets.get(key).map(value_to_inline_string).unwrap_or_default()
        } else {
            String::new()
        };
        out.push_str(&val);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out.replace(['\r', '\n'], "")
}

/// Fetches a single `dataSource` (`http` or `rss`) using SSRF-safe `http::fetch_public_custom`.
pub fn fetch_data_source(
    ds: &Value,
    approved_domains: &[String],
    config: &Value,
    secrets: &Value,
) -> Result<Value, String> {
    let kind = ds["kind"].as_str().unwrap_or("http");
    let method = ds["method"].as_str().unwrap_or("GET");
    let raw_url = ds["url"].as_str().unwrap_or("");
    let url = interpolate_url(raw_url, config)?;

    let mut headers = Vec::new();
    if let Some(h_map) = ds["headers"].as_object() {
        for (k, v) in h_map {
            if let Some(tpl) = v.as_str() {
                headers.push((k.clone(), interpolate_header(tpl, config, secrets)));
            }
        }
    }
    let body = ds.get("body").filter(|b| !b.is_null());

    let (status, _ct, bytes) = crate::http::fetch_public_custom(
        method,
        &url,
        &headers,
        body,
        approved_domains,
        MAX_HTTP_RESPONSE_BYTES,
        Duration::from_secs(HTTP_TIMEOUT_SECS),
    )
    .map_err(|e| e.to_string())?;

    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status} from {url}"));
    }

    if kind == "rss" {
        let xml = String::from_utf8_lossy(&bytes);
        let limit = ds["limit"].as_u64().unwrap_or(8).clamp(1, 20) as usize;
        let id = ds["id"].as_str().unwrap_or("rss");
        let parsed = crate::feed::parse_rss_or_atom(&xml, id, id, "custom", "rss", "#30d158", &url, limit);
        let items: Vec<Value> = parsed
            .into_iter()
            .take(limit)
            .map(|it| {
                let sub = if !it.snippet.is_empty() {
                    it.snippet
                } else if !it.publisher.is_empty() {
                    it.publisher
                } else {
                    it.source_name.clone()
                };
                json!({
                    "id": it.id,
                    "title": it.title,
                    "subtitle": sub,
                    "url": it.url,
                    "publishedMs": it.published_at,
                    "source": it.source_name,
                })
            })
            .collect();
        return Ok(json!({ "count": items.len(), "items": items }));
    }

    let parsed: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Expected JSON response from {url}: {e}"))?;

    if let Some(extract) = ds["extract"].as_object() {
        if !extract.is_empty() {
            let mut mapped = Map::new();
            for (out_key, path_val) in extract {
                if let Some(path) = path_val.as_str() {
                    mapped.insert(out_key.clone(), extract_json_path(&parsed, path));
                }
            }
            return Ok(Value::Object(mapped));
        }
    }
    Ok(parsed)
}
