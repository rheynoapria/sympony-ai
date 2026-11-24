//! Google sign-in for Calendar & Tasks sync, the way installed apps do it: the browser opens Google's page, Google
//! sends the browser back to a one-time listener on 127.0.0.1, and the code it carries (checked by `state`, bound by
//! PKCE) becomes the tokens.
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::OsRng;
use base64::Engine;
use sha2::{Digest, Sha256};

pub const SCOPE_CALENDAR_EVENTS: &str = "https://www.googleapis.com/auth/calendar.events";
pub const SCOPE_CALENDAR_LIST: &str = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
pub const SCOPE_TASKS: &str = "https://www.googleapis.com/auth/tasks";
pub const SCOPE_EMAIL: &str = "https://www.googleapis.com/auth/userinfo.email";

pub const SCOPES: &str = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/userinfo.email";

/// Splits Google's space-delimited `scope` string into distinct granted scopes.
pub fn parse_scopes(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    for s in raw.split_whitespace() {
        if !s.is_empty() && !out.iter().any(|x| x == s) {
            out.push(s.to_string());
        }
    }
    out
}

/// Whether `scopes` grants `want` (exact match or matching suffix such as `"auth/tasks"`).
pub fn has_scope(scopes: &[String], want: &str) -> bool {
    scopes.iter().any(|s| s == want || s.ends_with(want))
}

fn b64url(b: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// A fresh random string (PKCE verifier, `state`).
pub fn random() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b64url(&b)
}

/// PKCE S256: the verifier's SHA-256, base64url.
pub fn challenge(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}

pub fn auth_url(client_id: &str, redirect: &str, challenge: &str, state: &str) -> String {
    let q = crate::http::q;
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        q(client_id), q(redirect), q(SCOPES), q(challenge), q(state)
    )
}

