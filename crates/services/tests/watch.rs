use serde_json::json;
use services::watch::{lockkeys_changed, Watch};

#[test]
fn first_reading_is_a_change() {
    let mut w = Watch::default();
    assert_eq!(w.update(5), Some((5, None)));
}

#[test]
fn same_reading_is_quiet() {
    let mut w = Watch::default();
    w.update(5);
    assert_eq!(w.update(5), None);
}

#[test]
fn each_change_once() {
    let mut w = Watch::default();
    w.update(5);
    assert_eq!(w.update(6), Some((6, Some(5))));
    assert_eq!(w.update(6), None);
    assert_eq!(w.update(5), Some((5, Some(6))));
}

#[test]
fn caps_named_as_changed() {
    assert_eq!(lockkeys_changed(&json!({"caps": false}), &json!({"caps": true})), Some("caps"));
    assert_eq!(lockkeys_changed(&json!({"caps": true}), &json!({"caps": true})), None);
}
