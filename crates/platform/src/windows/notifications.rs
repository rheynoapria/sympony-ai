//! Other apps' notifications, read from Windows' notification database (`wpndatabase.db`, the toasts the
//! notification centre holds; this account's own file, opened read-only beside Windows' service), in the same shapes
//! as macOS's usernoted reader: each row's `data` is the toast's XML (`services::notif::parse_toast`), `app` its app id
//! (AUMID), `at` when it came. Also: what a click on one does (the app is activated as Windows' own click does it), and
//! a toast of Sympony's own (Settings → Notifications → Send a test).
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum Access {
    /// not allowed to read them (never on Windows: the file is this account's)
    Denied,
    /// nothing to read from
    Missing,
    Failed(String),
}

pub struct Row {
    pub id: i64,
    pub data: Vec<u8>,
    pub app: String,
    /// when it came (Unix ms)
    pub at: i64,
}

pub fn db_path() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default();
    local.join(r"Microsoft\Windows\Notifications\wpndatabase.db")
}

fn open() -> Result<Connection, Access> {
    let path = db_path();
    if !path.exists() {
        return Err(Access::Missing);
    }
    // (read-only beside Windows' notification service, which keeps it in WAL mode: readers don't wait for it)
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| Access::Failed(e.to_string()))
}

const MAX: &str = r#"SELECT IFNULL(MAX("Order"), 0) FROM Notification"#;
/// Toasts after a row, oldest first, with their app's id; ArrivalTime is a FILETIME (100 ns from 1601).
const AFTER: &str = r#"SELECT n."Order", n.Payload, IFNULL(h.PrimaryId, ''), IFNULL(n.ArrivalTime, 0) FROM Notification n
    LEFT JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n."Order" > ?1 ORDER BY n."Order""#;

fn unix_ms(filetime: i64) -> i64 {
    if filetime <= 0 {
        return chrono_now_ms();
    }
    filetime / 10_000 - 11_644_473_600_000
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn rows_after(db: &Connection, after: i64) -> rusqlite::Result<Vec<Row>> {
    let mut st = db.prepare_cached(AFTER)?;
    let rows = st.query_map([after], |r| {
        Ok(Row { id: r.get(0)?, data: r.get::<_, Option<Vec<u8>>>(1)?.unwrap_or_default(), app: r.get(2)?, at: unix_ms(r.get(3)?) })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// A handle kept open for the poll every second; opened again after an error.
#[derive(Default)]
pub struct Reader {
    db: Option<Connection>,
}

impl Reader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn close(&mut self) {
        self.db = None;
    }

    fn ensure_open(&mut self) -> Result<&Connection, Access> {
        if self.db.is_none() {
            self.db = Some(open()?);
        }
        Ok(self.db.as_ref().unwrap())
    }

    pub fn max_rowid(&mut self) -> Result<i64, Access> {
        let db = self.ensure_open()?;
        match db.prepare_cached(MAX).and_then(|mut st| st.query_row([], |r| r.get(0))) {
            Ok(id) => Ok(id),
            Err(e) => {
                self.close();
                Err(Access::Failed(e.to_string()))
            }
        }
    }

    pub fn read_after(&mut self, after: i64) -> Result<Vec<Row>, Access> {
        let db = self.ensure_open()?;
        match rows_after(db, after) {
            Ok(rows) => Ok(rows),
            Err(e) => {
                self.close();
                Err(Access::Failed(e.to_string()))
            }
        }
    }
}

/// The newest row's number (0 for none): where to start, so what's already there isn't shown.
pub fn max_rowid() -> Result<i64, Access> {
    open()?.query_row(MAX, [], |r| r.get(0)).map_err(|e| Access::Failed(e.to_string()))
}

/// Toasts newer than `after`, oldest first.
pub fn read_after(after: i64) -> Result<Vec<Row>, Access> {
    rows_after(&open()?, after).map_err(|e| Access::Failed(e.to_string()))
}

/// Apps that posted a toast here, by id (AUMID): a desktop app's entry in the notification centre comes with its first
/// toast; a Store app's comes when it's installed, so it counts only while one of its toasts is still there.
const APPS: &str = r#"SELECT h.PrimaryId FROM NotificationHandler h WHERE IFNULL(h.PrimaryId, '') <> ''
    AND (h.HandlerType = 'app:desktop' OR EXISTS (SELECT 1 FROM Notification n WHERE n.HandlerId = h.RecordId AND n.Type = 'toast'))"#;

/// The ids (AUMIDs) of the apps that posted a toast here (`APPS`).
pub fn apps() -> Result<Vec<String>, Access> {
    let db = open()?;
    let ids = db.prepare(APPS).and_then(|mut st| {
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(Result::ok).filter(|id| !id.is_empty()).collect())
    });
    ids.map_err(|e| Access::Failed(e.to_string()))
}

/// What a click on a notification does, as Windows' own click: a Store app is activated with the toast's `launch`;
/// a desktop app that registered a toast activator (browsers, chat apps) gets it through that; otherwise the app is
/// opened. False when none of these could be done.
pub fn activate(app_id: &str, launch: &str) -> bool {
    use ::windows::core::{HSTRING, PCWSTR};
    use ::windows::Win32::System::Com::{CoCreateInstance, CLSCTX_LOCAL_SERVER};
    use ::windows::Win32::UI::Notifications::INotificationActivationCallback;
    use ::windows::Win32::UI::Shell::{ApplicationActivationManager, IApplicationActivationManager, AO_NONE};
    if app_id.is_empty() {
        return false;
    }
    super::mta();
    let (id, args) = (HSTRING::from(app_id), HSTRING::from(launch));
    // SAFETY: COM calls on this thread's apartment, with NUL-terminated strings that outlive them
    unsafe {
        if app_id.contains('!') {
            if let Ok(m) = CoCreateInstance::<_, IApplicationActivationManager>(&ApplicationActivationManager, None, CLSCTX_LOCAL_SERVER) {
                if m.ActivateApplication(&id, &args, AO_NONE).is_ok() {
                    return true;
                }
            }
        }
        if let Some(clsid) = toast_activator(app_id) {
            if let Ok(cb) = CoCreateInstance::<_, INotificationActivationCallback>(&clsid, None, CLSCTX_LOCAL_SERVER) {
                if cb.Activate(PCWSTR(id.as_ptr()), PCWSTR(args.as_ptr()), &[]).is_ok() {
                    return true;
                }
            }
        }
    }
    super::shell::open(&format!(r"shell:AppsFolder\{app_id}"))
}

/// The toast activator a desktop app registered for its notifications: on its Start menu shortcut, or under
/// `AppUserModelId\<id>\CustomActivator`.
fn toast_activator(app_id: &str) -> Option<::windows::core::GUID> {
    use ::windows::core::{GUID, HSTRING};
    use ::windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ToastActivatorCLSID;
    use ::windows::Win32::UI::Shell::{IShellItem2, SHCreateItemFromParsingName};
    // SAFETY: a COM call on this thread's apartment with a string that outlives it
    let from_shortcut = unsafe {
        SHCreateItemFromParsingName::<_, _, IShellItem2>(&HSTRING::from(format!(r"shell:AppsFolder\{app_id}")), None)
            .and_then(|item| item.GetCLSID(&PKEY_AppUserModel_ToastActivatorCLSID))
            .ok()
    };
    from_shortcut.filter(|g| *g != GUID::zeroed()).or_else(|| {
        let v = reg_string(&format!(r"Software\Classes\AppUserModelId\{app_id}"), "CustomActivator")?;
        GUID::try_from(v.trim_matches(['{', '}'])).ok()
    })
}

fn reg_string(key: &str, name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let (key, name) = (super::shell::wide(key), super::shell::wide(name));
    let (mut buf, mut size) = ([0u16; 512], 1024u32);
    // SAFETY: NUL-terminated names and a buffer with its size in bytes, all outliving the call
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size) };
    if read != 0 {
        return None;
    }
    let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..n]))
}

