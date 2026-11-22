//! User dictionary (`~/.sympony/dictionary.json`): terms, replacements, CSV/TXT import/export.
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const MAX_ENTRIES: usize = 5_000;

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserTerm {
    pub text: String,
    #[serde(default)]
    pub prompt: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Replacement {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserDict {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub terms: Vec<UserTerm>,
    #[serde(default)]
    pub replacements: Vec<Replacement>,
}

impl Default for UserDict {
    fn default() -> Self {
        Self {
            version: 1,
            terms: Vec::new(),
            replacements: Vec::new(),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportReport {
    pub added_terms: usize,
    pub added_replacements: usize,
    pub skipped: usize,
    pub rejected_full: usize,
}

impl UserDict {
    /// Load from JSON; if corrupt, rename aside to `<path>.bad` and return an empty dictionary.
    pub fn load(path: &Path) -> UserDict {
        if !path.exists() {
            return UserDict::default();
        }
        let Ok(raw) = fs::read_to_string(path) else {
            rename_aside_bad(path);
            return UserDict::default();
        };
        match serde_json::from_str::<UserDict>(&raw) {
            Ok(mut dict) => {
                if dict.version == 0 {
                    dict.version = 1;
                }
                dict.terms.truncate(MAX_ENTRIES);
                dict.replacements.truncate(MAX_ENTRIES);
                dict
            }
            Err(_) => {
                rename_aside_bad(path);
                UserDict::default()
            }
        }
    }

    /// Save atomically (write `.tmp` then rename).
    pub fn save(&self, path: &Path) -> io::Result<()> {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        let mut tmp = OsString::from(path.as_os_str());
        tmp.push(".tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Add a term. Returns `Ok(true)` if added, `Ok(false)` if already present (case-insensitive),
    /// or `Err` if empty or at the 5,000-entry limit.
    pub fn add_term(&mut self, term: UserTerm) -> Result<bool, &'static str> {
        let text = term.text.trim().to_string();
        if text.is_empty() {
            return Err("empty term");
        }
        let low = text.to_lowercase();
        if self.terms.iter().any(|t| t.text.to_lowercase() == low) {
            return Ok(false);
        }
        if self.terms.len() >= MAX_ENTRIES {
            return Err("term limit reached (5000)");
        }
        self.terms.push(UserTerm {
            text,
            prompt: term.prompt,
        });
        Ok(true)
    }

    /// Add a replacement. Returns `Ok(true)` if added, `Ok(false)` if `from` already exists (case-insensitive),
    /// or `Err` if empty or at the 5,000-entry limit.
    pub fn add_replacement(&mut self, rep: Replacement) -> Result<bool, &'static str> {
        let from = rep.from.trim().to_string();
        let to = rep.to.trim().to_string();
        if from.is_empty() || to.is_empty() {
            return Err("empty replacement");
        }
        let low = from.to_lowercase();
        if self
            .replacements
            .iter()
            .any(|r| r.from.to_lowercase() == low)
        {
            return Ok(false);
        }
        if self.replacements.len() >= MAX_ENTRIES {
            return Err("replacement limit reached (5000)");
        }
        self.replacements.push(Replacement { from, to });
        Ok(true)
    }

    /// Import CSV with columns `type,text,to,prompt`. Merges and skips duplicates.
    pub fn import_csv(&mut self, text: &str) -> ImportReport {
        let mut rep = ImportReport::default();
        for (idx, line) in text.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let cols = parse_csv_row(trimmed);
            if cols.is_empty() {
                continue;
            }
            let kind = cols[0].trim().to_lowercase();
            if idx == 0 && kind == "type" {
                continue;
            }
            let col_text = cols.get(1).map(|s| s.trim()).unwrap_or("");
            let col_to = cols.get(2).map(|s| s.trim()).unwrap_or("");
            let col_prompt = cols.get(3).map(|s| s.trim().to_lowercase()).unwrap_or_default();

            match kind.as_str() {
                "term" => {
                    let prompt = matches!(col_prompt.as_str(), "true" | "1" | "yes");
                    match self.add_term(UserTerm {
                        text: col_text.to_string(),
                        prompt,
                    }) {
                        Ok(true) => rep.added_terms += 1,
                        Ok(false) => rep.skipped += 1,
                        Err("term limit reached (5000)") => rep.rejected_full += 1,
                        Err(_) => rep.skipped += 1,
                    }
                }
                "replacement" => match self.add_replacement(Replacement {
                    from: col_text.to_string(),
                    to: col_to.to_string(),
                }) {
                    Ok(true) => rep.added_replacements += 1,
                    Ok(false) => rep.skipped += 1,
                    Err("replacement limit reached (5000)") => rep.rejected_full += 1,
                    Err(_) => rep.skipped += 1,
                },
                _ => rep.skipped += 1,
            }
        }
        rep
    }

    /// Import plain text (one term per line). Merges and skips duplicates.
    pub fn import_txt(&mut self, text: &str) -> ImportReport {
        let mut rep = ImportReport::default();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            match self.add_term(UserTerm {
                text: trimmed.to_string(),
                prompt: false,
            }) {
                Ok(true) => rep.added_terms += 1,
                Ok(false) => rep.skipped += 1,
                Err("term limit reached (5000)") => rep.rejected_full += 1,
                Err(_) => rep.skipped += 1,
            }
        }
        rep
    }

    /// Export to CSV with columns `type,text,to,prompt`.
    pub fn export_csv(&self) -> String {
        let mut out = String::from("type,text,to,prompt\n");
        for t in &self.terms {
            out.push_str("term,");
            out.push_str(&csv_escape(&t.text));
            out.push_str(",,");
            out.push_str(if t.prompt { "true" } else { "false" });
            out.push('\n');
        }
        for r in &self.replacements {
            out.push_str("replacement,");
            out.push_str(&csv_escape(&r.from));
            out.push(',');
            out.push_str(&csv_escape(&r.to));
            out.push_str(",\n");
        }
        out
    }
}

fn rename_aside_bad(path: &Path) {
    let mut bad = OsString::from(path.as_os_str());
    bad.push(".bad");
    let _ = fs::rename(path, bad);
}

fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        let mut out = String::with_capacity(s.len() + 2);
        out.push('"');
        for ch in s.chars() {
            if ch == '"' {
                out.push('"');
            }
            out.push(ch);
        }
        out.push('"');
        out
    } else {
        s.to_string()
    }
}

fn parse_csv_row(line: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut cur = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cur.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(ch);
            }
        } else if ch == '"' && cur.is_empty() {
            in_quotes = true;
        } else if ch == ',' {
            cols.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    cols.push(cur);
    cols
}
