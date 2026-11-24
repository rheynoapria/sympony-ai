//! Launch at login on Windows, as Task Manager → Startup apps and Settings → Apps → Startup list it: the app's value
//! under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, and the "disabled" mark those two pages keep for it
//! under `Explorer\StartupApproved\Run`. Only this account's keys, so nothing needs elevation.
use std::path::Path;

const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

/// What Windows starts at login under a name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// The command as written (Sympony writes its quoted path)
    pub command: String,
    /// False when it was turned off in Task Manager or Settings → Apps → Startup
    pub enabled: bool,
}

/// The entry under `name`; None when Windows starts nothing under it.
pub fn entry(name: &str) -> Option<Entry> {
    entry_in(RUN, APPROVED, name)
}

/// Starts `exe` at login under `name` (its quoted path, no arguments), and clears a "disabled" mark left by Task
/// Manager, so turning it on in Sympony turns it on in Windows too.
pub fn register(name: &str, exe: &Path) -> Result<(), String> {
    register_in(RUN, APPROVED, name, exe)
}

/// Takes `name` off the login list, with its mark. Already gone is fine.
pub fn unregister(name: &str) -> Result<(), String> {
    unregister_in(RUN, APPROVED, name)
}

/// The program a Run command starts: the quoted path, else the text up to the first space.
pub fn program_of(command: &str) -> &str {
    let c = command.trim();
    match c.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or(rest),
        None => c.split(' ').next().unwrap_or(c),
    }
}

fn entry_in(run: &str, approved: &str, name: &str) -> Option<Entry> {
    let command = read_string(run, name)?;
    // (Task Manager writes 12 bytes: the first is odd while turned off, then when it was; no value at all is on)
    let enabled = read_binary(approved, name).and_then(|b| b.first().copied()).is_none_or(|first| first & 1 == 0);
    Some(Entry { command, enabled })
}

fn register_in(run: &str, approved: &str, name: &str, exe: &Path) -> Result<(), String> {
    let command = format!("\"{}\"", exe.display());
    if !write_string(run, name, &command) {
        return Err(format!("couldn't write {name} under {run}"));
    }
    delete_value(approved, name);
    Ok(())
}

fn unregister_in(run: &str, approved: &str, name: &str) -> Result<(), String> {
    let gone = delete_value(run, name);
    delete_value(approved, name);
    if gone { Ok(()) } else { Err(format!("couldn't remove {name} from {run}")) }
}

fn read_string(key: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};
    let (key, name) = (super::shell::wide(key), super::shell::wide(name));
    let (mut buf, mut size) = (vec![0u16; 1024], 2048u32);
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return None;
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

fn read_binary(key: &str, name: &str) -> Option<Vec<u8>> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
    let (key, name) = (super::shell::wide(key), super::shell::wide(name));
    let (mut buf, mut size) = ([0u8; 64], 64u32);
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_BINARY, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    (read == 0).then(|| buf[..(size as usize).min(buf.len())].to_vec())
}

fn write_string(key: &str, name: &str, value: &str) -> bool {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let (key, name, value) = (super::shell::wide(key), super::shell::wide(name), super::shell::wide(value));
    // SAFETY: NUL-terminated strings, the value's size in bytes with its NUL (the key is made when missing)
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) == 0 }
}

