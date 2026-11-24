use services::oauth::{auth_url, challenge, has_scope, parse_redirect, parse_scopes, SCOPE_CALENDAR_EVENTS, SCOPE_CALENDAR_LIST, SCOPE_TASKS};

#[test]
fn pkce_challenge_rfc7636() {
    assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
}

#[test]
fn auth_url_has_what_google_needs() {
    let u = auth_url("cid.apps.googleusercontent.com", "http://127.0.0.1:5555", "chal", "st8");
    assert!(u.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
    for part in [
        "client_id=cid.apps.googleusercontent.com",
        "redirect_uri=http%3A%2F%2F127.0.0.1%3A5555",
        "response_type=code",
        "code_challenge=chal",
        "code_challenge_method=S256",
        "state=st8",
        "access_type=offline",
        "prompt=consent",
        "scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.calendarlist.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Ftasks%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fuserinfo.email",
    ] {
        assert!(u.contains(part), "{part} missing in {u}");
    }
}

#[test]
fn scopes_parsed_and_checked() {
    let s = parse_scopes("https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/tasks");
    assert_eq!(s.len(), 2);
    assert!(has_scope(&s, SCOPE_CALENDAR_EVENTS));
    assert!(has_scope(&s, SCOPE_TASKS));
    assert!(has_scope(&s, "auth/tasks"));
    assert!(!has_scope(&s, SCOPE_CALENDAR_LIST));
}

#[test]
fn redirect_parsed() {
    assert_eq!(parse_redirect("GET /?state=st8&code=4%2F0Abc&scope=x HTTP/1.1", "st8"), Ok("4/0Abc".to_string()));
    assert!(parse_redirect("GET /?state=other&code=x HTTP/1.1", "st8").is_err());
    assert_eq!(parse_redirect("GET /?error=access_denied&state=st8 HTTP/1.1", "st8"), Err("access_denied".to_string()));
    assert!(parse_redirect("GET /favicon.ico HTTP/1.1", "st8").is_err());
}
