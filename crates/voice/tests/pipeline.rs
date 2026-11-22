use std::path::Path;
use std::time::Instant;

use voice::dictionary::{Replacement, UserDict, UserTerm};
use voice::normalize::NormOptions;
use voice::pipeline::{apply_replacements, prompt_terms, Pipeline};
use voice::vocab::Vocab;

fn vocab() -> Vocab {
    Vocab::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("data"))
}

#[test]
fn prompt_terms_user_first_capped_dedup() {
    let v = vocab();
    let mut d = UserDict::default();
    let core_first = v.core[0].clone();
    d.add_term(UserTerm {
        text: "Rheyno".into(),
        prompt: true,
    })
    .unwrap();
    // Duplicate of core term (different casing) should appear only once, at user position.
    d.add_term(UserTerm {
        text: core_first.to_uppercase(),
        prompt: true,
    })
    .unwrap();
    // prompt: false should not appear in prompt list.
    d.add_term(UserTerm {
        text: "HiddenTerm".into(),
        prompt: false,
    })
    .unwrap();

    let list = prompt_terms(&v, &d, true, 150);
    assert_eq!(list[0], "Rheyno");
    assert_eq!(list[1], core_first.to_uppercase());
    assert!(!list.iter().any(|t| t == "HiddenTerm"));
    let matches_core_first = list
        .iter()
        .filter(|t| t.eq_ignore_ascii_case(&core_first))
        .count();
    assert_eq!(matches_core_first, 1, "core duplicate must appear once");
    assert_eq!(list.len(), 51, "2 user prompt terms + 49 remaining top-50 core");

    // Without jargon, only user prompt terms appear.
    let no_jargon = prompt_terms(&v, &d, false, 150);
    assert_eq!(no_jargon.len(), 2);

    // Cap is enforced.
    let mut big = UserDict::default();
    for i in 0..200 {
        big.add_term(UserTerm {
            text: format!("UserTerm{i}"),
            prompt: true,
        })
        .unwrap();
    }
    let capped = prompt_terms(&v, &big, true, 150);
    assert_eq!(capped.len(), 150);
}

#[test]
fn user_wins_over_postcorrect() {
    let v = vocab();
    let mut d = UserDict::default();
    d.add_replacement(Replacement {
        from: "Casablanca".into(),
        to: "Kasablanka".into(),
    })
    .unwrap();

    let pipe = Pipeline {
        vocab: &v,
        dict: &d,
        norm: NormOptions::user_default(),
    };
    let out = pipe.run("saya mau pergi ke kasa belangka besok");
    assert_eq!(out.text, "Saya mau pergi ke Kasablanka besok.");

    // Whole-word guard: "Casablanca" replacement must not corrupt a longer word.
    assert_eq!(
        apply_replacements("Casablancan tetap utuh", &d),
        "Casablancan tetap utuh"
    );
}

#[test]
#[ignore]
fn user_wins_and_scales() {
    let v = vocab();
    let mut d = UserDict::default();
    d.add_replacement(Replacement {
        from: "Casablanca".into(),
        to: "Kasablanka".into(),
    })
    .unwrap();
    for i in 0..4999 {
        d.add_replacement(Replacement {
            from: format!("frasaunik{i}"),
            to: format!("hasilunik{i}"),
        })
        .unwrap();
    }
    d.add_term(UserTerm {
        text: "Rheyno".into(),
        prompt: true,
    })
    .unwrap();
    for i in 0..4999 {
        d.add_term(UserTerm {
            text: format!("CustomTermAlpha{i}"),
            prompt: false,
        })
        .unwrap();
    }

    let pipe = Pipeline {
        vocab: &v,
        dict: &d,
        norm: NormOptions::user_default(),
    };
    let sentence = "halo reino tolong kirim laporan rapat tanggal tujuh belas agustus dua ribu dua puluh enam ke kasa belangka bersama dua puluh lima ribu rupiah dan frasaunik4200 untuk evaluasi sistem kerja sama tim teknologi di jakarta selatan besok pagi jam sepuluh tiga puluh";
    assert!(sentence.split_whitespace().count() >= 40);

    let out = pipe.run(sentence);
    assert!(out.text.contains("Rheyno"), "got: {}", out.text);
    assert!(out.text.contains("Kasablanka"), "got: {}", out.text);
    assert!(out.text.contains("hasilunik4200"), "got: {}", out.text);

    let runs = 20;
    let start = Instant::now();
    for _ in 0..runs {
        let res = pipe.run(sentence);
        assert!(res.text.contains("Kasablanka"));
    }
    let avg_ms = start.elapsed().as_secs_f64() * 1000.0 / runs as f64;
    assert!(
        avg_ms < 20.0,
        "Pipeline::run averaged {avg_ms:.2} ms (limit < 20 ms)"
    );
}
