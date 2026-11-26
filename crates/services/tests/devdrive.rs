use serde_json::json;
use services::devdrive::{pick, result_of};

fn wins() -> Vec<(String, String)> {
    vec![
        ("settings".into(), "tauri://localhost/settings.html".into()),
        ("notch-2".into(), "tauri://localhost/notch.html?display=2".into()),
        ("notch".into(), "tauri://localhost/notch.html".into()),
    ]
}

#[test]
fn a_window_is_found_by_its_label_first_then_by_label_or_page() {
    assert_eq!(pick("notch-2", &wins()), Ok("notch-2".into()));
    // (the label "notch" itself, though "notch-2" holds it too)
    assert_eq!(pick("notch", &wins()), Ok("notch".into()));
    // (a page, as the DevTools way matched them: the first window by label)
    assert_eq!(pick("notch.html", &wins()), Ok("notch".into()));
    assert_eq!(pick("settings.html", &wins()), Ok("settings".into()));
}

#[test]
fn no_such_window_lists_the_ones_there_are() {
    let e = pick("chat", &wins()).unwrap_err();
    assert!(e.contains("\"chat\""), "{e}");
    for label in ["notch", "notch-2", "settings"] {
        assert!(e.contains(label), "{e}");
    }
    assert!(pick("", &wins()).is_err());
    assert!(pick("notch", &[]).is_err());
}

#[test]
fn the_script_s_value_comes_back_and_undefined_is_null() {
    let r = json!({"result": {"type": "object", "value": {"a": [1, "x"]}}}).to_string();
    assert_eq!(result_of(&r), Ok(json!({"a": [1, "x"]})));
    assert_eq!(result_of(&json!({"result": {"type": "number", "value": 2}}).to_string()), Ok(json!(2)));
    assert_eq!(result_of(&json!({"result": {"type": "undefined"}}).to_string()), Ok(json!(null)));
}

#[test]
fn what_the_script_threw_is_the_error() {
    let thrown = json!({
        "result": {"type": "object", "subtype": "error", "description": "Error: boom\n    at <anonymous>:1:7"},
        "exceptionDetails": {"text": "Uncaught", "exception": {"description": "Error: boom\n    at <anonymous>:1:7"}}
    });
    assert_eq!(result_of(&thrown.to_string()), Err("Error: boom\n    at <anonymous>:1:7".into()));
    // (a rejected promise that isn't an Error: only the text)
    let rejected = json!({"result": {"type": "string", "value": "no"}, "exceptionDetails": {"text": "Uncaught (in promise)"}});
    assert_eq!(result_of(&rejected.to_string()), Err("Uncaught (in promise)".into()));
}

#[test]
fn a_protocol_error_or_an_odd_answer_is_an_error() {
    let refused = json!({"code": -32000, "message": "Object couldn't be returned by value"});
    assert_eq!(result_of(&refused.to_string()), Err("Object couldn't be returned by value".into()));
    assert!(result_of("not json").is_err());
}
