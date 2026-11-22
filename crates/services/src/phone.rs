//! Sharing with a phone (pure): the page's routes (everything under an unguessable token), a phone's file name made
//! safe for the folder, the QR code as SVG, which address is the LAN's.
use std::net::Ipv4Addr;

#[derive(Debug, PartialEq)]
pub enum Route {
    Page,
    Info,
    Upload(String),
    Text,
    File(String),
    None,
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Constant-time byte comparison for session tokens.
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// A request's method and path (with its query) → what it asks for.
pub fn route(method: &str, path: &str, token: &str) -> Route {
    if token.is_empty() {
        return Route::None;
    }
    let (p, query) = path.split_once('?').unwrap_or((path, ""));
    let Some(after_slash) = p.strip_prefix('/') else { return Route::None };
    let (seg, rest) = match after_slash.split_once('/') {
        Some((s, r)) => (s, r),
        None => (after_slash, ""),
    };
    if !ct_eq(seg.as_bytes(), token.as_bytes()) {
        return Route::None;
    }
    let rest = rest.trim_start_matches('/');
    match (method, rest) {
        ("GET", "") => Route::Page,
        ("GET", "info") => Route::Info,
        ("PUT", "upload") => {
            let name = query.split('&').find_map(|kv| kv.strip_prefix("name=")).map(decode).unwrap_or_default();
            Route::Upload(name)
        }
        ("POST", "text") => Route::Text,
        ("GET", r) if r.starts_with("file/") && r.len() > 5 => Route::File(r[5..].to_string()),
        _ => Route::None,
    }
}

/// A file name from the phone, made safe: its last part only, no control characters, not hidden, not ".part" (the
/// name being written), at most 200 bytes with its extension kept.
pub fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    // (no control characters, nor the invisible ones that turn text around: "photo\u{202E}gpj.command")
    let invisible = |c: &char| matches!(*c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2069 | 0xFEFF);
    let mut s: String = last.chars().filter(|c| !c.is_control() && !invisible(c)).collect::<String>().trim().trim_start_matches('.').trim().to_string();
    if s.is_empty() || s == "." {
        s = "file".into();
    }
    if s.ends_with(".part") {
        s.push_str(".file");
    }
    if s.len() > 200 {
        let (stem, ext) = match s.rfind('.') {
            Some(i) if s.len() - i <= 16 => (s[..i].to_string(), s[i..].to_string()),
            _ => (s.clone(), String::new()),
        };
        let mut cut = 200 - ext.len();
        while !stem.is_char_boundary(cut) {
            cut -= 1;
        }
        s = format!("{}{ext}", &stem[..cut]);
    }
    s
}

/// The QR code for `text` as an SVG (black on white, a quiet zone), sized by its box.
pub fn qr_svg(text: &str) -> String {
    use qrcodegen::{QrCode, QrCodeEcc};
    let Ok(qr) = QrCode::encode_text(text, QrCodeEcc::Medium) else { return String::new() };
    let n = qr.size();
    let b = 2;
    let mut d = String::new();
    for y in 0..n {
        for x in 0..n {
            if qr.get_module(x, y) {
                d.push_str(&format!("M{},{}h1v1h-1z", x + b, y + b));
            }
        }
    }
    let w = n + 2 * b;
    format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {w} {w}\" shape-rendering=\"crispEdges\"><rect width=\"{w}\" height=\"{w}\" fill=\"#fff\"/><path d=\"{d}\" fill=\"#000\"/></svg>")
}

/// A private LAN address (Wi-Fi / Ethernet): not loopback, not link-local, not public.
pub fn is_lan(ip: Ipv4Addr) -> bool {
    ip.is_private()
}

/// A request's first line and the headers the server uses.
#[derive(Debug)]
pub struct Head {
    pub method: String,
    pub path: String,
    /// the body's length (0 without one)
    pub length: u64,
    pub host: String,
    /// custom header sent by phone.html (`X-Sympony-Request: 1`) to block cross-site form/fetch CSRF
    pub x_sympony: bool,
}

/// Reads a request's head (up to the blank line). Refused: a bad first line, a chunked body, a length twice or not a
/// number (the page always sends a length).
pub fn parse_head(raw: &[u8]) -> Result<Head, &'static str> {
    let text = std::str::from_utf8(raw).map_err(|_| "not text")?;
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path, version) = (first.next().unwrap_or(""), first.next().unwrap_or(""), first.next().unwrap_or(""));
    if method.is_empty() || !path.starts_with('/') || !version.starts_with("HTTP/1.") || first.next().is_some() {
        return Err("bad request line");
    }
    let mut length: Option<u64> = None;
    let mut host = String::new();
    let mut x_sympony = false;
    for l in lines.take_while(|l| !l.is_empty()) {
        let (k, v) = l.split_once(':').ok_or("bad header")?;
        let (k, v) = (k.trim().to_ascii_lowercase(), v.trim());
        match k.as_str() {
            "content-length" => {
                if length.is_some() {
                    return Err("two lengths");
                }
                length = Some(v.parse().map_err(|_| "bad length")?);
            }
            "transfer-encoding" => return Err("chunked"),
            "host" => host = v.to_string(),
            "x-sympony-request" => x_sympony = v == "1",
            _ => {}
        }
    }
    Ok(Head { method: method.into(), path: path.into(), length: length.unwrap_or(0), host, x_sympony })
}
