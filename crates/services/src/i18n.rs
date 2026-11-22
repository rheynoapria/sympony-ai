//! Sympony's language (pure): the OS languages, which one is used, the offered list and a downloaded table
//! checked (i18n.js applies them).
use serde_json::{Map, Value};

/// `defaults read -g AppleLanguages` → the codes, in order ("en-ID", "id-ID").
pub fn system_codes(out: &str) -> Vec<String> {
    out.split(['(', ')', ',', '\n']).map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect()
}

/// A language code as a file name may hold it: "id", "pt-BR".
pub fn valid_code(c: &str) -> bool {
    !c.is_empty() && c.len() <= 10 && c.split('-').all(|p| !p.is_empty() && p.chars().all(|ch| ch.is_ascii_alphanumeric())) && c.chars().next().is_some_and(|ch| ch.is_ascii_lowercase())
}

/// The language used for the setting ("auto": the Mac's first language Sympony offers, its own or its family's;
/// English when none).
pub fn resolve(setting: &str, system: &[String], offered: &[String]) -> String {
    let pick = |c: &str| -> Option<String> {
        if c == "en" || c.starts_with("en-") {
            return Some("en".into());
        }
        offered.iter().find(|o| o.eq_ignore_ascii_case(c)).or_else(|| offered.iter().find(|o| c.split('-').next().is_some_and(|l| o.eq_ignore_ascii_case(l)))).cloned()
    };
    match setting {
        "" | "auto" => system.iter().find_map(|c| pick(c)).unwrap_or_else(|| "en".into()),
        s if valid_code(s) => s.to_string(),
        _ => "en".into(),
    }
}

/// The languages offered (ready ones with a good code): (code, name, rtl).
pub fn offered(list: &Value) -> Vec<(String, String, bool)> {
    list["languages"].as_array().into_iter().flatten().filter(|l| l["ready"] == true).filter_map(|l| {
        let code = l["code"].as_str().filter(|c| valid_code(c))?;
        Some((code.to_string(), l["name"].as_str().unwrap_or(code).to_string(), l["rtl"] == true))
    }).collect()
}

/// A downloaded table: a JSON object of texts (at most 4 MB).
pub fn table(bytes: &[u8]) -> Result<Map<String, Value>, String> {
    if bytes.len() > 4 << 20 {
        return Err("too big".into());
    }
    let v: Value = serde_json::from_slice(bytes).map_err(|_| "not a translation".to_string())?;
    let m = v.as_object().filter(|m| !m.is_empty()).ok_or("not a translation")?;
    if !m.values().all(|v| v.as_str().is_some_and(safe_markup)) {
        return Err("not a translation (or markup Sympony doesn't take)".into());
    }
    Ok(m.clone())
}

/// The few tags the translations use, exactly so (the pages put the texts in as HTML: anything else could run code).
const TAGS: &[&str] = &["<b>", "</b>", "<i>", "</i>", "<code>", "</code>", "<kbd>", "</kbd>", "<br>", "<br/>", "<br />", "<span class=\"ok\">", "</span>"];

fn safe_markup(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    while let Some(off) = s[i..].find('<') {
        let at = i + off;
        let next = b.get(at + 1).copied().unwrap_or(b' ');
        // ("a < b": not a tag)
        if next.is_ascii_alphabetic() || matches!(next, b'/' | b'!' | b'?') {
            match TAGS.iter().find(|t| s[at..].starts_with(*t)) {
                Some(t) => i = at + t.len(),
                None => return false,
            }
        } else {
            i = at + 1;
        }
    }
    true
}
