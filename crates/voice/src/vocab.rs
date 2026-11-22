//! Built-in vocabulary and dictionary loader (runtime resource files under `voice/data/`).
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Category {
    Loanword,
    Brand,
    PlaceId,
    Institution,
    Unit,
    WorldName,
    Calendar,
    User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Term {
    pub text: String,
    pub category: Category,
}

#[derive(Debug, Default, Clone)]
pub struct Vocab {
    pub core: Vec<String>,
    pub lexicon: Vec<Term>,
    pub abbrev: HashMap<String, String>,
    pub id_words: HashSet<String>,
    pub en_words: HashSet<String>,
    pub di_bases: HashSet<String>,
    pub missing: Vec<String>,
    di_forms: HashMap<String, u8>,
    loan_single_words: HashSet<String>,
}

const DI_FORM_ZERO: u8 = 1;
const DI_FORM_KAN: u8 = 2;
const DI_FORM_I: u8 = 4;

impl Vocab {
    /// Lightweight check for missing bundled resource files without reading/parsing them into memory.
    pub fn check_missing(dir: &Path) -> Vec<String> {
        let vocab_dir = dir.join("vocab");
        let dict_dir = dir.join("dict");
        let mut missing = Vec::new();
        for f in [
            "core_priority.txt",
            "brands_apps.txt",
            "loanwords_work.txt",
            "places_id.txt",
            "units_symbols.txt",
            "calendar_id.txt",
            "world_proper_nouns.txt",
            "institutions_id.tsv",
            "id_verb_bases_di.txt",
        ] {
            if !vocab_dir.join(f).is_file() {
                missing.push(f.into());
            }
        }
        for f in ["id_ID.dic", "en_words.txt"] {
            if !dict_dir.join(f).is_file() {
                missing.push(f.into());
            }
        }
        missing
    }

    /// Load built-in vocabulary and dictionaries from `dir` (containing `vocab/` and `dict/`).
    /// Never fails: any unreadable file is recorded by basename in `missing`.
    pub fn load(dir: &Path) -> Vocab {
        let mut v = Vocab::default();
        let vocab_dir = dir.join("vocab");
        let dict_dir = dir.join("dict");

        // 1. Core priority list (preserve exact file order).
        if let Some(lines) = read_non_comment_lines(&vocab_dir.join("core_priority.txt")) {
            let mut seen_core = HashSet::new();
            for line in lines {
                let low = line.to_lowercase();
                if seen_core.insert(low) {
                    v.core.push(line);
                }
            }
        } else {
            v.missing.push("core_priority.txt".into());
        }

        // 2. Category lexicons (deduped case-insensitively across categories).
        let mut seen_lex = HashSet::new();
        let simple_files: &[(&str, Category)] = &[
            ("brands_apps.txt", Category::Brand),
            ("loanwords_work.txt", Category::Loanword),
            ("places_id.txt", Category::PlaceId),
            ("units_symbols.txt", Category::Unit),
            ("calendar_id.txt", Category::Calendar),
            ("world_proper_nouns.txt", Category::WorldName),
        ];

        for &(file, cat) in simple_files {
            if let Some(lines) = read_non_comment_lines(&vocab_dir.join(file)) {
                for line in lines {
                    let low = line.to_lowercase();
                    if seen_lex.insert(low) {
                        v.lexicon.push(Term { text: line, category: cat });
                    }
                }
            } else {
                v.missing.push(file.into());
            }
        }

        // Institutions TSV: ABBREV<TAB>Expansion.
        if let Some(lines) = read_non_comment_lines(&vocab_dir.join("institutions_id.tsv")) {
            for line in lines {
                let mut parts = line.splitn(2, '\t');
                let abbr = parts.next().unwrap_or("").trim();
                let exp = parts.next().unwrap_or("").trim();
                if abbr.is_empty() {
                    continue;
                }
                if !exp.is_empty() {
                    v.abbrev.entry(abbr.to_string()).or_insert_with(|| exp.to_string());
                }
                let low = abbr.to_lowercase();
                if seen_lex.insert(low) {
                    v.lexicon.push(Term {
                        text: abbr.to_string(),
                        category: Category::Institution,
                    });
                }
            }
        } else {
            v.missing.push("institutions_id.tsv".into());
        }

        // Ensure core priority terms are also present in the lexicon (as Loanword if not already listed).
        for term in &v.core {
            let low = term.to_lowercase();
            if seen_lex.insert(low) {
                v.lexicon.push(Term {
                    text: term.clone(),
                    category: Category::Loanword,
                });
            }
        }

        // 3. Indonesian passive di- verb bases (`<stem>\t<forms>` where forms ⊆ {0, kan, i}).
        if let Some(lines) = read_non_comment_lines(&vocab_dir.join("id_verb_bases_di.txt")) {
            for line in lines {
                let mut parts = line.splitn(2, '\t');
                let stem = parts.next().unwrap_or("").trim().to_lowercase();
                if stem.is_empty() {
                    continue;
                }
                let forms_str = parts.next().unwrap_or("0");
                let mut mask = 0u8;
                for f in forms_str.split(',') {
                    match f.trim() {
                        "0" => mask |= DI_FORM_ZERO,
                        "kan" => mask |= DI_FORM_KAN,
                        "i" => mask |= DI_FORM_I,
                        _ => {}
                    }
                }
                if mask == 0 {
                    mask = DI_FORM_ZERO;
                }
                v.di_bases.insert(stem.clone());
                *v.di_forms.entry(stem).or_insert(0) |= mask;
            }
        } else {
            v.missing.push("id_verb_bases_di.txt".into());
        }

        // 4. Hunspell Indonesian stems (skip line 0 count, split on '/').
        if let Ok(raw) = fs::read_to_string(dict_dir.join("id_ID.dic")) {
            for line in raw.lines().skip(1) {
                let stem = line.split('/').next().unwrap_or("").trim().to_lowercase();
                if !stem.is_empty() {
                    v.id_words.insert(stem);
                }
            }
        } else {
            v.missing.push("id_ID.dic".into());
        }

        // 5. English SCOWL size-50 word list.
        if let Some(lines) = read_non_comment_lines(&dict_dir.join("en_words.txt")) {
            for line in lines {
                let w = line.to_lowercase();
                if w.chars().count() > 2 {
                    v.en_words.insert(w);
                }
            }
        } else {
            v.missing.push("en_words.txt".into());
        }

        // 6. Precompute single-word loan/brand terms (excluding native Indonesian stems) for -nya hyphenation.
        for t in &v.lexicon {
            if matches!(t.category, Category::Loanword | Category::Brand)
                && !t.text.contains(char::is_whitespace)
            {
                let low = t.text.to_lowercase();
                if low.chars().all(|c| c.is_ascii_alphabetic()) && !v.id_words.contains(&low) {
                    v.loan_single_words.insert(low);
                }
            }
        }

        v
    }

    /// True if `word` (the token immediately following standalone `"di"`) is a valid passive `di-` verb form.
    pub fn di_derivable(&self, word: &str) -> bool {
        let mut low = word.to_lowercase();
        for clitic in ["nya", "lah", "kah", "pun"] {
            if let Some(stripped) = low.strip_suffix(clitic) {
                if stripped.len() >= 3 {
                    low = stripped.to_string();
                    break;
                }
            }
        }
        if let Some(&mask) = self.di_forms.get(&low) {
            if (mask & DI_FORM_ZERO) != 0 {
                return true;
            }
        }
        if let Some(stem) = low.strip_suffix("kan") {
            if let Some(&mask) = self.di_forms.get(stem) {
                if (mask & DI_FORM_KAN) != 0 {
                    return true;
                }
            }
        }
        if let Some(stem) = low.strip_suffix('i') {
            if let Some(&mask) = self.di_forms.get(stem) {
                if (mask & DI_FORM_I) != 0 {
                    return true;
                }
            }
        }
        false
    }

    /// True if `word` (lowercase ASCII) is a known single-word loanword or brand not in `id_words`.
    pub fn is_loan_word(&self, word: &str) -> bool {
        self.loan_single_words.contains(&word.to_lowercase())
    }
}

fn read_non_comment_lines(path: &Path) -> Option<Vec<String>> {
    let raw = fs::read_to_string(path).ok()?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        out.push(trimmed.to_string());
    }
    Some(out)
}
