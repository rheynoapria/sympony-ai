//! JSON over HTTPS for the services (weather, prayer times…). Blocking: never call it on the main thread.
use serde_json::Value;
use std::net::IpAddr;
use std::sync::OnceLock;
use std::time::Duration;

fn shared_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .http_status_as_error(false)
            .user_agent(concat!("Sympony/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

/// Shared pooled agent for authenticated API & MCP calls: `max_redirects(0)` because redirects are handled
/// explicitly by `safe_redirect_target` (up to 5 same-origin non-downgrade hops so FastMCP/Starlette 307
/// `/mcp` → `/mcp/` works without ever leaking credentials cross-host or downgrading https → http).
fn auth_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(120)))
            .http_status_as_error(false)
            .max_redirects(0)
            .user_agent(format!("Sympony/{} ({}; {})", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH))
            .build()
            .into()
    })
}

/// DNS resolver wrapper for untrusted public URL fetches (bookmark previews): delegates to ureq's `DefaultResolver`,
/// verifies every returned IP via `is_public_ip`, and hands those exact checked addresses straight to the connector
/// so there is no DNS-rebinding TOCTOU window between validation and connect.
#[derive(Debug)]
struct PublicOnlyResolver;

impl ureq::unversioned::resolver::Resolver for PublicOnlyResolver {
    fn resolve(
        &self,
        uri: &ureq::http::Uri,
        config: &ureq::config::Config,
        timeout: ureq::unversioned::transport::NextTimeout,
    ) -> Result<ureq::unversioned::resolver::ResolvedSocketAddrs, ureq::Error> {
        let addrs = ureq::unversioned::resolver::DefaultResolver::default().resolve(uri, config, timeout)?;
        if addrs.is_empty() || addrs.iter().any(|a| !is_public_ip(a.ip())) {
            return Err(ureq::Error::HostNotFound);
        }
        Ok(addrs)
    }
}

/// Shared pooled agent for untrusted public URL fetches (bookmark previews): no auto-redirects (manual hop-by-hop
/// validation in `get_public_bytes`), no proxy bypass, and `PublicOnlyResolver` pinning validated public IPs.
fn public_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        let cfg = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(15)))
            .http_status_as_error(false)
            .max_redirects(0)
            .proxy(None)
            .user_agent(concat!("Sympony/", env!("CARGO_PKG_VERSION")))
            .build();
        ureq::Agent::with_parts(cfg, ureq::unversioned::transport::DefaultConnector::default(), PublicOnlyResolver)
    })
}

const MAX_AUTH_REDIRECTS: usize = 5;
const MAX_PUBLIC_REDIRECTS: usize = 5;

fn uri_port(uri: &ureq::http::Uri) -> Option<u16> {
    uri.port_u16().or_else(|| match uri.scheme_str() {
        Some("https") => Some(443),
        Some("http") => Some(80),
        _ => None,
    })
}

/// Resolves a redirect `location` relative to `current` into a clean `http(s)` URL (rejecting `@` userinfo and non-HTTP schemes).
pub fn resolve_redirect_url(current: &str, location: &str) -> Option<String> {
    let cur = current.trim().parse::<ureq::http::Uri>().ok()?;
    let cur_scheme = cur.scheme_str()?;
    let cur_auth = cur.authority()?;
    let loc = location.trim();
    if loc.is_empty() {
        return None;
    }
    let next_str = if loc.starts_with("http://") || loc.starts_with("https://") {
        loc.to_string()
    } else if loc.starts_with("//") {
        format!("{cur_scheme}:{loc}")
    } else if loc.starts_with('/') {
        format!("{cur_scheme}://{cur_auth}{loc}")
    } else {
        // Reject explicit non-HTTP URI schemes (e.g. `file:///etc/passwd`, `ftp://...`, `javascript:...`).
        let first_seg = loc.split(['/', '?', '#']).next().unwrap_or("");
        if let Some((scheme, _)) = first_seg.split_once(':') {
            if !scheme.is_empty() && scheme.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.')) {
                return None;
            }
        }
        let base_path = cur.path();
        let dir = base_path.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        format!("{cur_scheme}://{cur_auth}{dir}/{loc}")
    };
    let next = next_str.parse::<ureq::http::Uri>().ok()?;
    let next_scheme = next.scheme_str()?;
    let next_auth = next.authority()?;
    if next_auth.as_str().contains('@') || !matches!(next_scheme, "http" | "https") {
        return None;
    }
    Some(next_str)
}

