use voice::dictionary::{Replacement, UserDict, UserTerm, MAX_ENTRIES};

#[test]
fn corrupt_dict_set_aside() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dictionary.json");
    std::fs::write(&path, "{not valid json").unwrap();

    let dict = UserDict::load(&path);
    assert!(dict.terms.is_empty());
    assert!(dict.replacements.is_empty());
    let bad = dir.path().join("dictionary.json.bad");
    assert!(bad.exists(), "expected corrupt file renamed to .bad");
    assert!(!path.exists(), "original corrupt file should be moved aside");
}

#[test]
fn import_csv_merges_and_skips_dupes() {
    let mut dict = UserDict::default();
    dict.add_term(UserTerm {
        text: "Rheyno".into(),
        prompt: true,
    })
    .unwrap();
    dict.add_replacement(Replacement {
        from: "kemipnya".into(),
        to: "commit-nya".into(),
    })
    .unwrap();

    let csv = "\
type,text,to,prompt
term,rheyno,,true
term,Sympony,,true
term,Paseo,,false
replacement,KEMIPNYA,commit-nya,
replacement,kasablanka,Kasablanka,
";
    let rep = dict.import_csv(csv);
    assert_eq!(rep.added_terms, 2);
    assert_eq!(rep.added_replacements, 1);
    assert_eq!(rep.skipped, 2);
    assert_eq!(dict.terms.len(), 3);
    assert_eq!(dict.replacements.len(), 2);

    let txt_rep = dict.import_txt("# comment\nSympony\nAntigravity\n\n");
    assert_eq!(txt_rep.added_terms, 1);
    assert_eq!(txt_rep.skipped, 1);
    assert_eq!(dict.terms.len(), 4);
}

#[test]
fn export_round_trips() {
    let mut dict = UserDict::default();
    dict.add_term(UserTerm {
        text: "Rheyno".into(),
        prompt: true,
    })
    .unwrap();
    dict.add_term(UserTerm {
        text: "PT, Tbk".into(),
        prompt: false,
    })
    .unwrap();
    dict.add_replacement(Replacement {
        from: "kemipnya".into(),
        to: "commit-nya".into(),
    })
    .unwrap();

    let exported = dict.export_csv();
    let mut loaded = UserDict::default();
    let rep = loaded.import_csv(&exported);
    assert_eq!(rep.added_terms, 2);
    assert_eq!(rep.added_replacements, 1);
    assert_eq!(loaded.terms, dict.terms);
    assert_eq!(loaded.replacements, dict.replacements);

    // Also verify atomic save + load round trip.
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dictionary.json");
    dict.save(&path).unwrap();
    let from_disk = UserDict::load(&path);
    assert_eq!(from_disk, dict);
}

#[test]
fn enforces_5000_cap() {
    let mut dict = UserDict::default();
    for i in 0..MAX_ENTRIES {
        dict.add_term(UserTerm {
            text: format!("Term{i}"),
            prompt: false,
        })
        .unwrap();
    }
    assert!(dict
        .add_term(UserTerm {
            text: "Overflow".into(),
            prompt: false,
        })
        .is_err());
}
