use services::http;
use std::io::{Read, Write};
use std::net::TcpListener;

/// One request, one fixed answer.
fn serve(status: &str, body: &str) -> String {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/x", l.local_addr().unwrap());
    let resp = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    std::thread::spawn(move || {
        let (mut s, _) = l.accept().unwrap();
        let mut buf = [0u8; 4096];
        let _ = s.read(&mut buf);
        s.write_all(resp.as_bytes()).unwrap();
    });
    url
}

#[test]
fn get_json_parses() {
    let url = serve("200 OK", r#"{"a": 1}"#);
    assert_eq!(http::get_json(&url).unwrap()["a"], 1);
}

#[test]
fn get_json_errors_on_404() {
    let url = serve("404 Not Found", "{}");
    let e = http::get_json(&url).unwrap_err().to_string();
    assert!(e.contains("404"), "{e}");
}

#[test]
fn encodes_query() {
    assert_eq!(http::q("Kota Bekasi"), "Kota%20Bekasi");
    assert_eq!(http::q("São Paulo&x"), "S%C3%A3o%20Paulo%26x");
}

#[test]
fn safe_endpoint_url_parses_host_strictly() {
    for ok in [
        "https://api.example.com/v1",
        "https://mcp.linear.app/mcp",
        "http://localhost:8799",
        "http://LOCALHOST:8799/mcp",
        "http://127.0.0.1:8799/v1",
        "http://[::1]:8799",
    ] {
        assert!(http::safe_endpoint_url(ok), "should accept: {ok}");
    }
    for bad in [
        "",
        "http://example.com/v1",
        "http://localhost.evil.com/v1",
        "http://127.0.0.1.nip.io/v1",
        "http://localhost@evil.com/v1",
        "https://user:pass@api.example.com/v1",
        "file:///etc/passwd",
        "javascript:alert(1)",
    ] {
        assert!(!http::safe_endpoint_url(bad), "should reject: {bad}");
    }
}

#[test]
fn is_public_url_rejects_local_and_private_targets() {
    for ok in ["https://example.com/page", "http://example.org", "https://1.1.1.1/dns"] {
        assert!(http::is_public_url(ok), "should accept public URL: {ok}");
    }
    for bad in [
        "http://localhost:8080",
        "http://foo.localhost/x",
        "http://printer.local/",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.1/",
        "http://172.16.0.1/",
        "http://192.168.1.1/",
        "http://100.64.0.1/",
        "http://[::1]/",
        "http://[fc00::1]/",
        "http://[fe80::1]/",
        "http://user@example.com/",
        "file:///etc/hosts",
    ] {
        assert!(!http::is_public_url(bad), "should reject non-public URL: {bad}");
    }
}

#[test]
fn bearer_does_not_follow_redirects_with_token() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    let target_addr = target.local_addr().unwrap();
    let hit = Arc::new(AtomicBool::new(false));
    let hit2 = hit.clone();
    let _ = target.set_nonblocking(true);
    std::thread::spawn(move || {
        for _ in 0..40 {
            if let Ok((mut s, _)) = target.accept() {
                hit2.store(true, Ordering::SeqCst);
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    });

    let redirector = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/test", redirector.local_addr().unwrap());
    let loc = format!("http://{target_addr}/steal");
    std::thread::spawn(move || {
        let (mut s, _) = redirector.accept().unwrap();
        let mut buf = [0u8; 4096];
        let _ = s.read(&mut buf);
        let resp = format!("HTTP/1.1 302 Found\r\nLocation: {loc}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        s.write_all(resp.as_bytes()).unwrap();
    });

    let (status, _) = http::bearer_for("GET", &url, "secret-token", None, 5).unwrap();
    assert_eq!(status, 302);
    std::thread::sleep(std::time::Duration::from_millis(120));
    assert!(!hit.load(Ordering::SeqCst), "bearer request must not follow 302 redirects");
}

#[test]
fn get_json_error_does_not_leak_url_token() {
    let base = serve("403 Forbidden", "{}");
    let url = format!("{base}?token=super-secret-query-token");
    let e = http::get_json(&url).unwrap_err().to_string();
    assert!(e.contains("403"), "{e}");
    assert!(!e.contains("super-secret-query-token"), "error leaked URL: {e}");
}

#[test]
fn auth_follows_same_origin_307_mcp_redirect_and_blocks_downgrade() {
    assert_eq!(
        http::safe_redirect_target("https://mcp.example.com/mcp", "/mcp/").as_deref(),
        Some("https://mcp.example.com/mcp/")
    );
    assert_eq!(
        http::safe_redirect_target("https://mcp.example.com/mcp", "https://mcp.example.com/mcp/").as_deref(),
        Some("https://mcp.example.com/mcp/")
    );
    // Reject cross-host, port change, and https -> http downgrade.
    assert!(http::safe_redirect_target("https://mcp.example.com/mcp", "https://evil.example.com/mcp").is_none());
    assert!(http::safe_redirect_target("https://mcp.example.com/mcp", "http://mcp.example.com/mcp/").is_none());
    assert!(http::safe_redirect_target("http://127.0.0.1:8000/mcp", "http://127.0.0.1:9000/mcp").is_none());

    // Live FastMCP/Starlette 307 /mcp -> /mcp/ redirect on the same host & port must succeed with headers + body intact.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        // Request 1: POST /mcp -> 307 /mcp/
        let (mut s1, _) = listener.accept().unwrap();
        let mut buf1 = [0u8; 4096];
        let n1 = s1.read(&mut buf1).unwrap_or(0);
        let req1 = String::from_utf8_lossy(&buf1[..n1]);
        assert!(req1.starts_with("POST /mcp HTTP/"), "{req1}");
        s1.write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: /mcp/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();

        // Request 2: POST /mcp/ must preserve Authorization header and JSON body
        let (mut s2, _) = listener.accept().unwrap();
        let mut buf2 = [0u8; 4096];
        let n2 = s2.read(&mut buf2).unwrap_or(0);
        let req2 = String::from_utf8_lossy(&buf2[..n2]);
        assert!(req2.starts_with("POST /mcp/ HTTP/"), "{req2}");
        assert!(req2.contains("Authorization: Bearer mcp-secret") || req2.contains("authorization: Bearer mcp-secret"), "{req2}");
        let body = r#"{"ok":true}"#;
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nMcp-Session-Id: sid-1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        s2.write_all(resp.as_bytes()).unwrap();
    });

    let url = format!("http://{addr}/mcp");
    let headers = vec![("Authorization".to_string(), "Bearer mcp-secret".to_string())];
    let (status, sid, text) = http::post_mcp(&url, &headers, &serde_json::json!({"jsonrpc": "2.0"}), 5).unwrap();
    handle.join().unwrap();
    assert_eq!(status, 200);
    assert_eq!(sid.as_deref(), Some("sid-1"));
    assert_eq!(text, r#"{"ok":true}"#);
}

#[test]
fn get_public_bytes_blocks_local_ip_and_dns_loopback() {
    use std::net::IpAddr;
    assert!(http::is_public_ip("1.1.1.1".parse::<IpAddr>().unwrap()));
    assert!(http::is_public_ip("2606:4700:4700::1111".parse::<IpAddr>().unwrap()));
    assert!(http::is_public_ip("2001:4860:4860::8888".parse::<IpAddr>().unwrap()));
    for blocked_ip in [
        "0.0.0.1",
        "127.0.0.1",
        "10.0.0.5",
        "172.16.0.1",
        "192.168.1.10",
        "169.254.169.254",
        "100.64.0.1",
        "198.18.0.1",
        "198.19.255.254",
        "240.0.0.1",
        "255.255.255.255",
        "::1",
        "fc00::1",
        "fe80::1",
        "fec0::1",
        "2002:7f00:0001::1",
        "2001::1",
        "::ffff:127.0.0.1",
        "::ffff:198.18.0.1",
        "64:ff9b::127.0.0.1",
        "64:ff9b::10.0.0.1",
        "64:ff9b:1::1",
    ] {
        assert!(!http::is_public_ip(blocked_ip.parse::<IpAddr>().unwrap()), "must block IP: {blocked_ip}");
    }
    assert!(!http::resolves_public("http://127.0.0.1:80/"));
    assert!(!http::resolves_public("http://localhost:80/"));
    // Public redirect resolver allows http->https, apex->www, relative paths, and rejects non-http / @ userinfo
    assert_eq!(
        http::resolve_redirect_url("http://example.com/a", "https://www.example.com/a").as_deref(),
        Some("https://www.example.com/a")
    );
    assert_eq!(
        http::resolve_redirect_url("https://t.co/xyz", "https://example.org/post").as_deref(),
        Some("https://example.org/post")
    );
    assert!(http::resolve_redirect_url("https://example.com/", "file:///etc/passwd").is_none());
    assert!(http::resolve_redirect_url("https://example.com/", "https://user@example.com/").is_none());
    let url = serve("200 OK", "secret");
    assert!(http::get_public_bytes(&url, 1024).is_err());
}

#[test]
fn get_json_with_follows_same_origin_redirect_and_post_mcp_does_not_repost_302() {
    // 1. get_json_with follows same-origin 302 redirect while keeping custom auth headers
    let l1 = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr1 = l1.local_addr().unwrap();
    let h1 = std::thread::spawn(move || {
        let (mut s1, _) = l1.accept().unwrap();
        let mut b = [0u8; 4096];
        let _ = s1.read(&mut b);
        s1.write_all(b"HTTP/1.1 302 Found\r\nLocation: /v2/usage\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        let (mut s2, _) = l1.accept().unwrap();
        let mut b2 = [0u8; 4096];
        let n2 = s2.read(&mut b2).unwrap_or(0);
        let req2 = String::from_utf8_lossy(&b2[..n2]);
        assert!(req2.starts_with("GET /v2/usage HTTP/"), "{req2}");
        assert!(req2.to_ascii_lowercase().contains("x-api-key: secret-key"), "{req2}");
        let body = r#"{"ok":true}"#;
        let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        s2.write_all(resp.as_bytes()).unwrap();
    });
    let (st, val) = http::get_json_with(&format!("http://{addr1}/v1/usage"), &[("X-API-Key", "secret-key")]).unwrap();
    h1.join().unwrap();
    assert_eq!(st, 200);
    assert_eq!(val["ok"], true);

    // 2. post_mcp must NOT re-POST on 302 (only 307/308 preserve POST method/body)
    let l2 = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr2 = l2.local_addr().unwrap();
    let h2 = std::thread::spawn(move || {
        let (mut s, _) = l2.accept().unwrap();
        let mut b = [0u8; 4096];
        let _ = s.read(&mut b);
        s.write_all(b"HTTP/1.1 302 Found\r\nLocation: /mcp/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
    });
    let (st2, _, _) = http::post_mcp(&format!("http://{addr2}/mcp"), &[], &serde_json::json!({"jsonrpc": "2.0"}), 5).unwrap();
    h2.join().unwrap();
    assert_eq!(st2, 302);
}