/// Resolves a redirect `location` relative to `current` ONLY when it stays on the exact same host & port and
/// never downgrades `https://` to `http://`. Returns `None` for cross-host, scheme downgrade, or malformed targets.
pub fn safe_redirect_target(current: &str, location: &str) -> Option<String> {
    let cur = current.trim().parse::<ureq::http::Uri>().ok()?;
    let cur_scheme = cur.scheme_str()?;
    let cur_auth = cur.authority()?;
    let cur_host = cur_auth.host();
    let cur_port = uri_port(&cur)?;
    let next_str = resolve_redirect_url(current, location)?;
    let next = next_str.parse::<ureq::http::Uri>().ok()?;
    let next_scheme = next.scheme_str()?;
    let next_auth = next.authority()?;
    if cur_scheme == "https" && next_scheme != "https" {
        return None;
    }
    if !next_auth.host().eq_ignore_ascii_case(cur_host) || uri_port(&next)? != cur_port {
        return None;
    }
    Some(next_str)
}

fn redirect_location(resp: &ureq::http::Response<ureq::Body>) -> Option<String> {
    let s = resp.status().as_u16();
    if !matches!(s, 301 | 302 | 303 | 307 | 308) {
        return None;
    }
    resp.headers().get("location").and_then(|v| v.to_str().ok()).map(String::from)
}

/// Shared pooled loopback-only agent (no proxy, no redirects).
fn local_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(10)))
            .http_status_as_error(false)
            .proxy(None)
            .max_redirects(0)
            .build()
            .into()
    })
}

/// Validates an API / MCP endpoint URL: `https://` with a non-empty host (no userinfo), or cleartext `http://` ONLY
/// when the exact host is `localhost`, `127.0.0.1`, or `[::1]` (never `http://localhost.evil.com`).
pub fn safe_endpoint_url(url: &str) -> bool {
    let Ok(uri) = url.trim().parse::<ureq::http::Uri>() else { return false };
    let Some(auth) = uri.authority() else { return false };
    if auth.as_str().contains('@') {
        return false;
    }
    let host = auth.host();
    if host.is_empty() {
        return false;
    }
    match uri.scheme_str() {
        Some("https") => true,
        Some("http") => host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "[::1]",
        _ => false,
    }
}

/// Whether `ip` is globally routable (rejects loopback, RFC1918, link-local, CGNAT 100.64/10, 0/8,
/// benchmarking 198.18/15, reserved 240/4, ULA fc00::/7, link-local fe80::/10, deprecated site-local fec0::/10,
/// NAT64 64:ff9b::/96 & 64:ff9b:1::/48, 6to4 2002::/16, Teredo 2001::/32, IPv4-mapped/compatible, multicast,
/// and unspecified).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            !(v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || o[0] == 0
                || (o[0] == 100 && (o[1] & 0b1100_0000) == 64)
                || (o[0] == 198 && (o[1] & 0xfe) == 18)
                || o[0] >= 240)
        }
        IpAddr::V6(v6) => {
            let seg = v6.segments();
            let nat64 = (seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2] == 0 && seg[3] == 0 && seg[4] == 0 && seg[5] == 0)
                || (seg[0] == 0x0064 && seg[1] == 0xff9b && seg[2] == 1);
            let ipv4_compat = seg[0] == 0 && seg[1] == 0 && seg[2] == 0 && seg[3] == 0 && seg[4] == 0 && seg[5] == 0;
            let six_to_four = seg[0] == 0x2002;
            let teredo = seg[0] == 0x2001 && seg[1] == 0x0000;
            let site_local = (seg[0] & 0xffc0) == 0xfec0;
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || nat64
                || ipv4_compat
                || six_to_four
                || teredo
                || site_local
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some_and(|v4| !is_public_ip(IpAddr::V4(v4))))
        }
    }
}

