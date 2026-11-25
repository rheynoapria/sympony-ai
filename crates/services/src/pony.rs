//! Pony Assistant: persona, conversation trimming, system prompt assembly, Agent Skills, and memory.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const DEFAULT_NAME: &str = "Pony";
pub const DEFAULT_PERSONA: &str = "friendly";
pub const DEFAULT_SHAPE: &str = "Squircle";
pub const DEFAULT_COLOR: &str = "Night";

pub const HISTORY_MSGS: usize = 20;
pub const HISTORY_CHARS: usize = 12_000;
pub const MAX_FACTS: usize = 100;
pub const MAX_FACT_CHARS: usize = 300;
const MAX_PERSONA_CHARS: usize = 2_000;
const MAX_SKILL_BYTES: u64 = 256 * 1024;
const MAX_INDEX_SKILLS: usize = 60;
const MAX_INLINE_CHARS: usize = 8_000;
const BUILTINS_MARKER: &str = ".builtins-v1";
const RAW_YAML_KEY: &str = "__raw_yaml";

static MEMORY_LOCK: Mutex<()> = Mutex::new(());
static TMP_SEQ: AtomicU64 = AtomicU64::new(1);

/// Reads Pony's persona fields from settings using the single source of truth for defaults.
pub fn persona_settings(settings: &Value) -> (&str, &str, &str) {
    let name = settings["ponyName"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_NAME);
    let preset = settings["ponyPersona"].as_str().filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_PERSONA);
    let text = settings["ponyPersonaText"].as_str().unwrap_or("");
    (name, preset, text)
}

pub const BUILTINS: [&str; 3] = ["plan-my-day", "wrap-up", "focus-session"];

const BUILTIN_FILES: [(&str, &str); 3] = [
    ("plan-my-day", include_str!("pony/skills/plan-my-day/SKILL.md")),
    ("wrap-up", include_str!("pony/skills/wrap-up/SKILL.md")),
    ("focus-session", include_str!("pony/skills/focus-session/SKILL.md")),
];

/// Pony's user-owned folder (`~/.sympony`).
pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
        .join(".sympony")
}

/// Ensures `dir` exists with `0700` permissions on Unix.
pub fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Builds the persona block injected into Pony's system prompt.
/// Presets: `friendly` (default / fallback), `focused`, `playful`, `custom`.
/// `text` is capped at 2,000 characters. `custom` with empty text gives only the name line.
pub fn persona_block(name: &str, preset: &str, text: &str) -> String {
    let display = name.trim();
    let display = if display.is_empty() { "Pony" } else { display };
    let preset_line = match preset.trim() {
        "focused" => Some("Be terse and direct: skip small talk, put work and results first."),
        "playful" => Some("Keep a light, cheerful tone while staying concise and getting the job done."),
        "custom" => None,
        _ => Some("Be warm, brief, and genuinely helpful—friendly without being wordy."),
    };
    let custom: String = text.trim().chars().take(MAX_PERSONA_CHARS).collect();

    let mut out = format!(
        "Persona (your name and style only; the Core rules above still apply):\nYour name is {display}. That is YOUR name, never the user's—never call or address the user as {display} or any short nickname for yourself."
    );
    if let Some(line) = preset_line {
        out.push(' ');
        out.push_str(line);
    }
    if !custom.is_empty() {
        out.push('\n');
        out.push_str(&custom);
    }
    out
}

/// Keeps the newest messages within both `max_msgs` and `max_chars`, always preserving the last message.
pub fn trim_history(msgs: &[Value], max_msgs: usize, max_chars: usize) -> Vec<Value> {
    if msgs.is_empty() || max_msgs == 0 {
        return vec![];
    }
    let msg_len = |m: &Value| -> usize {
        m["content"]
            .as_str()
            .or_else(|| m["text"].as_str())
            .map(|s| s.chars().count())
            .unwrap_or(0)
    };
    let last_idx = msgs.len() - 1;
    let mut kept_rev: Vec<Value> = vec![msgs[last_idx].clone()];
    let mut used_chars = msg_len(&msgs[last_idx]);

    for m in msgs[..last_idx].iter().rev() {
        if kept_rev.len() >= max_msgs {
            break;
        }
        let len = msg_len(m);
        if used_chars + len > max_chars {
            break;
        }
        used_chars += len;
        kept_rev.push(m.clone());
    }
    kept_rev.reverse();
    kept_rev
}

/// Assembles Pony's system prompt in fixed order: base rules, persona, skills, memory facts, then current time.
/// Empty sections are omitted cleanly.
/// Sympony's own rules for Pony (identity as Sympony AI Assistant, safety, prompt injection, actions): built in,
/// always first, and not part of the Persona the user edits.
pub const CORE: &str = include_str!("pony/core.txt");

pub fn system_prompt(base: &str, persona: &str, skills: &str, facts: &str, now: &str) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(6);
    for p in [CORE, base, persona, skills, facts] {
        let t = p.trim();
        if !t.is_empty() {
            parts.push(t.to_string());
        }
    }
    let now_t = now.trim();
    if !now_t.is_empty() {
        parts.push(format!("It is now {now_t}."));
    }
    parts.join("\n\n")
}

// ================================================================== Agent Skills (agentskills.io)

#[derive(Debug, Clone, PartialEq)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
    pub dir: PathBuf,
    pub extra: Map<String, Value>,
    pub problems: Vec<String>,
    pub has_scripts: bool,
    pub body_lines: usize,
}

