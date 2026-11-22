//! A bookmark's page (pure): its title (og:title, else <title>) and the icons to try, best first (apple-touch-icon,
//! icon links, /favicon.ico), as full addresses.

fn decode(s: &str) -> String {
    s.replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ").replace("&amp;", "&")
}

/// The attributes of each `<tag …>` (lower-case names).
fn tags(html: &str, low: &str, tag: &str) -> Vec<Vec<(String, String)>> {
    let open = format!("<{tag}");
    low.match_indices(open.as_str()).filter_map(|(i, _)| {
        let rest = &html[i + open.len()..];
        if !rest.starts_with(|c: char| c.is_whitespace()) {
            return None;
        }
        let end = rest.find('>')?;
        Some(attrs(&rest[..end]))
    }).collect()
}

fn attrs(s: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'/') { i += 1; }
        let ns = i;
        while i < b.len() && !b[i].is_ascii_whitespace() && b[i] != b'=' { i += 1; }
        let name = s[ns..i].to_ascii_lowercase();
        while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
        let mut val = String::new();
        if i < b.len() && b[i] == b'=' {
            i += 1;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            if i < b.len() && (b[i] == b'"' || b[i] == b'\'') {
                let q = b[i];
                let vs = i + 1;
                i = vs;
                while i < b.len() && b[i] != q { i += 1; }
                val = s[vs..i.min(b.len())].to_string();
                i += 1;
            } else {
                let vs = i;
                while i < b.len() && !b[i].is_ascii_whitespace() { i += 1; }
                val = s[vs..i].to_string();
            }
        }
        if !name.is_empty() { out.push((name, val)); }
    }
    out
}

fn get<'a>(a: &'a [(String, String)], k: &str) -> Option<&'a str> {
    a.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str())
}

/// `href` against the page's address.
pub fn absolute(base: &str, href: &str) -> String {
    if href.starts_with("http://") || href.starts_with("https://") { return href.to_string(); }
    let scheme = base.split("://").next().unwrap_or("https");
    if let Some(h) = href.strip_prefix("//") { return format!("{scheme}://{h}"); }
    let after = base.split("://").nth(1).unwrap_or(base);
    let host = after.split(['/', '?', '#']).next().unwrap_or(after);
    if href.starts_with('/') { return format!("{scheme}://{host}{href}"); }
    let path = after[host.len()..].split(['?', '#']).next().unwrap_or("");
    let dir = &path[..path.rfind('/').map_or(0, |i| i + 1)];
    let dir = if dir.is_empty() { "/" } else { dir };
    format!("{scheme}://{host}{dir}{href}")
}

pub fn page_meta(html: &str, url: &str) -> (Option<String>, Vec<String>) {
    let low = html.to_ascii_lowercase();
    let og = tags(html, &low, "meta").into_iter().find(|a| get(a, "property") == Some("og:title")).and_then(|a| get(&a, "content").map(String::from));
    let title = og.or_else(|| {
        let s = low.find("<title")?;
        let open = s + low[s..].find('>')? + 1;
        let close = open + low[open..].find("</title")?;
        Some(html[open..close].to_string())
    }).map(|t| decode(t.split_whitespace().collect::<Vec<_>>().join(" ").as_str())).filter(|t| !t.is_empty());
    let mut icons: Vec<(u8, String)> = tags(html, &low, "link").into_iter().filter_map(|a| {
        let rel = get(&a, "rel")?.to_ascii_lowercase();
        let href = get(&a, "href").filter(|h| !h.is_empty())?;
        let rank = if rel.contains("apple-touch-icon") { 0 } else if rel.split_whitespace().any(|r| r == "icon") { 1 } else { return None };
        Some((rank, absolute(url, &decode(href))))
    }).collect();
    icons.sort_by_key(|x| x.0);
    let mut out: Vec<String> = icons.into_iter().map(|x| x.1).collect();
    let fav = absolute(url, "/favicon.ico");
    if !out.contains(&fav) { out.push(fav); }
    (title, out)
}