/// Whether `url` points to a public `http(s)` host (rejects loopback, private, link-local, metadata, and `.local` hosts).
pub fn is_public_url(url: &str) -> bool {
    let Ok(uri) = url.trim().parse::<ureq::http::Uri>() else { return false };
    if !matches!(uri.scheme_str(), Some("http" | "https")) {
        return false;
    }
    let Some(auth) = uri.authority() else { return false };
    if auth.as_str().contains('@') {
        return false;
    }
    let host = auth.host().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_public_ip(ip);
    }
    true
}

/// Resolves `url`'s host via DNS and ensures every resolved IP is public (blocks DNS rebinding / nip.io to loopback/LAN).
pub fn resolves_public(url: &str) -> bool {
    use std::net::ToSocketAddrs;
    if !is_public_url(url) {
        return false;
    }
    let Ok(uri) = url.trim().parse::<ureq::http::Uri>() else { return false };
    let Some(auth) = uri.authority() else { return false };
    let Some(port) = uri_port(&uri) else { return false };
    let host = auth.host().trim_start_matches('[').trim_end_matches(']');
    let Ok(addrs) = (host, port).to_socket_addrs() else { return false };
    let mut any = false;
    for addr in addrs {
        any = true;
        if !is_public_ip(addr.ip()) {
            return false;
        }
    }
    any
}

/// A text body up to 50 MB (a big calendar feed). The error doesn't name the URL: feed links hold private tokens.
pub fn get_text(url: &str) -> anyhow::Result<String> {
    let mut resp = shared_agent().get(url).call()?;
    let status = resp.status().as_u16();
    anyhow::ensure!((200..300).contains(&status), "HTTP {status}");
    Ok(resp.body_mut().with_config().limit(50 * 1024 * 1024).read_to_string()?)
}

/// JSON with extra headers (an API token), and the status: the caller tells 401 from the rest.
/// Follows up to 5 same-origin non-downgrade redirects (never leaks headers cross-host or on https → http).
pub fn get_json_with(url: &str, headers: &[(&str, &str)]) -> anyhow::Result<(u16, Value)> {
    let lim = Some(Duration::from_secs(15));
    let mut cur_url = url.to_string();
    for hop in 0..=MAX_AUTH_REDIRECTS {
        let mut req = auth_agent().get(&cur_url).config().timeout_global(lim).build();
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let mut resp = req.call()?;
        if hop < MAX_AUTH_REDIRECTS {
            if let Some(loc) = redirect_location(&resp) {
                if let Some(next) = safe_redirect_target(&cur_url, &loc) {
                    cur_url = next;
                    continue;
                }
            }
        }
        let status = resp.status().as_u16();
        return Ok((status, resp.body_mut().read_json().unwrap_or(Value::Null)));
    }
    anyhow::bail!("too many redirects")
}

pub fn get_json(url: &str) -> anyhow::Result<Value> {
    let mut resp = shared_agent().get(url).call()?;
    let status = resp.status().as_u16();
    anyhow::ensure!((200..300).contains(&status), "HTTP {status}");
    Ok(resp.body_mut().read_json()?)
}