impl Skill {
    pub fn valid(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Agent Skills name validation: 1–64 chars, `[a-z0-9-]`, no leading/trailing `-`, no `--`.
pub fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Name is required".into());
    }
    if name.chars().count() > 64 {
        return Err("Name must be at most 64 characters".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err("Use only lowercase letters, numbers, and hyphens".into());
    }
    if name.starts_with('-') || name.ends_with('-') {
        return Err("Name cannot start or end with a hyphen".into());
    }
    if name.contains("--") {
        return Err("Name cannot contain consecutive hyphens".into());
    }
    Ok(())
}

fn unquote_yaml(raw: &str) -> String {
    let s = raw.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        let inner = &s[1..s.len() - 1];
        let mut out = String::with_capacity(inner.len());
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some(other) => {
                        out.push('\\');
                        out.push(other);
                    }
                    None => out.push('\\'),
                }
            } else {
                out.push(c);
            }
        }
        return out;
    }
    if s.len() >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        return s[1..s.len() - 1].replace("''", "'");
    }
    s.to_string()
}

fn quote_yaml(val: &str) -> String {
    let needs = val.is_empty()
        || val.starts_with(' ')
        || val.ends_with(' ')
        || val.starts_with(|c: char| matches!(c, '-' | '?' | ':' | ',' | '[' | ']' | '{' | '}' | '#' | '&' | '*' | '!' | '|' | '>' | '\'' | '"' | '%' | '@' | '`'))
        || val.contains(": ")
        || val.contains(" #")
        || val.contains('\n')
        || val.contains('\r')
        || val.contains('"')
        || matches!(val, "true" | "false" | "null" | "~");
    if !needs {
        return val.to_string();
    }
    let escaped = val
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("\"{escaped}\"")
}

fn parse_flow_map(s: &str) -> Result<Map<String, Value>, String> {
    let inner = s
        .trim()
        .strip_prefix('{')
        .and_then(|x| x.strip_suffix('}'))
        .ok_or_else(|| "Metadata must be a map of strings".to_string())?
        .trim();
    let mut map = Map::new();
    if inner.is_empty() {
        return Ok(map);
    }
    // Split by top-level commas respecting quotes
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut esc = false;
    for ch in inner.chars() {
        if esc {
            cur.push(ch);
            esc = false;
            continue;
        }
        if let Some(q) = quote {
            cur.push(ch);
            if q == '"' && ch == '\\' {
                esc = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' => {
                quote = Some(ch);
                cur.push(ch);
            }
            ',' => {
                parts.push(std::mem::take(&mut cur));
            }
            _ => cur.push(ch),
        }
    }
    if !cur.trim().is_empty() {
        parts.push(cur);
    }
    for item in parts {
        let Some((k, v)) = item.split_once(':') else {
            return Err("Metadata must be a map of strings".into());
        };
        let key = unquote_yaml(k.trim());
        let val = v.trim();
        if key.is_empty() || val.starts_with('{') || val.starts_with('[') {
            return Err("Metadata must be a map of strings".into());
        }
        map.insert(key, Value::String(unquote_yaml(val)));
    }
    Ok(map)
}

fn split_frontmatter(text: &str) -> Option<(String, String)> {
    let norm = text.replace("\r\n", "\n");
    let mut lines = norm.split('\n');
    if lines.next()?.trim() != "---" {
        return None;
    }
    let mut fm = Vec::new();
    let mut found_end = false;
    let mut rest = Vec::new();
    for line in lines {
        if !found_end {
            if line.trim() == "---" {
                found_end = true;
            } else {
                fm.push(line);
            }
        } else {
            rest.push(line);
        }
    }
    if !found_end {
        return None;
    }
    let body = rest.join("\n").trim_matches('\n').to_string();
    Some((fm.join("\n"), body))
}

