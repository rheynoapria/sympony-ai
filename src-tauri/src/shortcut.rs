//! The toggle shortcut (setting `toggleShortcut`, e.g. "Alt+N").
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

/// "Alt+N", "Ctrl+Shift+Space", "Cmd+Option+5"… At least one modifier (a bare key would take it from every app),
/// exactly one key: a letter, a digit, Space, or F1-F12. Anything else: None.
pub fn parse_shortcut(s: &str) -> Option<Shortcut> {
    let mut mods = Modifiers::empty();
    let mut key = None;
    for part in s.split('+').map(str::trim) {
        let m = match part.to_ascii_lowercase().as_str() {
            "alt" | "option" | "opt" => Some(Modifiers::ALT),
            "ctrl" | "control" => Some(Modifiers::CONTROL),
            "shift" => Some(Modifiers::SHIFT),
            "cmd" | "command" | "super" | "meta" => Some(Modifiers::SUPER),
            _ => None,
        };
        match m {
            Some(m) => mods |= m,
            None if key.is_none() => key = Some(code(part)?),
            None => return None,
        }
    }
    (!mods.is_empty()).then_some(())?;
    Some(Shortcut::new(Some(mods), key?))
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    Keep,
    Register(Shortcut),
    Unregister,
    /// the setting doesn't parse: log it (once: `last_bad` is the one already logged, or refused) and drop the current one
    Bad,
}

pub fn decide(wanted: &str, current: Option<Shortcut>, last_bad: &str) -> Decision {
    match parse_shortcut(wanted) {
        Some(sc) if current == Some(sc) => Decision::Keep,
        Some(_) if wanted == last_bad && current.is_none() => Decision::Keep,
        Some(sc) => Decision::Register(sc),
        None if wanted.is_empty() => if current.is_some() { Decision::Unregister } else { Decision::Keep },
        None if wanted == last_bad && current.is_none() => Decision::Keep,
        None => Decision::Bad,
    }
}

fn code(k: &str) -> Option<Code> {
    let up = k.to_ascii_uppercase();
    let c = match up.as_str() {
        "SPACE" => "Space".to_string(),
        s if s.len() == 1 && s.as_bytes()[0].is_ascii_alphabetic() => format!("Key{s}"),
        s if s.len() == 1 && s.as_bytes()[0].is_ascii_digit() => format!("Digit{s}"),
        s if s.starts_with('F') && s[1..].parse::<u8>().is_ok_and(|n| (1..=12).contains(&n)) => s.to_string(),
        _ => return None,
    };
    c.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::parse_shortcut;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    #[test]
    fn parses_alt_n() {
        assert_eq!(parse_shortcut("Alt+N"), Some(Shortcut::new(Some(Modifiers::ALT), Code::KeyN)));
        assert_eq!(parse_shortcut("ctrl+shift+space"), Some(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)));
        assert_eq!(parse_shortcut("Cmd+Option+5"), Some(Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::Digit5)));
    }

    #[test]
    fn decide_logs_a_bad_setting_once() {
        use super::{decide, Decision};
        let alt_n = parse_shortcut("Alt+N");
        assert_eq!(decide("Foo+N", None, ""), Decision::Bad);
        assert_eq!(decide("Foo+N", None, "Foo+N"), Decision::Keep); // already logged
        assert_eq!(decide("Alt+N", None, ""), Decision::Register(alt_n.unwrap()));
        assert_eq!(decide("Alt+N", alt_n, ""), Decision::Keep);
        assert_eq!(decide("", alt_n, ""), Decision::Unregister);
        assert_eq!(decide("Foo+N", alt_n, ""), Decision::Bad); // and the old one goes
        // one that parses but macOS refused (taken by another app): not tried and logged again
        assert_eq!(decide("Alt+N", None, "Alt+N"), Decision::Keep);
    }

    #[test]
    fn rejects_bad() {
        for bad in ["", "Alt+", "Foo+N", "N", "Alt+Shift"] {
            assert_eq!(parse_shortcut(bad), None, "{bad:?}");
        }
    }
}
