use voice::wer::{eval_normalize, wer};

#[test]
fn wer_basics() {
    assert_eq!(wer("halo dunia apa kabar", "halo dunia apa kabar"), (0, 4));
    assert_eq!(wer("halo dunia apa kabar", "Halo, dunia apa kabar!"), (0, 4));
    assert_eq!(wer("halo dunia apa kabar", "halo bumi apa kabar"), (1, 4));
    assert_eq!(wer("satu dua tiga", ""), (3, 3));
}

#[test]
fn eval_normalize_matches_spike() {
    // 5 reference/example lines matching Python `score2.py` (`NFKC`, lower, `[^\w\s]|_` -> ' ', split).
    let cases: &[(&str, &[&str])] = &[
        (
            "Dataran Tinggi Giza, atau \"Nekropolis Giza\"",
            &["dataran", "tinggi", "giza", "atau", "nekropolis", "giza"],
        ),
        (
            "Perdana Menteri Singapura Lee Hsien Loong.",
            &["perdana", "menteri", "singapura", "lee", "hsien", "loong"],
        ),
        (
            "berhati-hati dengan risiko cuaca buruk, sebab hal_tersebut!",
            &[
                "berhati",
                "hati",
                "dengan",
                "risiko",
                "cuaca",
                "buruk",
                "sebab",
                "hal",
                "tersebut",
            ],
        ),
        (
            "Harganya Rp25.000 (naik 2,5%).",
            &["harganya", "rp25", "000", "naik", "2", "5"],
        ),
        (
            "Penemuan ini juga memberikan wawasan tentang evolusi bulu pada burung.",
            &[
                "penemuan",
                "ini",
                "juga",
                "memberikan",
                "wawasan",
                "tentang",
                "evolusi",
                "bulu",
                "pada",
                "burung",
            ],
        ),
    ];
    for &(input, want) in cases {
        let got = eval_normalize(input);
        let want_vec: Vec<String> = want.iter().map(|s| s.to_string()).collect();
        assert_eq!(got, want_vec, "input: {input:?}");
    }
}
