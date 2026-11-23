//! Running apps (stand-in: none seen yet). On Windows an app's id is its executable name (`chrome.exe`) where macOS
//! has a bundle id.

pub fn frontmost_pid() -> Option<i32> {
    None
}

pub fn activate_pid(_pid: i32) {}

pub fn running(_bundle_id: &str) -> bool {
    false
}

pub fn pid_of(_bundle_id: &str) -> Option<i32> {
    None
}

pub fn icon_png(_bundle_id: &str, _px: f64) -> Option<Vec<u8>> {
    None
}

pub fn app_name(_bundle_id: &str) -> Option<String> {
    None
}

pub fn bundle_for_name(_name: &str) -> Option<String> {
    None
}

/// (id, name) of the app in front.
pub fn frontmost() -> Option<(String, String)> {
    None
}

pub fn is_app(_pid: i32) -> bool {
    false
}

/// (id, name) of each app with a window.
pub fn open_apps() -> Vec<(String, String)> {
    vec![]
}
