//! Word Error Rate (WER) calculation and FLEURS evaluation normalization.
use unicode_normalization::UnicodeNormalization;

/// Normalize text for WER scoring:
/// NFKC -> lowercase -> replace non-word / `_` with space -> split on whitespace.
pub fn eval_normalize(s: &str) -> Vec<String> {
    let nfkc: String = s.nfkc().collect();
    let lower = nfkc.to_lowercase();
    let cleaned: String = lower
        .chars()
        .map(|c| {
            if c == '_' || (!c.is_alphanumeric() && !c.is_whitespace()) {
                ' '
            } else {
                c
            }
        })
        .collect();
    cleaned.split_whitespace().map(str::to_string).collect()
}

/// Word-level Levenshtein distance between reference and hypothesis.
/// Returns `(edits, ref_word_count)`.
pub fn wer(reference: &str, hyp: &str) -> (usize, usize) {
    let r = eval_normalize(reference);
    let h = eval_normalize(hyp);
    let mut prev: Vec<usize> = (0..=h.len()).collect();
    let mut cur = vec![0usize; h.len() + 1];
    for (i, rw) in r.iter().enumerate() {
        cur[0] = i + 1;
        for (j, hw) in h.iter().enumerate() {
            let cost = usize::from(rw != hw);
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    (prev[h.len()], r.len())
}
