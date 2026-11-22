use std::path::Path;
use voice::postcorrect::{phonetic_key, postcorrect, theta};
use voice::vocab::{Category, Term, Vocab};

fn vocab() -> Vocab {
    Vocab::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("data"))
}

#[test]
fn spike_fixes_still_happen() {
    let v = vocab();

    let (out, corrs) = postcorrect("terbang ke kasa belangka besok", &v, &[]);
    assert_eq!(out, "terbang ke Casablanca besok");
    assert_eq!(corrs.len(), 1);
    assert_eq!(corrs[0].to, "Casablanca");

    let (out, _) = postcorrect("belanja di toko pedia saja", &v, &[]);
    assert_eq!(out, "belanja di Tokopedia saja");

    let (out, _) = postcorrect("tanya ke chat gpt dulu", &v, &[]);
    assert_eq!(out, "tanya ke ChatGPT dulu");

    let extra_inv = [Term {
        text: "invoice".into(),
        category: Category::User,
    }];
    let (out, _) = postcorrect("tolong kirim info c sekarang", &v, &extra_inv);
    assert_eq!(out, "tolong kirim invoice sekarang");

    let (out, _) = postcorrect("pulau Ada gaskar di Afrika", &v, &[]);
    assert_eq!(out, "pulau Madagaskar di Afrika");
}

#[test]
fn spike_mistakes_do_not_happen() {
    let v = vocab();

    let (out, corrs) = postcorrect("Dataran tinggi Giza sangat megah", &v, &[]);
    assert_eq!(out, "Dataran tinggi Giza sangat megah");
    assert!(corrs.is_empty(), "unexpected corrections: {corrs:?}");

    let (out, corrs) = postcorrect("Perdana Menteri Singapura Lee Hsien Loong", &v, &[]);
    assert_eq!(out, "Perdana Menteri Singapura Lee Hsien Loong");
    assert!(corrs.is_empty(), "unexpected corrections: {corrs:?}");

    let (out, corrs) = postcorrect("di lereng pegunungan para pendaki beristirahat", &v, &[]);
    assert_eq!(out, "di lereng pegunungan para pendaki beristirahat");
    assert!(corrs.is_empty(), "unexpected corrections: {corrs:?}");
}

#[test]
fn valid_words_untouched() {
    let v = vocab();
    let s = "Saya pergi ke pasar bersama ibu untuk membeli sayur dan buah segar.";
    let (out, corrs) = postcorrect(s, &v, &[]);
    assert_eq!(out, s);
    assert!(corrs.is_empty(), "unexpected corrections: {corrs:?}");
}

#[test]
fn user_terms_correct() {
    let v = vocab();
    let extra = [Term {
        text: "Rheyno".into(),
        category: Category::User,
    }];
    let (out, corrs) = postcorrect("halo reino apa kabar", &v, &extra);
    assert_eq!(out, "halo Rheyno apa kabar");
    assert_eq!(corrs.len(), 1);
    assert_eq!(corrs[0].category, Category::User);

    assert!((theta(Category::User) - 0.2).abs() < 1e-6);
    assert!((theta(Category::WorldName) - 0.12).abs() < 1e-6);
    assert_eq!(theta(Category::Institution), 0.0);
    assert_eq!(phonetic_key("reino"), phonetic_key("Rheyno"));
}