/// A path or query part, percent-encoded (everything but unreserved characters).
pub fn q(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// A form POST (OAuth's token endpoint): the status and the JSON answer.
pub fn post_form(url: &str, form: &[(&str, &str)]) -> anyhow::Result<(u16, Value)> {
    let mut resp = auth_agent().post(url).config().timeout_global(Some(Duration::from_secs(15))).build().send_form(form.iter().copied())?;
    let status = resp.status().as_u16();
    Ok((status, resp.body_mut().read_json().unwrap_or(Value::Null)))
}

/// An API call with a bearer token: GET / POST / PATCH / DELETE, a JSON body for the two that send one.
pub fn bearer(method: &str, url: &str, token: &str, body: Option<&Value>) -> anyhow::Result<(u16, Value)> {
    bearer_for(method, url, token, body, 15)
}

/// `bearer` with its own time limit (a model's answer takes longer than 15 s).
/// Pooled; follows up to 5 same-origin non-downgrade redirects (refuses cross-host & https→http redirects).
pub fn bearer_for(method: &str, url: &str, token: &str, body: Option<&Value>, secs: u64) -> anyhow::Result<(u16, Value)> {
    let auth = (!token.trim().is_empty()).then(|| format!("Bearer {token}"));
    let a = auth_agent();
    let lim = Some(Duration::from_secs(secs));
    let mut cur_url = url.to_string();
    let mut cur_method = method.to_string();
    let mut cur_body = body.cloned();
    for hop in 0..=MAX_AUTH_REDIRECTS {
        let mut resp = match (cur_method.as_str(), &cur_body) {
            ("POST", b) => {
                let mut r = a.post(&cur_url).config().timeout_global(lim).build();
                if let Some(ref h) = auth {
                    r = r.header("Authorization", h);
                }
                r.send_json(b.clone().unwrap_or(Value::Null))?
            }
            ("PATCH", b) => {
                let mut r = a.patch(&cur_url).config().timeout_global(lim).build();
                if let Some(ref h) = auth {
                    r = r.header("Authorization", h);
                }
                r.send_json(b.clone().unwrap_or(Value::Null))?
            }
            ("DELETE", _) => {
                let mut r = a.delete(&cur_url).config().timeout_global(lim).build();
                if let Some(ref h) = auth {
                    r = r.header("Authorization", h);
                }
                r.call()?
            }
            _ => {
                let mut r = a.get(&cur_url).config().timeout_global(lim).build();
                if let Some(ref h) = auth {
                    r = r.header("Authorization", h);
                }
                r.call()?
            }
        };
        if hop < MAX_AUTH_REDIRECTS {
            if let Some(loc) = redirect_location(&resp) {
                if let Some(next) = safe_redirect_target(&cur_url, &loc) {
                    if matches!(resp.status().as_u16(), 301 | 302 | 303) && cur_method != "GET" {
                        cur_method = "GET".into();
                        cur_body = None;
                    }
                    cur_url = next;
                    continue;
                }
            }
        }
        let status = resp.status().as_u16();
        return Ok((status, resp.body_mut().read_json().unwrap_or(Value::Null)));
    }
    anyhow::bail!("too many redirects")
}

/// A streamed POST (server-sent events): each `data:` line goes to `on_data` as it comes; a reply that isn't a
/// stream (an error, or a server that answers whole) comes back as text. (status, the body when it wasn't a stream)
/// `on_data` answers false to stop reading (the user pressed Stop): what came so far stands.
pub fn bearer_stream(url: &str, token: &str, body: &Value, secs: u64, on_data: &mut dyn FnMut(&str) -> bool) -> anyhow::Result<(u16, String)> {
    use std::io::BufRead;
    let auth = (!token.trim().is_empty()).then(|| format!("Bearer {token}"));
    let lim = Some(Duration::from_secs(secs));
    let mut cur_url = url.to_string();
    let mut resp = loop {
        let mut hops = 0usize;
        break loop {
            let mut req = auth_agent()
                .post(&cur_url)
                .config()
                .timeout_global(lim)
                .build()
                .header("Accept", "text/event-stream");
            if let Some(ref h) = auth {
                req = req.header("Authorization", h);
            }
            let r = req.send_json(body.clone())?;
            if hops < MAX_AUTH_REDIRECTS && matches!(r.status().as_u16(), 307 | 308) {
                if let Some(loc) = redirect_location(&r) {
                    if let Some(next) = safe_redirect_target(&cur_url, &loc) {
                        cur_url = next;
                        hops += 1;
                        continue;
                    }
                }
            }
            break r;
        };
    };
    let status = resp.status().as_u16();
    let sse = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|c| c.contains("event-stream"));
    if !(200..300).contains(&status) || !sse {
        return Ok((status, resp.body_mut().with_config().limit(16 << 20).read_to_string()?));
    }
    let reader = std::io::BufReader::new(resp.body_mut().with_config().limit(64 << 20).reader());
    for line in reader.lines() {
        let line = line?;
        if let Some(d) = line.strip_prefix("data:") {
            if !on_data(d.trim_start()) {
                break;
            }
        }
    }
    Ok((status, String::new()))
}

