use platform::geometry::{place, Display, Rect};
use serde_json::json;

fn mac(camera: Option<Rect>) -> Display {
    Display { id: 1, name: "Built-in Retina Display".into(), frame: Rect { x: 0.0, y: 0.0, w: 1800.0, h: 1169.0 }, camera, main: true }
}

#[test]
fn place_on_notched_mac() {
    let (win, cam) = place(&mac(Some(Rect { x: 790.0, y: 0.0, w: 220.0, h: 38.0 })));
    assert_eq!(win, Rect { x: 490.0, y: 0.0, w: 820.0, h: 420.0 });
    assert_eq!(cam, Some(json!({ "x": 410.0, "w": 220.0, "h": 38.0 })));
}

#[test]
fn place_without_camera() {
    let ext = Display { id: 2, name: "LG".into(), frame: Rect { x: 1800.0, y: 0.0, w: 2560.0, h: 1440.0 }, camera: None, main: false };
    let (win, cam) = place(&ext);
    assert_eq!(win, Rect { x: 1800.0 + 870.0, y: 0.0, w: 820.0, h: 420.0 });
    assert_eq!(cam, None);
}

#[test]
fn target_display_order() {
    let ext = Display { id: 2, name: "LG".into(), frame: Rect { x: 1800.0, y: 0.0, w: 2560.0, h: 1440.0 }, camera: None, main: false };
    let built = mac(Some(Rect { x: 790.0, y: 0.0, w: 220.0, h: 38.0 }));
    let all = vec![ext, built];
    // "primary" (default) and "all" go to the main display, an id to that display, an unknown id to the main
    assert_eq!(platform::geometry::target(&all, "primary").unwrap().id, 1);
    assert_eq!(platform::geometry::target(&all, "all").unwrap().id, 1);
    assert_eq!(platform::geometry::target(&all, "2").unwrap().id, 2);
    assert_eq!(platform::geometry::target(&all, "99").unwrap().id, 1);
}

#[test]
fn anchor_from_position() {
    assert_eq!(platform::geometry::anchor_px(0.5), 410.0);
    assert_eq!(platform::geometry::anchor_px(0.25), 205.0);
    assert_eq!(platform::geometry::anchor_px(7.0), 820.0); // clamped
    assert_eq!(platform::geometry::anchor_px_for(0.5, 700.0), 350.0);
}

#[test]
fn compact_display_clamps_window_and_reports_display_info() {
    let small = Display { id: 3, name: "Compact".into(), frame: Rect { x: 0.0, y: 0.0, w: 760.0, h: 430.0 }, camera: None, main: true };
    let (win, cam) = place(&small);
    assert_eq!(win, Rect { x: 12.0, y: 0.0, w: 736.0, h: 390.0 });
    assert_eq!(cam, None);
    assert_eq!(platform::geometry::display_info(&small), json!({ "id": 3, "w": 760.0, "h": 430.0, "hasCamera": false }));
}