fn set_reg_string(key: &str, name: &str, value: &str) -> bool {
    use windows_sys::Win32::System::Registry::{RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let (key, name, value) = (super::shell::wide(key), super::shell::wide(name), super::shell::wide(value));
    // SAFETY: NUL-terminated strings, the value's size in bytes with its NUL
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, value.as_ptr().cast(), (value.len() * 2) as u32) == 0 }
}

const APP_SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";

/// An app's "Show notification banners" (Settings → System → Notifications → the app) as Windows keeps it: 0 off, 1
/// on, None when never set (on). Windows reads it as each toast comes.
pub fn banner_setting(app_id: &str) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let (key, name) = (super::shell::wide(&format!(r"{APP_SETTINGS}\{app_id}")), super::shell::wide("ShowBanner"));
    let (mut v, mut size) = (0u32, 4u32);
    // SAFETY: NUL-terminated names, a DWORD with its size
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(), (&raw mut v).cast(), &mut size) };
    (read == 0).then_some(v)
}

/// Sets an app's "Show notification banners" (None: back to never set).
pub fn set_banner_setting(app_id: &str, value: Option<u32>) -> bool {
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD};
    let (key, name) = (super::shell::wide(&format!(r"{APP_SETTINGS}\{app_id}")), super::shell::wide("ShowBanner"));
    // SAFETY: NUL-terminated names, a DWORD with its size
    unsafe {
        match value {
            Some(v) => RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_DWORD, (&raw const v).cast(), 4) == 0,
            None => {
                let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr());
                // (already gone is fine)
                r == 0 || r == windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND
            }
        }
    }
}

/// A toast from `app_id`, which is registered first as an app Windows may take toasts from (its shown name and icon,
/// under `AppUserModelId`, as apps without a Start menu shortcut do). False when Windows didn't take it.
pub fn post(app_id: &str, name: &str, icon: Option<&Path>, title: &str, body: &str) -> bool {
    use ::windows::core::HSTRING;
    use ::windows::Data::Xml::Dom::XmlDocument;
    use ::windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    let key = format!(r"Software\Classes\AppUserModelId\{app_id}");
    set_reg_string(&key, "DisplayName", name);
    if let Some(icon) = icon {
        set_reg_string(&key, "IconUri", &icon.to_string_lossy());
    }
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let xml = format!(r#"<toast><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#, esc(title), esc(body));
    super::mta();
    (|| -> ::windows::core::Result<()> {
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
    })()
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_toast_s_app_is_among_the_apps() {
        // (this account's own notification centre; none on the machine: nothing to check)
        let (Ok(rows), Ok(apps)) = (read_after(0), apps()) else { return };
        let missing = rows.iter().filter(|r| !r.app.is_empty() && !apps.contains(&r.app)).count();
        // (counted, not named: the apps are this account's)
        assert_eq!(missing, 0, "toasts whose app isn't among the {} apps", apps.len());
        assert!(apps.iter().all(|id| !id.is_empty()));
    }
}