/// An MCP message to an outside server (Streamable HTTP): the status, the session id it gave, and the body as text
/// (JSON, or an event stream that the caller reads for its answer). Follows up to 5 same-origin non-downgrade
/// 307/308 redirects (e.g. FastMCP/Starlette 307 `/mcp` → `/mcp/`) without re-POSTing on 301/302/303 or leaking credentials.
pub fn post_mcp(url: &str, headers: &[(String, String)], body: &Value, secs: u64) -> anyhow::Result<(u16, Option<String>, String)> {
    let lim = Some(Duration::from_secs(secs));
    let mut cur_url = url.to_string();
    for hop in 0..=MAX_AUTH_REDIRECTS {
        let mut req = auth_agent().post(&cur_url).config().timeout_global(lim).build();
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let mut resp = req.send_json(body.clone())?;
        if hop < MAX_AUTH_REDIRECTS && matches!(resp.status().as_u16(), 307 | 308) {
            if let Some(loc) = redirect_location(&resp) {
                if let Some(next) = safe_redirect_target(&cur_url, &loc) {
                    cur_url = next;
                    continue;
                }
            }
        }
        let status = resp.status().as_u16();
        let sid = resp.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()).map(String::from);
        return Ok((status, sid, resp.body_mut().with_config().limit(16 << 20).read_to_string()?));
    }
    anyhow::bail!("too many redirects")
}

/// A JSON POST with extra headers: the status and the body as text (an MCP server may answer as an event stream).
/// (to this Mac only: never through a proxy, no redirects, so a credential stays here)
pub fn post_with(url: &str, headers: &[(&str, &str)], body: &Value) -> anyhow::Result<(u16, String)> {
    let mut req = local_agent().post(url);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let mut resp = req.send_json(body.clone())?;
    let status = resp.status().as_u16();
    Ok((status, resp.body_mut().with_config().limit(8 << 20).read_to_string()?))
}

/// A small file (an icon): (status, content type, bytes), at most `max` bytes.
pub fn get_bytes(url: &str, max: u64) -> anyhow::Result<(u16, String, Vec<u8>)> {
    let mut resp = shared_agent().get(url).call()?;
    let status = resp.status().as_u16();
    let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let bytes = resp.body_mut().with_config().limit(max).read_to_vec()?;
    Ok((status, ct, bytes))
}

