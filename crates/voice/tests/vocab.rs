use std::collections::HashSet;
use std::path::{Path, PathBuf};
use voice::vocab::{Category, Vocab};

fn data_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("data")
}

#[test]
fn loads_all_categories() {
    let v = Vocab::load(&data_dir());
    assert!(v.missing.is_empty(), "unexpected missing files: {:?}", v.missing);
    assert!(v.core.len() >= 50, "expected >= 50 core terms, got {}", v.core.len());
    for cat in [
        Category::Loanword,
        Category::Brand,
        Category::PlaceId,
        Category::Institution,
        Category::Unit,
        Category::WorldName,
        Category::Calendar,
    ] {
        let count = v.lexicon.iter().filter(|t| t.category == cat).count();
        assert!(count > 0, "category {cat:?} has 0 terms");
    }
    assert!(!v.abbrev.is_empty(), "abbreviations should be populated");
    assert!(v.id_words.len() > 10_000, "id_words should load hunspell stems");
    assert!(v.en_words.len() > 20_000, "en_words should load SCOWL size 50");
    assert!(v.di_bases.len() > 1_000, "di_bases should load verb bases");
}

#[test]
fn missing_file_degrades() {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&data_dir(), tmp.path());
    std::fs::remove_file(tmp.path().join("vocab/places_id.txt")).unwrap();

    let v = Vocab::load(tmp.path());
    assert_eq!(v.missing, vec!["places_id.txt".to_string()]);
    assert!(v.core.len() >= 50);
    assert!(v.lexicon.iter().any(|t| t.category == Category::Brand));
    assert!(!v.id_words.is_empty());
}

#[test]
fn no_duplicate_terms() {
    let v = Vocab::load(&data_dir());
    let mut seen = HashSet::new();
    for t in &v.lexicon {
        let low = t.text.to_lowercase();
        assert!(seen.insert(low), "duplicate lexicon term: {}", t.text);
    }
}

#[test]
fn vocab_has_no_eval_reference_sentence() {
    let mut refs = Vec::new();
    let eval_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("eval");
    if eval_dir.is_dir() {
        for name in ["dev.tsv", "test.tsv", "sanity.tsv"] {
            let p = eval_dir.join(name);
            if let Ok(txt) = std::fs::read_to_string(&p) {
                for line in txt.lines().skip(1) {
                    if let Some(r) = line.split('\t').nth(2) {
                        let r = r.trim().to_lowercase();
                        if r.split_whitespace().count() >= 4 {
                            refs.push(r);
                        }
                    }
                }
            }
        }
    }
    assert!(!refs.is_empty(), "expected eval references to check against");

    let vocab_dir = data_dir().join("vocab");
    for entry in std::fs::read_dir(&vocab_dir).unwrap().flatten() {
        let txt = std::fs::read_to_string(entry.path()).unwrap();
        for line in txt.lines() {
            let l = line.trim();
            if l.is_empty() || l.starts_with('#') {
                continue;
            }
            let low = l.to_lowercase();
            for r in &refs {
                assert!(
                    low != *r && !low.contains(r.as_str()),
                    "vocab file {:?} contains eval reference: {r}",
                    entry.file_name()
                );
            }
        }
    }
}

fn copy_dir(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for entry in std::fs::read_dir(src).unwrap().flatten() {
        let sp = entry.path();
        let dp = dst.join(entry.file_name());
        if sp.is_dir() {
            copy_dir(&sp, &dp);
        } else {
            std::fs::copy(&sp, &dp).unwrap();
        }
    }
}
