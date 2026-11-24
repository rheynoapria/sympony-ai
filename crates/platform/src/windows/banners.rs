//! Other apps' notification banners on screen. Windows' notifications are read from its notification database
//! instead (`notifications.rs`), so none are read here. `trusted` stands for macOS's Accessibility permission, which
//! Windows doesn't have: Sympony may watch keys, type and read windows without one, so it's always true (Voice's
//! setup and onboarding then don't wait for a permission that can't be given).

/// One element of a banner.
pub struct El(());

pub fn trusted(_ask: bool) -> bool {
    true
}

pub struct Banner {
    pub id: String,
    /// "<app>, <title>, <subtitle>, <body>"
    pub description: String,
    pub title: String,
    pub subtitle: String,
    pub body: String,
    pub el: El,
}

pub fn banners() -> Vec<Banner> {
    vec![]
}

pub fn close(_b: &Banner) -> bool {
    false
}
