use serde_json::json;
use services::hit::{HitMsg, Hover};

fn msg(seq: u64, x: f64, y: f64, w: f64, h: f64) -> HitMsg {
    HitMsg::parse(&json!({ "x": x, "y": y, "w": w, "h": h, "extra": null, "vis": [], "seq": seq })).unwrap()
}

#[test]
fn stale_seq_dropped() {
    let mut h = Hover::default();
    assert!(h.apply(msg(5, 372.0, 0.0, 76.0, 39.0)));
    assert!(!h.apply(msg(4, 0.0, 0.0, 820.0, 420.0)));
    assert_eq!(h.update((500.0, 300.0)), None); // still the seq-5 area: outside it, and it started outside
}

#[test]
fn enter_and_leave() {
    let mut h = Hover::default();
    h.apply(msg(1, 372.0, 0.0, 76.0, 39.0));
    assert_eq!(h.update((394.0, 32.0)), Some(true));
    assert_eq!(h.update((394.0, 30.0)), None);
    assert_eq!(h.update((394.0, 80.0)), Some(false));
}

#[test]
fn extra_and_vis_count_as_inside() {
    let mut h = Hover::default();
    let m = HitMsg::parse(&json!({ "x": 372, "y": 0, "w": 76, "h": 39,
        "extra": { "x": 100, "y": 0, "w": 50, "h": 50 }, "vis": [{ "x": 300, "y": 100, "w": 20, "h": 20 }], "seq": 1 })).unwrap();
    h.apply(m);
    assert_eq!(h.update((120.0, 10.0)), Some(true));
    assert_eq!(h.update((310.0, 110.0)), None);
    assert_eq!(h.update((5.0, 400.0)), Some(false));
}

#[test]
fn bad_message_rejected() {
    assert!(HitMsg::parse(&json!({ "seq": 1 })).is_none());
}

#[test]
fn reset_after_page_reload_takes_low_seq_again() {
    let mut h = Hover::default();
    h.apply(msg(500, 0.0, 0.0, 10.0, 10.0));
    h.reset(); // the page reloaded: bridge.js counts from 0 again
    assert!(h.apply(msg(1, 372.0, 0.0, 76.0, 39.0)));
    assert_eq!(h.update((394.0, 20.0)), Some(true));
}

#[test]
fn near_is_the_notchs_spot_or_the_buddys() {
    let mut h = Hover::default();
    h.apply(HitMsg::parse(&json!({ "x": 372, "y": 0, "w": 76, "h": 39, "seq": 1,
        "near": { "x": 360, "y": 0, "w": 100, "h": 60 }, "near2": { "x": 380, "y": 60, "w": 40, "h": 40 } })).unwrap());
    assert_eq!(h.update_near((10.0, 10.0)), None);
    assert_eq!(h.update_near((400.0, 50.0)), Some(true));
    assert_eq!(h.update_near((400.0, 90.0)), None); // the buddy's spot counts too
    assert_eq!(h.update_near((400.0, 200.0)), Some(false));
    // no near rect (step aside off): never near
    h.apply(msg(2, 372.0, 0.0, 76.0, 39.0));
    assert_eq!(h.update_near((400.0, 20.0)), None);
}

#[test]
fn peek_band_enters_and_leaves() {
    let mut h = Hover::default();
    h.apply(HitMsg::parse(&json!({ "x": 372, "y": 0, "w": 76, "h": 39, "seq": 1,
        "peek": { "x": 332, "y": 29, "w": 156, "h": 70 } })).unwrap());
    assert_eq!(h.update_peek((10.0, 10.0)), None);
    assert_eq!(h.update_peek((410.0, 60.0)), Some(true));
    assert_eq!(h.update_peek((410.0, 80.0)), None);
    assert_eq!(h.update_peek((410.0, 130.0)), Some(false));
    // peek cleared (e.g. notch opened or peek disabled): leaves cleanly
    assert_eq!(h.update_peek((410.0, 60.0)), Some(true));
    h.apply(msg(2, 372.0, 0.0, 76.0, 39.0));
    assert_eq!(h.update_peek((410.0, 60.0)), Some(false));
}

#[test]
fn peek_hit_makes_window_clickable_without_triggering_notch_hover() {
    let mut h = Hover::default();
    h.apply(
        HitMsg::parse(&json!({
            "x": 372, "y": 0, "w": 76, "h": 32, "seq": 1,
            "peek": { "x": 332, "y": 32, "w": 156, "h": 68 },
            "peekHit": { "x": 368, "y": 32, "w": 84, "h": 42 }
        }))
        .unwrap(),
    );
    // Hovering Pony's peeking head below the closed notch: window accepts clicks/pointermove,
    // but `notch:hover` stays false so `openOnHover` does not immediately open the notch.
    assert_eq!(h.update_peek((410.0, 50.0)), Some(true));
    assert_eq!(h.update_clickable((410.0, 50.0)), Some(true));
    assert_eq!(h.update((410.0, 50.0)), None);
    assert!(!h.inside());

    // Moving up onto the closed notch itself triggers `notch:hover` normally while staying clickable.
    assert_eq!(h.update((410.0, 16.0)), Some(true));
    assert_eq!(h.update_clickable((410.0, 16.0)), None);

    // Leaving both restores click-through and ends hover.
    assert_eq!(h.update((10.0, 200.0)), Some(false));
    assert_eq!(h.update_clickable((10.0, 200.0)), Some(false));
    assert_eq!(h.update_peek((10.0, 200.0)), Some(false));
}
