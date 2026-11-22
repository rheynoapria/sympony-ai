//! Phonetic lexicon post-correction with Indonesian/English dictionary guards and per-category thresholds.
use std::collections::{HashMap, HashSet};

use crate::vocab::{Category, Term, Vocab};

const MIN_KEY: usize = 5;
const MIN_KEY_UNIGRAM_BUILTIN: usize = 6;
const MAX_N: usize = 3;

const PREFIXES: &[&str] = &[
    "memper", "diper", "meny", "meng", "mem", "men", "me", "peny", "peng", "pem", "pen", "per",
    "ber", "ter", "di", "ke", "se",
];

const SUFFIXES: &[&str] = &["nya", "lah", "kah", "pun", "kan", "an", "i"];

fn men_map(pre: &str) -> Option<&'static str> {
    Some(match pre {
        "meny" | "peny" => "s",
        "mem" | "pem" => "p",
        "men" | "pen" => "t",
        "meng" | "peng" => "k",
        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Correction {
    pub from: String,
    pub to: String,
    pub category: Category,
}

/// Per-category normalized edit-distance threshold over phonetic keys.
pub fn theta(c: Category) -> f32 {
    match c {
        Category::Loanword | Category::Brand | Category::User => 0.2,
        Category::WorldName | Category::PlaceId => 0.12,
        Category::Institution | Category::Unit | Category::Calendar => 0.0,
    }
}

/// Phonetic key for Indonesian + English loanword matching (single-pass, allocation-lean).
pub fn phonetic_key(s: &str) -> String {
    let lower: Vec<char> = s
        .chars()
        .filter(|c| c.is_alphabetic())
        .flat_map(|c| c.to_lowercase())
        .collect();
    let n = lower.len();
    let mut out = String::with_capacity(n);
    let mut prev: Option<char> = None;
    let mut push_dedup = |ch: char| {
        if prev != Some(ch) {
            out.push(ch);
            prev = Some(ch);
        }
    };

    let mut i = 0;
    while i < n {
        let c0 = lower[i];
        let c1 = lower.get(i + 1).copied();
        let c2 = lower.get(i + 2).copied();

        // 3-char clusters first (preserve DIGRAPHS priority: "sch" -> "sk", "ngk" -> "nk").
        if c0 == 's' && c1 == Some('c') && c2 == Some('h') {
            push_dedup('s');
            push_dedup('k');
            i += 3;
            continue;
        }
        if c0 == 'n' && c1 == Some('g') && c2 == Some('k') {
            push_dedup('n');
            push_dedup('k');
            i += 3;
            continue;
        }

        // 2-char digraphs mapped directly through CHARS (`c->k, q->k, x->ks, v->f, z->s, y->i, h->""`).
        if let Some(n1) = c1 {
            let dig = match (c0, n1) {
                ('c', 'h') | ('t', 'j') | ('c', 'k') | ('k', 'h') => Some('k'),
                ('s', 'h') | ('s', 'y') => Some('s'),
                ('p', 'h') => Some('f'),
                ('t', 'h') => Some('t'),
                ('g', 'h') => Some('g'),
                ('d', 'h') => Some('d'),
                ('w', 'h') => Some('w'),
                ('o', 'o') | ('o', 'u') | ('o', 'e') => Some('u'),
                ('e', 'e') | ('e', 'a') | ('i', 'e') => Some('i'),
                ('o', 'i') => Some('o'),
                ('a', 'i') | ('a', 'y') => Some('e'),
                ('d', 'j') => Some('j'),
                _ => None,
            };
            if let Some(mapped) = dig {
                push_dedup(mapped);
                i += 2;
                continue;
            }
        }

        // Single-char mapping.
        match c0 {
            'c' | 'q' => push_dedup('k'),
            'x' => {
                push_dedup('k');
                push_dedup('s');
            }
            'v' => push_dedup('f'),
            'z' => push_dedup('s'),
            'y' => push_dedup('i'),
            'h' => {}
            other => push_dedup(other),
        }
        i += 1;
    }
    out
}

fn lev_chars(a: &[char], b: &[char], cap: usize) -> usize {
    if a.len().abs_diff(b.len()) > cap {
        return cap + 1;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, &x) in a.iter().enumerate() {
        cur[0] = i + 1;
        let mut lo = cur[0];
        for (j, &y) in b.iter().enumerate() {
            let cost = usize::from(x != y);
            let v = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
            cur[j + 1] = v;
            if v < lo {
                lo = v;
            }
        }
        if lo > cap {
            return cap + 1;
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

fn alnum_lower_chars(s: &str) -> Vec<char> {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub fn is_dict_word(word: &str, v: &Vocab) -> bool {
    let w = word.to_lowercase();
    let w = w.trim_matches(|c| c == '\'' || c == '’');
    if w.is_empty() || w.chars().any(|c| c.is_ascii_digit()) {
        return true;
    }
    if w.chars().count() < 2 {
        return false;
    }
    if !w.chars().all(|c| c.is_alphabetic()) {
        let normalized = w.replace('’', "'");
        let parts: Vec<&str> = normalized.split('-').filter(|p| !p.is_empty()).collect();
        return !parts.is_empty()
            && parts
                .iter()
                .all(|p| p.chars().all(|c| c.is_alphabetic()) && is_dict_word(p, v));
    }
    if v.id_words.contains(w) || v.en_words.contains(w) {
        return true;
    }
    let mut cands: HashSet<String> = HashSet::new();
    cands.insert(w.to_string());
    for _ in 0..2 {
        let mut nxt: HashSet<String> = HashSet::new();
        for c in &cands {
            for &suf in SUFFIXES {
                if let Some(stem) = c.strip_suffix(suf) {
                    if stem.chars().count() >= 3 {
                        if v.id_words.contains(stem) {
                            return true;
                        }
                        nxt.insert(stem.to_string());
                    }
                }
            }
            for &pre in PREFIXES {
                if let Some(rest) = c.strip_prefix(pre) {
                    if rest.chars().count() >= 3 {
                        if v.id_words.contains(rest) {
                            return true;
                        }
                        nxt.insert(rest.to_string());
                        if let Some(rep) = men_map(pre) {
                            let alt = format!("{rep}{rest}");
                            if v.id_words.contains(&alt) {
                                return true;
                            }
                            nxt.insert(alt);
                        }
                    }
                }
            }
        }
        cands = nxt;
    }
    false
}

struct IndexedTerm {
    text: String,
    lower: String,
    alnum: Vec<char>,
    category: Category,
    key_chars: Vec<char>,
    word_keys: Vec<Vec<char>>,
    cap: usize,
    rank: usize,
}

/// Reusable index for fast repeated post-correction (e.g. inside `Pipeline`).
pub struct PostcorrectIndex {
    terms: Vec<IndexedTerm>,
    exact_by_key: HashMap<String, Vec<usize>>,
    fuzzy_by_len: HashMap<usize, Vec<usize>>,
    exact_lower: HashSet<String>,
}

impl PostcorrectIndex {
    pub fn build(v: &Vocab, extra: &[Term]) -> Self {
        let mut terms = Vec::with_capacity(v.lexicon.len() + extra.len());
        let mut exact_by_key: HashMap<String, Vec<usize>> = HashMap::new();
        let mut fuzzy_by_len: HashMap<usize, Vec<usize>> = HashMap::new();
        let mut exact_lower: HashSet<String> = HashSet::new();
        let mut seen = HashSet::new();

        // User `extra` terms come first so they win duplicates and priority.
        for t in extra.iter().chain(v.lexicon.iter()) {
            let trimmed = t.text.trim();
            if trimmed.is_empty() {
                continue;
            }
            let lower = trimmed.to_lowercase();
            if !seen.insert(lower.clone()) {
                continue;
            }
            let k = phonetic_key(trimmed);
            let key_chars: Vec<char> = k.chars().collect();
            if key_chars.len() < MIN_KEY {
                continue;
            }
            let cap = (theta(t.category) * key_chars.len() as f32).floor() as usize;
            let word_keys: Vec<Vec<char>> = if trimmed.contains(char::is_whitespace) {
                trimmed
                    .split_whitespace()
                    .map(|w| phonetic_key(w).chars().collect())
                    .collect()
            } else {
                Vec::new()
            };
            let idx = terms.len();
            exact_lower.insert(lower.clone());
            exact_by_key.entry(k).or_default().push(idx);
            if cap >= 1 {
                fuzzy_by_len.entry(key_chars.len()).or_default().push(idx);
            }
            let alnum = if cap >= 1 {
                alnum_lower_chars(trimmed)
            } else {
                Vec::new()
            };
            terms.push(IndexedTerm {
                text: trimmed.to_string(),
                lower,
                alnum,
                category: t.category,
                key_chars,
                word_keys,
                cap,
                rank: idx,
            });
        }

        Self {
            terms,
            exact_by_key,
            fuzzy_by_len,
            exact_lower,
        }
    }

    fn multiword_tokens_within_theta(&self, core: &[&str], term: &IndexedTerm) -> bool {
        let m = term.word_keys.len();
        if m <= 1 {
            return true;
        }
        let n = core.len();
        let th = theta(term.category);
        let token_ok = |surf_key: &[char], tgt_key: &[char]| -> bool {
            let cap = (th * tgt_key.len() as f32).floor() as usize;
            lev_chars(surf_key, tgt_key, cap) <= cap
        };

        if n == m {
            return core.iter().zip(term.word_keys.iter()).all(|(&s, tk)| {
                let sk: Vec<char> = phonetic_key(s).chars().collect();
                token_ok(&sk, tk)
            });
        }
        // Only allow splitting when surface has 3 tokens and target has 2 tokens (e.g. ASR split one word).
        if n == 3 && m == 2 {
            let k0: Vec<char> = phonetic_key(core[0]).chars().collect();
            let k12: Vec<char> = phonetic_key(&format!("{}{}", core[1], core[2]))
                .chars()
                .collect();
            if token_ok(&k0, &term.word_keys[0]) && token_ok(&k12, &term.word_keys[1]) {
                return true;
            }
            let k01: Vec<char> = phonetic_key(&format!("{}{}", core[0], core[1]))
                .chars()
                .collect();
            let k2: Vec<char> = phonetic_key(core[2]).chars().collect();
            if token_ok(&k01, &term.word_keys[0]) && token_ok(&k2, &term.word_keys[1]) {
                return true;
            }
        }
        false
    }

    fn best_term(&self, core: &[&str], surface: &str, unigram: bool) -> Option<(&IndexedTerm, usize)> {
        let k_str = phonetic_key(surface);
        let k_chars: Vec<char> = k_str.chars().collect();
        if k_chars.len() < MIN_KEY - 1 {
            return None;
        }

        let surf_lower: Vec<char> = surface.to_lowercase().chars().collect();
        let surf_alnum = alnum_lower_chars(surface);
        let mut cands: Vec<(usize, usize, usize, &IndexedTerm)> = Vec::new();

        if unigram {
            // Single words require an identical phonetic key (d == 0).
            if let Some(indices) = self.exact_by_key.get(&k_str) {
                for &idx in indices {
                    let term = &self.terms[idx];
                    if term.word_keys.len() > 1 {
                        continue;
                    }
                    let min_len = if term.category == Category::User {
                        MIN_KEY
                    } else {
                        MIN_KEY_UNIGRAM_BUILTIN
                    };
                    if term.key_chars.len() < min_len {
                        continue;
                    }
                    let raw = lev_chars(&surf_lower, &term.lower.chars().collect::<Vec<_>>(), 99);
                    cands.push((0, raw, term.rank, term));
                }
            }
        } else {
            let mut seen_idx: HashSet<usize> = HashSet::new();

            // Exact-key matches (also covers theta == 0 categories like Institution).
            if let Some(indices) = self.exact_by_key.get(&k_str) {
                for &idx in indices {
                    let term = &self.terms[idx];
                    if !self.multiword_tokens_within_theta(core, term) {
                        continue;
                    }
                    seen_idx.insert(idx);
                    let raw = lev_chars(&surf_lower, &term.lower.chars().collect::<Vec<_>>(), 99);
                    cands.push((0, raw, term.rank, term));
                }
            }

            // Fuzzy matches within per-category theta.
            let lo = k_chars.len().saturating_sub(2);
            let hi = k_chars.len() + 2;
            for l in lo..=hi {
                if let Some(indices) = self.fuzzy_by_len.get(&l) {
                    for &idx in indices {
                        if seen_idx.contains(&idx) {
                            continue;
                        }
                        let term = &self.terms[idx];
                        let d = lev_chars(&k_chars, &term.key_chars, term.cap);
                        if d > term.cap {
                            continue;
                        }
                        if !self.multiword_tokens_within_theta(core, term) {
                            continue;
                        }
                        if d > 0 {
                            let max_alnum = surf_alnum.len().max(term.alnum.len());
                            let raw_alnum = lev_chars(&surf_alnum, &term.alnum, max_alnum / 2);
                            if raw_alnum * 2 > max_alnum {
                                continue;
                            }
                        }
                        let raw = lev_chars(&surf_lower, &term.lower.chars().collect::<Vec<_>>(), 99);
                        cands.push((d, raw, term.rank, term));
                    }
                }
            }
        }

        if cands.is_empty() {
            return None;
        }
        cands.sort_by_key(|&(d, raw, rank, _)| (d, raw, rank));
        let (d, raw, _, best) = cands[0];
        if cands.len() > 1
            && cands[1].0 == d
            && cands[1].1 == raw
            && cands[1].3.lower != best.lower
        {
            return None; // True tie: leave unchanged.
        }
        Some((best, d))
    }

    pub fn correct(&self, text: &str, v: &Vocab) -> (String, Vec<Correction>) {
        let toks: Vec<&str> = text.split_whitespace().collect();
        let mut out: Vec<String> = Vec::with_capacity(toks.len());
        let mut corrs: Vec<Correction> = Vec::new();
        let mut i = 0;

        while i < toks.len() {
            let mut done = false;
            for n in (1..=MAX_N).rev() {
                if i + n > toks.len() {
                    continue;
                }
                let grp = &toks[i..i + n];
                let mut core: Vec<&str> = grp
                    .iter()
                    .map(|g| g.trim_matches(|c| matches!(c, ',' | '.' | '?' | '!' | ';' | ':' | '"' | '(' | ')')))
                    .collect();
                if core.iter().any(|c| c.is_empty()) {
                    continue;
                }

                let first_g = grp[0];
                let lead_len = first_g.len() - first_g.trim_start_matches(|c| c == '"' || c == '(').len();
                let lead = &first_g[..lead_len];

                let last_g = grp[n - 1];
                let stripped_end = last_g
                    .trim_end_matches(|c| matches!(c, ',' | '.' | '?' | '!' | ';' | ':' | '"' | '(' | ')'));
                let trail = &last_g[stripped_end.len()..];

                let mut suffix = "";
                let last_core = core[n - 1];
                if last_core.to_lowercase().ends_with("nya")
                    && last_core.chars().count() > 6
                    && !is_dict_word(last_core, v)
                {
                    core[n - 1] = &last_core[..last_core.len() - 3];
                    suffix = "nya";
                }

                // Dictionary guard: at least one token must be out-of-dictionary.
                if core.iter().all(|c| is_dict_word(c, v)) {
                    continue;
                }
                if n > 1 && core.iter().any(|c| self.exact_lower.contains(&c.to_lowercase())) {
                    continue;
                }

                let surface = core.join(" ");
                let Some((term, _d)) = self.best_term(&core, &surface, n == 1) else {
                    continue;
                };
                if term.lower == surface.to_lowercase() {
                    continue;
                }

                let joiner = if !term.text.contains(' ') && !suffix.is_empty() {
                    "-"
                } else {
                    ""
                };
                let replacement = format!("{lead}{}{joiner}{suffix}{trail}", term.text);
                corrs.push(Correction {
                    from: surface,
                    to: term.text.clone(),
                    category: term.category,
                });
                out.push(replacement);
                i += n;
                done = true;
                break;
            }
            if !done {
                out.push(toks[i].to_string());
                i += 1;
            }
        }

        (out.join(" "), corrs)
    }
}

pub fn postcorrect(text: &str, v: &Vocab, extra: &[Term]) -> (String, Vec<Correction>) {
    let index = PostcorrectIndex::build(v, extra);
    index.correct(text, v)
}
