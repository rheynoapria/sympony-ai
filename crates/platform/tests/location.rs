use platform::location::{moved_enough, Fix};
use serde_json::json;

fn bekasi() -> serde_json::Value {
    json!({ "name": "Bekasi", "lat": -6.2349, "lon": 106.9896 })
}

#[test]
fn same_place_is_not_a_move() {
    // ~500 m east
    assert!(!moved_enough(&bekasi(), &Fix { lat: -6.2349, lon: 106.9941, accuracy_m: 30.0 }));
}

#[test]
fn far_is_a_move() {
    // Bandung
    assert!(moved_enough(&bekasi(), &Fix { lat: -6.9175, lon: 107.6191, accuracy_m: 30.0 }));
}

#[test]
fn no_saved_place_is_a_move() {
    assert!(moved_enough(&serde_json::Value::Null, &Fix { lat: 1.0, lon: 2.0, accuracy_m: 30.0 }));
}