fn unq(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                out.push(u8::from_str_radix(&s[i + 1..i + 3], 16).unwrap_or(b'?'));
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The browser's request to the listener (`GET /?code=…&state=… HTTP/1.1`) → the code, or Google's error.
pub fn parse_redirect(request_line: &str, state: &str) -> Result<String, String> {
    let path = request_line.split_whitespace().nth(1).ok_or("not a request")?;
    let query = path.split_once('?').map(|x| x.1).ok_or("no answer in it")?;
    let get = |k: &str| query.split('&').filter_map(|kv| kv.split_once('=')).find(|(a, _)| *a == k).map(|(_, v)| unq(v));
    if get("state").as_deref() != Some(state) {
        return Err("the answer isn't for this sign-in".into());
    }
    if let Some(e) = get("error") {
        return Err(e);
    }
    get("code").ok_or_else(|| "no code in the answer".into())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The page the browser shows when it comes back to Sympony from a sign-in to `what` (Sympony AI, Google Tasks):
/// Pony with a check (`Ok(who)`, who may be empty) or the reason it failed, light or dark, Indonesian or English.
/// A tab the page didn't open can't close itself in most browsers: the button tries, then says ⌘W.
pub fn done_page(indonesian: bool, what: &str, result: Result<&str, &str>) -> String {
    let tr = |id: &'static str, en: &'static str| if indonesian { id } else { en };
    let (ok, title, body, extra) = match result {
        Ok(who) => (
            true,
            tr("Berhasil masuk", "You’re signed in").to_string(),
            if indonesian { format!("Sympony sudah tersambung ke {}. Jendela Sympony sudah dibuka untuk Anda.", esc(what)) }
            else { format!("Sympony is connected to {}. Sympony’s window is open for you.", esc(what)) },
            if who.is_empty() { String::new() } else if indonesian { format!("Masuk sebagai <b>{}</b>", esc(who)) } else { format!("Signed in as <b>{}</b>", esc(who)) },
        ),
        Err(e) => (
            false,
            tr("Belum berhasil masuk", "Sign-in didn’t finish").to_string(),
            esc(e),
            if what == "Sympony AI" {
                tr("Coba lagi dari Sympony: Pengaturan → Pony Assistant.", "Try again from Sympony: Settings → Pony Assistant.").to_string()
            } else {
                tr("Coba lagi dari Pengaturan Sympony.", "Try again from Sympony Settings.").to_string()
            },
        ),
    };
    let badge = if ok {
        r##"<circle cx="74" cy="20" r="13" fill="#22c55e"/><path d="M68 20.5l4 4 8-8.5" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"##
    } else {
        r##"<circle cx="74" cy="20" r="13" fill="#f59e0b"/><path d="M74 13v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="74" cy="27" r="1.9" fill="#fff"/>"##
    };
    let (close, hint) = (tr("Tutup tab ini", "Close this tab"), tr("Browser tidak mengizinkan tab ditutup otomatis. Tekan ⌘W untuk menutupnya.", "Your browser doesn’t let a page close its own tab. Press ⌘W to close it."));
    format!(
        r##"<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sympony</title>
<style>
:root{{color-scheme:light dark;--bg:#f6f6fb;--card:#fff;--fg:#14151c;--mute:#5d6072;--line:#e6e6ef;--btn:#14151c;--btnfg:#fff}}
@media (prefers-color-scheme:dark){{:root{{--bg:#0c0d12;--card:#15161d;--fg:#f2f2f7;--mute:#9a9caf;--line:#262833;--btn:#f2f2f7;--btnfg:#14151c}}}}
*{{box-sizing:border-box}}html,body{{height:100%;margin:0}}
body{{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--fg);background:var(--bg);display:grid;place-items:center;overflow:hidden}}
.aurora{{position:fixed;inset:-20%;z-index:0;background:radial-gradient(40% 35% at 30% 30%,rgba(99,102,241,.22),transparent 70%),radial-gradient(35% 30% at 70% 35%,rgba(139,92,246,.18),transparent 70%),radial-gradient(40% 35% at 55% 75%,rgba(34,211,238,.16),transparent 70%)}}
.card{{position:relative;z-index:1;width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:22px;padding:0 32px 30px;text-align:center;box-shadow:0 24px 60px -24px rgba(20,21,28,.35)}}
.notch{{width:104px;height:22px;margin:0 auto;background:#0b0b0f;border-radius:0 0 14px 14px;box-shadow:0 8px 22px -8px rgba(99,102,241,.7)}}
.pony{{display:block;margin:18px auto 6px;animation:drop .7s cubic-bezier(.3,1.5,.5,1) both}}
@keyframes drop{{from{{transform:translateY(-26px) scale(.9);opacity:0}}to{{transform:none;opacity:1}}}}
@media (prefers-reduced-motion:reduce){{.pony{{animation:none}}}}
h1{{font-size:21px;line-height:1.25;letter-spacing:-.01em;margin:8px 0 6px}}
p{{margin:0;color:var(--mute)}}p.who{{margin-top:12px;color:var(--fg);font-size:14px}}p.who b{{font-weight:600}}
button{{margin-top:22px;font:600 14px -apple-system,system-ui,sans-serif;color:var(--btnfg);background:var(--btn);border:0;border-radius:11px;padding:10px 18px;cursor:pointer}}
button:focus-visible{{outline:3px solid rgba(99,102,241,.5);outline-offset:2px}}
.hint{{margin-top:12px;font-size:13px;min-height:1.5em}}
.brand{{margin-top:22px;font-size:12px;color:var(--mute);opacity:.8}}
</style>
<div class="aurora"></div>
<main class="card">
<div class="notch"></div>
<svg class="pony" width="96" height="88" viewBox="0 0 96 88" aria-hidden="true"><defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b5e70"/><stop offset="1" stop-color="#16171f"/></linearGradient></defs>
<ellipse cx="44" cy="82" rx="26" ry="4" fill="rgba(0,0,0,.18)"/><rect x="8" y="16" width="72" height="62" rx="24" fill="url(#b)"/><rect x="18" y="32" width="52" height="26" rx="13" fill="#0b0c12"/>
<ellipse cx="34" cy="45" rx="5" ry="7" fill="#9ff3ff"/><ellipse cx="54" cy="45" rx="5" ry="7" fill="#9ff3ff"/><path d="{mouth}" stroke="#9ff3ff" stroke-width="2.5" fill="none" stroke-linecap="round"/>{badge}</svg>
<h1>{title}</h1><p>{body}</p>{who}
<button type="button" id="c">{close}</button>
<p class="hint" id="h"></p>
<p class="brand">Sympony</p>
</main>
<script>document.getElementById("c").onclick=function(){{window.close();setTimeout(function(){{document.getElementById("h").textContent={hint_js}}},250)}};</script>
</html>"##,
        lang = if indonesian { "id" } else { "en" },
        mouth = if ok { "M40 53.5q4 4 8 0" } else { "M40 55h8" },
        who = if extra.is_empty() { String::new() } else { format!("<p class=\"who\">{extra}</p>") },
        hint_js = serde_json::to_string(hint).unwrap_or_default(),
    )
}

#[cfg(test)]
mod page_tests {
    use super::done_page;

    #[test]
    fn done_page_escapes_and_speaks_the_language() {
        let ok = done_page(true, "Sympony AI", Ok("a<b>@x.com"));
        assert!(ok.contains("Berhasil masuk") && ok.contains("a&lt;b&gt;@x.com") && !ok.contains("a<b>@"));
        let bad = done_page(false, "Google Tasks", Err("<script>x</script>"));
        assert!(bad.contains("Sign-in didn’t finish") && bad.contains("&lt;script&gt;") && !bad.contains("<script>x"));
    }
}