/// Fetches bytes from an untrusted user-supplied public URL (bookmark previews/icons): follows up to 5 redirects
/// (http → https, apex → www, short links) while checking `is_public_url` + pinning DNS resolution to public IPs
/// via `PublicOnlyResolver` on every hop so redirects and DNS rebinding cannot reach loopback, LAN, or metadata.
pub fn get_public_bytes(url: &str, max: u64) -> anyhow::Result<(u16, String, Vec<u8>)> {
    let mut cur_url = url.to_string();
    for hop in 0..=MAX_PUBLIC_REDIRECTS {
        anyhow::ensure!(is_public_url(&cur_url), "refused non-public URL");
        let mut resp = public_agent().get(&cur_url).call()?;
        if hop < MAX_PUBLIC_REDIRECTS {
            if let Some(loc) = redirect_location(&resp) {
                let next = resolve_redirect_url(&cur_url, &loc).ok_or_else(|| anyhow::anyhow!("refused redirect URL"))?;
                anyhow::ensure!(is_public_url(&next), "refused non-public redirect target");
                cur_url = next;
                continue;
            }
        }
        let status = resp.status().as_u16();
        let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let bytes = resp.body_mut().with_config().limit(max).read_to_vec()?;
        return Ok((status, ct, bytes));
    }
    anyhow::bail!("too many redirects")
}

/// A stream's ICY metadata block (a short read: up to its first block). Err: the stream has no ICY titles.
pub fn icy_block(url: &str) -> Result<Option<Vec<u8>>, ()> {
    use std::io::Read;
    let a: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into();
    let Ok(mut resp) = a.get(url).header("Icy-MetaData", "1").call() else { return Ok(None) };
    let every: usize = match resp.headers().get("icy-metaint").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()) {
        Some(n) if n > 0 && n < 1 << 20 => n,
        _ => return Err(()),
    };
    let mut r = resp.body_mut().as_reader();
    if std::io::copy(&mut (&mut r).take(every as u64), &mut std::io::sink()).ok() != Some(every as u64) {
        return Ok(None);
    }
    let mut len = [0u8; 1];
    if r.read_exact(&mut len).is_err() {
        return Ok(None);
    }
    let mut block = vec![0u8; len[0] as usize * 16];
    Ok(r.read_exact(&mut block).ok().map(|_| block))
}

/// One timed transfer of the speed test: bytes, seconds, and Cloudflare's `cf-ray` / `server-timing`.
pub struct Timed {
    pub bytes: u64,
    pub secs: f64,
    pub ray: String,
    pub server_timing: String,
}

/// The speed test's connection (kept alive between its requests, so a ping is one round trip).
pub struct Timer(ureq::Agent);

impl Default for Timer {
    fn default() -> Self {
        Timer(ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(30))).http_status_as_error(true)
            .user_agent(concat!("Sympony/", env!("CARGO_PKG_VERSION"))).build().into())
    }
}

impl Timer {
    fn timed(resp: &ureq::http::Response<ureq::Body>, bytes: u64, secs: f64) -> Timed {
        let h = |k: &str| resp.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        Timed { bytes, secs, ray: h("cf-ray"), server_timing: h("server-timing") }
    }

    /// A GET read to its end; `chunk(bytes so far)` after each piece, false to stop.
    pub fn get(&self, url: &str, chunk: &mut dyn FnMut(u64) -> bool) -> anyhow::Result<Timed> {
        use std::io::Read;
        let t = std::time::Instant::now();
        let mut resp = self.0.get(url).header("Accept-Encoding", "identity").call()?;
        let mut r = resp.body_mut().with_config().limit(200 << 20).reader();
        let mut buf = vec![0u8; 64 << 10];
        let mut n = 0u64;
        loop {
            let k = r.read(&mut buf)?;
            if k == 0 {
                break;
            }
            n += k as u64;
            anyhow::ensure!(chunk(n), "cancelled");
        }
        drop(r);
        Ok(Self::timed(&resp, n, t.elapsed().as_secs_f64()))
    }

    /// A POST of `n` bytes.
    pub fn post(&self, url: &str, n: usize) -> anyhow::Result<Timed> {
        let body = vec![b'0'; n];
        let t = std::time::Instant::now();
        let resp = self.0.post(url).header("Content-Type", "application/octet-stream").send(&body[..])?;
        Ok(Self::timed(&resp, n as u64, t.elapsed().as_secs_f64()))
    }
}
