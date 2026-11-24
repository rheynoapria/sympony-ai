//! The frontend's hover area (`notch_hitrect`, coalesced and stamped with `seq`, so stale ones are dropped) and the
//! mouse inside/outside it, which decides click-through and `notch:hover`. Window coordinates (points).
use platform::geometry::Rect;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct HitMsg {
    pub seq: u64,
    pub main: Rect,
    pub extra: Option<Rect>,
    pub vis: Vec<Rect>,
    /// the notch's spot and the buddy's under it (Step aside), when it's on
    pub near: Vec<Rect>,
    /// the ~60 px approach band below the closed notch for Pony's peek body
    pub peek: Option<Rect>,
    /// Pony's visible peek body below the closed notch: clickable (disables click-through) without firing `notch:hover`
    pub peek_hit: Option<Rect>,
}

fn rect(v: &Value) -> Option<Rect> {
    let n = |k: &str| v.get(k).and_then(Value::as_f64);
    Some(Rect { x: n("x")?, y: n("y")?, w: n("w")?, h: n("h")? })
}

impl HitMsg {
    /// `strip` and `frost` aren't used (frosted glass).
    pub fn parse(r: &Value) -> Option<HitMsg> {
        Some(HitMsg {
            seq: r.get("seq").and_then(Value::as_u64).unwrap_or(0),
            main: rect(r)?,
            extra: r.get("extra").and_then(rect),
            vis: r.get("vis").and_then(Value::as_array).map(|a| a.iter().filter_map(rect).collect()).unwrap_or_default(),
            near: ["near", "near2"].iter().filter_map(|k| r.get(*k).and_then(rect)).collect(),
            peek: r.get("peek").and_then(rect),
            peek_hit: r.get("peekHit").and_then(rect),
        })
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        self.main.contains(x, y) || self.extra.is_some_and(|r| r.contains(x, y)) || self.vis.iter().any(|r| r.contains(x, y))
    }

    /// True when the notch window should accept mouse events (over the notch itself OR over Pony's visible peek body).
    pub fn clickable(&self, x: f64, y: f64) -> bool {
        self.contains(x, y) || self.peek_hit.is_some_and(|r| r.contains(x, y))
    }
}

#[derive(Debug, Default)]
pub struct Hover {
    area: Option<HitMsg>,
    inside: bool,
    clickable: bool,
    near: bool,
    peek: bool,
}

impl Hover {
    /// False (and nothing changes) when `msg` is older than the area in use.
    pub fn apply(&mut self, msg: HitMsg) -> bool {
        if self.area.as_ref().is_some_and(|a| msg.seq < a.seq) {
            return false;
        }
        self.area = Some(msg);
        true
    }

    /// The mouse, in window coordinates: `Some(inside)` when that changed.
    pub fn update(&mut self, (x, y): (f64, f64)) -> Option<bool> {
        let inside = self.area.as_ref().is_some_and(|a| a.contains(x, y));
        (inside != self.inside).then(|| {
            self.inside = inside;
            inside
        })
    }

    /// Whether the window should accept cursor events (notch OR Pony peek body): `Some(clickable)` when that changed.
    pub fn update_clickable(&mut self, (x, y): (f64, f64)) -> Option<bool> {
        let clickable = self.area.as_ref().is_some_and(|a| a.clickable(x, y));
        (clickable != self.clickable).then(|| {
            self.clickable = clickable;
            clickable
        })
    }

    /// The mouse in the notch's spot (`notch:near`): `Some(near)` when that changed.
    pub fn update_near(&mut self, (x, y): (f64, f64)) -> Option<bool> {
        let near = self.area.as_ref().is_some_and(|a| a.near.iter().any(|r| r.contains(x, y)));
        (near != self.near).then(|| {
            self.near = near;
            near
        })
    }

    /// The mouse in Pony's peek band below the closed notch (`pony:near`): `Some(peek)` when that changed.
    pub fn update_peek(&mut self, (x, y): (f64, f64)) -> Option<bool> {
        let peek = self.area.as_ref().is_some_and(|a| a.peek.is_some_and(|r| r.contains(x, y)));
        (peek != self.peek).then(|| {
            self.peek = peek;
            peek
        })
    }

    /// The page reloaded: its `seq` starts again from 0.
    pub fn reset(&mut self) {
        *self = Hover::default();
    }

    /// Whether the page has sent its area yet (a page just loaded hasn't).
    pub fn has_area(&self) -> bool {
        self.area.is_some()
    }

    pub fn inside(&self) -> bool {
        self.inside
    }
}