/// Parses a `SKILL.md` string against the Agent Skills specification.
pub fn parse_skill(dir: &Path, text: &str) -> Skill {
    let folder = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let has_scripts = dir.join("scripts").is_dir();
    let mut problems = Vec::new();
    let mut extra = Map::new();

    let Some((fm, body)) = split_frontmatter(text) else {
        problems.push("Missing YAML frontmatter".into());
        let body_lines = if text.trim().is_empty() { 0 } else { text.lines().count() };
        return Skill {
            name: folder,
            description: String::new(),
            body: text.to_string(),
            dir: dir.to_path_buf(),
            extra,
            problems,
            has_scripts,
            body_lines,
        };
    };

    let mut name = String::new();
    let mut description = String::new();
    let lines: Vec<&str> = fm.lines().collect();
    let mut idx = 0;
    while idx < lines.len() {
        let line = lines[idx];
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            idx += 1;
            continue;
        }
        // Only top-level keys (no leading whitespace)
        if line.starts_with(' ') || line.starts_with('\t') {
            idx += 1;
            continue;
        }
        let Some((raw_k, raw_v)) = line.split_once(':') else {
            idx += 1;
            continue;
        };
        let key = raw_k.trim();
        let val_part = raw_v.trim();

        if key == "metadata" {
            if val_part.is_empty() {
                let mut map = Map::new();
                let mut raw_lines = vec![line];
                let mut nested_or_complex = false;
                let mut base_indent: Option<usize> = None;
                idx += 1;
                while idx < lines.len() {
                    let sub = lines[idx];
                    if sub.trim().is_empty() || sub.trim().starts_with('#') {
                        raw_lines.push(sub);
                        idx += 1;
                        continue;
                    }
                    if !sub.starts_with(' ') && !sub.starts_with('\t') {
                        break;
                    }
                    raw_lines.push(sub);
                    let indent = sub.chars().take_while(|c| *c == ' ' || *c == '\t').count();
                    let bi = *base_indent.get_or_insert(indent);
                    if indent != bi || sub.trim_start().starts_with("- ") {
                        nested_or_complex = true;
                    } else if let Some((mk, mv)) = sub.trim().split_once(':') {
                        let mkey = unquote_yaml(mk.trim());
                        let mval = mv.trim();
                        if mkey.is_empty() || mval.is_empty() || mval.starts_with('{') || mval.starts_with('[') {
                            nested_or_complex = true;
                        } else {
                            map.insert(mkey, Value::String(unquote_yaml(mval)));
                        }
                    } else {
                        nested_or_complex = true;
                    }
                    idx += 1;
                }
                while raw_lines.len() > 1 && raw_lines.last().is_some_and(|l| l.trim().is_empty()) {
                    raw_lines.pop();
                }
                if nested_or_complex {
                    let mut obj = Map::new();
                    obj.insert(RAW_YAML_KEY.into(), Value::String(raw_lines.join("\n")));
                    extra.insert("metadata".into(), Value::Object(obj));
                } else {
                    extra.insert("metadata".into(), Value::Object(map));
                }
                continue;
            } else if val_part.starts_with('{') {
                match parse_flow_map(val_part) {
                    Ok(map) => {
                        extra.insert("metadata".into(), Value::Object(map));
                    }
                    Err(e) => problems.push(e),
                }
                idx += 1;
                continue;
            } else {
                problems.push("Metadata must be a map of strings".into());
                idx += 1;
                continue;
            }
        }

        // Handle block scalar (`|` or `>`) if present
        let value = if val_part == "|" || val_part == ">" || val_part == "|-" || val_part == ">-" {
            let folded = val_part.starts_with('>');
            let mut block_lines = Vec::new();
            idx += 1;
            let mut base_indent: Option<usize> = None;
            while idx < lines.len() {
                let sub = lines[idx];
                if sub.trim().is_empty() {
                    block_lines.push(String::new());
                    idx += 1;
                    continue;
                }
                let indent = sub.chars().take_while(|c| *c == ' ').count();
                if indent == 0 {
                    break;
                }
                let bi = *base_indent.get_or_insert(indent);
                let cut = bi.min(indent);
                block_lines.push(sub[cut..].to_string());
                idx += 1;
            }
            while block_lines.last().is_some_and(|l| l.is_empty()) {
                block_lines.pop();
            }
            if folded {
                block_lines.join(" ").trim().to_string()
            } else {
                block_lines.join("\n").trim().to_string()
            }
        } else if val_part.is_empty() && key != "name" && key != "description" {
            // Preserve nested YAML lists/maps under unknown or optional keys verbatim (e.g. allowed-tools list)
            let mut raw_lines = vec![line];
            idx += 1;
            while idx < lines.len() {
                let sub = lines[idx];
                if sub.trim().is_empty() || sub.trim().starts_with('#') {
                    raw_lines.push(sub);
                    idx += 1;
                    continue;
                }
                if !sub.starts_with(' ') && !sub.starts_with('\t') && !sub.starts_with("- ") {
                    break;
                }
                raw_lines.push(sub);
                idx += 1;
            }
            while raw_lines.len() > 1 && raw_lines.last().is_some_and(|l| l.trim().is_empty()) {
                raw_lines.pop();
            }
            if raw_lines.len() > 1 {
                let mut obj = Map::new();
                obj.insert(RAW_YAML_KEY.into(), Value::String(raw_lines.join("\n")));
                extra.insert(key.to_string(), Value::Object(obj));
            }
            continue;
        } else {
            idx += 1;
            unquote_yaml(val_part)
        };

        match key {
            "name" => name = value,
            "description" => description = value,
            other => {
                extra.insert(other.to_string(), Value::String(value));
            }
        }
    }

    if let Err(e) = validate_name(&name) {
        problems.push(e);
    } else if !folder.is_empty() && name != folder {
        problems.push("Folder name must match skill name".into());
    }

    let desc_chars = description.trim().chars().count();
    if desc_chars == 0 {
        problems.push("Description is required".into());
    } else if desc_chars > 1024 {
        problems.push("Description must be at most 1,024 characters".into());
    }

    if let Some(comp) = extra.get("compatibility") {
        let len = comp.as_str().map(|s| s.trim().chars().count()).unwrap_or(0);
        if len == 0 || len > 500 {
            problems.push("Compatibility must be 1–500 characters".into());
        }
    }

    let body_lines = if body.is_empty() { 0 } else { body.lines().count() };
    let display_name = if name.is_empty() { folder } else { name };
    Skill {
        name: display_name,
        description: description.trim().to_string(),
        body,
        dir: dir.to_path_buf(),
        extra,
        problems,
        has_scripts,
        body_lines,
    }
}

/// Loads all skill folders under `root` (`root/*/SKILL.md`), sorted by name. Never panics on invalid files.
pub fn load_skills(root: &Path) -> Vec<Skill> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return vec![];
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        if folder.starts_with('.') {
            continue;
        }
        let has_scripts = path.join("scripts").is_dir();
        let md = path.join("SKILL.md");
        if !md.is_file() {
            out.push(Skill {
                name: folder,
                description: String::new(),
                body: String::new(),
                dir: path,
                extra: Map::new(),
                problems: vec!["Missing SKILL.md".into()],
                has_scripts,
                body_lines: 0,
            });
            continue;
        }
        let meta = std::fs::metadata(&md);
        if meta.as_ref().is_ok_and(|m| m.len() > MAX_SKILL_BYTES) {
            out.push(Skill {
                name: folder,
                description: String::new(),
                body: String::new(),
                dir: path,
                extra: Map::new(),
                problems: vec!["SKILL.md exceeds 256 KB".into()],
                has_scripts,
                body_lines: 0,
            });
            continue;
        }
        match std::fs::read(&md) {
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(text) => out.push(parse_skill(&path, &text)),
                Err(_) => out.push(Skill {
                    name: folder,
                    description: String::new(),
                    body: String::new(),
                    dir: path,
                    extra: Map::new(),
                    problems: vec!["SKILL.md is not valid UTF-8".into()],
                    has_scripts,
                    body_lines: 0,
                }),
            },
            Err(e) => out.push(Skill {
                name: folder,
                description: String::new(),
                body: String::new(),
                dir: path,
                extra: Map::new(),
                problems: vec![format!("Could not read SKILL.md: {e}")],
                has_scripts,
                body_lines: 0,
            }),
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then_with(|| a.name.cmp(&b.name)));
    out
}

