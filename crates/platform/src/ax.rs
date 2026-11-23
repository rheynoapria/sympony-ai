//! Other apps' windows for Pony's Eyes and Hands, the same names on every OS: the macOS backend is `macos::ax`; a
//! Windows backend (UI Automation, SendInput) provides the same functions and `El`.
#[cfg(target_os = "macos")]
pub use crate::macos::ax::{
    activate, app_name, app_version, bring, choose, click_at, default_browser, double_click_at, drag, find_running_app, front_app, front_pid, installed, is_front, menu_path, mouse_move, open_apps, open_background, open_with, pid_of,
    press_combo, press_key, read, screen_access, scroll_at, secure_input, settle, selection, trusted, type_all, type_text, typing_in, window, window_id, El,
};

/// One element of a window, in reading order (`depth` from the window).
#[derive(Debug, Clone, Default)]
pub struct Node {
    pub depth: u16,
    pub role: String,
    pub subrole: String,
    /// what it's called: description, title, or (for a text field) its placeholder
    pub label: String,
    pub value: String,
    /// numeric range for sliders/steppers (`AXMinValue`..`AXMaxValue`)
    pub min_val: Option<f64>,
    pub max_val: Option<f64>,
    pub enabled: bool,
    pub focused: bool,
    pub frame: (f64, f64, f64, f64),
    /// a web page's DOM class list and id (Chromium and WebKit expose them)
    pub classes: Vec<String>,
    pub url: String,
}
