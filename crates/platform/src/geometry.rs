//! Where the notch window goes. Points, top-left origin (the whole desktop's), like the frontend's coordinates.
use serde_json::{json, Value};

pub const WIN_W: f64 = 820.0;
pub const WIN_H: f64 = 420.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Display {
    pub id: u32,
    pub name: String,
    pub frame: Rect,
    /// the camera notch, in desktop coordinates
    pub camera: Option<Rect>,
    pub main: bool,
}

/// The notch window: 820×420 centred on the display's top edge; and `notch:camera` for it (the camera's centre and
/// size in window coordinates), `None` on a display without one.
pub fn place(d: &Display) -> (Rect, Option<Value>) {
    let win = Rect { x: d.frame.x + (d.frame.w - WIN_W) / 2.0, y: d.frame.y, w: WIN_W, h: WIN_H };
    let cam = d.camera.map(|c| json!({ "x": c.x + c.w / 2.0 - win.x, "w": c.w, "h": c.h }));
    (win, cam)
}

/// Where the notch sits in its window for `notchPosition` (0..1 along the window; 0.5 is the middle).
pub fn anchor_px(position: f64) -> f64 {
    (position * WIN_W).clamp(0.0, WIN_W)
}

/// The display the notch goes on, from the `display` setting: a display's id, else the main display ("primary",
/// default; "all" too until multi-notch support lands).
pub fn target<'a>(all: &'a [Display], setting: &str) -> Option<&'a Display> {
    setting
        .parse::<u32>()
        .ok()
        .and_then(|id| all.iter().find(|d| d.id == id))
        .or_else(|| all.iter().find(|d| d.main))
        .or_else(|| all.first())
}
