use services::{paths, Log};

#[test]
fn log_line_format() {
    let dir = tempfile::tempdir().unwrap();
    let log = Log::open(dir.path());
    log.line("hello");
    let text = std::fs::read_to_string(dir.path().join("sympony.log")).unwrap();
    let last = text.lines().last().unwrap();
    let re = |s: &str| {
        // [YYYY-MM-DDTHH:MM:SS.mmmZ] hello
        s.len() == 26 + 6 && s.starts_with('[') && &s[24..26] == "Z]" && &s[11..12] == "T" && s.ends_with(" hello")
    };
    assert!(re(last), "unexpected line: {last:?}");
}

#[test]
fn data_dir_follows_env() {
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("SYMPONY_DATA_DIR", dir.path().join("x"));
    assert_eq!(paths::data_dir(), dir.path().join("x"));
    assert!(dir.path().join("x").is_dir());
}

#[test]
fn external_urls_allowed_by_scheme() {
    for ok in ["https://github.com/rheynoapria/sympony-ai", "http://x.test/a", "mailto:a@b.c", "x-apple.systempreferences:com.apple.preference.security"] {
        assert!(services::external_url_ok(ok), "{ok}");
    }
    for bad in ["file:///etc/passwd", "javascript:alert(1)", "", "ssh://h", "/Applications/Calculator.app"] {
        assert!(!services::external_url_ok(bad), "{bad}");
    }
}