/// Discovery index for brains with tools: valid, enabled skills as `name: description` (at most 60 lines).
pub fn skill_index(skills: &[Skill], off: &[String]) -> String {
    skills
        .iter()
        .filter(|s| s.valid() && !off.iter().any(|x| x == &s.name))
        .take(MAX_INDEX_SKILLS)
        .map(|s| format!("{}: {}", s.name, s.description))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Inline skills for brains without tools: whole enabled valid skill bodies, up to 8,000 chars total.
pub fn inline_skills(skills: &[Skill], off: &[String]) -> String {
    let mut out = String::new();
    let mut used = 0usize;
    for s in skills.iter().filter(|s| s.valid() && !off.iter().any(|x| x == &s.name)) {
        let chunk = format!("## {}\n{}\n\n{}", s.name, s.description, s.body);
        let sep = if out.is_empty() { 0 } else { 2 };
        let add = sep + chunk.chars().count();
        if used + add > MAX_INLINE_CHARS {
            break;
        }
        if sep > 0 {
            out.push_str("\n\n");
        }
        out.push_str(&chunk);
        used += add;
    }
    out
}

/// Checks that a skill exists, is valid, and is not turned off in `off` (used by MCP read_skill / read_skill_file).
pub fn ensure_skill_available(root: &Path, name: &str, off: &[String]) -> Result<Skill, String> {
    if validate_name(name).is_err() || off.iter().any(|x| x == name) {
        return Err(format!("Skill '{name}' is not available"));
    }
    let dir = root.join(name);
    let md = dir.join("SKILL.md");
    let Ok(meta) = std::fs::metadata(&md) else {
        return Err(format!("Skill '{name}' is not available"));
    };
    if !meta.is_file() || meta.len() > MAX_SKILL_BYTES {
        return Err(format!("Skill '{name}' is not available"));
    }
    let Ok(bytes) = std::fs::read(&md) else {
        return Err(format!("Skill '{name}' is not available"));
    };
    let Ok(text) = String::from_utf8(bytes) else {
        return Err(format!("Skill '{name}' is not available"));
    };
    let sk = parse_skill(&dir, &text);
    if !sk.valid() {
        return Err(format!("Skill '{name}' is not available"));
    }
    Ok(sk)
}

/// Reads a UTF-8 text file inside `<root>/<name>/<rel>` (confined to the skill folder, <= 256 KB).
pub fn read_skill_file(root: &Path, name: &str, rel: &str) -> Result<String, String> {
    validate_name(name)?;
    let rel = rel.trim();
    if rel.is_empty() {
        return Err("File path is required".into());
    }
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("Absolute paths are not allowed".into());
    }
    for comp in rel_path.components() {
        if matches!(comp, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Path cannot leave the skill folder".into());
        }
    }
    let skill_dir = root.join(name);
    let dir_canon = std::fs::canonicalize(&skill_dir).map_err(|_| format!("Skill '{name}' not found"))?;
    let target = skill_dir.join(rel_path);
    let target_canon = std::fs::canonicalize(&target).map_err(|_| format!("File '{rel}' not found"))?;
    if !target_canon.starts_with(&dir_canon) || !target_canon.is_file() {
        return Err("Path cannot leave the skill folder".into());
    }
    let meta = std::fs::metadata(&target_canon).map_err(|e| e.to_string())?;
    if meta.len() > MAX_SKILL_BYTES {
        return Err("File exceeds 256 KB".into());
    }
    let bytes = std::fs::read(&target_canon).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "not a text file".into())
}

/// One entry in a skill folder's tree: `path` relative to the skill folder, `/`-separated.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TreeEntry {
    pub path: String,
    pub dir: bool,
    pub size: u64,
}

const MAX_TREE_ENTRIES: usize = 300;
const MAX_TREE_DEPTH: usize = 4;

/// The skill folder as a flat, ordered tree: `SKILL.md` first, then folders before files, alphabetical, depth-first.
/// Hidden entries (`.x`) and symlinks are left out; at most 300 entries, 4 levels deep.
pub fn skill_tree(root: &Path, name: &str) -> Result<Vec<TreeEntry>, String> {
    validate_name(name)?;
    let dir = root.join(name);
    if !dir.is_dir() {
        return Err(format!("Skill '{name}' not found"));
    }
    fn walk(base: &Path, at: &Path, depth: usize, out: &mut Vec<TreeEntry>) {
        let Ok(rd) = std::fs::read_dir(at) else { return };
        let mut items: Vec<(String, bool, u64)> = rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let meta = std::fs::symlink_metadata(e.path()).ok()?;
                (!name.starts_with('.') && !meta.file_type().is_symlink()).then(|| (name, meta.is_dir(), meta.len()))
            })
            .collect();
        items.sort_by(|a, b| {
            let top = |n: &str| depth == 0 && n == "SKILL.md";
            top(&b.0).cmp(&top(&a.0)).then(b.1.cmp(&a.1)).then(a.0.to_lowercase().cmp(&b.0.to_lowercase()))
        });
        for (n, is_dir, size) in items {
            if out.len() >= MAX_TREE_ENTRIES {
                return;
            }
            let p = at.join(&n);
            let rel = p.strip_prefix(base).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            out.push(TreeEntry { path: rel, dir: is_dir, size: if is_dir { 0 } else { size } });
            if is_dir && depth + 1 < MAX_TREE_DEPTH {
                walk(base, &p, depth + 1, out);
            }
        }
    }
    let mut out = vec![];
    walk(&dir, &dir, 0, &mut out);
    Ok(out)
}

