//! What Settings → Privacy & security allows Sympony for a capability (`location`, `microphone`): the switch for the
//! whole PC, "Let apps access…", "Let desktop apps access…" (Sympony is a desktop app) and, where Windows asks each
//! desktop app (Windows 11 24H2 on), Sympony's own answer.
use ::windows::core::HSTRING;
use ::windows::Security::Authorization::AppCapabilityAccess::{AppCapability, AppCapabilityAccessStatus};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Consent {
    /// off for the whole PC
    Off,
    /// apps, desktop apps or Sympony aren't allowed
    Denied,
    /// Windows will ask (its prompt) the first time Sympony uses it
    NotAsked,
    Allowed,
}

impl Consent {
    /// `"granted" | "denied" | "notAsked"`, as macOS's permissions read.
    pub(crate) fn perm(self) -> &'static str {
        match self {
            Consent::Allowed => "granted",
            Consent::NotAsked => "notAsked",
            Consent::Off | Consent::Denied => "denied",
        }
    }
}

/// A consent store's "Allow" / "Deny" (`Value` under `key`, in the machine's or the user's part of the registry).
fn store_value(machine: bool, key: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let (key, name) = (super::shell::wide(key), super::shell::wide("Value"));
    let (mut buf, mut size) = ([0u16; 32], 64u32);
    let root = if machine { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER };
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return None;
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

pub(crate) fn consent(capability: &str) -> Consent {
    let store = format!(r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{capability}");
    let deny = |v: Option<String>| v.is_some_and(|v| v.eq_ignore_ascii_case("Deny"));
    if deny(store_value(true, &store)) {
        return Consent::Off;
    }
    if deny(store_value(false, &store)) || deny(store_value(false, &format!(r"{store}\NonPackaged"))) {
        return Consent::Denied;
    }
    // (Sympony's own answer, under its path with `#` for `\`)
    let own = std::env::current_exe().ok().and_then(|p| store_value(false, &format!(r"{store}\NonPackaged\{}", p.to_string_lossy().replace('\\', "#"))));
    match own.as_deref() {
        Some(v) if v.eq_ignore_ascii_case("Deny") => return Consent::Denied,
        Some(v) if v.eq_ignore_ascii_case("Allow") => return Consent::Allowed,
        _ => {}
    }
    super::mta();
    match AppCapability::Create(&HSTRING::from(capability)).and_then(|c| c.CheckAccess()) {
        Ok(AppCapabilityAccessStatus::UserPromptRequired) => Consent::NotAsked,
        Ok(AppCapabilityAccessStatus::DeniedByUser) => Consent::Denied,
        Ok(AppCapabilityAccessStatus::DeniedBySystem) => Consent::Off,
        // (allowed, or a Windows that doesn't ask desktop apps: the switches above decide)
        _ => Consent::Allowed,
    }
}

/// Windows' own prompt for the capability, when it has one for Sympony and hasn't had an answer; doesn't wait for it.
pub(crate) fn ask(capability: &'static str) {
    if consent(capability) != Consent::NotAsked {
        return;
    }
    std::thread::spawn(move || {
        super::mta();
        let _ = AppCapability::Create(&HSTRING::from(capability)).and_then(|c| c.RequestAccessAsync()).and_then(|op| op.join());
    });
}