/// True when the value is gone afterwards (also when it, or its key, never was).
fn delete_value(key: &str, name: &str) -> bool {
    use windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, HKEY_CURRENT_USER};
    let (key, name) = (super::shell::wide(key), super::shell::wide(name));
    // SAFETY: NUL-terminated names outliving the call
    let r = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) };
    r == 0 || r == ERROR_FILE_NOT_FOUND
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Scratch keys at `HKCU\Software\Sympony-test-startup-<tag>-<pid>`, never the real Run keys; removed when dropped,
    /// also after a failed assert. (Each test has its own key right under Software: a shared parent deleted by one test
    /// while another creates its path under it fails that one with ERROR_KEY_DELETED.)
    struct Scratch {
        root: String,
        run: String,
        approved: String,
    }

    impl Scratch {
        fn new(tag: &str) -> Self {
            let root = format!(r"Software\Sympony-test-startup-{tag}-{}", std::process::id());
            Scratch { run: format!(r"{root}\Run"), approved: format!(r"{root}\StartupApproved\Run"), root }
        }

        fn mark(&self, name: &str, bytes: &[u8]) {
            use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_BINARY};
            let (key, name) = (super::super::shell::wide(&self.approved), super::super::shell::wide(name));
            // SAFETY: NUL-terminated names, the bytes with their length
            let r = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_BINARY, bytes.as_ptr().cast(), bytes.len() as u32) };
            assert_eq!(r, 0);
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            use windows_sys::Win32::System::Registry::{RegDeleteKeyW, RegDeleteTreeW, HKEY_CURRENT_USER};
            let root = super::super::shell::wide(&self.root);
            // SAFETY: a NUL-terminated path: the key's subkeys and values, then the key itself
            unsafe {
                RegDeleteTreeW(HKEY_CURRENT_USER, root.as_ptr());
                RegDeleteKeyW(HKEY_CURRENT_USER, root.as_ptr());
            }
        }
    }

    const EXE: &str = r"C:\Users\someone\AppData\Local\Sympony\sympony.exe";

    #[test]
    fn nothing_listed_reads_none() {
        let s = Scratch::new("none");
        assert_eq!(entry_in(&s.run, &s.approved, "Sympony"), None);
        // (taking off what isn't there is fine)
        assert_eq!(unregister_in(&s.run, &s.approved, "Sympony"), Ok(()));
    }

    #[test]
    fn registering_writes_the_quoted_path_and_unregistering_removes_it() {
        let s = Scratch::new("cycle");
        register_in(&s.run, &s.approved, "Sympony", Path::new(EXE)).unwrap();
        let e = entry_in(&s.run, &s.approved, "Sympony").unwrap();
        assert_eq!(e.command, format!("\"{EXE}\""));
        assert!(e.enabled);
        assert_eq!(program_of(&e.command), EXE);
        unregister_in(&s.run, &s.approved, "Sympony").unwrap();
        assert_eq!(entry_in(&s.run, &s.approved, "Sympony"), None);
    }

    #[test]
    fn task_managers_mark_turns_it_off_and_registering_clears_it() {
        let s = Scratch::new("mark");
        register_in(&s.run, &s.approved, "Sympony", Path::new(EXE)).unwrap();
        // turned off in Task Manager: 03 00 00 00 and when (a FILETIME)
        s.mark("Sympony", &[3, 0, 0, 0, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x01]);
        assert!(!entry_in(&s.run, &s.approved, "Sympony").unwrap().enabled);
        // turned on again there: an even first byte
        s.mark("Sympony", &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert!(entry_in(&s.run, &s.approved, "Sympony").unwrap().enabled);
        s.mark("Sympony", &[7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert!(!entry_in(&s.run, &s.approved, "Sympony").unwrap().enabled);
        // turned on in Sympony: listed again and the mark is gone
        register_in(&s.run, &s.approved, "Sympony", Path::new(EXE)).unwrap();
        assert!(entry_in(&s.run, &s.approved, "Sympony").unwrap().enabled);
        assert_eq!(read_binary(&s.approved, "Sympony"), None);
        // turned off in Sympony: both are gone
        s.mark("Sympony", &[3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        unregister_in(&s.run, &s.approved, "Sympony").unwrap();
        assert_eq!(read_binary(&s.approved, "Sympony"), None);
        assert_eq!(entry_in(&s.run, &s.approved, "Sympony"), None);
    }

    #[test]
    fn other_names_are_left_alone() {
        let s = Scratch::new("others");
        register_in(&s.run, &s.approved, "Other", Path::new(r"C:\Other\other.exe")).unwrap();
        register_in(&s.run, &s.approved, "Sympony", Path::new(EXE)).unwrap();
        unregister_in(&s.run, &s.approved, "Sympony").unwrap();
        assert_eq!(entry_in(&s.run, &s.approved, "Other").unwrap().command, "\"C:\\Other\\other.exe\"");
    }

    #[test]
    fn program_of_reads_quoted_and_bare_commands() {
        assert_eq!(program_of(r#""C:\Program Files\App\app.exe" --hidden"#), r"C:\Program Files\App\app.exe");
        assert_eq!(program_of(r"C:\Tools\tool.exe /min"), r"C:\Tools\tool.exe");
        assert_eq!(program_of(r"  C:\Tools\tool.exe  "), r"C:\Tools\tool.exe");
    }
}
