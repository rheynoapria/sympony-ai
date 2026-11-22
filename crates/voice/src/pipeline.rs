//! Full Indonesian post-processing pipeline: postcorrect -> normalize -> user replacements.
use std::collections::{HashMap, HashSet};

use crate::dictionary::UserDict;
use crate::normalize::{normalize, NormOptions};
use crate::postcorrect::{Correction, PostcorrectIndex};
use crate::vocab::{Category, Term, Vocab};

const CORE_PROMPT_LIMIT: usize = 50;

/// Build the engine prompt term list: user `prompt: true` terms first, then up to 50 built-in
/// core terms when `jargon` is enabled. Case-insensitively deduplicated and capped at `cap`.
pub fn prompt_terms(v: &Vocab, d: &UserDict, jargon: bool, cap: usize) -> Vec<String> {
    let mut out = Vec::with_capacity(cap.min(d.terms.len() + CORE_PROMPT_LIMIT));
    let mut seen = HashSet::new();

    for t in &d.terms {
        if !t.prompt {
            continue;
        }
        if out.len() >= cap {
            return out;
        }
        let trimmed = t.text.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_lowercase()) {
            out.push(trimmed.to_string());
        }
    }

    if jargon {
        for c in v.core.iter().take(CORE_PROMPT_LIMIT) {
            if out.len() >= cap {
                break;
            }
            let trimmed = c.trim();
            if trimmed.is_empty() {
                continue;
            }
            if seen.insert(trimmed.to_lowercase()) {
                out.push(trimmed.to_string());
            }
        }
    }

    out
}

#[derive(Debug)]
enum Span<'a> {
    Word(&'a str),
    Sep(&'a str),
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '-' | '\'' | '’')
}

fn split_spans(text: &str) -> Vec<Span<'_>> {
    let mut spans = Vec::new();
    let mut iter = text.char_indices().peekable();
    while let Some(&(start, ch)) = iter.peek() {
        let word = is_word_char(ch);
        let mut end = start + ch.len_utf8();
        iter.next();
        while let Some(&(idx, c)) = iter.peek() {
            if is_word_char(c) != word {
                break;
            }
            end = idx + c.len_utf8();
            iter.next();
        }
        let slice = &text[start..end];
        spans.push(if word { Span::Word(slice) } else { Span::Sep(slice) });
    }
    spans
}

fn phrase_words_lower(s: &str) -> Vec<String> {
    split_spans(s)
        .into_iter()
        .filter_map(|sp| match sp {
            Span::Word(w) => Some(w.to_lowercase()),
            Span::Sep(_) => None,
        })
        .collect()
}

/// Apply user replacements (whole word or phrase, case-insensitive). Longest phrase wins.
pub fn apply_replacements(text: &str, d: &UserDict) -> String {
    if d.replacements.is_empty() || text.is_empty() {
        return text.to_string();
    }

    let spans = split_spans(text);
    let mut text_words: HashSet<String> = HashSet::with_capacity(spans.len() / 2 + 1);
    for sp in &spans {
        if let Span::Word(w) = sp {
            text_words.insert(w.to_lowercase());
        }
    }
    if text_words.is_empty() {
        return text.to_string();
    }

    let mut by_first: HashMap<String, Vec<(Vec<String>, &str)>> = HashMap::new();
    for r in &d.replacements {
        let first_slice = r
            .from
            .trim_start_matches(|c: char| !is_word_char(c))
            .split(|c: char| !is_word_char(c))
            .next()
            .unwrap_or("");
        if first_slice.is_empty() {
            continue;
        }
        let first_low = first_slice.to_lowercase();
        if !text_words.contains(&first_low) {
            continue;
        }
        let words = phrase_words_lower(&r.from);
        if !words.is_empty() {
            by_first
                .entry(first_low)
                .or_default()
                .push((words, r.to.as_str()));
        }
    }
    if by_first.is_empty() {
        return text.to_string();
    }
    for list in by_first.values_mut() {
        if list.len() > 1 {
            list.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        }
    }

    let mut out = String::with_capacity(text.len());
    let mut i = 0;

    while i < spans.len() {
        match spans[i] {
            Span::Sep(s) => {
                out.push_str(s);
                i += 1;
            }
            Span::Word(w) => {
                let low = w.to_lowercase();
                let mut replaced = false;
                if let Some(cands) = by_first.get(&low) {
                    for (words, target) in cands {
                        let m = words.len();
                        let needed_spans = m * 2 - 1;
                        if i + needed_spans > spans.len() {
                            continue;
                        }
                        let mut ok = true;
                        for k in 1..m {
                            match spans[i + k * 2 - 1] {
                                Span::Sep(sep) if !sep.is_empty() && sep.chars().all(|c| c == ' ') => {}
                                _ => {
                                    ok = false;
                                    break;
                                }
                            }
                            match spans[i + k * 2] {
                                Span::Word(nw) if nw.to_lowercase() == words[k] => {}
                                _ => {
                                    ok = false;
                                    break;
                                }
                            }
                        }
                        if ok {
                            out.push_str(target);
                            i += needed_spans;
                            replaced = true;
                            break;
                        }
                    }
                }
                if !replaced {
                    out.push_str(w);
                    i += 1;
                }
            }
        }
    }

    out
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipelineOut {
    pub text: String,
    pub corrections: Vec<Correction>,
}

pub struct Pipeline<'a> {
    pub vocab: &'a Vocab,
    pub dict: &'a UserDict,
    pub norm: NormOptions,
}

impl<'a> Pipeline<'a> {
    /// Build a reusable `PostcorrectIndex` combining `self.vocab` and `self.dict` user terms.
    pub fn build_index(&self) -> PostcorrectIndex {
        let extra: Vec<Term> = self
            .dict
            .terms
            .iter()
            .map(|t| Term {
                text: t.text.clone(),
                category: Category::User,
            })
            .collect();
        PostcorrectIndex::build(self.vocab, &extra)
    }

    /// Run full pipeline using a pre-built `PostcorrectIndex` (avoids rebuilding phonetic keys per utterance).
    pub fn run_with_index(&self, raw: &str, index: &PostcorrectIndex) -> PipelineOut {
        let (corrected, corrections) = index.correct(raw, self.vocab);
        let normalized = normalize(&corrected, self.vocab, &self.norm);
        let final_text = apply_replacements(&normalized, self.dict);
        PipelineOut {
            text: final_text,
            corrections,
        }
    }

    /// Run full pipeline in spec order: postcorrect (built-in + user terms) -> normalize -> user replacements.
    pub fn run(&self, raw: &str) -> PipelineOut {
        let index = self.build_index();
        self.run_with_index(raw, &index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_with_index_matches_run() {
        let mut vocab = Vocab::default();
        vocab.lexicon.push(Term {
            text: "Kubernetes".into(),
            category: Category::Brand,
        });
        let dict = UserDict::default();
        let pipe = Pipeline {
            vocab: &vocab,
            dict: &dict,
            norm: NormOptions::user_default(),
        };
        let idx = pipe.build_index();
        assert_eq!(pipe.run("pakai kubernetis"), pipe.run_with_index("pakai kubernetis", &idx));
    }
}