/// A path inside `<root>/<name>` for writing or removing: relative, no `..`, no hidden segments, never the skill's own
/// `SKILL.md` (that goes through `write_skill`), and its existing parent must not leave the skill folder.
pub fn skill_path(root: &Path, name: &str, rel: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    let rel = rel.trim().trim_end_matches('/');
    if rel.is_empty() {
        return Err("File path is required".into());
    }
    let rel_path = Path::new(rel);
    for comp in rel_path.components() {
        match comp {
            Component::Normal(s) if !s.to_string_lossy().starts_with('.') => {}
            _ => return Err("Path cannot leave the skill folder".into()),
        }
    }
    if rel.eq_ignore_ascii_case("SKILL.md") {
        return Err("Edit SKILL.md with the skill form".into());
    }
    let dir = root.join(name);
    let dir_canon = std::fs::canonicalize(&dir).map_err(|_| format!("Skill '{name}' not found"))?;
    let target = dir.join(rel_path);
    // the deepest part that exists must stay inside (catches symlinked folders)
    let mut probe = target.clone();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    let probe_canon = std::fs::canonicalize(&probe).map_err(|e| e.to_string())?;
    if !probe_canon.starts_with(&dir_canon) {
        return Err("Path cannot leave the skill folder".into());
    }
    if std::fs::symlink_metadata(&target).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Path cannot leave the skill folder".into());
    }
    Ok(target)
}

/// Writes a text file inside the skill folder (creating folders on the way), atomically; at most 256 KB.
pub fn write_skill_file(root: &Path, name: &str, rel: &str, text: &str) -> Result<(), String> {
    let target = skill_path(root, name, rel)?;
    if text.len() as u64 > MAX_SKILL_BYTES {
        return Err("File exceeds 256 KB".into());
    }
    if target.is_dir() {
        return Err("A folder has that name".into());
    }
    let parent = target.parent().ok_or("Invalid path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = target.with_extension("tmp-write");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())
}

/// Creates a folder inside the skill folder.
pub fn create_skill_dir(root: &Path, name: &str, rel: &str) -> Result<(), String> {
    let target = skill_path(root, name, rel)?;
    if target.exists() {
        return Err("That name is already taken".into());
    }
    std::fs::create_dir_all(&target).map_err(|e| e.to_string())
}

fn format_skill_md(name: &str, description: &str, body: &str, extra: &Map<String, Value>) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("name: {}\n", quote_yaml(name)));
    out.push_str(&format!("description: {}\n", quote_yaml(description.trim())));
    // Keep well-known spec keys in clean order, then any extra keys sorted
    let ordered = ["license", "compatibility", "allowed-tools", "metadata"];
    let mut written = std::collections::HashSet::new();
    for k in ordered {
        if let Some(v) = extra.get(k) {
            write_extra_field(&mut out, k, v);
            written.insert(k);
        }
    }
    let mut rest: Vec<(&String, &Value)> = extra
        .iter()
        .filter(|(k, _)| k.as_str() != "name" && k.as_str() != "description" && !written.contains(k.as_str()))
        .collect();
    rest.sort_by(|a, b| a.0.cmp(b.0));
    for (k, v) in rest {
        write_extra_field(&mut out, k, v);
    }
    out.push_str("---\n");
    let body_trimmed = body.trim_matches('\n');
    if !body_trimmed.is_empty() {
        out.push_str(body_trimmed);
        out.push('\n');
    }
    out
}

fn write_extra_field(out: &mut String, k: &str, v: &Value) {
    match v {
        Value::String(s) => {
            if !s.trim().is_empty() {
                out.push_str(&format!("{k}: {}\n", quote_yaml(s.trim())));
            }
        }
        Value::Object(m) if !m.is_empty() => {
            if let Some(raw) = m.get(RAW_YAML_KEY).and_then(Value::as_str) {
                let clean = raw.trim_end_matches('\n');
                if !clean.is_empty() {
                    out.push_str(clean);
                    out.push('\n');
                }
                return;
            }
            out.push_str(&format!("{k}:\n"));
            let mut entries: Vec<(&String, &Value)> = m.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            for (mk, mv) in entries {
                if let Some(ms) = mv.as_str() {
                    out.push_str(&format!("  {}: {}\n", quote_yaml(mk), quote_yaml(ms)));
                }
            }
        }
        Value::Array(arr) if !arr.is_empty() => {
            out.push_str(&format!("{k}:\n"));
            for item in arr {
                if let Some(s) = item.as_str() {
                    out.push_str(&format!("  - {}\n", quote_yaml(s)));
                }
            }
        }
        _ => {}
    }
}

/// Validates skill fields before any filesystem mutation (rename or write).
pub fn validate_skill_inputs(
    name: &str,
    description: &str,
    extra: &Map<String, Value>,
) -> Result<(), String> {
    validate_name(name)?;
    let desc = description.trim();
    if desc.is_empty() {
        return Err("Description is required".into());
    }
    if desc.chars().count() > 1024 {
        return Err("Description must be at most 1,024 characters".into());
    }
    if let Some(comp) = extra.get("compatibility") {
        if let Some(s) = comp.as_str() {
            let n = s.trim().chars().count();
            if n > 500 {
                return Err("Compatibility must be 1–500 characters".into());
            }
        }
    }
    Ok(())
}

