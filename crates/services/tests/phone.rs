use services::phone::*;

#[test]
fn a_phones_file_name_stays_in_the_folder() {
    assert_eq!(safe_name("IMG_0001.HEIC"), "IMG_0001.HEIC");
    assert_eq!(safe_name("../../etc/passwd"), "passwd");
    assert_eq!(safe_name("a/b\\c.txt"), "c.txt");
    assert_eq!(safe_name(".."), "file");
    assert_eq!(safe_name(".hidden"), "hidden");
    assert_eq!(safe_name("  bad\u{0}\u{7}name\n.jpg "), "badname.jpg");
    assert_eq!(safe_name(""), "file");
    assert_eq!(safe_name("x.part"), "x.part.file");
    let long = format!("{}.jpg", "a".repeat(300));
    let s = safe_name(&long);
    assert!(s.len() <= 200 && s.ends_with(".jpg"), "{s}");
    assert_eq!(safe_name("foto ünï.png"), "foto ünï.png");
}

#[test]
fn only_the_token_gets_in() {
    let t = "Tok3n";
    assert_eq!(route("GET", "/Tok3n/", t), Route::Page);
    assert_eq!(route("GET", "/Tok3n", t), Route::Page);
    assert_eq!(route("GET", "/Tok3n/info", t), Route::Info);
    assert_eq!(route("PUT", "/Tok3n/upload?name=a%20b.jpg", t), Route::Upload("a b.jpg".into()));
    assert_eq!(route("POST", "/Tok3n/text", t), Route::Text);
    assert_eq!(route("GET", "/Tok3n/file/ab12", t), Route::File("ab12".into()));
    assert_eq!(route("GET", "/wrong/info", t), Route::None);
    assert_eq!(route("GET", "/", t), Route::None);
    assert_eq!(route("GET", "/Tok3nX/", t), Route::None);
    assert_eq!(route("DELETE", "/Tok3n/info", t), Route::None);
    assert_eq!(route("GET", "/Tok3n/upload?name=x", t), Route::None);
}

#[test]
fn the_qr_is_an_svg() {
    let s = qr_svg("http://192.168.1.5:5000/abc/");
    assert!(s.starts_with("<svg") && s.contains("<path") && s.ends_with("</svg>"));
}

#[test]
fn a_lan_address_is_private() {
    assert!(is_lan("192.168.1.5".parse().unwrap()));
    assert!(is_lan("10.0.0.2".parse().unwrap()));
    assert!(is_lan("172.20.1.1".parse().unwrap()));
    assert!(!is_lan("172.32.0.1".parse().unwrap()));
    assert!(!is_lan("127.0.0.1".parse().unwrap()));
    assert!(!is_lan("8.8.8.8".parse().unwrap()));
    assert!(!is_lan("169.254.3.3".parse().unwrap()));
}

#[test]
fn a_request_head_is_read_strictly() {
    let h = parse_head(b"PUT /t/upload?name=a HTTP/1.1\r\nHost: 192.168.1.5:5000\r\nContent-Length: 12\r\n\r\n").unwrap();
    assert_eq!((h.method.as_str(), h.path.as_str(), h.length, h.host.as_str()), ("PUT", "/t/upload?name=a", 12, "192.168.1.5:5000"));
    let g = parse_head(b"GET /t/ HTTP/1.1\r\nhost: x\r\n\r\n").unwrap();
    assert_eq!((g.length, g.host.as_str()), (0, "x"));
    // chunked bodies, two lengths, a bad length, a bad request line: refused
    assert!(parse_head(b"PUT /t/upload HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").is_err());
    assert!(parse_head(b"PUT /t/upload HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n").is_err());
    assert!(parse_head(b"PUT /t/upload HTTP/1.1\r\nContent-Length: -1\r\n\r\n").is_err());
    assert!(parse_head(b"garbage\r\n\r\n").is_err());
    // a huge length is just a number here; the server checks it against its limits before reading anything
    assert_eq!(parse_head(b"POST /x HTTP/1.1\r\nContent-Length: 1000000000000000000\r\n\r\n").unwrap().length, 1_000_000_000_000_000_000);
}

#[test]
fn names_cant_hide_their_real_extension() {
    assert_eq!(safe_name("photo\u{202E}gpj.command"), "photogpj.command");
    assert_eq!(safe_name("a\u{200B}b\u{2066}.txt"), "ab.txt");
}

#[test]
fn m01_csrf_header_and_empty_token_are_checked() {
    assert_eq!(route("GET", "/", ""), Route::None);
    assert_eq!(route("GET", "/Tok3n/", ""), Route::None);
    let ok = parse_head(b"POST /t/text HTTP/1.1\r\nHost: 192.168.1.5:5000\r\nX-Sympony-Request: 1\r\nContent-Length: 2\r\n\r\n").unwrap();
    assert!(ok.x_sympony);
    let missing = parse_head(b"POST /t/text HTTP/1.1\r\nHost: 192.168.1.5:5000\r\nContent-Length: 2\r\n\r\n").unwrap();
    assert!(!missing.x_sympony);
    let wrong = parse_head(b"POST /t/text HTTP/1.1\r\nHost: 192.168.1.5:5000\r\nX-Sympony-Request: 0\r\nContent-Length: 2\r\n\r\n").unwrap();
    assert!(!wrong.x_sympony);
}
