//! Other apps' windows for Pony's Eyes and Hands (stand-in: no window read, nothing pressed or typed yet; UI
//! Automation and SendInput later). Same functions and `El` as `macos::ax`, re-exported by `crate::ax`.
pub use crate::ax::Node;

/// The browser that opens web links.
pub fn default_browser() -> Option<String> {
    None
}

/// An element of another app's window (UI Automation's IUIAutomationElement later).
#[derive(Debug, Clone, PartialEq)]
pub struct El(());

impl El {
    pub fn app(_pid: i32) -> El {
        El(())
    }
    pub fn text(&self, _name: &str) -> String {
        String::new()
    }
    pub fn value(&self, _name: &str) -> String {
        String::new()
    }
    pub fn flag(&self, _name: &str) -> Option<bool> {
        None
    }
    pub fn url(&self) -> String {
        String::new()
    }
    pub fn strings(&self, _name: &str) -> Vec<String> {
        vec![]
    }
    pub fn el(&self, _name: &str) -> Option<El> {
        None
    }
    pub fn children(&self) -> Vec<El> {
        vec![]
    }
    pub fn frame(&self) -> (f64, f64, f64, f64) {
        (0.0, 0.0, 0.0, 0.0)
    }
    pub fn set_flag(&self, _name: &str, _on: bool) -> bool {
        false
    }
    pub fn set_text(&self, _name: &str, _value: &str) -> bool {
        false
    }
    pub fn act(&self, _action: &str) -> bool {
        false
    }
}

/// (pid, app name, app id) of the app in front, not `me`.
pub fn front_app(_me: i32) -> Option<(i32, String, String)> {
    None
}

pub fn window(_pid: i32) -> Option<El> {
    None
}

pub fn read(_win: &El, _max: usize) -> (Vec<Node>, Vec<El>) {
    (vec![], vec![])
}

pub fn typing_in(_pid: i32) -> bool {
    false
}

pub fn selection(_pid: i32) -> String {
    String::new()
}

pub fn is_front(_pid: i32) -> bool {
    false
}

pub fn bring(_pid: i32, _win: &El) -> bool {
    false
}

pub fn type_text(_text: &str) {}

pub fn press_key(_code: u16, _shift: bool) {}

pub fn type_all(_text: &str) {}

/// Whether Sympony may read and drive other apps' windows: not until UI Automation is in.
pub fn trusted(_ask: bool) -> bool {
    false
}

pub fn secure_input() -> bool {
    false
}

pub fn pid_of(_app: &str) -> Option<i32> {
    None
}

pub fn installed(_app: &str) -> bool {
    false
}

pub fn app_name(_app: &str) -> Option<String> {
    None
}

pub fn open_apps() -> Vec<(String, String)> {
    vec![]
}

pub fn front_pid() -> Option<i32> {
    None
}

pub fn activate(_pid: i32) {}

pub fn open_background(_app: &str, _url: &str) {}

pub fn open_with(_app: &str, _args: &[String]) {}

pub fn press_combo(_code: u16, _flags: u64) {}

pub fn click_at(_x: f64, _y: f64) {}

pub fn scroll_at(_x: f64, _y: f64, _dy: i32) {}

pub fn choose(_el: &El, _option: &str) -> bool {
    false
}

pub fn menu_path(_pid: i32, _path: &[String]) -> bool {
    false
}

pub fn settle(_pid: i32, _win: &El, _max_ms: u64) {}

pub fn app_version(_bundle: &str) -> Option<String> {
    None
}

pub fn screen_access(_ask: bool) -> bool {
    false
}

pub fn window_id(_pid: i32) -> Option<u32> {
    None
}