/// Validates and writes `<root>/<name>/SKILL.md` atomically.
pub fn write_skill(
    root: &Path,
    name: &str,
    description: &str,
    body: &str,
    extra: &Map<String, Value>,
) -> Result<PathBuf, String> {
    validate_skill_inputs(name, description, extra)?;
    let desc = description.trim();
    ensure_dir(root).map_err(|e| e.to_string())?;
    let dir = root.join(name);
    ensure_dir(&dir).map_err(|e| e.to_string())?;
    let content = format_skill_md(name, desc, body, extra);
    let dst = dir.join("SKILL.md");
    crate::paths::write_private(&dst, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Saves a skill from Settings: validates everything BEFORE renaming, and refuses overwriting an
/// existing skill when `create_new` is true.
pub fn save_skill_checked(
    root: &Path,
    name: &str,
    description: &str,
    body: &str,
    extra: &Map<String, Value>,
    rename_from: Option<&str>,
    create_new: bool,
) -> Result<PathBuf, String> {
    validate_skill_inputs(name, description, extra)?;
    if create_new && root.join(name).exists() {
        return Err("A skill with that name already exists".into());
    }
    if let Some(from) = rename_from.filter(|f| !f.is_empty() && *f != name) {
        rename_skill(root, from, name)?;
    }
    write_skill(root, name, description, body, extra)
}

/// Saves a skill from MCP `save_skill`: refuses to overwrite an existing skill unless `replace` is true
/// (telling the brain to ask the user via `ask_user` first), and preserves existing extra frontmatter.
pub fn save_skill_from_mcp(
    root: &Path,
    name: &str,
    description: &str,
    body: &str,
    replace: bool,
) -> Result<PathBuf, String> {
    validate_skill_inputs(name, description, &Map::new())?;
    let dir = root.join(name);
    let mut merged_extra = Map::new();
    if dir.exists() {
        if !replace {
            return Err(format!(
                "Skill '{name}' already exists. Ask the user via ask_user before overwriting it, then call save_skill with replace: true."
            ));
        }
        if let Ok(raw) = std::fs::read_to_string(dir.join("SKILL.md")) {
            let existing = parse_skill(&dir, &raw);
            merged_extra = existing.extra;
        }
    }
    write_skill(root, name, description, body, &merged_extra)
}

/// Renames a skill folder and updates `name:` in `SKILL.md`, refusing an existing target.
pub fn rename_skill(root: &Path, from: &str, to: &str) -> Result<(), String> {
    validate_name(from)?;
    validate_name(to)?;
    if from == to {
        return Ok(());
    }
    let src_dir = root.join(from);
    let dst_dir = root.join(to);
    if !src_dir.is_dir() {
        return Err(format!("Skill '{from}' not found"));
    }
    if dst_dir.exists() {
        return Err(format!("A skill named '{to}' already exists"));
    }
    let raw = std::fs::read_to_string(src_dir.join("SKILL.md")).map_err(|e| e.to_string())?;
    let parsed = parse_skill(&src_dir, &raw);
    std::fs::rename(&src_dir, &dst_dir).map_err(|e| e.to_string())?;
    write_skill(root, to, &parsed.description, &parsed.body, &parsed.extra)?;
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    ensure_dir(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name();
        let name_s = name.to_string_lossy();
        if name_s == "__MACOSX" || name_s == ".DS_Store" {
            continue;
        }
        let from = entry.path();
        let meta = std::fs::symlink_metadata(&from).map_err(|e| e.to_string())?;
        // Skip all symlinks to prevent escaping the skill folder or recursing forever on `.`
        if meta.file_type().is_symlink() {
            continue;
        }
        let to = dst.join(&name);
        if meta.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if meta.is_file() {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn locate_skill_root(base: &Path) -> Result<PathBuf, String> {
    if base.join("SKILL.md").is_file() {
        return Ok(base.to_path_buf());
    }
    let dirs: Vec<PathBuf> = std::fs::read_dir(base)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| !n.starts_with('.') && n != "__MACOSX")
        })
        .collect();
    if dirs.len() == 1 && dirs[0].join("SKILL.md").is_file() {
        return Ok(dirs[0].clone());
    }
    Err("No valid SKILL.md found in archive or folder".into())
}

fn extract_source(src: &Path) -> Result<(PathBuf, Option<PathBuf>), String> {
    const MAX_SKILL_ZIP_BYTES: u64 = 16 << 20;
    const MAX_SKILL_UNPACKED_BYTES: u64 = 32 << 20;
    const MAX_SKILL_ENTRIES: usize = 300;
    if src.is_dir() {
        return Ok((locate_skill_root(src)?, None));
    }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if ext != "zip" && ext != "skill" {
        return Err("Pick a skill folder, .zip, or .skill file".into());
    }
    let file = std::fs::File::open(src).map_err(|e| format!("Could not open skill archive: {e}"))?;
    let size = file.metadata().map(|m| m.len()).unwrap_or(MAX_SKILL_ZIP_BYTES + 1);
    if size > MAX_SKILL_ZIP_BYTES {
        return Err("Skill archive is too large (max 16 MB)".into());
    }
    let tmp = std::env::temp_dir().join(format!(
        "sympony-skill-import-{}-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        TMP_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    crate::paths::ensure_private_dir(&tmp).map_err(|e| e.to_string())?;
    let allowed = |name: &str| !name.is_empty() && !name.starts_with('/') && !name.contains('\\') && !name.split('/').any(|s| s == "..");
    if let Err(e) = crate::backup::safe_extract_zip(file, &tmp, MAX_SKILL_ENTRIES, MAX_SKILL_UNPACKED_BYTES, &allowed) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(format!("Could not extract skill archive: {e}"));
    }
    match locate_skill_root(&tmp) {
        Ok(skill_dir) => Ok((skill_dir, Some(tmp))),
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            Err(e)
        }
    }
}

/// Validates an import source (folder, `.zip`, or `.skill`) and returns its declared skill name.
pub fn inspect_import_skill(src: &Path) -> Result<String, String> {
    let (skill_dir, cleanup) = extract_source(src)?;
    let res = (|| {
        let raw = std::fs::read_to_string(skill_dir.join("SKILL.md"))
            .map_err(|_| "Missing or unreadable SKILL.md".to_string())?;
        let parsed = parse_skill(&skill_dir, &raw);
        // If extracted from a zip root, folder name is temp dir; validate against declared name instead
        let virtual_dir = PathBuf::from(&parsed.name);
        let check = parse_skill(&virtual_dir, &raw);
        if !check.valid() {
            return Err(check.problems.join("; "));
        }
        Ok(check.name)
    })();
    if let Some(tmp) = cleanup {
        let _ = std::fs::remove_dir_all(tmp);
    }
    res
}

/// Imports a skill from a folder, `.zip`, or `.skill` file into `root`, validating first.
/// On a name clash without `replace`, picks `<name>-2`, `<name>-3`, etc. and rewrites `name:`.
pub fn import_skill(root: &Path, src: &Path, replace: bool) -> Result<String, String> {
    let (skill_dir, cleanup) = extract_source(src)?;
    let res = (|| {
        let raw = std::fs::read_to_string(skill_dir.join("SKILL.md"))
            .map_err(|_| "Missing or unreadable SKILL.md".to_string())?;
        let initial = parse_skill(&skill_dir, &raw);
        let virtual_dir = PathBuf::from(&initial.name);
        let parsed = parse_skill(&virtual_dir, &raw);
        if !parsed.valid() {
            return Err(parsed.problems.join("; "));
        }
        ensure_dir(root).map_err(|e| e.to_string())?;
        let mut final_name = parsed.name.clone();
        let replacing = root.join(&final_name).exists() && replace;
        if root.join(&final_name).exists() && !replace {
            let mut n = 2u32;
            loop {
                let suffix = format!("-{n}");
                let max_base = 64usize.saturating_sub(suffix.len());
                let base: String = parsed.name.chars().take(max_base).collect();
                let base = base.trim_end_matches('-');
                let cand = format!("{base}{suffix}");
                if validate_name(&cand).is_ok() && !root.join(&cand).exists() {
                    final_name = cand;
                    break;
                }
                n += 1;
                if n > 999 {
                    return Err("Could not pick a unique skill name".into());
                }
            }
        }
        let dst = root.join(&final_name);
        // Copy into a hidden temp sibling first, then rename into place so an existing skill is never lost on failure
        let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let stage = root.join(format!(".import-{final_name}-{}-{seq}", std::process::id()));
        if let Err(e) = copy_dir_recursive(&skill_dir, &stage) {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(e);
        }
        if replacing {
            let backup = root.join(format!(".replace-old-{final_name}-{}-{seq}", std::process::id()));
            if let Err(e) = std::fs::rename(&dst, &backup) {
                let _ = std::fs::remove_dir_all(&stage);
                return Err(e.to_string());
            }
            if let Err(e) = std::fs::rename(&stage, &dst) {
                let _ = std::fs::rename(&backup, &dst);
                let _ = std::fs::remove_dir_all(&stage);
                return Err(e.to_string());
            }
            let _ = std::fs::remove_dir_all(&backup);
        } else if let Err(e) = std::fs::rename(&stage, &dst) {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(e.to_string());
        }
        if final_name != parsed.name {
            write_skill(root, &final_name, &parsed.description, &parsed.body, &parsed.extra)?;
        }
        Ok(final_name)
    })();
    if let Some(tmp) = cleanup {
        let _ = std::fs::remove_dir_all(tmp);
    }
    res
}

/// Exports `<root>/<name>` as a zip archive at `dest_zip`, the folder under its own name (as `ditto --keepParent`
/// did), written in Rust on every OS. A file already at `dest_zip` (the save dialog asked first) is replaced only
/// once the new one is whole; when it fails, it's left as it was.
pub fn export_skill(root: &Path, name: &str, dest_zip: &Path) -> Result<(), String> {
    validate_name(name)?;
    let dir = root.join(name);
    if !dir.is_dir() {
        return Err(format!("Skill '{name}' not found"));
    }
    let parent = dest_zip.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let _ = std::fs::create_dir_all(parent);
    let part = parent.join(format!(".{name}-export-{}-{}.part", std::process::id(), TMP_SEQ.fetch_add(1, Ordering::Relaxed)));
    crate::archive::zip_items(&part, &[dir]).map_err(|e| format!("Could not export skill: {e}"))?;
    std::fs::rename(&part, dest_zip).map_err(|e| {
        let _ = std::fs::remove_file(&part);
        format!("Could not export skill: {e}")
    })
}

/// Writes any missing built-in skills into `root`, never overwriting existing folders.
pub fn restore_builtins(root: &Path) -> std::io::Result<Vec<String>> {
    ensure_dir(root)?;
    let mut restored = Vec::new();
    for (name, content) in BUILTIN_FILES {
        let dir = root.join(name);
        if !dir.exists() {
            ensure_dir(&dir)?;
            std::fs::write(dir.join("SKILL.md"), content)?;
            restored.push(name.to_string());
        }
    }
    Ok(restored)
}

/// Seeds built-in skills once per user home, tracked by `<pony_home>/.builtins-v1`, so deleted
/// built-ins stay deleted across launches while Settings "Restore built-ins" can still force it.
pub fn seed_builtins_once(pony_home: &Path) -> std::io::Result<Vec<String>> {
    ensure_dir(pony_home)?;
    let marker = pony_home.join(BUILTINS_MARKER);
    if marker.exists() {
        return Ok(vec![]);
    }
    let restored = restore_builtins(&pony_home.join("skills"))?;
    std::fs::write(&marker, "1\n")?;
    Ok(restored)
}

// ================================================================== Memory (`~/.sympony/memory.json`)

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fact {
    pub id: String,
    pub text: String,
    pub at: i64,
    /// "learned": Pony saved it on its own after a chat (crate::learn), not because the user asked
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
}

fn base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize] as char);
        n /= 36;
    }
    out.into_iter().rev().collect()
}

