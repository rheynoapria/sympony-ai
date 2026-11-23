//! Other apps' notification banners on screen (stand-in: none seen yet). `trusted` stands for macOS's Accessibility
//! permission, which Windows doesn't have; it stays false until reading other apps' windows works here.

/// One element of a banner.
pub struct El(());

pub fn trusted(_ask: bool) -> bool {
    false
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
