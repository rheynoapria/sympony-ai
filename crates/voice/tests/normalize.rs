use std::path::Path;
use voice::normalize::{normalize, rule_groups, NormOptions, UnitsStyle};
use voice::vocab::Vocab;

fn vocab() -> Vocab {
    Vocab::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("data"))
}

const SPIKE_SELF_TESTS: &[(&str, &str)] = &[
    ("harganya dua puluh lima ribu rupiah", "Harganya Rp25.000."),
    ("naik dua koma lima persen", "Naik 2,5%."),
    ("suhu tiga puluh derajat celsius", "Suhu 30°C."),
    ("lima dolar dan seratus dolar", "$5 dan $100."),
    ("tiga ratus juta rupiah", "Rp300 juta."),
    ("pada tahun seribu sembilan ratus enam puluh", "Pada tahun 1960."),
    ("ada empat ratus ribu kasus", "Ada 400.000 kasus."),
    ("salah satu dari tiga orang", "Salah satu dari tiga orang."),
    ("rapat jam sepuluh tiga puluh", "Rapat jam 10.30."),
    ("tanggal tujuh belas agustus", "Tanggal 17 Agustus."),
    ("kirim pe de ef nya", "Kirim PDF nya."),
    ("Ed Davey M P", "Ed Davey MP."),
    ("email saya budi et gmail titik com", "Email saya budi@gmail.com."),
    ("buka tokopedia titik co titik id", "Buka tokopedia.co.id."),
    (
        "Di bangun oleh orang mesir di tahun itu",
        "Dibangun oleh orang mesir di tahun itu.",
    ),
    (
        "dia tinggal disini dan di rumah",
        "Dia tinggal di sini dan di rumah.",
    ),
    ("urutan ke tiga", "Urutan ke-3."),
    ("peringkat kedua puluh empat", "Peringkat ke-24."),
    ("ukurannya lima belas gigabyte", "Ukurannya 15 GB."),
    ("dia bilang tanda tanya", "Dia bilang?"),
    ("tolong update projectnya", "Tolong update project-nya."),
];

#[test]
fn spike_21_self_tests() {
    let v = vocab();
    let o = NormOptions::user_default();
    for &(src, want) in SPIKE_SELF_TESTS {
        let got = normalize(src, &v, &o);
        assert_eq!(got, want, "input: {src:?}");
    }
    assert!(rule_groups().len() >= 8);
}

#[test]
fn numbers_indonesian_format() {
    let v = vocab();
    let mut o = NormOptions::user_default();
    o.casing = false;
    assert_eq!(normalize("dua puluh lima ribu rupiah", &v, &o), "Rp25.000");
    assert_eq!(normalize("dua koma lima", &v, &o), "2,5");
}

#[test]
fn urls_emails() {
    let v = vocab();
    let mut o = NormOptions::user_default();
    o.casing = false;
    assert_eq!(normalize("tokopedia titik com", &v, &o), "tokopedia.com");
    assert_eq!(normalize("budi et gmail titik com", &v, &o), "budi@gmail.com");
    assert_eq!(
        normalize("situs kemdikbud titik go titik id garis miring pendaftaran", &v, &o),
        "situs kemdikbud.go.id/pendaftaran"
    );
}

#[test]
fn dates_times() {
    let v = vocab();
    let mut o = NormOptions::user_default();
    o.casing = false;
    assert_eq!(
        normalize("tujuh belas agustus dua ribu dua puluh enam", &v, &o),
        "17 Agustus 2026"
    );
    assert_eq!(normalize("jam tiga sore", &v, &o), "jam 3 sore");
}

#[test]
fn units_style() {
    let v = vocab();
    let mut o_sym = NormOptions::user_default();
    o_sym.casing = false;
    o_sym.units = UnitsStyle::Symbols;
    assert_eq!(normalize("delapan persen", &v, &o_sym), "8%");

    let mut o_words = NormOptions::eval_profile();
    o_words.casing = false;
    assert_eq!(o_words.units, UnitsStyle::Words);
    assert!(!o_words.spoken_punct);
    assert_eq!(normalize("delapan persen", &v, &o_words), "8 persen");
}

#[test]
fn di_join_keeps_preposition() {
    let v = vocab();
    let mut o = NormOptions::user_default();
    o.casing = false;
    assert_eq!(normalize("di bangun", &v, &o), "dibangun");
    assert_eq!(normalize("di Jakarta", &v, &o), "di Jakarta");
    assert_eq!(normalize("di rumah", &v, &o), "di rumah");
}

#[test]
fn spoken_punct() {
    let v = vocab();
    let o = NormOptions::user_default();
    assert_eq!(
        normalize("halo koma apa kabar tanda tanya", &v, &o),
        "Halo, apa kabar?"
    );
    assert_eq!(normalize("baris baru", &v, &o), "\n");
}

#[test]
fn idempotent() {
    let v = vocab();
    let o = NormOptions::user_default();
    let extra = [
        "dua puluh lima ribu rupiah",
        "dua koma lima",
        "tokopedia titik com",
        "budi et gmail titik com",
        "situs kemdikbud titik go titik id garis miring pendaftaran",
        "tujuh belas agustus dua ribu dua puluh enam",
        "jam tiga sore",
        "delapan persen",
        "di bangun",
        "di Jakarta",
        "di rumah",
        "halo koma apa kabar tanda tanya",
        "baris baru",
    ];
    for &(src, _) in SPIKE_SELF_TESTS {
        let once = normalize(src, &v, &o);
        let twice = normalize(&once, &v, &o);
        assert_eq!(twice, once, "not idempotent on {src:?} -> {once:?}");
    }
    for src in extra {
        let once = normalize(src, &v, &o);
        let twice = normalize(&once, &v, &o);
        assert_eq!(twice, once, "not idempotent on {src:?} -> {once:?}");
    }
}