fn write_facts_atomic(path: &Path, list: &[Fact]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        ensure_dir(parent).map_err(|e| e.to_string())?;
    }
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("memory.json");
    let tmp = path.with_file_name(format!(".{fname}.tmp-{}-{seq}", std::process::id()));
    let body = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, format!("{body}\n")).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

fn facts_unlocked(path: &Path) -> Vec<Fact> {
    let Ok(bytes) = std::fs::read(path) else {
        return vec![];
    };
    if bytes.iter().all(|b| b.is_ascii_whitespace()) {
        return vec![];
    }
    match serde_json::from_slice::<Vec<Fact>>(&bytes) {
        Ok(list) => list,
        Err(_) => {
            let mut bad_name = path.as_os_str().to_os_string();
            bad_name.push(".bad");
            let _ = std::fs::rename(path, PathBuf::from(bad_name));
            vec![]
        }
    }
}

/// Reads facts from `path`. A corrupt JSON file is set aside as `<path>.bad` and an empty list is returned.
pub fn facts(path: &Path) -> Vec<Fact> {
    let _guard = MEMORY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    facts_unlocked(path)
}

/// Appends a remembered fact (trimmed, 1..=300 chars), keeping at most 100 newest facts.
/// Returns the saved fact plus the dropped oldest fact when the 100-fact cap was exceeded.
pub fn remember_with_drop(path: &Path, text: &str, now_ms: i64) -> Result<(Fact, Option<Fact>), String> {
    remember_by(path, text, now_ms, None)
}

/// As `remember_with_drop`, marking who saved it (`Some("learned")`).
pub fn remember_by(path: &Path, text: &str, now_ms: i64, by: Option<&str>) -> Result<(Fact, Option<Fact>), String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Err("Fact text cannot be empty".into());
    }
    if clean.chars().count() > MAX_FACT_CHARS {
        return Err(format!("Fact text must be at most {MAX_FACT_CHARS} characters"));
    }
    let _guard = MEMORY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = facts_unlocked(path);
    let base = format!("m{}", base36(now_ms.max(0) as u64));
    let mut id = base.clone();
    let mut n = 1u32;
    while list.iter().any(|f| f.id == id) {
        id = format!("{base}{n}");
        n += 1;
    }
    let fact = Fact {
        id,
        text: clean.to_string(),
        at: now_ms,
        by: by.map(String::from),
    };
    list.push(fact.clone());
    let dropped = if list.len() > MAX_FACTS {
        let drop_n = list.len() - MAX_FACTS;
        let drained: Vec<Fact> = list.drain(..drop_n).collect();
        drained.into_iter().next()
    } else {
        None
    };
    write_facts_atomic(path, &list)?;
    Ok((fact, dropped))
}

/// Appends a remembered fact (trimmed, 1..=300 chars), keeping at most 100 newest facts.
pub fn remember(path: &Path, text: &str, now_ms: i64) -> Result<Fact, String> {
    remember_with_drop(path, text, now_ms).map(|(f, _)| f)
}

/// Updates an existing fact's text in place, preserving its id and timestamp.
pub fn edit_fact(path: &Path, id: &str, text: &str) -> Result<(), String> {
    let clean = text.trim();
    if clean.is_empty() {
        return Err("Fact text cannot be empty".into());
    }
    if clean.chars().count() > MAX_FACT_CHARS {
        return Err(format!("Fact text must be at most {MAX_FACT_CHARS} characters"));
    }
    let _guard = MEMORY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = facts_unlocked(path);
    let Some(f) = list.iter_mut().find(|f| f.id == id) else {
        return Err(format!("Memory fact '{id}' not found"));
    };
    f.text = clean.to_string();
    write_facts_atomic(path, &list)
}

/// Removes a fact by id. Returns `true` if a fact was removed.
pub fn forget(path: &Path, id: &str) -> bool {
    let _guard = MEMORY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut list = facts_unlocked(path);
    let before = list.len();
    list.retain(|f| f.id != id);
    if list.len() == before {
        return false;
    }
    let _ = write_facts_atomic(path, &list);
    true
}

/// Clears all stored memory facts.
pub fn forget_all(path: &Path) {
    let _guard = MEMORY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let _ = write_facts_atomic(path, &[]);
}

/// Formats stored facts as a system-prompt section (`[id] text` per line); empty → `""`.
pub fn facts_block(list: &[Fact]) -> String {
    if list.is_empty() {
        return String::new();
    }
    let mut out = String::from("Remembered facts about the user (use forget(id) if asked to remove one):");
    for f in list {
        out.push_str(&format!("\n[{}] {}", f.id, f.text));
    }
    out
}
